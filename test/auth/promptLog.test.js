// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPromptLogService } = require('../../src/auth/promptLog');

/** @param {unknown} body */
function jsonResponse(body) {
  return { status: 200, headers: { get: (/** @type {string} */ h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) };
}

const accessToken = /** @type {any} */ ({ withRetry: (/** @type {(t: string) => any} */ run) => run('jwt-1') });

test('getRecent: reads rows from get-user-logs, defaulting to a limit of 100', async () => {
  let sentBody;
  const fetchImpl = /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init) => {
    sentBody = JSON.parse(init.body);
    return jsonResponse({ response: [{ id: 1, date_time: 't', model: 'gpt-4.1', prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 }] });
  });
  const svc = createPromptLogService({ apiBase: 'https://api.test', accessToken, fetchImpl });
  const rows = await svc.getRecent();
  assert.deepEqual(rows, [{ id: 1, date_time: 't', model: 'gpt-4.1', prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 }]);
  assert.equal(/** @type {any} */ (sentBody).limit, 100);
});

test('getRecent: clamps the limit to the endpoint\'s 1..100 range', async () => {
  let sentBody;
  const fetchImpl = /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init) => {
    sentBody = JSON.parse(init.body);
    return jsonResponse({ response: [] });
  });
  const svc = createPromptLogService({ apiBase: 'https://api.test', accessToken, fetchImpl });
  await svc.getRecent({ limit: 500 });
  assert.equal(/** @type {any} */ (sentBody).limit, 100);
  await svc.getRecent({ limit: 0 });
  assert.equal(/** @type {any} */ (sentBody).limit, 1);
});

test('getRecent: a non-array response is treated as no rows', async () => {
  const fetchImpl = /** @type {any} */ (async () => jsonResponse({ response: null }));
  const svc = createPromptLogService({ apiBase: 'https://api.test', accessToken, fetchImpl });
  assert.deepEqual(await svc.getRecent(), []);
});

test('getRecent: a network/auth failure surfaces as an error', async () => {
  const fetchImpl = /** @type {any} */ (async () => {
    throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED') });
  });
  const svc = createPromptLogService({ apiBase: 'https://api.test', accessToken, fetchImpl });
  await assert.rejects(svc.getRecent(), /get-user-logs failed: fetch failed \(connect ECONNREFUSED\)/);
});
