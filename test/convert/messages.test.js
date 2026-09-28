// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parts } = require('../helpers/vscode-stub');
const {
  toChatCompletionsMessages,
  toResponsesInput,
  toChatCompletionsTools,
  toResponsesTools,
  toAnthropicTools,
  toAnthropicMessages,
  sortedTools,
} = require('../../src/convert/messages');

const ROLE_ENUM = { User: 1, Assistant: 2 };
const CTORS = { TextPart: parts.LanguageModelTextPart, ToolCallPart: parts.LanguageModelToolCallPart, ToolResultPart: parts.LanguageModelToolResultPart };
const CTORS_WITH_THINKING = { ...CTORS, ThinkingPart: parts.LanguageModelThinkingPart };
const text = (/** @type {string} */ v) => new parts.LanguageModelTextPart(v);

test('sortedTools is deterministic regardless of input order (PLAN §4.3)', () => {
  const tools = [{ name: 'zeta' }, { name: 'alpha' }, { name: 'mid' }];
  assert.deepEqual(sortedTools(tools).map((t) => t.name), ['alpha', 'mid', 'zeta']);
});

test('toChatCompletionsTools / toResponsesTools shapes', () => {
  const tools = [{ name: 'b', description: 'B tool', inputSchema: { type: 'object' } }, { name: 'a', description: 'A tool' }];
  assert.deepEqual(toChatCompletionsTools(tools), [
    { type: 'function', function: { name: 'a', description: 'A tool', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'b', description: 'B tool', parameters: { type: 'object' } } },
  ]);
  assert.deepEqual(toResponsesTools(tools), [
    { type: 'function', name: 'a', description: 'A tool', parameters: { type: 'object', properties: {} } },
    { type: 'function', name: 'b', description: 'B tool', parameters: { type: 'object' } },
  ]);
});

test('toChatCompletionsMessages: plain user/assistant text', () => {
  const messages = [{ role: 1, content: [text('hi')] }, { role: 2, content: [text('hello back')] }];
  assert.deepEqual(toChatCompletionsMessages(messages, CTORS, ROLE_ENUM), [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello back' },
  ]);
});

test('toChatCompletionsMessages: assistant tool call, then a tool-result message', () => {
  const messages = [
    { role: 1, content: [text('run it')] },
    { role: 2, content: [new parts.LanguageModelToolCallPart('call-1', 'search', { q: 'x' })] },
    { role: 1, content: [new parts.LanguageModelToolResultPart('call-1', [text('42 results')])] },
  ];
  const out = toChatCompletionsMessages(messages, CTORS, ROLE_ENUM);
  assert.deepEqual(out, [
    { role: 'user', content: 'run it' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'search', arguments: '{"q":"x"}' } }] },
    { role: 'tool', tool_call_id: 'call-1', content: '42 results' },
  ]);
});

test('toResponsesInput: text, function_call and function_call_output items', () => {
  const messages = [
    { role: 1, content: [text('run it')] },
    { role: 2, content: [new parts.LanguageModelToolCallPart('call-1', 'search', { q: 'x' })] },
    { role: 1, content: [new parts.LanguageModelToolResultPart('call-1', [text('42 results')])] },
  ];
  const out = toResponsesInput(messages, CTORS, ROLE_ENUM);
  assert.deepEqual(out, [
    { role: 'user', content: [{ type: 'input_text', text: 'run it' }] },
    { type: 'function_call', call_id: 'call-1', name: 'search', arguments: '{"q":"x"}' },
    { type: 'function_call_output', call_id: 'call-1', output: '42 results' },
  ]);
});

test('toResponsesInput: a reasoning item precedes the function_call it led to, from cache (PLAN §5)', () => {
  const messages = [{ role: 2, content: [new parts.LanguageModelToolCallPart('call-1', 'search', { q: 'x' })] }];
  const out = toResponsesInput(messages, CTORS, ROLE_ENUM, { getReasoningState: (id) => (id === 'call-1' ? { thinking: '', signature: 'enc-abc' } : undefined) });
  assert.deepEqual(out, [
    { type: 'reasoning', id: 'rs-call-1', encrypted_content: 'enc-abc', summary: [] },
    { type: 'function_call', call_id: 'call-1', name: 'search', arguments: '{"q":"x"}' },
  ]);
});

test('toResponsesInput: no reasoning state anywhere -> onReasoningStateLost fires, no reasoning item, no crash', () => {
  const messages = [{ role: 2, content: [new parts.LanguageModelToolCallPart('call-1', 'search', {})] }];
  const lost = [];
  const out = toResponsesInput(messages, CTORS, ROLE_ENUM, { onReasoningStateLost: (id) => lost.push(id) });
  assert.deepEqual(lost, ['call-1']);
  assert.equal(out.some((i) => i.type === 'reasoning'), false);
});

