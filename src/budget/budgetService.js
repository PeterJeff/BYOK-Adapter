// @ts-check
'use strict';

// PLAN.md §3.3: remaining/used/limit, refreshed on activation, after each completed turn
// (debounced by the caller), and periodically while chat is active. Never cached across a month.

const { request } = require('../transport/httpClient');

/**
 * @param {{ apiBase: string, accessToken: import('../auth/accessToken').createAccessTokenService extends (...a: any) => infer R ? R : never,
 *   userInfo: import('../auth/userInfo').createUserInfoService extends (...a: any) => infer R ? R : never, fetchImpl?: typeof fetch }} opts
 */
function createBudgetService(opts) {
  return {
    /** @returns {Promise<{ maxTokens: number | null, remaining: number | null, used: number | null }>} */
    async getStatus() {
      const [{ maxTokens }, remainingRes, usedRes] = await Promise.all([
        opts.userInfo.getLimits(),
        opts.accessToken.withRetry((token) => request({ url: `${opts.apiBase}/server/count-monthly-tokens-left-with-org`, headers: { 'x-access-tokens': token }, fetchImpl: opts.fetchImpl })),
        opts.accessToken.withRetry((token) => request({ url: `${opts.apiBase}/server/count-monthly-tokens`, headers: { 'x-access-tokens': token }, fetchImpl: opts.fetchImpl })),
      ]);
      const remaining = Number(/** @type {any} */ (remainingRes.body)?.response);
      const used = Number(/** @type {any} */ (usedRes.body)?.response);
      return { maxTokens, remaining: Number.isFinite(remaining) ? remaining : null, used: Number.isFinite(used) ? used : null };
    },
  };
}

module.exports = { createBudgetService };
