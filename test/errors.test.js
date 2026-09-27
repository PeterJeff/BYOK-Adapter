// @ts-check
'use strict';

// Same fixtures as test/probe/api-probe.test.mjs (research), pointed at the CommonJS port.

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectError, isAuthInvalid, toLanguageModelError } = require('../src/errors');

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

test('toLanguageModelError uses vscode.LanguageModelError.Blocked when present, else a plain Error', () => {
  const withApi = { LanguageModelError: { Blocked: (/** @type {string} */ m) => ({ code: 'Blocked', message: m }) } };
  assert.deepEqual(toLanguageModelError(/** @type {any} */ (withApi), new Error('boom')), { code: 'Blocked', message: 'boom' });
  const withoutApi = {};
  const e = toLanguageModelError(/** @type {any} */ (withoutApi), { shape: 'asksage-envelope', message: 'Token is invalid [1]' });
  assert.ok(e instanceof Error);
  assert.match(e.message, /asksage-envelope/);
});
