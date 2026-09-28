// @ts-check
'use strict';

// Converts VS Code's LanguageModelChatMessage[]/tools into the Chat Completions (CC) and
// Responses (R) wire shapes, and back. Pure: part classes and the role enum are injected
// (PLAN.md §7 "pure logic ... free of vscode imports"), same pattern as
// phase0/smoke-extension/lib/inspect.js.
//
// Phase 1 scope: text and basic tool-call/tool-result passthrough for Ask mode. No cache
// breakpoints, no reasoning-state round-trip (Phase 2, PLAN.md §4-§5).

/**
 * @typedef {{ TextPart: Function, ToolCallPart: Function, ToolResultPart: Function }} PartCtors
 */

/**
 * @param {unknown} role
 * @param {Record<string, number>} roleEnum
 */
function roleName(role, roleEnum) {
  for (const [name, value] of Object.entries(roleEnum)) if (value === role) return name.toLowerCase();
  return 'user';
}

/**
 * @param {any} message
 * @param {PartCtors} ctors
 */
function textOf(message, ctors) {
  let text = '';
  for (const p of message.content || []) if (p instanceof ctors.TextPart) text += p.value;
  return text;
}

/**
 * @param {any} message
 * @param {PartCtors} ctors
 */
function toolCallsOf(message, ctors) {
  return (message.content || []).filter((/** @type {any} */ p) => p instanceof ctors.ToolCallPart);
}

/**
 * @param {any} message
 * @param {PartCtors} ctors
 */
function toolResultsOf(message, ctors) {
  return (message.content || []).filter((/** @type {any} */ p) => p instanceof ctors.ToolResultPart);
}

/** @param {any} content vscode.LanguageModelToolResultPart#content: an array of parts */
function toolResultText(content, ctors) {
  let text = '';
  for (const p of content || []) {
    if (p instanceof ctors.TextPart) text += p.value;
    else if (typeof p === 'string') text += p;
  }
  return text;
}

/**
 * Deterministic tool ordering (PLAN.md §4.3): sort by name, stable JSON key order.
 * @param {readonly { name: string, description?: string, inputSchema?: unknown }[]} tools
 */
function sortedTools(tools) {
  return [...(tools || [])].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {readonly { name: string, description?: string, inputSchema?: unknown }[]} tools
 */
function toChatCompletionsTools(tools) {
  return sortedTools(tools).map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema || { type: 'object', properties: {} } } }));
}

/**
 * @param {readonly { name: string, description?: string, inputSchema?: unknown }[]} tools
 */
function toResponsesTools(tools) {
  return sortedTools(tools).map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.inputSchema || { type: 'object', properties: {} } }));
}

/**
 * @param {readonly any[]} messages
 * @param {PartCtors} ctors
 * @param {Record<string, number>} roleEnum
 */
function toChatCompletionsMessages(messages, ctors, roleEnum) {
  /** @type {any[]} */
  const out = [];
  for (const m of messages) {
    const role = roleName(m.role, roleEnum);
    const toolResults = toolResultsOf(m, ctors);
    for (const tr of toolResults) out.push({ role: 'tool', tool_call_id: tr.callId, content: toolResultText(tr.content, ctors) });
    const toolCalls = toolCallsOf(m, ctors);
    const text = textOf(m, ctors);
    if (toolCalls.length) {
      out.push({
        role: 'assistant',
        content: text || null,
        tool_calls: toolCalls.map((/** @type {any} */ c) => ({ id: c.callId, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) } })),
      });
    } else if (text || !toolResults.length) {
      out.push({ role, content: text });
    }
  }
  return out;
}

/**
 * Reasoning-item round-trip (PLAN.md §5, R/Responses): a `reasoning` item with its
 * `encrypted_content` must precede the `function_call` item(s) it led to. Same pairing and
 * fallback as toAnthropicMessages' thinking blocks -- metadata first (`metadata.encryptedContent`
 * on the emitted LanguageModelThinkingPart, E4's round-trip path), then
 * `opts.getReasoningState(toolCallId)` (src/state/reasoningCache.js, whose `signature` field
 * doubles as "the opaque blob to resend" for both M's Claude signature and R's encrypted
 * content), then `opts.onReasoningStateLost`. Measured (T22, GPT-6 Sol): dropping it is accepted
 * too -- the model just reasons again.
 * @param {readonly any[]} messages
 * @param {{ TextPart: Function, ToolCallPart: Function, ToolResultPart: Function, ThinkingPart?: Function }} ctors
 * @param {Record<string, number>} roleEnum
 * @param {{ getReasoningState?: (toolCallId: string) => { thinking: string, signature: string } | undefined,
 *   onReasoningStateLost?: (toolCallId: string) => void, includeReasoning?: boolean }} [opts]
 */
function toResponsesInput(messages, ctors, roleEnum, opts = {}) {
  const includeReasoning = opts.includeReasoning !== false;
  /** @type {any[]} */
  const out = [];
  for (const m of messages) {
    const role = roleName(m.role, roleEnum);
    for (const tr of toolResultsOf(m, ctors)) out.push({ type: 'function_call_output', call_id: tr.callId, output: toolResultText(tr.content, ctors) });
    const toolCalls = toolCallsOf(m, ctors);
    if (includeReasoning && toolCalls.length) {
      const thinkingParts = ctors.ThinkingPart ? (m.content || []).filter((/** @type {any} */ p) => p instanceof /** @type {Function} */ (ctors.ThinkingPart)) : [];
      const pairedCallId = toolCalls[0].callId;
      // Same metadata key as toAnthropicMessages' thinking-block signature: one opaque
      // round-trip blob, read the same way regardless of which flavor produced it.
      let encryptedContent = thinkingParts.map((/** @type {any} */ tp) => tp.metadata?.signature).find(Boolean);
      if (!encryptedContent && opts.getReasoningState) encryptedContent = opts.getReasoningState(pairedCallId)?.signature;
      if (encryptedContent) out.push({ type: 'reasoning', id: `rs-${pairedCallId}`, encrypted_content: encryptedContent, summary: [] });
      else if (opts.onReasoningStateLost) opts.onReasoningStateLost(pairedCallId);
    }
    for (const c of toolCalls) out.push({ type: 'function_call', call_id: c.callId, name: c.name, arguments: JSON.stringify(c.input ?? {}) });
    const text = textOf(m, ctors);
    if (text) out.push({ role, content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }] });
  }
  return out;
}

