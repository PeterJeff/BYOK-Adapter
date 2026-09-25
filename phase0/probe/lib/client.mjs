// @ts-check
// Recording HTTP client for the probe. Zero dependencies; `fetch` is injected so tests can
// drive it with a fake server. Credentials stay in this closure: exchanges record header
// NAMES only, never values.

import { SseParser, sseEventJson, splitSepStream, detectError } from './streams.mjs';
import { rawUsage, normalize, resolvedModel } from './usage.mjs';
import { keepHeaders, jwtShape } from './redact.mjs';

/** @typedef {import('./usage.mjs').Flavor} Flavor */
/** @typedef {'x-api-key' | 'bearer' | 'x-goog-api-key' | 'x-access-tokens'} AuthStyle */
/** @typedef {'key' | 'jwt' | 'bad' | 'none'} AuthSource */

/**
 * @typedef {object} CallOptions
 * @property {string} label           short name used for the fixture file
 * @property {Flavor | 'server' | 'user'} kind
 * @property {string} path            e.g. "/server/anthropic/v1/messages"
 * @property {string} [method]        default POST
 * @property {unknown} [body]
 * @property {string} [model]         recorded for pricing; not sent unless in body
 * @property {boolean} [stream]       read the body incrementally (SSE or sep stream)
 * @property {AuthSource} [auth]      default: key for passthrough flavors, jwt for server/user
 * @property {AuthStyle} [authStyle]  default per kind (docs: M x-api-key, CC/R bearer, G x-goog-api-key)
 * @property {Record<string, string>} [headers]  extra non-secret headers (anthropic-version, anthropic-beta)
 * @property {number} [abortAfterEvents] abort the stream after this many events (T9)
 * @property {number} [timeoutMs]
 */

/**
 * @typedef {object} Exchange
 * @property {string} label
 * @property {string} kind
 * @property {string | undefined} model
 * @property {string} method
 * @property {string} path
 * @property {boolean} stream
 * @property {string} startedAt
 * @property {{ auth: AuthSource, authStyle: AuthStyle | null, headerNames: string[], headers: Record<string, string>, body: unknown }} request
 * @property {number | null} status
 * @property {Record<string, string>} headers
 * @property {string | null} contentType
 * @property {number} ms
 * @property {number | null} ttftMs
 * @property {boolean} aborted
 * @property {unknown} [body]
 * @property {{ event?: string, data: any, raw?: string }[]} [events]
 * @property {{ shape: string, status?: number | string, message: string } | null} error
 * @property {{ name: string, code?: string, message: string }[] | null} transportError
 * @property {Record<string, any> | null} usage
 * @property {import('./usage.mjs').Norm | null} norm
 * @property {string | null} resolvedModel
 */

/** @type {Record<string, AuthStyle>} */
const DEFAULT_STYLE = { M: 'x-api-key', CC: 'bearer', R: 'bearer', G: 'x-goog-api-key', N: 'x-access-tokens', server: 'x-access-tokens', user: 'x-access-tokens' };

const BAD_CREDENTIAL = 'probe-invalid-credential-0000000000000000000000000000000000000000';

/**
 * @param {{ apiBase: string, apiKey?: string, email?: string, fetchImpl?: typeof fetch,
 *   timeoutMs?: number, now?: () => number, noAuthHeaders?: boolean }} opts
 */
