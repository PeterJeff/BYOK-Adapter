// @ts-check
'use strict';

// PLAN.md §3.6 / §4.3 passive analysis: POST /user/get-user-logs, the caller's own real prompt
// log (id, time, model, prompt/completion/total tokens; prompt and response text are dropped on
// receipt, never kept -- CLAUDE.md security rule). Ported from the shape of
// phase0/probe/prompt-log.mjs (research, ESM) to CommonJS for runtime use. Always live: no
// caching, since callers ask for whatever window they need to reconcile.

const { request, describeFailure } = require('../transport/httpClient');

/**
 * @param {{ apiBase: string, accessToken: import('./accessToken').createAccessTokenService extends (...args: any) => infer R ? R : never, fetchImpl?: typeof fetch }} opts
 */
function createPromptLogService(opts) {
  return {
    /**
     * @param {{ limit?: number }} [o]
     * @returns {Promise<unknown[]>} raw rows (id, date_time, model, prompt_tokens, completion_tokens, total_tokens, plus fields this never reads)
     */
    async getRecent(o = {}) {
      const limit = Math.max(1, Math.min(100, o.limit ?? 100));
      const result = await opts.accessToken.withRetry((token) =>
        request({
          url: `${opts.apiBase}/user/get-user-logs`,
          headers: { 'x-access-tokens': token },
          body: { limit },
          fetchImpl: opts.fetchImpl,
        })
      );
      const failure = describeFailure(result);
      if (failure) throw new Error(`Ask Sage: get-user-logs failed: ${failure}`);
      const response = /** @type {any} */ (result.body)?.response;
      return Array.isArray(response) ? response : [];
    },
  };
}

module.exports = { createPromptLogService };