/**
 * @param {readonly { name: string, description?: string, inputSchema?: unknown }[]} tools
 */
function toAnthropicTools(tools) {
  return sortedTools(tools).map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema || { type: 'object', properties: {} } }));
}

/**
 * Converts to Anthropic's Messages API shape: a `system` array of text blocks (undefined if there
 * is none) and a `messages` array where tool results are folded into a 'user' message and
 * thinking/text/tool_use blocks are folded into one 'assistant' message per turn, per Anthropic's
 * protocol (unlike CC's separate 'tool' role).
 *
 * The stable VS Code API exposes no System role (only User/Assistant, confirmed in
 * test/helpers/vscode-stub.js and PLAN.md's "LanguageModelChatMessageRole.System (proposed)"
 * capability probe), so today Copilot's system-style instructions arrive folded into the first
 * user message like any other content -- same as the CC/R converters above, which extract no
 * system field either. `roleEnum.System` is still checked so this picks up a future VS Code that
 * adds it, without assuming one exists now.
 *
 * Reasoning-state round-trip (PLAN.md §5): a thinking part's signature is read from its
 * `metadata.signature` (the E4-confirmed round-trip path); when that's missing (dropped part, a
 * miss after reload) and the turn has a tool call, `opts.getReasoningState(toolCallId)` is tried
 * as the src/state/reasoningCache.js fallback. If both miss, `opts.onReasoningStateLost` fires
 * and the turn is sent with no thinking block (Ask Sage accepts this: the model just re-reasons,
 * T7/T22). `opts.includeThinking: false` skips thinking entirely, for the strip-and-retry path on
 * a preserved-thinking 400 (PLAN.md §5, Opus 5.5/Fable 5.1).
 * @param {readonly any[]} messages
 * @param {{ TextPart: Function, ToolCallPart: Function, ToolResultPart: Function, ThinkingPart?: Function }} ctors
 * @param {Record<string, number>} roleEnum
 * @param {{ getReasoningState?: (toolCallId: string) => { thinking: string, signature: string } | undefined,
 *   onReasoningStateLost?: (toolCallId: string) => void, includeThinking?: boolean }} [opts]
 */
function toAnthropicMessages(messages, ctors, roleEnum, opts = {}) {
  const systemRoleValue = roleEnum.System;
  const includeThinking = opts.includeThinking !== false;
  /** @type {{ type: 'text', text: string }[]} */
  const system = [];
  /** @type {any[]} */
  const out = [];
  for (const m of messages) {
    if (systemRoleValue !== undefined && m.role === systemRoleValue) {
      const t = textOf(m, ctors);
      if (t) system.push({ type: 'text', text: t });
      continue;
    }
    const role = roleName(m.role, roleEnum);
    const toolResults = toolResultsOf(m, ctors);
    if (toolResults.length) {
      out.push({ role: 'user', content: toolResults.map((/** @type {any} */ tr) => ({ type: 'tool_result', tool_use_id: tr.callId, content: [{ type: 'text', text: toolResultText(tr.content, ctors) }] })) });
    }
    const toolCalls = toolCallsOf(m, ctors);
    const text = textOf(m, ctors);
    const thinkingParts = ctors.ThinkingPart ? (m.content || []).filter((/** @type {any} */ p) => p instanceof /** @type {Function} */ (ctors.ThinkingPart)) : [];
    if (toolCalls.length || thinkingParts.length) {
      /** @type {any[]} */
      const content = [];
      const pairedCallId = toolCalls[0]?.callId;
      if (includeThinking) {
        let attached = false;
        for (const tp of thinkingParts) {
          const signature = /** @type {any} */ (tp).metadata?.signature;
          if (!signature) continue;
          const value = Array.isArray(tp.value) ? tp.value.join('') : tp.value;
          content.push({ type: 'thinking', thinking: value, signature });
          attached = true;
        }
        if (!attached && pairedCallId && opts.getReasoningState) {
          const cached = opts.getReasoningState(pairedCallId);
          if (cached) {
            content.push({ type: 'thinking', thinking: cached.thinking, signature: cached.signature });
            attached = true;
          }
        }
        if (!attached && pairedCallId && opts.onReasoningStateLost) opts.onReasoningStateLost(pairedCallId);
      }
      if (text) content.push({ type: 'text', text });
      for (const c of toolCalls) content.push({ type: 'tool_use', id: c.callId, name: c.name, input: c.input ?? {} });
      out.push({ role: 'assistant', content });
    } else if (text || !toolResults.length) {
      out.push({ role, content: [{ type: 'text', text }] });
    }
  }
  return { system: system.length ? system : undefined, messages: out };
}

module.exports = {
  roleName,
  textOf,
  toolCallsOf,
  toolResultsOf,
  toolResultText,
  sortedTools,
  toChatCompletionsTools,
  toResponsesTools,
  toChatCompletionsMessages,
  toResponsesInput,
  toAnthropicTools,
  toAnthropicMessages,
};
