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
  assert.equal(describeFailure(await request({ url: 'https://api.test/x', headers: {}, timeoutMs: 5, fetchImpl: timeout })), 'Ask Sage sent no data for 1 second, so the request was stopped');
  const json = (/** @type {unknown} */ body) => /** @type {any} */ (async () => ({ status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body) }));
  assert.equal(describeFailure(await request({ url: 'https://api.test/x', headers: {}, fetchImpl: json({ response: 'Token is invalid [1]', status: 400 }) })), 'Token is invalid [1]');
  assert.equal(describeFailure(await request({ url: 'https://api.test/x', headers: {}, fetchImpl: json({ response: [] }) })), null);
});

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
const EVENT = (/** @type {number} */ n) => `event: e
data: {"n":${n}}

`;

/**
 * A streaming fetch: sends `chunks` (text) spaced `gapMs` apart, then either ends or stalls until
 * the request is aborted, the way a hung upstream does. The abort reaches the body stream the way
 * Node's fetch delivers it: the pending read() rejects with the signal's reason.
 * @param {string[]} chunks
 * @param {number} gapMs
 * @param {boolean} stall
 */
function streamingFetch(chunks, gapMs, stall) {
  return /** @type {any} */ (async (/** @type {string} */ _u, /** @type {any} */ init) => ({
    status: 200,
    headers: { get: () => 'text/event-stream' },
    body: new ReadableStream({
      async start(controller) {
        init.signal.addEventListener('abort', () => controller.error(init.signal.reason));
        for (const c of chunks) {
          await sleep(gapMs);
          if (init.signal.aborted) return;
          controller.enqueue(new TextEncoder().encode(c));
        }
        if (!stall) controller.close();
      },
    }),
  }));
}

test('a stream that stalls is reported as a timeout, not as a complete answer (DEFECTS D2)', async () => {
  const seen = [];
  const res = await request({ url: 'https://api.test/x', headers: {}, stream: true, timeoutMs: 300, onEvent: (e) => seen.push(e), fetchImpl: streamingFetch([EVENT(1)], 10, true) });
  assert.equal(seen.length, 1);
  assert.equal(res.events?.length, 1);
  assert.ok(res.transportError, 'the truncation must surface');
  assert.equal(res.transportError?.name, 'TimeoutError');
  assert.match(describeFailure(res) || '', /sent no data for 1 second/);
});

test('a long stream that keeps flowing is not cut off: the idle timer resets on every chunk (DEFECTS D2)', async () => {
  const chunks = [1, 2, 3, 4, 5, 6].map(EVENT);
  // 6 chunks x 80 ms = 480 ms in total, past the 300 ms idle limit, but never 300 ms without data.
  const res = await request({ url: 'https://api.test/x', headers: {}, stream: true, timeoutMs: 300, fetchImpl: streamingFetch(chunks, 80, false) });
  assert.equal(res.transportError, null);
  assert.equal(res.events?.length, 6);
});

test('totalTimeoutMs caps a stream that keeps flowing', async () => {
  const chunks = [1, 2, 3, 4, 5, 6].map(EVENT);
  const res = await request({ url: 'https://api.test/x', headers: {}, stream: true, timeoutMs: 300, totalTimeoutMs: 200, fetchImpl: streamingFetch(chunks, 80, false) });
  assert.equal(res.transportError?.name, 'TimeoutError');
  assert.match(describeFailure(res) || '', /ran longer than the 1 second limit/);
  assert.ok((res.events?.length ?? 0) < 6);
});

test('a user cancel mid-stream is not reported as a timeout', async () => {
  /** @type {(() => void) | null} */
  let cancel = null;
  const token = { isCancellationRequested: false, onCancellationRequested: (/** @type {() => void} */ cb) => { cancel = cb; return { dispose() {} }; } };
  setTimeout(() => cancel && cancel(), 40);
  const res = await request({ url: 'https://api.test/x', headers: {}, stream: true, timeoutMs: 300, token, fetchImpl: streamingFetch([EVENT(1)], 10, true) });
  assert.equal(res.events?.length, 1);
  assert.equal(res.transportError, null, 'a cancel mid-stream stays silent, as before');
});
