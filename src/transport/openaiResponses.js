// @ts-check
'use strict';

// R (OpenAI Responses) transport: /server/openai/v1/responses. PLAN.md §2.2/§4.2: R is the
// default for GPT-5.4+ and reasoning GPT models (cache-discounted, measured). store:false, the
// full history every request, never previous_response_id. Auth: raw API key as Bearer, same as
// CC (measured shape). Reasoning-state round-trip (encrypted_content persisted across tool
// rounds, PLAN.md §5) is Phase 2; this phase streams text and passes tool calls through.

const { request } = require('./httpClient');
const { toResponsesInput, toResponsesTools } = require('../convert/messages');

/**
 * @typedef {{ TextPart: Function, ToolCallPart: Function, ToolResultPart: Function }} PartCtors
 */

/**
 * @param {{ apiBase: string, apiKey: string, model: string, messages: readonly any[], ctors: PartCtors,
 *   roleEnum: Record<string, number>, tools?: readonly any[], maxOutputTokens?: number, promptCacheKey?: string,
 *   includeReasoning?: boolean,
 *   getReasoningState?: (toolCallId: string) => { thinking: string, signature: string } | undefined,
 *   onReasoningStateLost?: (toolCallId: string) => void,
 *   onText?: (text: string) => void, onToolCall?: (call: { callId: string, name: string, input: unknown }) => void,
 *   onThinking?: (t: { toolCallId: string, value: string, signature: string }) => void,
 *   token?: import('./httpClient').RequestOptions['token'], fetchImpl?: typeof fetch }} opts
 */
async function streamResponses(opts) {
  /** @type {Record<string, any>} */
  const body = {
    model: opts.model,
    stream: true,
    store: false,
    include: ['reasoning.encrypted_content'], // PLAN.md §5: needed for the reasoning item to round-trip (measured, T22)
    input: toResponsesInput(opts.messages, opts.ctors, opts.roleEnum, {
      getReasoningState: opts.getReasoningState,
      onReasoningStateLost: opts.onReasoningStateLost,
      includeReasoning: opts.includeReasoning !== false,
    }),
  };
  if (opts.tools && opts.tools.length) body.tools = toResponsesTools(opts.tools);
  if (opts.maxOutputTokens) body.max_output_tokens = opts.maxOutputTokens;
  if (opts.promptCacheKey) body.prompt_cache_key = opts.promptCacheKey; // PLAN.md §4.2

  /** @type {{ callId: string, name: string, args: string }[]} */
  const calls = [];
  /** @type {{ encryptedContent: string } | null} */
  let lastReasoning = null;
  /** @type {Record<string, any> | null} */
  let usage = null;
  /** @type {string | null} */
  let resolvedModel = null;
  /** @type {string | null} */
  let stopReason = null;

  const result = await request({
    url: `${opts.apiBase}/server/openai/v1/responses`,
    headers: { authorization: `Bearer ${opts.apiKey}` },
    body,
    stream: true,
    token: opts.token,
    fetchImpl: opts.fetchImpl,
    onEvent: (ev) => {
      const d = /** @type {any} */ (ev.data);
      if (!d || typeof d !== 'object') return;
      if (d.type === 'response.output_text.delta' && opts.onText) opts.onText(d.delta || '');
      if (d.type === 'response.output_item.done' && d.item?.type === 'function_call') {
        calls.push({ callId: d.item.call_id, name: d.item.name, args: d.item.arguments || '' });
      }
      if (d.type === 'response.output_item.done' && d.item?.type === 'reasoning' && d.item.encrypted_content) {
        lastReasoning = { encryptedContent: d.item.encrypted_content };
      }
      if (d.type === 'response.completed' || d.type === 'response.incomplete') {
        if (d.response?.usage) usage = d.response.usage;
        if (d.response?.model) resolvedModel = d.response.model;
        if (d.response?.status) stopReason = d.response.status;
      }
    },
  });

  if (!result.error && !result.transportError) {
    for (const c of calls) {
      /** @type {unknown} */
      let input = {};
      try {
        input = c.args ? JSON.parse(c.args) : {};
      } catch {
        input = {};
      }
      if (opts.onToolCall) opts.onToolCall({ callId: c.callId, name: c.name, input });
      // As with M's thinking block (anthropicMessages.js): the one reasoning item in a turn
      // precedes all of that turn's function_call items, so it pairs with each of them.
      if (lastReasoning && opts.onThinking) opts.onThinking({ toolCallId: c.callId, value: '', signature: lastReasoning.encryptedContent });
    }
  }

  return { usage, resolvedModel, stopReason, error: result.error, transportError: result.transportError, requestBody: body };
}

module.exports = { streamResponses };
