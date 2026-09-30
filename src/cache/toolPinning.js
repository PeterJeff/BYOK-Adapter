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
// itself bust the cache, and the model may still reference it). Tools Copilot adds later are sent
// from that turn on and stay in the pinned set: one cold turn for the change, then stable again.
// (The transports sort tools by name on the wire, so this order is not the wire order.) Holding them back
// (the first version) left the model unable to call an MCP server the user enabled mid-chat, or
// a tool Copilot's virtual-tool grouping added. Pure: no vscode import: the caller
// decides what counts as a new conversation (src/extension.js's conversationIdFor) and how to log.

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
     * @param {{ onAdded?: (msg: string) => void }} [o] called once per turn that adds tools
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
      if (!newOnes.length) return existing;
      const merged = [...existing, ...newOnes];
      pinned.set(conversationId, merged);
      if (o.onAdded) {
        o.onAdded(
          `Ask Sage: ${newOnes.length} tool(s) added mid-conversation (${newOnes.map((t) => t.name).join(', ')}); ` +
            `sent from now on, so this one request reads its prompt at full price (asksage.cache.pinToolList)`
        );
      }
      return merged;
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
