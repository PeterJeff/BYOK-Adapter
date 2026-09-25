// @ts-check
'use strict';

// E5: can the extension host reach the tenant host? Sends one unauthenticated POST to
// get-models. No credentials are sent, so the probe cannot spend tokens.
//
// get-models is not a reliable "auth works" signal: despite the docs describing it as an
// authenticated endpoint, on some instances it answers with the real model catalog (HTTP 200,
// a `data`/`response` array) even with no credential at all, rather than the
// {"response":"Token is invalid ..."} envelope other authenticated endpoints return. Either
// shape proves the host was reached; `classifyBody` reports which one so a report doesn't
// read a catalog response as "unreachable" or as evidence the endpoint enforced auth.

const PROBE_PATH = '/server/get-models';
const SNIPPET_CHARS = 300;

/**
 * Accepts "host", "host:port" or a URL and returns "host[:port]".
 * @param {string} input
 */
function normalizeHost(input) {
  const h = String(input || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/.test(h)) throw new Error(`Not a host name: ${JSON.stringify(input)}`);
  return h;
}

/**
 * Flattens an error and its `cause` chain, which is where fetch hides the TLS
 * or proxy error code (e.g. UNABLE_TO_GET_ISSUER_CERT_LOCALLY).
 * @param {unknown} err
 */
function describeError(err) {
  const chain = [];
  let e = /** @type {any} */ (err);
  for (let depth = 0; e && depth < 5; depth++) {
    chain.push({
      name: e.name || typeof e,
      code: e.code || undefined,
      message: String(e.message ?? e).slice(0, SNIPPET_CHARS),
    });
    e = e.cause;
  }
  return chain;
}

/**
 * @param {string} text
 */
function classifyBody(text) {
  try {
    const j = JSON.parse(text);
    if (j && typeof j.response === 'string' && /token is invalid/i.test(j.response)) return 'asksage-auth-rejected';
    if (j && (Array.isArray(j.data) || Array.isArray(j.response))) return 'asksage-catalog-no-auth-required';
    return 'json';
  } catch {
    return /<html/i.test(text) ? 'html' : 'other';
  }
}

/**
 * @typedef {{ method: string, url: string, ok: boolean, status?: number, contentType?: string,
 *   bodyClass?: string, bodySnippet?: string, ms: number, error?: ReturnType<typeof describeError> }} ProbeResult
 */

/**
 * @param {string} url
 * @param {typeof fetch} fetchImpl
 * @param {number} timeoutMs
 * @returns {Promise<ProbeResult>}
 */
async function probeFetch(url, fetchImpl, timeoutMs) {
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error(`timeout after ${timeoutMs} ms`)), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: ac.signal,
    });
    const text = await res.text();
    return {
      method: 'fetch',
      url,
      ok: true,
      status: res.status,
      contentType: res.headers.get('content-type') || undefined,
      bodyClass: classifyBody(text),
      bodySnippet: text.slice(0, SNIPPET_CHARS),
      ms: Date.now() - started,
    };
  } catch (e) {
    return { method: 'fetch', url, ok: false, ms: Date.now() - started, error: describeError(e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Same probe through Node's https module, which VS Code patches for proxy and
 * system-certificate support differently from fetch.
 * @param {string} url
 * @param {{ request: Function }} httpsImpl
 * @param {number} timeoutMs
 * @returns {Promise<ProbeResult>}
 */
function probeHttps(url, httpsImpl, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    /** @param {ProbeResult} r */
    const done = (r) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    try {
      const req = httpsImpl.request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '2' } }, (/** @type {any} */ res) => {
        /** @type {Buffer[]} */
        const chunks = [];
        res.on('data', (/** @type {Buffer} */ c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          done({
            method: 'https',
            url,
            ok: true,
            status: res.statusCode,
            contentType: res.headers['content-type'],
            bodyClass: classifyBody(text),
            bodySnippet: text.slice(0, SNIPPET_CHARS),
            ms: Date.now() - started,
          });
        });
        res.on('error', (/** @type {Error} */ e) => done({ method: 'https', url, ok: false, ms: Date.now() - started, error: describeError(e) }));
      });
      req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs} ms`)));
      req.on('error', (/** @type {Error} */ e) => done({ method: 'https', url, ok: false, ms: Date.now() - started, error: describeError(e) }));
      req.end('{}');
    } catch (e) {
      done({ method: 'https', url, ok: false, ms: Date.now() - started, error: describeError(e) });
    }
  });
}

/**
 * @param {string} host
 * @param {{ fetch?: typeof fetch, https: { request: Function }, timeoutMs?: number, scheme?: string }} deps
 */
async function probeAll(host, deps) {
  const url = `${deps.scheme || 'https'}://${normalizeHost(host)}${PROBE_PATH}`;
  const timeoutMs = deps.timeoutMs ?? 15000;
  /** @type {ProbeResult[]} */
  const results = [];
  if (typeof deps.fetch === 'function') results.push(await probeFetch(url, deps.fetch, timeoutMs));
  else results.push({ method: 'fetch', url, ok: false, ms: 0, error: [{ name: 'Unavailable', code: undefined, message: 'globalThis.fetch is not defined in this extension host' }] });
  results.push(await probeHttps(url, deps.https, timeoutMs));
  return { at: new Date().toISOString(), url, results };
}

module.exports = { PROBE_PATH, normalizeHost, describeError, classifyBody, probeFetch, probeHttps, probeAll };
