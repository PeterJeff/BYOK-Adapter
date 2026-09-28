// @ts-check
'use strict';

// CC (OpenAI Chat Completions) transport: /server/openai/v1/chat/completions. Auth is the raw
// API key as a Bearer token (measured shape, phase0/probe/lib/client.mjs DEFAULT_STYLE.CC) --
// no JWT exchange for model calls, only for /server and /user endpoints (auth/accessToken.js).

const { request } = require('./httpClient');
const { toChatCompletionsMessages, toChatCompletionsTools } = require('../convert/messages');

/**
 * @typedef {{ TextPart: Function, ToolCallPart: Function, ToolResultPart: Function }} PartCtors
 */

/**
 * @param {{ apiBase: string, apiKey: string, model: string, messages: readonly any[], ctors: PartCtors,
 *   roleEnum: Record<string, number>, tools?: readonly any[], maxOutputTokens?: number, promptCacheKey?: string,
 *   onText?: (text: string) => void, onToolCall?: (call: { callId: string, name: string, input: unknown }) => void,
 *   token?: import('./httpClient').RequestOptions['token'], fetchImpl?: typeof fetch }} opts
 */
async function streamChatCompletions(opts) {
  /** @type {Record<string, any>} */
  const body = {
    model: opts.model,
    stream: true,
    stream_options: { include_usage: true },
    messages: toChatCompletionsMessages(opts.messages, opts.ctors, opts.roleEnum),
  };
  if (opts.tools && opts.tools.length) body.tools = toChatCompletionsTools(opts.tools);
  if (opts.maxOutputTokens) body.max_completion_tokens = opts.maxOutputTokens;
  if (opts.promptCacheKey) body.prompt_cache_key = opts.promptCacheKey; // PLAN.md §4.2

  /** @type {Record<number, { id: string, name: string, args: string }>} */
  const calls = {};
  /** @type {Record<string, any> | null} */
  let usage = null;
  /** @type {string | null} */
  let resolvedModel = null;
  /** @type {string | null} */
  let stopReason = null;

  const result = await request({
    url: `${opts.apiBase}/server/openai/v1/chat/completions`,
    headers: { authorization: `Bearer ${opts.apiKey}` },
    body,
    stream: true,
    token: opts.token,
    fetchImpl: opts.fetchImpl,
    onEvent: (ev) => {
      if (ev.data === '[DONE]') return;
      const d = /** @type {any} */ (ev.data);
      if (!d || typeof d !== 'object') return;
      if (d.model) resolvedModel = d.model;
      if (d.usage) usage = d.usage;
      const ch = d.choices?.[0];
      if (!ch) return;
      if (ch.delta?.content && opts.onText) opts.onText(ch.delta.content);
      for (const t of ch.delta?.tool_calls || []) {
        const idx = t.index ?? 0;
        if (!calls[idx]) calls[idx] = { id: '', name: '', args: '' };
        const c = calls[idx];
        if (t.id) c.id = t.id;
        if (t.function?.name) c.name += t.function.name;
        if (t.function?.arguments) c.args += t.function.arguments;
      }
      if (ch.finish_reason) stopReason = ch.finish_reason;
    },
  });

  if (!result.error && !result.transportError && opts.onToolCall) {
    for (const c of Object.values(calls)) {
      /** @type {unknown} */
      let input = {};
      try {
        input = c.args ? JSON.parse(c.args) : {};
      } catch {
        input = {};
      }
      opts.onToolCall({ callId: c.id, name: c.name, input });
    }
  }

  return { usage, resolvedModel, stopReason, error: result.error, transportError: result.transportError, requestBody: body };
}

module.exports = { streamChatCompletions };
