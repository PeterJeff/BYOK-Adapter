// @ts-check
'use strict';

// Pins the tool list Copilot sends on a conversation's first request, and keeps sending that same
// list (same tools, same order) for the rest of the conversation. Raised in TODO.md 2026-09-27
// ("Phase 2 cache input: pin the tool list per conversation"): Copilot's tool set changes
// mid-conversation (e.g. an extension registering a tool once it activates), and the tool list
// sits before the messages in the cached prefix on every flavor, so any change makes the next
// round full price (PLAN.md §4.3's "one cold turn per change" only covers a real, one-time
// change -- not churn).
//
// Policy: tools Copilot later removes are still sent (dropping one from the cached prefix would
// itself bust the cache, and the model may still reference it); tools Copilot adds later are held
// back until a new conversation id, and the first time that happens it's logged once so the
// tradeoff is visible. Pure: no vscode import: the caller decides what counts as a new
// conversation (src/extension.js's conversationIdFor) and how to log.

/**
 * @typedef {{ name: string, description?: string, inputSchema?: unknown }} ToolDef
 */

function createToolPinning() {
  /** @type {Map<string, ToolDef[]>} */
  const pinned = new Map();

  return {
    /**
     * @param {string} conversationId
     * @param {readonly ToolDef[]} tools this turn's tools, already sorted (src/convert/messages.js sortedTools)
     * @param {{ warn?: (msg: string) => void }} [o]
     * @returns {readonly ToolDef[]} the tools to actually send this turn
     */
    resolve(conversationId, tools, o = {}) {
      const existing = pinned.get(conversationId);
      if (!existing) {
        pinned.set(conversationId, [...tools]);
        return tools;
      }
      const existingNames = new Set(existing.map((t) => t.name));
      const newOnes = tools.filter((t) => !existingNames.has(t.name));
      if (newOnes.length && o.warn) {
        o.warn(
          `Ask Sage: ${newOnes.length} new tool(s) appeared mid-conversation (${newOnes.map((t) => t.name).join(', ')}); ` +
            `held back from the pinned tool list until a new chat (asksage.cache.pinToolList)`
        );
      }
      return existing;
    },
    /** @param {string} conversationId */
    clear(conversationId) {
      pinned.delete(conversationId);
    },
    size() {
      return pinned.size;
    },
  };
}

module.exports = { createToolPinning };
