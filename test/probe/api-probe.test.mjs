// @ts-check
// Unit tests for the Phase 0b probe's pure pieces. Redaction is covered most, because it
// is what keeps the key and tenant identity out of committed fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRedactor, summarizeUser, jwtShape, keepHeaders } from '../../phase0/probe/lib/redact.mjs';
import { SseParser, splitSepStream, detectError } from '../../phase0/probe/lib/streams.mjs';
import { normalize, estimate, rawUsage, outputOf } from '../../phase0/probe/lib/usage.mjs';
import { pickModels } from '../../phase0/probe/lib/models.mjs';
import { parseArgs, preEstimate } from '../../phase0/probe/api-probe.mjs';
import { closest } from '../../phase0/probe/lib/tests.mjs';
import { createClient } from '../../phase0/probe/lib/client.mjs';

const KEY = 'a'.repeat(30) + 'SECRET' + 'b'.repeat(28);
const b64 = (/** @type {object} */ o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = `${b64({ alg: 'HS256' })}.${b64({ user_id: 1, iat: 10, exp: 3610 })}.c2lnbmF0dXJlLXZhbHVl`;

test('redactor removes secrets, JWTs, emails, identity fields and hosts', () => {
  const r = createRedactor({ secrets: [KEY], hosts: ['api.tenant.example'], alias: 'tenant-a' });
  const out = JSON.stringify(
    r.value({ note: `key ${KEY} at https://API.tenant.example/x by pat@corp.example`, token: 'opaque-token-value', user_id: 77, nested: { org: { id: 1 } }, max_tokens: 5, jwt: JWT }),
  );
  assert.ok(!out.includes(KEY) && !out.includes('SECRET'));
  assert.ok(!out.includes('pat@corp.example') && !/tenant\.example/i.test(out));
  assert.ok(!out.includes(JWT) && !out.includes('opaque-token-value'));
  assert.match(out, /<tenant-a>/);
  assert.match(out, /"user_id":"<redacted>"/);
  assert.match(out, /"org":"<redacted:object>"/);
  assert.match(out, /"max_tokens":5/);
});

test('redactor elides long request strings and truncates long responses', () => {
  const r = createRedactor({ alias: 't' });
  assert.match(String(r.value('x'.repeat(3000), { elide: 2000 })), /^<elided chars=3000 sha256=[0-9a-f]{16}>$/);
  assert.match(String(r.value('y'.repeat(5000), { truncate: 4000 })), /<truncated chars=5000>$/);
});

test('assertClean refuses text that still holds a secret; addSecret covers late secrets', () => {
  const r = createRedactor({ secrets: [KEY], hosts: ['h.example'], alias: 't' });
  assert.throws(() => r.assertClean(`x ${KEY}`), /secret/);
  assert.throws(() => r.assertClean('see h.example'), /host/);
  r.addSecret('late-opaque-secret');
  assert.ok(!r.serialize({ a: 'late-opaque-secret' }).includes('late-opaque-secret'));
});

test('summarizeUser keeps budget and model-restriction values, drops identity', () => {
  const s = /** @type {any} */ (summarizeUser({ email: 'a@b.c', user_id: 3, max_tokens: 100, force_models: 'x,y', custom_intro_prompt: 'hello', org: { org_id: 9, pool_tokens: 50 } }));
  assert.equal(s.email, 'string');
  assert.equal(s.user_id, 'number');
  assert.equal(s.max_tokens, 100);
  assert.equal(s.force_models, 'x,y');
  assert.deepEqual(s.custom_intro_prompt, { type: 'string', chars: 5 });
  assert.equal(s.org, 'object');
});

test('jwtShape reports claim names and lifetime only; keepHeaders drops cookies', () => {
  assert.deepEqual(jwtShape(JWT), { jwt: true, alg: 'HS256', claims: ['exp', 'iat', 'user_id'], lifetimeS: 3600 });
  assert.deepEqual(keepHeaders({ 'Set-Cookie': 's=1', 'Content-Type': 'text/event-stream', 'x-ratelimit-remaining': '9' }), { 'content-type': 'text/event-stream', 'x-ratelimit-remaining': '9' });
});

test('SseParser handles split chunks, CRLF and multi-line data', () => {
  const p = new SseParser();
  const got = [...p.feed('event: a\r\ndata: {"x"'), ...p.feed(':1}\r'), ...p.feed('\n\r\ndata: l1\ndata: l2\n\n: comment\ndata: tail'), ...p.end()];
  assert.deepEqual(got, [{ event: 'a', data: '{"x":1}' }, { data: 'l1\nl2' }, { data: 'tail' }]);
});

test('splitSepStream unescapes the delimiter; detectError knows every shape', () => {
  assert.deepEqual(splitSepStream('{"a":"x@|@@sep@@|@y"}@|@sep@|@{"b":2}').map((c) => c.data), [{ a: 'x@|@sep@|@y' }, { b: 2 }]);
  assert.equal(detectError({ response: 'Token is invalid [1]', status: 400 })?.shape, 'asksage-envelope');
  assert.equal(detectError({ response: 'fine', status: 200 }), null);
  assert.equal(detectError({ type: 'error', error: { type: 'overloaded_error', message: 'x' } })?.shape, 'anthropic-error');
  assert.equal(detectError({ error: { code: 400, message: 'm', status: 'INVALID_ARGUMENT' } })?.shape, 'gemini-error');
  assert.equal(detectError({ type: 'response.failed', response: { error: { code: 'x', message: 'm' } } })?.shape, 'responses-failed');
});

test('normalize follows PLAN §3.2 per flavor; estimate prices three hypotheses', () => {
  const m = normalize('M', { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200, cache_creation: { ephemeral_5m_input_tokens: 150, ephemeral_1h_input_tokens: 50 }, output_tokens: 5 });
  assert.deepEqual([m?.inputUncached, m?.cacheRead, m?.cacheWrite5m, m?.cacheWrite1h, m?.thinkingUnknown], [10, 1000, 150, 50, true]);
  const c = normalize('CC', { prompt_tokens: 1200, prompt_tokens_details: { cached_tokens: 1024 }, completion_tokens: 50, completion_tokens_details: { reasoning_tokens: 40 } });
  assert.deepEqual([c?.inputUncached, c?.cacheRead, c?.visibleOutput, c?.thinking], [176, 1024, 10, 40]);
  const g = normalize('G', { promptTokenCount: 100, cachedContentTokenCount: 60, candidatesTokenCount: 5, thoughtsTokenCount: 7 });
  assert.deepEqual([g?.inputUncached, g?.cacheRead, g?.visibleOutput, g?.thinking], [40, 60, 5, 7]);
  const e = estimate(normalize('CC', { prompt_tokens: 1000, prompt_tokens_details: { cached_tokens: 1000 }, completion_tokens: 0 }), { prompt: 0.5, completion: 2 });
  assert.deepEqual([e?.discounted, e?.full, e?.inverse], [50, 500, 2000]);
  assert.equal(closest(55, /** @type {any} */ (e)), 'discounted');
});

test('stream assembly: Anthropic usage merge, thinking signature and tool JSON', () => {
  const events = [
    { data: { type: 'message_start', message: { model: 'm', usage: { input_tokens: 9, cache_read_input_tokens: 100, output_tokens: 1 } } } },
    { data: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } } },
    { data: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hm' } } },
    { data: { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'SIG' } } },
    { data: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't1', name: 'f', input: {} } } },
    { data: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"a":' } } },
    { data: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '1}' } } },
    { data: { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 30 } } },
  ];
  assert.deepEqual(rawUsage('M', { events }), { input_tokens: 9, cache_read_input_tokens: 100, output_tokens: 30 });
  const o = outputOf('M', { events });
  assert.equal(o.content[0].signature, 'SIG');
  assert.deepEqual(o.content[1].input, { a: 1 });
  assert.equal(o.stopReason, 'tool_use');
});

