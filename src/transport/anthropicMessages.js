// @ts-check
'use strict';

// M (Anthropic Messages) transport: /server/anthropic/v1/messages. PLAN.md §2.2: always the
// default for Claude, with no CC fallback (Claude through CC is billed 0 today, an Ask Sage bug --
// never route Claude through CC, PLAN.md §2.1). Auth: raw API key as Bearer, the same shape CC/R
// use (no evidence of a different style for M).
//
// Phase 2 scope (PLAN.md §4.1, §5): cache breakpoints via src/cache/breakpoints.js, the per-model
// thinking shape from src/convert/thinking.js (the caller supplies it, so this module has no
// per-model knowledge), and the reasoning-state round-trip: a thinking block's signature is
// carried out via `onThinking` (the caller attaches it to an emitted LanguageModelThinkingPart's
// metadata and/or the src/state/reasoningCache.js side cache) and read back in via
// `getReasoningState`/`onReasoningStateLost`, both threaded through to
// src/convert/messages.js's toAnthropicMessages.

const { request } = require('./httpClient');
const { toAnthropicMessages, toAnthropicTools } = require('../convert/messages');
const { placeBreakpoints } = require('../cache/breakpoints');

/**
 * @typedef {{ TextPart: Function, ToolCallPart: Function, ToolResultPart: Function, ThinkingPart?: Function }} PartCtors
 */

/**
 * @param {{ apiBase: string, apiKey: string, model: string, messages: readonly any[], ctors: PartCtors,
 *   roleEnum: Record<string, number>, tools?: readonly any[], maxOutputTokens?: number,
 *   thinkingShape?: { thinking?: object, output_config?: object }, includeThinking?: boolean,
 *   ttlMode?: '5m' | 'mixed' | '1h', minPrefixTokens?: number,
 *   getReasoningState?: (toolCallId: string) => { thinking: string, signature: string } | undefined,
 *   onReasoningStateLost?: (toolCallId: string) => void,
 *   onText?: (text: string) => void,
 *   onToolCall?: (call: { callId: string, name: string, input: unknown }) => void,
 *   onThinking?: (t: { toolCallId: string, value: string, signature: string }) => void,
 *   token?: import('./httpClient').RequestOptions['token'], fetchImpl?: typeof fetch }} opts
 */
async function streamMessages(opts) {
  const converted = toAnthropicMessages(opts.messages, opts.ctors, opts.roleEnum, {
    getReasoningState: opts.getReasoningState,
    onReasoningStateLost: opts.onReasoningStateLost,
    includeThinking: opts.includeThinking !== false,
  });

  /** @type {Record<string, any>} */
  let body = {
    model: opts.model,
    stream: true,
    max_tokens: opts.maxOutputTokens || 4096, // Anthropic requires max_tokens, unlike OpenAI's optional cap
    messages: converted.messages,
    ...(converted.system ? { system: converted.system } : {}),
    ...(opts.thinkingShape || {}),
  };
  if (opts.tools && opts.tools.length) body.tools = toAnthropicTools(opts.tools);

  body = { ...body, ...placeBreakpoints(body, { ttlMode: opts.ttlMode, minPrefixTokens: opts.minPrefixTokens }) };

  /** @type {Record<number, { type: string, id?: string, name?: string, json: string, text: string, signature: string }>} */
  const blocks = {};
  /** @type {{ callId: string, name: string, input: unknown }[]} */
  const calls = [];
  /** @type {{ value: string, signature: string } | null} */
  let lastThinking = null;
  /** @type {Record<string, any> | null} */
  let usage = null;
  /** @type {string | null} */
  let resolvedModel = null;
  /** @type {string | null} */
  let stopReason = null;

  const result = await request({
    url: `${opts.apiBase}/server/anthropic/v1/messages`,
    headers: { authorization: `Bearer ${opts.apiKey}` },
    body,
    stream: true,
    token: opts.token,
    fetchImpl: opts.fetchImpl,
    onEvent: (ev) => {
      const d = /** @type {any} */ (ev.data);
      if (!d || typeof d !== 'object') return;
      if (d.type === 'message_start') {
        if (d.message?.model) resolvedModel = d.message.model;
        if (d.message?.usage) usage = { ...(usage || {}), ...d.message.usage };
      } else if (d.type === 'content_block_start') {
        blocks[d.index] = {
          type: d.content_block?.type,
          id: d.content_block?.id,
          name: d.content_block?.name,
          json: '',
          text: d.content_block?.text || '',
          signature: d.content_block?.signature || '',
        };
        if (d.content_block?.type === 'text' && d.content_block.text && opts.onText) opts.onText(d.content_block.text);
      } else if (d.type === 'content_block_delta') {
        const b = blocks[d.index];
        if (!b) return;
        const delta = d.delta || {};
        if (delta.type === 'text_delta') {
          b.text += delta.text || '';
          if (opts.onText) opts.onText(delta.text || '');
        } else if (delta.type === 'input_json_delta') {
          b.json += delta.partial_json || '';
        } else if (delta.type === 'thinking_delta') {
          b.text += delta.thinking || '';
        } else if (delta.type === 'signature_delta') {
          b.signature += delta.signature || '';
        }
      } else if (d.type === 'content_block_stop') {
        const b = blocks[d.index];
        if (!b) return;
        if (b.type === 'tool_use') {
          /** @type {unknown} */
          let input = {};
          try {
            input = b.json ? JSON.parse(b.json) : {};
          } catch {
            input = {};
          }
          calls.push({ callId: /** @type {string} */ (b.id), name: /** @type {string} */ (b.name), input });
        } else if (b.type === 'thinking') {
          lastThinking = { value: b.text, signature: b.signature };
        }
      } else if (d.type === 'message_delta') {
        if (d.usage) usage = { ...(usage || {}), ...d.usage };
        if (d.delta?.stop_reason) stopReason = d.delta.stop_reason;
      }
    },
  });

  if (!result.error && !result.transportError) {
    for (const c of calls) if (opts.onToolCall) opts.onToolCall(c);
    // One thinking block per turn, reported once and paired with the turn's first tool call (the
    // id the converter and the reasoning cache look it up by). Reporting it per call put N
    // identical blocks in history, and they were resent as N thinking blocks.
    if (calls.length && lastThinking && opts.onThinking) opts.onThinking({ toolCallId: calls[0].callId, value: lastThinking.value, signature: lastThinking.signature });
  }

  return { usage, resolvedModel, stopReason, error: result.error, transportError: result.transportError, requestBody: body };
}

module.exports = { streamMessages };
