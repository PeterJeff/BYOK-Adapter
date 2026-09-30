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

// DEFECTS D3. No recorded stream has parallel tool calls yet (no live run has recorded one yet), so this
// replays a recorded message (thinking block with its real signature, then a tool_use) as an SSE
// stream and adds a second tool_use to it, the shape Anthropic emits for parallel calls.
const fs = require('node:fs');
const path = require('node:path');
const { toAnthropicMessages } = require('../../src/convert/messages');

/** @param {any} message a recorded non-streaming Messages response body */
function sseFromMessage(message) {
  const sse = (/** @type {any} */ d) => `event: ${d.type}\ndata: ${JSON.stringify(d)}\n\n`;
  let out = sse({ type: 'message_start', message: { id: message.id, model: message.model, usage: { input_tokens: 10 } } });
  message.content.forEach((/** @type {any} */ b, /** @type {number} */ i) => {
    if (b.type === 'thinking') {
      out += sse({ type: 'content_block_start', index: i, content_block: { type: 'thinking', thinking: '' } });
      out += sse({ type: 'content_block_delta', index: i, delta: { type: 'thinking_delta', thinking: b.thinking } });
      out += sse({ type: 'content_block_delta', index: i, delta: { type: 'signature_delta', signature: b.signature } });
    } else {
      out += sse({ type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: b.id, name: b.name } });
      out += sse({ type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
    }
    out += sse({ type: 'content_block_stop', index: i });
  });
  return out + sse({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } }) + sse({ type: 'message_stop' });
}

test('parallel tool calls: one thinking block is reported, and history resends it once (DEFECTS D3)', async () => {
  const recorded = JSON.parse(fs.readFileSync(path.join(__dirname, '../../research/live/manual-run/probe/2026-09-26-0402-c5ced6/T7/050-m-round1.json'), 'utf8')).body;
  const thinkingBlock = recorded.content.find((/** @type {any} */ b) => b.type === 'thinking');
  const toolUse = recorded.content.find((/** @type {any} */ b) => b.type === 'tool_use');
  const parallel = { ...recorded, content: [thinkingBlock, toolUse, { ...toolUse, id: 'toolu_second', input: { city: 'Berlin' } }, { ...toolUse, id: 'toolu_third', input: { city: 'Rome' } }] };

  const calls = [];
  const thinkings = [];
  const result = await streamMessages({
    apiBase: 'https://x.invalid', apiKey: 'k', model: 'google-claude-45-haiku',
    messages: [{ role: 1, content: [text('weather in three cities')] }],
    ctors: CTORS, roleEnum: ROLE_ENUM, token: token(),
    onToolCall: (c) => calls.push(c),
    onThinking: (t) => thinkings.push(t),
    fetchImpl: async () => sseResponse(sseFromMessage(parallel)),
  });
  assert.equal(result.error, null);
  assert.equal(calls.length, 3);
  assert.equal(thinkings.length, 1, 'one thinking block for the turn, not one per tool call');
  assert.deepEqual(thinkings[0], { toolCallId: toolUse.id, value: thinkingBlock.thinking, signature: thinkingBlock.signature });

  // Replay the turn the way VS Code hands it back: the calls, and a thinking part per report.
  const assistant = {
    role: 2,
    content: [
      ...calls.map((c) => new parts.LanguageModelToolCallPart(c.callId, c.name, c.input)),
      ...thinkings.map((t) => new parts.LanguageModelThinkingPart(t.value, t.toolCallId, { signature: t.signature })),
    ],
  };
  const out = toAnthropicMessages([{ role: 1, content: [text('weather in three cities')] }, assistant], CTORS, ROLE_ENUM);
  const types = out.messages[1].content.map((/** @type {any} */ b) => b.type);
  assert.deepEqual(types, ['thinking', 'tool_use', 'tool_use', 'tool_use']);
  assert.equal(out.messages[1].content[0].signature, thinkingBlock.signature, 'sent back unmodified');
});

test('toAnthropicMessages: a history with one thinking copy per tool call (older builds) still sends one (DEFECTS D3)', () => {
  const calls = ['a', 'b'].map((id) => new parts.LanguageModelToolCallPart(id, 'search', {}));
  const twins = ['a', 'b'].map((id) => new parts.LanguageModelThinkingPart('because', id, { signature: 'sig-same' }));
  const out = toAnthropicMessages([{ role: 2, content: [calls[0], twins[0], calls[1], twins[1]] }], CTORS, ROLE_ENUM);
  assert.deepEqual(out.messages[0].content.map((/** @type {any} */ b) => b.type), ['thinking', 'tool_use', 'tool_use']);
});
