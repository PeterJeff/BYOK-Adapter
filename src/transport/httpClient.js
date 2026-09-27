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
 * @property {number} [timeoutMs]
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
  const timeoutMs = o.timeoutMs || 180000;
  const timer = setTimeout(() => ac.abort(new Error('timeout')), timeoutMs);
  /** @type {Result} */
  const result = { status: null, contentType: null, error: null, transportError: null };
  try {
    const res = await fetchImpl(o.url, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body), signal: ac.signal });
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
          const evs = parser.feed(dec.decode(value, { stream: true })).map(sseEventJson);
          result.events.push(...evs);
          for (const ev of evs) if (o.onEvent) o.onEvent(ev);
        }
      } catch (e) {
        if (!ac.signal.aborted) throw e;
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
    clearTimeout(timer);
    if (cancelSub && typeof (/** @type {any} */ (cancelSub).dispose) === 'function') /** @type {any} */ (cancelSub).dispose();
  }
  result.error = findError(result);
  return result;
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
