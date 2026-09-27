// @ts-check
'use strict';

// PLAN.md §3.5: a simple per-conversation and per-hour cap in Ask Sage tokens, with a hard
// stop, so agent testing (Phase 2+) cannot run away. Pure; in-memory only (per extension-host
// process, like the ledger). The cap is checked before each request is sent, so the request
// that crosses it still completes; the next one is refused.

/** @typedef {{ sessionCapTokens: number, hourlyCapTokens: number }} SpendLimits  0 disables that cap */

/**
 * @param {SpendLimits | (() => SpendLimits)} limitsOrGetter  a getter is read on every check, so
 *   a changed setting applies at once (live finding 2026-09-27: a cap lowered after activation
 *   was ignored until a reload)
 */
function createSpendCap(limitsOrGetter) {
  const getLimits = typeof limitsOrGetter === 'function' ? limitsOrGetter : () => limitsOrGetter;
  /** @type {Map<string, number>} */
  const perConversation = new Map();
  /** @type {{ at: number, cost: number }[]} */
  const hourly = [];

  /** @param {number} now */
  function prune(now) {
    const cutoff = now - 60 * 60 * 1000;
    while (hourly.length && hourly[0].at < cutoff) hourly.shift();
  }

  /** @param {number} now */
  function hourlyTotal(now) {
    prune(now);
    return hourly.reduce((a, e) => a + e.cost, 0);
  }

  return {
    /**
     * Throws if the cap is already reached, before a request is sent.
     * @param {string} conversationId
     */
    check(conversationId) {
      const now = Date.now();
      const limits = getLimits();
      const convTotal = perConversation.get(conversationId) || 0;
      if (limits.sessionCapTokens > 0 && convTotal >= limits.sessionCapTokens) {
        throw new Error(`Ask Sage: session spend cap reached (${convTotal} of ${limits.sessionCapTokens} AS tokens) for this conversation`);
      }
      const hTotal = hourlyTotal(now);
      if (limits.hourlyCapTokens > 0 && hTotal >= limits.hourlyCapTokens) {
        throw new Error(`Ask Sage: hourly spend cap reached (${hTotal} of ${limits.hourlyCapTokens} AS tokens)`);
      }
    },
    /**
     * Records spend after a request completes (estimated or measured).
     * @param {string} conversationId
     * @param {number} cost
     */
    record(conversationId, cost) {
      if (!(cost > 0)) return;
      const now = Date.now();
      perConversation.set(conversationId, (perConversation.get(conversationId) || 0) + cost);
      hourly.push({ at: now, cost });
      prune(now);
    },
    /** @param {string} conversationId */
    snapshot(conversationId) {
      const now = Date.now();
      return { conversation: perConversation.get(conversationId) || 0, hourly: hourlyTotal(now) };
    },
  };
}

module.exports = { createSpendCap };
