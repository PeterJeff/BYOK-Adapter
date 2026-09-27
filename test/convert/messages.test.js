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
  sortedTools,
} = require('../../src/convert/messages');

const ROLE_ENUM = { User: 1, Assistant: 2 };
const CTORS = { TextPart: parts.LanguageModelTextPart, ToolCallPart: parts.LanguageModelToolCallPart, ToolResultPart: parts.LanguageModelToolResultPart };
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
