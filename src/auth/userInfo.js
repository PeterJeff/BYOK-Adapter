// @ts-check
'use strict';

// PLAN.md §3.3: monthly limit comes from validate_token_with_full_user with an API-key JWT.

const { request } = require('../transport/httpClient');

/**
 * @param {{ apiBase: string, accessToken: import('../auth/accessToken').createAccessTokenService extends (...args: any) => infer R ? R : never, fetchImpl?: typeof fetch }} opts
 */
function createUserInfoService(opts) {
  return {
    /** @returns {Promise<{ maxTokens: number | null }>} */
    async getLimits() {
      const result = await opts.accessToken.withRetry((token) =>
        request({
          url: `${opts.apiBase}/user/validate_token_with_full_user`,
          headers: { 'x-access-tokens': token },
          fetchImpl: opts.fetchImpl,
        })
      );
      if (result.error) throw new Error(`Ask Sage: validate_token_with_full_user failed: ${result.error.message}`);
      const maxTokens = /** @type {any} */ (result.body)?.response?.max_tokens;
      return { maxTokens: typeof maxTokens === 'number' ? maxTokens : null };
    },
  };
}

module.exports = { createUserInfoService };
