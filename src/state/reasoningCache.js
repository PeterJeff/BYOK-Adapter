// @ts-check
'use strict';

// Bounded reasoning-state side cache: the fallback half of PLAN.md §5's reasoning round-trip. The
// first choice is carrying a Claude signed-thinking signature in LanguageModelThinkingPart's
// metadata, which round-trips through VS Code history inside a tool loop (E4, measured up to 6
// rounds and 64 KB signatures). This is the fallback for when it doesn't -- a window reload, a
// build where the part or its metadata is dropped, or a size limit -- keyed by tool-call id (the
// id VS Code hands back on the matching tool_result, per E2 and PLAN.md §5). LRU-bounded by entry
// count, entries expire after 2 hours, memory only: never written to disk, and gone when the
// extension host exits (this module is re-required on the next activation).

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * @param {{ maxEntries?: number, ttlMs?: number, now?: () => number }} [opts]
 */
function createReasoningCache(opts = {}) {
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const now = opts.now || Date.now;
  /** @type {Map<string, { thinking: string, signature: string, at: number }>} */
  const entries = new Map();

  return {
    /**
     * `signature` doubles as "the opaque blob to resend unmodified" for both flavors that need
     * this cache: Claude's cryptographic signature (M) and OpenAI's encrypted reasoning content
     * (R) -- same round-trip role, different transport, one field.
     * @param {string} toolCallId
     * @param {{ thinking: string, signature: string }} state
     */
    set(toolCallId, state) {
      if (!toolCallId || !state.signature) return;
      entries.delete(toolCallId); // re-insert at the end so `keys().next()` evicts the true LRU entry
      entries.set(toolCallId, { thinking: state.thinking, signature: state.signature, at: now() });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    /** @param {string} toolCallId */
    get(toolCallId) {
      const e = entries.get(toolCallId);
      if (!e) return undefined;
      if (now() - e.at > ttlMs) {
        entries.delete(toolCallId);
        return undefined;
      }
      return { thinking: e.thinking, signature: e.signature };
    },
    size() {
      return entries.size;
    },
  };
}

module.exports = { createReasoningCache };
