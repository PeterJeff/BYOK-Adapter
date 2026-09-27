// @ts-check
'use strict';

// PLAN.md §3.3: monthly limit comes from validate_token_with_full_user with an API-key JWT.
// The same response carries the organization's force_models (PLAN.md §2.3), which the catalog
// intersects with get-models.

const { request, describeFailure } = require('../transport/httpClient');

const FORCE_MODELS_TTL_MS = 60 * 60 * 1000;
const FAILURE_BACKOFF_MS = 60 * 1000;

/**
 * force_models as a list of model names; empty means no restriction. The user API spec types it
 * as a comma-separated string (one schema mistypes it as a boolean); the public tenant returns a
 * JSON array (`[]`, T0 fixture 2026-09-26). Accept both, ignore anything else.
 * @param {unknown} raw
 * @returns {string[]}
 */
function parseForceModels(raw) {
  const items = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const names = items.filter((x) => typeof x === 'string').map((s) => s.trim()).filter(Boolean);
  return [...new Set(names)];
}

/**
 * @param {{ apiBase: string, accessToken: import('../auth/accessToken').createAccessTokenService extends (...args: any) => infer R ? R : never, fetchImpl?: typeof fetch }} opts
 */
function createUserInfoService(opts) {
  /** @type {{ at: number, forceModels: string[] } | null} */
  let forceCache = null;
  let failedAt = 0;
  /** @type {Error | null} */
  let lastError = null;

  /** @returns {Promise<{ maxTokens: number | null, forceModels: string[] }>} */
  async function getLimits() {
    const result = await opts.accessToken.withRetry((token) =>
      request({
        url: `${opts.apiBase}/user/validate_token_with_full_user`,
        headers: { 'x-access-tokens': token },
        fetchImpl: opts.fetchImpl,
      })
    );
    const failure = describeFailure(result);
    if (failure) throw new Error(`Ask Sage: validate_token_with_full_user failed: ${failure}`);
    const user = /** @type {any} */ (result.body)?.response;
    const maxTokens = user?.max_tokens;
    const forceModels = parseForceModels(user?.force_models);
    forceCache = { at: Date.now(), forceModels };
    return { maxTokens: typeof maxTokens === 'number' ? maxTokens : null, forceModels };
  }

  return {
    getLimits,
    /**
     * Cached for an hour, since the picker and every request ask for it. After a failure (no
     * email or key yet, network) the same error is rethrown for a minute instead of refetching.
     * @returns {Promise<string[]>}
     */
    async getForceModels() {
      if (forceCache && Date.now() - forceCache.at < FORCE_MODELS_TTL_MS) return forceCache.forceModels;
      if (lastError && Date.now() - failedAt < FAILURE_BACKOFF_MS) throw lastError;
      try {
        return (await getLimits()).forceModels;
      } catch (e) {
        lastError = /** @type {Error} */ (e);
        failedAt = Date.now();
        throw e;
      }
    },
  };
}

module.exports = { createUserInfoService, parseForceModels };
