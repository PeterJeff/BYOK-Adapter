// @ts-check
'use strict';

// Same fixtures as test/probe/api-probe.test.mjs (research), pointed at the CommonJS port.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { detectError, isAuthInvalid, parseOutputCapTooLarge, toLanguageModelError } = require('../src/errors');

test('detectError knows every shape seen in research/live fixtures', () => {
  assert.equal(detectError({ response: 'Token is invalid [1]', status: 400 })?.shape, 'asksage-envelope');
  assert.equal(detectError({ response: 'fine', status: 200 }), null);
  assert.equal(detectError({ type: 'error', error: { type: 'overloaded_error', message: 'x' } })?.shape, 'anthropic-error');
  assert.equal(detectError({ error: { code: 400, message: 'm', status: 'INVALID_ARGUMENT' } })?.shape, 'gemini-error');
  assert.equal(detectError({ error: { message: 'm', type: 't', code: 400 } })?.shape, 'openai-error');
  assert.equal(detectError({ type: 'response.failed', response: { error: { code: 'x', message: 'm' } } })?.shape, 'responses-failed');
  assert.equal(detectError(null), null);
  assert.equal(detectError('a string'), null);
});

test('isAuthInvalid matches the bad-credential message every flavor returns', () => {
  assert.ok(isAuthInvalid(detectError({ response: 'Token is invalid [1]', status: 400 })));
  assert.ok(!isAuthInvalid(detectError({ error: { code: 500, message: 'server error' } })));
  assert.ok(!isAuthInvalid(null));
});

test('parseOutputCapTooLarge extracts the real cap from a rejection (live finding, 2026-09-27)', () => {
  const real = detectError({ error: { message: 'max_tokens is too large: 100000. This model supports at most 32768 completion tokens, whereas you provided 100000.', type: 'invalid_request_error' } });
  assert.equal(parseOutputCapTooLarge(real), 32768);
  assert.equal(parseOutputCapTooLarge(detectError({ error: { message: 'supports at most 4,096 output tokens', type: 'invalid_request_error' } })), 4096, 'handles a comma-grouped number and "output tokens" wording');
  assert.equal(parseOutputCapTooLarge(detectError({ response: 'Token is invalid [1]', status: 400 })), null, 'an unrelated error must not match');
  assert.equal(parseOutputCapTooLarge(null), null);
});

test('parseOutputCapTooLarge reads Anthropic\'s rejection from the recorded fixture (DEFECTS D1)', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../research/live/manual-run/probe/2026-09-26-0402-c5ced6/T8/061-over-limit.json'), 'utf8'));
  assert.equal(fixture.request.body.max_tokens, 136000);
  const detected = detectError(fixture.body);
  assert.equal(detected?.shape, 'anthropic-error');
  assert.equal(parseOutputCapTooLarge(detected), 64000);
});

test('toLanguageModelError uses vscode.LanguageModelError.Blocked when present, else a plain Error', () => {
  const withApi = { LanguageModelError: { Blocked: (/** @type {string} */ m) => ({ code: 'Blocked', message: m }) } };
  assert.deepEqual(toLanguageModelError(/** @type {any} */ (withApi), new Error('boom')), { code: 'Blocked', message: 'boom' });
  const withoutApi = {};
  const e = toLanguageModelError(/** @type {any} */ (withoutApi), { shape: 'asksage-envelope', message: 'Token is invalid [1]' });
  assert.ok(e instanceof Error);
  assert.match(e.message, /asksage-envelope/);
});
