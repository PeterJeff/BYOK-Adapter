// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUserInfoService, parseForceModels } = require('../../src/auth/userInfo');

/** @param {unknown} body */
function jsonResponse(body) {
  return { status: 200, headers: { get: (/** @type {string} */ h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) };
}

/** A stand-in for the access-token service: hands a fixed JWT to the request. */
const accessToken = /** @type {any} */ ({ withRetry: (/** @type {(t: string) => any} */ run) => run('jwt-1') });

test('parseForceModels: accepts the JSON array the tenant returns and the comma-separated string the spec describes', () => {
  assert.deepEqual(parseForceModels([]), []); // public test account (T0, 2026-09-26)
  assert.deepEqual(parseForceModels(['gpt-4.1-nano', ' gpt-5.4-nano ', '', 'gpt-4.1-nano']), ['gpt-4.1-nano', 'gpt-5.4-nano']);
  assert.deepEqual(parseForceModels('gpt-4.1-nano, gpt-5.4-nano,,'), ['gpt-4.1-nano', 'gpt-5.4-nano']);
  assert.deepEqual(parseForceModels(''), []);
  for (const other of [null, undefined, false, true, 3, {}]) assert.deepEqual(parseForceModels(other), []); // one schema types it as boolean
});

test('getForceModels: read from validate_token_with_full_user, cached; getLimits still returns max_tokens', async () => {
  let calls = 0;
  const fetchImpl = /** @type {any} */ (async () => {
    calls++;
    return jsonResponse({ response: { max_tokens: 200000, force_models: 'gpt-4.1-nano,gpt-5.4-nano' } });
  });
  const svc = createUserInfoService({ apiBase: 'https://api.test', accessToken, fetchImpl });
  assert.deepEqual(await svc.getForceModels(), ['gpt-4.1-nano', 'gpt-5.4-nano']);
  assert.deepEqual(await svc.getForceModels(), ['gpt-4.1-nano', 'gpt-5.4-nano']);
  assert.equal(calls, 1);
  assert.deepEqual(await svc.getLimits(), { maxTokens: 200000, forceModels: ['gpt-4.1-nano', 'gpt-5.4-nano'] });
});

test('getForceModels: a failure is rethrown without refetching for a while', async () => {
  let calls = 0;
  const failing = /** @type {any} */ ({
    withRetry: async () => {
      calls++;
      throw new Error('Ask Sage: asksage.email is not set');
    },
  });
  const svc = createUserInfoService({ apiBase: 'https://api.test', accessToken: failing });
  await assert.rejects(svc.getForceModels(), /email is not set/);
  await assert.rejects(svc.getForceModels(), /email is not set/);
  assert.equal(calls, 1);
});
