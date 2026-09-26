// @ts-check
// T22 model matrix: the pure selection and arithmetic, then a whole run against a fake server.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PRESETS, defaultFlavors, resolveMatrix, entryEstimate, impliedMultiplier } from '../../phase0/probe/lib/matrix.mjs';
import { parseArgs, planCost, selectTests, runProbe } from '../../phase0/probe/api-probe.mjs';
import { pickModels } from '../../phase0/probe/lib/models.mjs';

/** @param {string} id @param {number} p @param {Record<string, any>} [x] */
const model = (id, p, x = {}) => ({ id, token_conversion_rate: { prompt: p, completion: p * 5 }, cui_capable: true, ...x });
const CATALOG = [
  model('google-claude-45-haiku', 0.055),
  model('google-claude-sonnet-5', 0.11),
  model('gpt-5.4-nano', 0.011),
  model('gpt-5.6-sol', 0.55),
  model('gpt-4.1-mini', 0.022),
  model('google-gemini-3.1-flash-lite-gov', 0.01375),
  model('google-gemini-3.1-pro-com', 0.125),
  model('mistral-large-3', 0.032),
  model('deepseek-v4-pro', 0.087, { cui_capable: false }),
];

test('defaultFlavors follows the plan: Claude M, new and reasoning GPT R+CC, GPT-4.1 CC, Gemini G+CC, others CC', () => {
  assert.deepEqual(defaultFlavors('google-claude-opus-5-5'), ['M']);
  assert.deepEqual(defaultFlavors('aws-bedrock-claude-fable-5-1-gov'), ['M']);
  assert.deepEqual(defaultFlavors('gpt-5.6-sol'), ['R', 'CC']);
  assert.deepEqual(defaultFlavors('gpt-6-astra'), ['R', 'CC']);
  assert.deepEqual(defaultFlavors('aws-bedrock-gpt-5-6-luna-gov'), ['R', 'CC']);
  assert.deepEqual(defaultFlavors('gpt-5.1'), ['R', 'CC']);
  assert.deepEqual(defaultFlavors('gpt-o3-mini'), ['R', 'CC']);
  assert.deepEqual(defaultFlavors('gpt-4.1-mini'), ['CC']);
  assert.deepEqual(defaultFlavors('aws-bedrock-gpt-oss-120b-gov'), ['CC']);
  assert.deepEqual(defaultFlavors('google-gemini-3.7-flash'), ['G', 'CC']);
  assert.deepEqual(defaultFlavors('grok-4-20-reasoning'), ['CC']);
});

