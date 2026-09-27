// @ts-check
'use strict';

// JWT access-token exchange for /server and /user endpoints (catalog, rates, budget). CC/R
// model calls use the raw API key directly as a Bearer token and never go through this module
// (measured shapes, phase0/probe/lib/client.mjs DEFAULT_STYLE). CLAUDE.md security rule: the
// short-lived access token is refreshed on expiry or on a "Token is invalid" response, with one
// retry, and only before any output has streamed.

const { request, describeFailure } = require('../transport/httpClient');
const { isAuthInvalid } = require('../errors');

/**
 * @param {{ apiBase: string, getApiKey: () => Promise<string | undefined>, email: string, fetchImpl?: typeof fetch }} opts
 */
function createAccessTokenService(opts) {
  /** @type {string | null} */
  let jwt = null;

  async function exchange() {
    const apiKey = await opts.getApiKey();
    if (!apiKey) throw new Error('Ask Sage: no API key set (run "Ask Sage: Set API Key")');
    if (!opts.email) throw new Error('Ask Sage: asksage.email is not set');
    const res = await request({
      url: `${opts.apiBase}/user/get-token-with-api-key`,
      headers: {},
      body: { email: opts.email, api_key: apiKey },
      fetchImpl: opts.fetchImpl,
    });
    const token = /** @type {any} */ (res.body)?.response?.access_token;
    const failure = describeFailure(res);
    if (failure || typeof token !== 'string' || !token) {
      throw new Error(`Ask Sage: token exchange failed: ${failure || `no access_token in the response (HTTP ${res.status})`}`);
    }
    jwt = token;
    return jwt;
  }

  return {
    /** @returns {Promise<string>} */
    async getToken() {
      if (jwt) return jwt;
      return exchange();
    },
    /**
     * Retries once on an auth-invalid error, only before any output has streamed.
     * @template T
     * @param {(token: string) => Promise<T & { error?: import('../errors').DetectedError | null }>} run
     * @returns {Promise<T & { error?: import('../errors').DetectedError | null }>}
     */
    async withRetry(run) {
      const token = jwt || (await exchange());
      const first = await run(token);
      if (first.error && isAuthInvalid(first.error)) {
        jwt = null;
        const fresh = await exchange();
        return run(fresh);
      }
      return first;
    },
    invalidate() {
      jwt = null;
    },
  };
}

module.exports = { createAccessTokenService };