test('toResponsesInput: includeReasoning:false skips reasoning entirely, even with cached state', () => {
  const messages = [{ role: 2, content: [new parts.LanguageModelToolCallPart('call-1', 'search', {})] }];
  const out = toResponsesInput(messages, CTORS, ROLE_ENUM, { includeReasoning: false, getReasoningState: () => ({ thinking: '', signature: 'enc-abc' }) });
  assert.equal(out.some((i) => i.type === 'reasoning'), false);
});

test('toAnthropicTools uses input_schema (not parameters) and sorts by name', () => {
  const tools = [{ name: 'b', description: 'B tool', inputSchema: { type: 'object' } }, { name: 'a', description: 'A tool' }];
  assert.deepEqual(toAnthropicTools(tools), [
    { name: 'a', description: 'A tool', input_schema: { type: 'object', properties: {} } },
    { name: 'b', description: 'B tool', input_schema: { type: 'object' } },
  ]);
});

test('toAnthropicMessages: no System role in the stable API, so system content folds into a plain user message (unmapped)', () => {
  const messages = [{ role: 1, content: [text('hi')] }, { role: 2, content: [text('hello back')] }];
  const out = toAnthropicMessages(messages, CTORS, ROLE_ENUM);
  assert.equal(out.system, undefined);
  assert.deepEqual(out.messages, [
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'hello back' }] },
  ]);
});

test('toAnthropicMessages: a System-role message (feature-detected) becomes the system array', () => {
  const roleEnumWithSystem = { User: 1, Assistant: 2, System: 0 };
  const messages = [{ role: 0, content: [text('be terse')] }, { role: 1, content: [text('hi')] }];
  const out = toAnthropicMessages(messages, CTORS, roleEnumWithSystem);
  assert.deepEqual(out.system, [{ type: 'text', text: 'be terse' }]);
  assert.deepEqual(out.messages, [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]);
});

test('toAnthropicMessages: tool_use/tool_result fold into one assistant / one user message', () => {
  const messages = [
    { role: 1, content: [text('run it')] },
    { role: 2, content: [new parts.LanguageModelToolCallPart('call-1', 'search', { q: 'x' })] },
    { role: 1, content: [new parts.LanguageModelToolResultPart('call-1', [text('42 results')])] },
  ];
  const out = toAnthropicMessages(messages, CTORS, ROLE_ENUM);
  assert.deepEqual(out.messages, [
    { role: 'user', content: [{ type: 'text', text: 'run it' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'call-1', name: 'search', input: { q: 'x' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: [{ type: 'text', text: '42 results' }] }] },
  ]);
});

test('toAnthropicMessages: a thinking part with a signature in metadata round-trips ahead of its tool_use (PLAN §5, E4)', () => {
  const messages = [{ role: 2, content: [new parts.LanguageModelThinkingPart('because...', 'think-1', { signature: 'sig-abc' }), new parts.LanguageModelToolCallPart('call-1', 'search', {})] }];
  const out = toAnthropicMessages(messages, CTORS_WITH_THINKING, ROLE_ENUM);
  assert.deepEqual(out.messages, [
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'because...', signature: 'sig-abc' }, { type: 'tool_use', id: 'call-1', name: 'search', input: {} }] },
  ]);
});

test('toAnthropicMessages: missing metadata falls back to the reasoning-state cache, then to onReasoningStateLost', () => {
  const messages = [{ role: 2, content: [new parts.LanguageModelToolCallPart('call-1', 'search', {})] }];
  const cached = toAnthropicMessages(messages, CTORS_WITH_THINKING, ROLE_ENUM, { getReasoningState: (id) => (id === 'call-1' ? { thinking: 'cached reasoning', signature: 'sig-cached' } : undefined) });
  assert.deepEqual(cached.messages[0].content[0], { type: 'thinking', thinking: 'cached reasoning', signature: 'sig-cached' });

  const lost = [];
  const uncached = toAnthropicMessages(messages, CTORS_WITH_THINKING, ROLE_ENUM, { onReasoningStateLost: (id) => lost.push(id) });
  assert.equal(uncached.messages[0].content.some((c) => c.type === 'thinking'), false);
  assert.deepEqual(lost, ['call-1']);
});

test('toAnthropicMessages: includeThinking:false strips thinking even when metadata is present (strip-and-retry, PLAN §5)', () => {
  const messages = [{ role: 2, content: [new parts.LanguageModelThinkingPart('because...', 'think-1', { signature: 'sig-abc' }), new parts.LanguageModelToolCallPart('call-1', 'search', {})] }];
  const out = toAnthropicMessages(messages, CTORS_WITH_THINKING, ROLE_ENUM, { includeThinking: false });
  assert.equal(out.messages[0].content.some((c) => c.type === 'thinking'), false);
});
