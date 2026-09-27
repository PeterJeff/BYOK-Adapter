// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccessTokenService } = require('../../src/auth/accessToken');

/** @param {number} status @param {unknown} body */
function jsonResponse(status, body) {
  return { status, headers: { get: (/** @type {string} */ h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) };
}

/** @param {unknown[]} responses */
function fakeFetch(responses) {
  const calls = [];
  const fn = async (/** @type {string} */ url, /** @type {any} */ init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('fakeFetch: no more scripted responses');
    return next;
  };
  fn.calls = calls;
  return fn;
}

test('exchanges the API key for a JWT and caches it', async () => {
  const fetchImpl = fakeFetch([jsonResponse(200, { response: { access_token: 'jwt-1' } })]);
  const svc = createAccessTokenService({ apiBase: 'https://api.test', getApiKey: async () => 'key-1', email: 'a@b.test', fetchImpl });
  assert.equal(await svc.getToken(), 'jwt-1');
  assert.equal(await svc.getToken(), 'jwt-1'); // cached: no second fetch
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, 'https://api.test/user/get-token-with-api-key');
});

test('withRetry succeeds without retrying when there is no auth error', async () => {
  const fetchImpl = fakeFetch([jsonResponse(200, { response: { access_token: 'jwt-1' } })]);
  const svc = createAccessTokenService({ apiBase: 'https://api.test', getApiKey: async () => 'key-1', email: 'a@b.test', fetchImpl });
  let calls = 0;
  const result = await svc.withRetry(async (token) => {
    calls++;
    return { error: null, tokenUsed: token };
  });
  assert.equal(calls, 1);
  assert.equal(result.tokenUsed, 'jwt-1');
  assert.equal(fetchImpl.calls.length, 1);
});

test('withRetry actually retries: two exchanges, run called twice, second token used', async () => {
  const fetchImpl = fakeFetch([
    jsonResponse(200, { response: { access_token: 'jwt-1' } }),
    jsonResponse(200, { response: { access_token: 'jwt-2' } }),
  ]);
  const svc = createAccessTokenService({ apiBase: 'https://api.test', getApiKey: async () => 'key-1', email: 'a@b.test', fetchImpl });
  const seen = [];
  const result = await svc.withRetry(async (token) => {
    seen.push(token);
    if (token === 'jwt-1') return { error: { shape: 'asksage-envelope', message: 'Token is invalid [1]' } };
    return { error: null, tokenUsed: token };
  });
  assert.deepEqual(seen, ['jwt-1', 'jwt-2']);
  assert.equal(result.tokenUsed, 'jwt-2');
  assert.equal(fetchImpl.calls.length, 2);
});

test('exchange failure throws with no access token', async () => {
  const fetchImpl = fakeFetch([jsonResponse(400, { response: 'Token is invalid [1]', status: 400 })]);
  const svc = createAccessTokenService({ apiBase: 'https://api.test', getApiKey: async () => 'key-1', email: 'a@b.test', fetchImpl });
  await assert.rejects(() => svc.getToken(), /token exchange failed/);
});
