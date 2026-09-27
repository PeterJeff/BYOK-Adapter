// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { request, describeFailure } = require('../../src/transport/httpClient');

/** What Node's fetch throws for an unresolvable host: a bare "fetch failed" with the reason in cause. */
function dnsFailure() {
  const cause = Object.assign(new Error('getaddrinfo ENOTFOUND example.invalid'), { code: 'ENOTFOUND' });
  return /** @type {any} */ (async () => {
    throw new TypeError('fetch failed', { cause });
  });
}

test('describeFailure: a network failure is reported with its cause, not swallowed (live finding 2026-09-27)', async () => {
  const res = await request({ url: 'https://example.invalid/x', headers: {}, body: {}, fetchImpl: dnsFailure() });
  assert.equal(res.error, null); // unchanged: the chat path handles transportError itself
  assert.equal(describeFailure(res), 'fetch failed (getaddrinfo ENOTFOUND example.invalid)');
});

test('describeFailure: a timeout, a detected error, and success', async () => {
  const timeout = /** @type {any} */ (async (/** @type {string} */ _u, /** @type {any} */ init) => new Promise((_r, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))));
  assert.equal(describeFailure(await request({ url: 'https://api.test/x', headers: {}, timeoutMs: 5, fetchImpl: timeout })), 'timeout');
  const json = (/** @type {unknown} */ body) => /** @type {any} */ (async () => ({ status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body) }));
  assert.equal(describeFailure(await request({ url: 'https://api.test/x', headers: {}, fetchImpl: json({ response: 'Token is invalid [1]', status: 400 }) })), 'Token is invalid [1]');
  assert.equal(describeFailure(await request({ url: 'https://api.test/x', headers: {}, fetchImpl: json({ response: [] }) })), null);
});