export function createClient(opts) {
  const fetchImpl = opts.fetchImpl || fetch;
  const now = opts.now || (() => performance.now());
  const base = opts.apiBase.replace(/\/+$/, '');
  /** @type {string | null} */
  let jwt = null;
  /** @type {Exchange | null} */
  let tokenExchange = null;

  /**
   * Exchanges the API key for an access token (x-access-tokens JWT). Under `noAuthHeaders`
   * there is nothing to exchange — a gateway in front of `apiBase` is assumed to authenticate
   * the request itself, so this returns null instead of calling the endpoint or throwing.
   * With an API key but no email (key-only mode), the exchange needs an email it doesn't have,
   * so this also returns null: `server`/`user`/`N` calls run with no credential and fail auth,
   * same as `noAuthHeaders`, while M/CC/R/G calls still authenticate directly with the raw key.
   */
  async function token() {
    if (jwt) return jwt;
    if (opts.noAuthHeaders) return null;
    if (!opts.apiKey) throw new Error('no API key');
    if (!opts.email) return null;
    const ex = await call({ label: 'get-token-with-api-key', kind: 'user', path: '/user/get-token-with-api-key', auth: 'none', body: { email: opts.email, api_key: opts.apiKey } });
    // The recorded request body holds the key and email; drop it now so it can never be saved.
    ex.request.body = { email: '<redacted:email>', api_key: '<redacted:secret>' };
    tokenExchange = ex;
    const b = /** @type {any} */ (ex.body);
    const t = b?.response?.access_token;
    if (typeof t !== 'string' || !t) throw new Error(`no access token: HTTP ${ex.status} ${ex.error ? ex.error.message : ''}`.trim());
    jwt = t;
    ex.body = { response: { access_token: '<redacted:jwt>', shape: jwtShape(t) }, status: b?.status };
    return jwt;
  }

  /**
   * @param {AuthSource} source
   * @returns {Promise<string | null>}
   */
  async function credential(source) {
    if (source === 'none') return null;
    if (source === 'bad') return BAD_CREDENTIAL;
    if (source === 'jwt') return token();
    if (opts.noAuthHeaders) return null;
    if (!opts.apiKey) throw new Error('no API key');
    return opts.apiKey;
  }

  /**
   * @param {CallOptions} o
   * @returns {Promise<Exchange>}
   */
  async function call(o) {
    const kind = o.kind;
    const auth = o.auth || (kind === 'server' || kind === 'user' || kind === 'N' ? 'jwt' : 'key');
    const style = auth === 'none' ? null : o.authStyle || DEFAULT_STYLE[kind];
    const method = o.method || 'POST';
    /** @type {Record<string, string>} */
    const headers = { accept: o.stream ? 'text/event-stream, text/plain, application/json' : 'application/json', ...(o.headers || {}) };
    if (o.body !== undefined) headers['content-type'] = 'application/json';
    const cred = await credential(auth);
    if (cred && style) {
      if (style === 'bearer') headers.authorization = `Bearer ${cred}`;
      else headers[style] = cred;
    }
    /** @type {Exchange} */
    const ex = {
      label: o.label,
      kind,
      model: o.model,
      method,
      path: o.path,
      stream: !!o.stream,
      startedAt: new Date().toISOString(),
      request: { auth, authStyle: style, headerNames: Object.keys(headers).sort(), headers: { ...(o.headers || {}) }, body: o.body },
      status: null,
      headers: {},
      contentType: null,
      ms: 0,
      ttftMs: null,
      aborted: false,
      error: null,
      transportError: null,
      usage: null,
      norm: null,
      resolvedModel: null,
    };
    const ac = new AbortController();
    const timeoutMs = o.timeoutMs || opts.timeoutMs || 180000;
    const timer = setTimeout(() => ac.abort(new Error('timeout')), timeoutMs);
    const t0 = now();
    try {
      const res = await fetchImpl(base + o.path, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body), signal: ac.signal });
      ex.status = res.status;
      ex.headers = keepHeaders(res.headers);
      ex.contentType = res.headers.get('content-type');
      const ct = ex.contentType || '';
      if (o.stream && res.body && /event-stream/i.test(ct)) {
        ex.events = [];
        const parser = new SseParser();
        const dec = new TextDecoder();
        const reader = res.body.getReader();
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            const evs = parser.feed(dec.decode(value, { stream: true }));
            if (evs.length && ex.ttftMs === null) ex.ttftMs = Math.round(now() - t0);
            ex.events.push(...evs.map(sseEventJson));
            if (o.abortAfterEvents && ex.events.length >= o.abortAfterEvents) {
              ex.aborted = true;
              ac.abort(new Error('probe abort'));
              await reader.cancel().catch(() => {});
              break;
            }
          }
        } catch (e) {
          if (!ex.aborted) throw e;
        }
        if (!ex.aborted) ex.events.push(...parser.end().map(sseEventJson));
      } else {
        const text = await res.text();
        if (ex.ttftMs === null) ex.ttftMs = Math.round(now() - t0);
        if (text.includes('@|@sep@|@')) ex.events = splitSepStream(text);
        else {
          try {
            ex.body = JSON.parse(text);
          } catch {
            ex.body = text.length > 20000 ? `${text.slice(0, 20000)}<truncated chars=${text.length}>` : text;
          }
        }
      }
    } catch (e) {
      ex.transportError = describeError(e);
    } finally {
      clearTimeout(timer);
      ex.ms = Math.round(now() - t0);
    }
    ex.error = findError(ex);
    const flavor = /** @type {Flavor} */ (['M', 'CC', 'R', 'G', 'N'].includes(kind) ? kind : null);
    if (flavor) {
      ex.usage = rawUsage(flavor, /** @type {any} */ (ex));
      ex.norm = normalize(flavor, ex.usage);
      ex.resolvedModel = resolvedModel(flavor, /** @type {any} */ (ex));
    }
    return ex;
  }

  return { call, token, tokenExchange: () => tokenExchange, hasJwt: () => jwt !== null, currentToken: () => jwt, noAuthHeaders: () => !!opts.noAuthHeaders };
}

/**
 * First error found in the HTTP status, the body, or any stream event.
 * @param {Exchange} ex
 */
export function findError(ex) {
  const fromBody = detectError(ex.body);
  if (fromBody) return fromBody;
  for (const e of ex.events || []) {
    const d = detectError(e.data);
    if (d) return { ...d, shape: `${d.shape} (in stream)` };
  }
  if (ex.status !== null && ex.status >= 400) return { shape: 'http', status: ex.status, message: typeof ex.body === 'string' ? ex.body.slice(0, 500) : JSON.stringify(ex.body ?? '').slice(0, 500) };
  return null;
}

/**
 * @param {unknown} err
 * @returns {{ name: string, code?: string, message: string }[]}
 */
export function describeError(err) {
  const chain = [];
  let e = /** @type {any} */ (err);
  for (let depth = 0; e && depth < 5; depth++) {
    chain.push({ name: e.name || typeof e, ...(e.code ? { code: String(e.code) } : {}), message: String(e.message ?? e).slice(0, 300) });
    e = e.cause;
  }
  return chain;
}

/**
 * Keeps the first and last events of a long stream, with a count of what was dropped.
 * Usage and output are extracted before this runs.
 * @param {{ event?: string, data: any }[] | undefined} events
 * @param {number} [keep]
 */
export function compactEvents(events, keep = 40) {
  if (!events || events.length <= keep * 2) return events;
  const mid = events.slice(keep, events.length - keep);
  /** @type {Record<string, number>} */
  const types = {};
  for (const e of mid) {
    const t = e.event || e.data?.type || e.data?.object || 'data';
    types[t] = (types[t] || 0) + 1;
  }
  return [...events.slice(0, keep), { event: 'probe.elided', data: { count: mid.length, types } }, ...events.slice(-keep)];
}