test('pickModels prefers the cheapest non -com match and refuses non-CUI overrides', () => {
  const cat = [
    { id: 'claude-haiku-4-5-com', cui_capable: true, token_conversion_rate: { prompt: 0.04, completion: 0.2 } },
    { id: 'google-claude-45-haiku', cui_capable: true, token_conversion_rate: { prompt: 0.055, completion: 0.275 } },
    { id: 'gpt-o3', cui_capable: false, token_conversion_rate: { prompt: 0.1, completion: 0.4 } },
  ];
  assert.equal(pickModels(cat).models.claude?.id, 'google-claude-45-haiku');
  assert.throws(() => pickModels(cat, { overrides: { gpt: 'gpt-o3' } }), /cui_capable/);
});

test('parseArgs requires an alias; preEstimate caps assumed output', () => {
  assert.throws(() => parseArgs(['--api', 'api.x.example']), /--alias/);
  assert.equal(parseArgs(['--api', 'https://API.x.example/server', '--alias', 'x']).api, 'api.x.example');
  assert.equal(Math.round(preEstimate({ max_tokens: 999999 }, { prompt: 1e-9, completion: 1 })), 4096);
});

test('createClient: key-only (no email) authenticates M/CC/R/G directly and never throws obtaining a JWT', async () => {
  /** @type {{ url: string, headers: Record<string, string> }[]} */
  const seen = [];
  const fetchImpl = async (/** @type {string} */ url, /** @type {any} */ init) => {
    seen.push({ url, headers: init.headers });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const client = createClient({ apiBase: 'https://api.x.example', apiKey: KEY, fetchImpl: /** @type {any} */ (fetchImpl) });

  // token() must resolve to null, not throw, when there is a key but no email.
  await assert.doesNotReject(() => client.token());
  assert.equal(client.hasJwt(), false);

  // An M-kind (key-auth) call still carries the real API key.
  await client.call({ label: 'm-call', kind: 'M', path: '/server/anthropic/v1/messages', body: { model: 'm' } });
  assert.equal(seen[0].headers['x-api-key'], KEY);

  // A server-kind (jwt-auth) call goes out with no credential rather than throwing.
  await client.call({ label: 'server-call', kind: 'server', path: '/server/count-monthly-tokens', method: 'GET' });
  assert.equal(seen[1].headers['x-access-tokens'], undefined);
  assert.equal(seen[1].headers.authorization, undefined);
});
