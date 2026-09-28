// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parts } = require('../helpers/vscode-stub');
const { streamMessages } = require('../../src/transport/anthropicMessages');

const CTORS = { TextPart: parts.LanguageModelTextPart, ToolCallPart: parts.LanguageModelToolCallPart, ToolResultPart: parts.LanguageModelToolResultPart, ThinkingPart: parts.LanguageModelThinkingPart };
const ROLE_ENUM = { User: 1, Assistant: 2 };
const text = (/** @type {string} */ v) => new parts.LanguageModelTextPart(v);
const token = () => ({ isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) });

/** @param {string} sseText */
function sseResponse(sseText) {
  return {
    status: 200,
    headers: { get: (/** @type {string} */ h) => (h.toLowerCase() === 'content-type' ? 'text/event-stream' : null) },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseText));
        controller.close();
      },
    }),
  };
}

const SSE_WITH_THINKING_AND_TOOL_USE =
  'event: message_start\n' +
  'data: {"type":"message_start","message":{"id":"msg_1","model":"claude-sonnet-5-2026","usage":{"input_tokens":100,"cache_read_input_tokens":20,"cache_creation_input_tokens":0}}}\n\n' +
  'event: content_block_start\n' +
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n' +
  'event: content_block_delta\n' +
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"reasoning..."}}\n\n' +
  'event: content_block_delta\n' +
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig-abc"}}\n\n' +
  'event: content_block_stop\n' +
  'data: {"type":"content_block_stop","index":0}\n\n' +
  'event: content_block_start\n' +
  'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call-1","name":"search"}}\n\n' +
  'event: content_block_delta\n' +
  'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"q\\":\\"x\\"}"}}\n\n' +
  'event: content_block_stop\n' +
  'data: {"type":"content_block_stop","index":1}\n\n' +
  'event: message_delta\n' +
  'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":15,"output_tokens_details":{"thinking_tokens":8}}}\n\n' +
  'event: message_stop\n' +
  'data: {"type":"message_stop"}\n\n';

test('streamMessages: extracts text, tool_use, thinking+signature, and usage from the SSE stream', async () => {
  const textChunks = [];
  const calls = [];
  const thinkings = [];
  const result = await streamMessages({
    apiBase: 'https://x.invalid',
    apiKey: 'k',
    model: 'google-claude-sonnet-5',
    messages: [{ role: 1, content: [text('hi')] }],
    ctors: CTORS,
    roleEnum: ROLE_ENUM,
    token: token(),
    onText: (t) => textChunks.push(t),
    onToolCall: (c) => calls.push(c),
    onThinking: (t) => thinkings.push(t),
    fetchImpl: async () => sseResponse(SSE_WITH_THINKING_AND_TOOL_USE),
  });

  assert.equal(result.error, null);
  assert.equal(result.resolvedModel, 'claude-sonnet-5-2026');
  assert.equal(result.stopReason, 'tool_use');
  assert.deepEqual(calls, [{ callId: 'call-1', name: 'search', input: { q: 'x' } }]);
  assert.deepEqual(thinkings, [{ toolCallId: 'call-1', value: 'reasoning...', signature: 'sig-abc' }]);
  assert.equal(result.usage.input_tokens, 100);
  assert.equal(result.usage.cache_read_input_tokens, 20);
  assert.equal(result.usage.output_tokens, 15);
  assert.equal(result.usage.output_tokens_details.thinking_tokens, 8);
});

test('streamMessages: always sends max_tokens (Anthropic requires it, unlike OpenAI)', async () => {
  /** @type {any} */
  let sentBody;
  await streamMessages({
    apiBase: 'https://x.invalid',
    apiKey: 'k',
    model: 'google-claude-sonnet-5',
    messages: [{ role: 1, content: [text('hi')] }],
    ctors: CTORS,
    roleEnum: ROLE_ENUM,
    token: token(),
    fetchImpl: async (/** @type {any} */ _url, /** @type {any} */ init) => {
      sentBody = JSON.parse(init.body);
      return sseResponse('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    },
  });
  assert.equal(sentBody.max_tokens, 4096);
});

test('streamMessages: places cache breakpoints on a long-enough prefix', async () => {
  /** @type {any} */
  let sentBody;
  const longText = 'x'.repeat(5000);
  await streamMessages({
    apiBase: 'https://x.invalid',
    apiKey: 'k',
    model: 'google-claude-sonnet-5',
    messages: [{ role: 1, content: [text(longText)] }],
    tools: [{ name: 'search', description: 'search', inputSchema: { type: 'object' } }],
    ctors: CTORS,
    roleEnum: ROLE_ENUM,
    minPrefixTokens: 0, // isolates breakpoint placement from the minimum-prefix skip (covered in test/cache/breakpoints.test.js)
    token: token(),
    fetchImpl: async (/** @type {any} */ _url, /** @type {any} */ init) => {
      sentBody = JSON.parse(init.body);
      return sseResponse('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    },
  });
  assert.deepEqual(sentBody.tools[0].cache_control, { type: 'ephemeral', ttl: '1h' });
  assert.deepEqual(sentBody.messages[0].content[0].cache_control, { type: 'ephemeral' });
});

test('streamMessages: an Anthropic error envelope is detected', async () => {
  const result = await streamMessages({
    apiBase: 'https://x.invalid',
    apiKey: 'bad',
    model: 'google-claude-sonnet-5',
    messages: [{ role: 1, content: [text('hi')] }],
    ctors: CTORS,
    roleEnum: ROLE_ENUM,
    token: token(),
    fetchImpl: async () => ({
      status: 400,
      headers: { get: (/** @type {string} */ h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
      text: async () => JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'bad request' } }),
    }),
  });
  assert.equal(result.error?.shape, 'anthropic-error');
  assert.match(result.error?.message ?? '', /bad request/);
});
