// @ts-check
'use strict';

// Shared fetch wrapper: timeout, SSE-vs-JSON branching, error detection. Ported from the
// shape of phase0/probe/lib/client.mjs's call() (research, ESM) to CommonJS for runtime use,
// simplified: no recording/redaction (that's a research-only concern), and callers build their
// own headers (auth style lives in the transport modules, not here).

const { SseParser, sseEventJson } = require('./sse');
const { detectError } = require('../errors');

/**
 * @typedef {object} RequestOptions
 * @property {string} url
 * @property {string} [method]
 * @property {Record<string, string>} headers
 * @property {unknown} [body]
 * @property {boolean} [stream]
 * @property {(event: { event?: string, data: unknown, raw?: string }) => void} [onEvent]  called as each SSE event arrives
 * @property {number} [timeoutMs]  idle timeout, default 180000: no response headers, or no data chunk, for this long aborts the request. Reset on every chunk, so a long stream that keeps flowing is never cut off
 * @property {number} [totalTimeoutMs]  optional cap on the whole request, streaming included; none by default
 * @property {{ isCancellationRequested: boolean, onCancellationRequested: (cb: () => void) => unknown }} [token]
 * @property {typeof fetch} [fetchImpl]
 */

/**
 * @typedef {object} Result
 * @property {number | null} status
 * @property {string | null} contentType
 * @property {unknown} [body]
 * @property {{ event?: string, data: unknown, raw?: string }[]} [events]
 * @property {import('../errors').DetectedError | null} error
 * @property {Error | null} transportError
 */

/**
 * @param {RequestOptions} o
 * @returns {Promise<Result>}
 */
async function request(o) {
  const fetchImpl = o.fetchImpl || globalThis.fetch;
  const method = o.method || 'POST';
  const headers = { accept: o.stream ? 'text/event-stream, text/plain, application/json' : 'application/json', ...o.headers };
  if (o.body !== undefined) headers['content-type'] = 'application/json';
  const ac = new AbortController();
  const cancelSub = o.token ? o.token.onCancellationRequested(() => ac.abort(new Error('cancelled'))) : null;
  const idleMs = o.timeoutMs || 180000;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let idleTimer;
  const arm = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => ac.abort(timeoutError(`Ask Sage sent no data for ${seconds(idleMs)}, so the request was stopped`)), idleMs);
  };
  arm();
  const totalTimer = o.totalTimeoutMs ? setTimeout(() => ac.abort(timeoutError(`the request ran longer than the ${seconds(o.totalTimeoutMs || 0)} limit and was stopped`)), o.totalTimeoutMs) : undefined;
  /** @type {Result} */
  const result = { status: null, contentType: null, error: null, transportError: null };
  try {
    const res = await fetchImpl(o.url, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body), signal: ac.signal });
    arm();
    result.status = res.status;
    result.contentType = res.headers.get('content-type');
    const ct = result.contentType || '';
    if (o.stream && res.body && /event-stream/i.test(ct)) {
      result.events = [];
      const parser = new SseParser();
      const dec = new TextDecoder();
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          arm();
          const evs = parser.feed(dec.decode(value, { stream: true })).map(sseEventJson);
          result.events.push(...evs);
          for (const ev of evs) if (o.onEvent) o.onEvent(ev);
        }
      } catch (e) {
        if (!ac.signal.aborted) throw e;
        // Aborted mid-stream. A user cancel is not a failure, but a timeout is: report it, so a
        // truncated answer is never taken for a complete one.
        if (isTimeout(ac.signal.reason)) result.transportError = ac.signal.reason;
      }
      if (!ac.signal.aborted) {
        const tail = parser.end().map(sseEventJson);
        result.events.push(...tail);
        for (const ev of tail) if (o.onEvent) o.onEvent(ev);
      }
    } else {
      const text = await res.text();
      try {
        result.body = JSON.parse(text);
      } catch {
        result.body = text;
      }
    }
  } catch (e) {
    result.transportError = /** @type {Error} */ (e);
  } finally {
    clearTimeout(idleTimer);
    clearTimeout(totalTimer);
    if (cancelSub && typeof (/** @type {any} */ (cancelSub).dispose) === 'function') /** @type {any} */ (cancelSub).dispose();
  }
  result.error = findError(result);
  return result;
}

/** @param {number} ms */
function seconds(ms) {
  const n = Math.max(1, Math.round(ms / 1000));
  return `${n} second${n === 1 ? '' : 's'}`;
}

/** @param {string} message */
function timeoutError(message) {
  return Object.assign(new Error(message), { name: 'TimeoutError' });
}

/** @param {unknown} reason */
function isTimeout(reason) {
  return reason instanceof Error && reason.name === 'TimeoutError';
}

/**
 * First error found in the HTTP status, the body, or any stream event.
 * @param {Result} result
 */
function findError(result) {
  const fromBody = detectError(result.body);
  if (fromBody) return fromBody;
  for (const e of result.events || []) {
    const d = detectError(e.data);
    if (d) return { ...d, shape: `${d.shape} (in stream)` };
  }
  if (result.status !== null && result.status >= 400) {
    return { shape: 'http', status: result.status, message: typeof result.body === 'string' ? result.body.slice(0, 500) : JSON.stringify(result.body ?? '').slice(0, 500) };
  }
  return null;
}

/**
 * Why a request failed, for an error message: the detected error, else the network error with
 * its cause (Node's fetch says only "fetch failed" and puts ENOTFOUND/ECONNREFUSED in `cause`).
 * Null when the request succeeded. `error` alone misses network failures, which leave no body.
 * @param {Result} result
 * @returns {string | null}
 */
function describeFailure(result) {
  if (result.error) return result.error.message;
  const t = result.transportError;
  if (!t) return null;
  const cause = /** @type {any} */ (t).cause;
  const detail = cause && (cause.message || cause.code);
  return detail && detail !== t.message ? `${t.message} (${detail})` : t.message;
}

module.exports = { request, findError, describeFailure };