test('resolveMatrix expands presets, honors @flavors, dedupes, and reports what it skipped', () => {
  const { entries, notes } = resolveMatrix('small,gpt-5.6-sol@R,gpt-5.6-sol@R,deepseek-v4-pro,no-such-model-x,bogus', CATALOG);
  assert.deepEqual(entries.map((e) => `${e.model.id}@${e.flavors.join('+')}`), [
    'google-claude-45-haiku@M',
    'gpt-5.4-nano@R+CC',
    'gpt-4.1-mini@CC',
    'google-gemini-3.1-flash-lite-gov@G+CC',
    'gpt-5.6-sol@R',
  ]);
  assert.equal(entries[0].preset, 'small');
  assert.equal(entries[4].preset, null);
  assert.ok(notes.some((x) => /gpt-6-luna \(preset small\): not in this tenant's catalog/.test(x)));
  assert.ok(notes.some((x) => /deepseek-v4-pro: cui_capable:false/.test(x)));
  assert.ok(notes.some((x) => /no-such-model-x: not in this tenant's catalog/.test(x)));
  assert.ok(notes.some((x) => /bogus: not a preset/.test(x)));
  assert.equal(resolveMatrix('deepseek-v4-pro', CATALOG, { allowNonCui: true }).entries.length, 1);
  assert.throws(() => resolveMatrix('gpt-5.6-sol@X', CATALOG), /unknown flavor X/);
});

test('every preset id is a plausible catalog id and every preset has a purpose', () => {
  for (const [name, p] of Object.entries(PRESETS)) {
    assert.ok(p.purpose.length > 20, name);
    for (const id of p.ids) assert.match(id, /^[a-z0-9][a-z0-9.-]+$/, `${name}: ${id}`);
  }
});

test('entryEstimate: two cache and three loop requests per flavor, Claude prefix at least the M minimum', () => {
  const [sonnet] = resolveMatrix('google-claude-sonnet-5', CATALOG).entries;
  const reqs = entryEstimate(sonnet, { prefixTokens: 6000 });
  assert.equal(reqs.length, 5);
  assert.ok(reqs[0].inTokens >= 6000);
  const [sol] = resolveMatrix('gpt-5.6-sol', CATALOG).entries;
  assert.equal(entryEstimate(sol).length, 10);
});

test('impliedMultiplier recovers the rule from a bill, and refuses when the constant would dominate', () => {
  const rates = { prompt: 0.0729, completion: 0.364 };
  // Haiku, T1 B: 5,244 read + 13 uncached + 4 out billed 42 → about 0.1.
  const read = impliedMultiplier({ billed: 42, cachedTokens: 5244, uncachedTokens: 13, outputTokens: 4, rates });
  assert.ok(read !== null && Math.abs(read - 0.1) < 0.02, String(read));
  // T1 A: 5,244 written billed 474 → about 1.23.
  const write = impliedMultiplier({ billed: 474, cachedTokens: 5244, uncachedTokens: 13, outputTokens: 4, rates });
  assert.ok(write !== null && Math.abs(write - 1.23) < 0.03, String(write));
  assert.equal(impliedMultiplier({ billed: 5, cachedTokens: 100, uncachedTokens: 0, outputTokens: 0, rates }), null, 'cached part worth < 20 tokens');
  assert.equal(impliedMultiplier({ billed: null, cachedTokens: 5244, uncachedTokens: 0, outputTokens: 0, rates }), null);
  assert.equal(impliedMultiplier({ billed: 42, cachedTokens: 0, uncachedTokens: 0, outputTokens: 0, rates }), null);
});

test('--matrix alone selects T0 and T22; with --tests it adds T22; planCost prices matrix requests per model', () => {
  const base = ['--api', 'api.test.example', '--alias', 't'];
  assert.deepEqual(parseArgs([...base, '--matrix', 'small']).tests, ['T0', 'T22']);
  assert.deepEqual(parseArgs([...base, '--matrix', 'small', '--tests', 'T18']).tests, ['T18', 'T22']);
  assert.equal(parseArgs(base).tests, null);
  assert.ok(!selectTests(null, [], true).some((t) => t.id === 'T22'), 'T22 is opt-in');
  const { models } = pickModels(CATALOG);
  const matrix = resolveMatrix('gpt-5.6-sol@R', CATALOG).entries;
  const plan = planCost(selectTests(['T22'], [], true), models, { prefixTokens: 6000, ttlWaitS: 0, measure: true, matrix });
  // Catalog rates x1.3 when no tokenizer rate is known: 2 × (2540 in + 256 out) + 3 × (400 in + 768 out).
  const cost = (/** @type {number} */ p, /** @type {number} */ c) => 2 * (2540 * p + 256 * c) + 3 * (400 * p + 768 * c);
  assert.equal(plan.total, Math.round(cost(0.55 * 1.3, 2.75 * 1.3)));
  // With a tokenizer rate it is used as is.
  const billed = { 'gpt-5.6-sol': { prompt: 0.7, completion: 3, source: 'tokenizer' } };
  assert.equal(planCost(selectTests(['T22'], [], true), models, { prefixTokens: 6000, ttlWaitS: 0, measure: true, matrix }, billed).total, Math.round(cost(0.7, 3)));
});

// ---------------------------------------------------------------- whole run against a fake server

/**
 * A fake Ask Sage that behaves like the 2026-09-26 run: Claude and OpenAI cache on repeat and
 * return reasoning state; Gemini returns no thought signature and accepts only the placeholder.
 */
function fakeAskSage() {
  const seen = new Map();
  /** @type {string[]} */
  const calls = [];
  const json = (/** @type {unknown} */ body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  /** @param {string} key */
  const repeat = (key) => {
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    return n > 1;
  };
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init) => {
    const path = new URL(String(url)).pathname;
    const b = JSON.parse(String(init?.body || '{}'));
    calls.push(`${path} ${b.model || ''}`);
    if (path === '/server/tokenizer') {
      const tokens = Math.ceil(String(b.content).length / 4);
      return json({ response: b.convert_to_asksage ? Math.round(tokens * 0.1 + (b.completion_estimate || 0) * 0.5 + 2) : tokens, status: 200 });
    }
    if (path === '/server/anthropic/v1/messages') {
      const sys = b.system?.[0]?.text;
      if (sys) {
        const hit = repeat(sys);
        return json({ model: 'claude-served', stop_reason: 'end_turn', content: [{ type: 'text', text: 'OK' }], usage: { input_tokens: 10, cache_read_input_tokens: hit ? 5000 : 0, cache_creation_input_tokens: hit ? 0 : 5000, output_tokens: 2 } });
      }
      const last = b.messages[b.messages.length - 1];
      if (Array.isArray(last.content) && last.content[0]?.type === 'tool_result') return json({ model: 'claude-served', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Sunny' }], usage: { input_tokens: 200, output_tokens: 5 } });
      const content = [...(b.thinking ? [{ type: 'thinking', thinking: 'hmm', signature: 'S'.repeat(600) }] : []), { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Paris' } }];
      return json({ model: 'claude-served', stop_reason: 'tool_use', content, usage: { input_tokens: 300, output_tokens: 80, output_tokens_details: { thinking_tokens: 40 } } });
    }
    if (path === '/server/openai/v1/responses') {
      if (b.instructions) {
        const hit = repeat(b.instructions);
        return json({ model: b.model, status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }], usage: { input_tokens: 2500, input_tokens_details: { cached_tokens: hit ? 2304 : 0 }, output_tokens: 2, output_tokens_details: { reasoning_tokens: 0 } } });
      }
      if (b.input.some((/** @type {any} */ i) => i.type === 'function_call_output')) return json({ model: b.model, status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Sunny' }] }], usage: { input_tokens: 100, output_tokens: 5 } });
      return json({ model: b.model, status: 'completed', output: [{ type: 'reasoning', encrypted_content: 'E'.repeat(900) }, { type: 'function_call', call_id: 'call_1', name: 'get_weather', arguments: '{"city":"Paris"}' }], usage: { input_tokens: 60, output_tokens: 90, output_tokens_details: { reasoning_tokens: 64 } } });
    }
    if (path === '/server/openai/v1/chat/completions') {
      if (/gemini/.test(b.model)) return json({ error: { message: `Unsupported model: ${b.model}`, type: 'invalid_request_error' } }, 400);
      const sys = b.messages[0]?.role === 'system' ? b.messages[0].content : null;
      if (sys) {
        const hit = repeat(`cc:${sys}`);
        return json({ model: b.model, choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2500, prompt_tokens_details: { cached_tokens: hit ? 2304 : 0 }, completion_tokens: 2 } });
      }
      if (b.messages.some((/** @type {any} */ x) => x.role === 'tool')) return json({ model: b.model, choices: [{ message: { role: 'assistant', content: 'Sunny' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 5 } });
      return json({ model: b.model, choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 60, completion_tokens: 20 } });
    }
    if (path.startsWith('/server/google/')) {
      const usage = { promptTokenCount: 40, candidatesTokenCount: 5, totalTokenCount: 45 };
      if (b.systemInstruction) return json({ modelVersion: 'gemini-served', candidates: [{ content: { role: 'model', parts: [{ text: 'OK' }] }, finishReason: 'STOP' }], usageMetadata: usage });
      if (b.contents.length > 1) {
        const sig = b.contents[1].parts.find((/** @type {any} */ p) => p.functionCall)?.thoughtSignature;
        if (sig !== 'skip_thought_signature_validator') return json({ error: { code: 400, message: 'Invalid request.', status: 'INVALID_ARGUMENT' } }, 400);
        return json({ modelVersion: 'gemini-served', candidates: [{ content: { role: 'model', parts: [{ text: 'Sunny' }] }, finishReason: 'STOP' }], usageMetadata: usage });
      }
      return json({ modelVersion: 'gemini-served', candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'get_weather', args: { city: 'Paris' } } }] }, finishReason: 'STOP' }], usageMetadata: usage });
    }
    return json({ status: 404, response: 'not found' }, 404);
  };
  return { fetchImpl, calls };
}

test('T22 runs every flavor end to end against a fake server and reports a row per model and flavor', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'probe-matrix-'));
  try {
    const args = parseArgs(['--api', 'api.test.example', '--alias', 'fake', '--matrix', 'google-claude-sonnet-5,gpt-5.6-sol,google-gemini-3.1-pro-com', '--tests', 'T22', '--no-measure']);
    const { fetchImpl } = fakeAskSage();
    const { run } = await runProbe({ args, apiKey: '', email: '', noAuthHeaders: true, catalog: /** @type {any} */ (CATALOG), fetchImpl, sleep: async () => {}, outDir: dir, log: () => {}, runId: 'test-run' });
    const t22 = /** @type {any} */ (run.results.find((r) => r.id === 'T22'));
    assert.equal(t22.status, 'ok', t22.reason);
    const rows = t22.observations.matrixRows;
    assert.deepEqual(rows.map((/** @type {any} */ r) => `${r.model}@${r.flavor}`), [
      'google-claude-sonnet-5@M',
      'gpt-5.6-sol@R',
      'gpt-5.6-sol@CC',
      'google-gemini-3.1-pro-com@G',
      'google-gemini-3.1-pro-com@CC',
    ]);
    const by = Object.fromEntries(rows.map((/** @type {any} */ r) => [`${r.model}@${r.flavor}`, r]));
    assert.equal(by['google-claude-sonnet-5@M'].cacheRead, 5000);
    assert.equal(by['google-claude-sonnet-5@M'].state, 'signature 600 chars');
    assert.equal(by['google-claude-sonnet-5@M'].round2, 'ok');
    assert.equal(by['gpt-5.6-sol@R'].state, 'encrypted reasoning 900 chars');
    assert.equal(by['gpt-5.6-sol@R'].round2Without, 'ok');
    assert.equal(by['gpt-5.6-sol@CC'].cacheRead, 2304);
    assert.equal(by['google-gemini-3.1-pro-com@G'].state, 'none');
    assert.match(by['google-gemini-3.1-pro-com@G'].round2, /^rejected/);
    assert.equal(by['google-gemini-3.1-pro-com@G'].round2Placeholder, 'ok');
    assert.match(by['google-gemini-3.1-pro-com@CC'].cacheError, /Unsupported model/);
    assert.equal(t22.observations.billedRates['gpt-5.6-sol'].source, 'tokenizer');

    const checks = Object.fromEntries(t22.checks.map((/** @type {any} */ c) => [c.name, c.result]));
    assert.equal(checks['google-claude-sonnet-5@M: cache read on repeat'], 'pass');
    assert.equal(checks['gpt-5.6-sol@R: reasoning state returned'], 'pass');
    assert.equal(checks['google-gemini-3.1-pro-com@G: reasoning state returned'], 'fail');
    assert.equal(checks['google-gemini-3.1-pro-com@G: round 2 with placeholder signature'], 'pass');
    assert.equal(checks['google-gemini-3.1-pro-com@CC: cache request accepted'], 'fail');

    const md = readFileSync(join(dir, 'summary.md'), 'utf8');
    assert.match(md, /## Model matrix \(T22\)/);
    assert.match(md, /\| `gpt-5\.6-sol` \| R \| gpt-5\.6-sol \| 2304 \/ 2500 \|/);
    assert.deepEqual(run.options.matrix, ['google-claude-sonnet-5@M', 'gpt-5.6-sol@R+CC', 'google-gemini-3.1-pro-com@G+CC']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
