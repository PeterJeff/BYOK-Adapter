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
 * @param {readonly any[]} messages
 * @param {PartCtors} ctors
 * @param {Record<string, number>} roleEnum
 */
function toResponsesInput(messages, ctors, roleEnum) {
  /** @type {any[]} */
  const out = [];
  for (const m of messages) {
    const role = roleName(m.role, roleEnum);
    for (const tr of toolResultsOf(m, ctors)) out.push({ type: 'function_call_output', call_id: tr.callId, output: toolResultText(tr.content, ctors) });
    const toolCalls = toolCallsOf(m, ctors);
    for (const c of toolCalls) out.push({ type: 'function_call', call_id: c.callId, name: c.name, arguments: JSON.stringify(c.input ?? {}) });
    const text = textOf(m, ctors);
    if (text) out.push({ role, content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }] });
  }
  return out;
}

module.exports = { roleName, textOf, toolCallsOf, toolResultsOf, toolResultText, sortedTools, toChatCompletionsTools, toResponsesTools, toChatCompletionsMessages, toResponsesInput };
