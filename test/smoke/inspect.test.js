// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inspect = require('../../phase0/smoke-extension/lib/inspect');
const { parts } = require('../helpers/vscode-stub');

const ctors = {
  TextPart: parts.LanguageModelTextPart,
  ToolCallPart: parts.LanguageModelToolCallPart,
  ToolResultPart: parts.LanguageModelToolResultPart,
  DataPart: parts.LanguageModelDataPart,
  ThinkingPart: parts.LanguageModelThinkingPart,
};
const text = (/** @type {string} */ v) => new parts.LanguageModelTextPart(v);

test('makeNonce has the scanned shape', () => {
  const n = inspect.makeNonce(7, () => 0.5);
  assert.match(n, /^smk-7-[a-z0-9]{6}$/);
});

test('classifyPart uses classes, then duck typing', () => {
  assert.equal(inspect.classifyPart(text('x'), ctors), 'text');
  assert.equal(inspect.classifyPart(new parts.LanguageModelThinkingPart('t'), ctors), 'thinking');
  assert.equal(inspect.classifyPart(new parts.LanguageModelToolCallPart('c', 'n', {}), ctors), 'toolCall');
  assert.equal(inspect.classifyPart(new parts.LanguageModelToolResultPart('c', []), ctors), 'toolResult');
  assert.equal(inspect.classifyPart(parts.LanguageModelDataPart.json({}, 'a/b'), ctors), 'data');
  // Without the class (proposed API absent), a thinking part is still named by its constructor.
  assert.equal(inspect.classifyPart(new parts.LanguageModelThinkingPart('t'), {}), 'thinking');
  assert.equal(inspect.classifyPart({ callId: 'c', name: 'n', input: {} }, {}), 'toolCall');
  assert.equal(inspect.classifyPart({ mimeType: 'a', data: new Uint8Array() }, {}), 'data');
  assert.equal(inspect.classifyPart({ value: 'plain' }, {}), 'text');
  assert.match(inspect.classifyPart({ weird: 1 }, {}), /^unknown\(Object: weird\)$/);
  assert.equal(inspect.classifyPart(null, ctors), 'object');
});

test('summarizeMessages counts roles, parts and chars', () => {
  const s = inspect.summarizeMessages(
    [
      { role: 1, content: [text('hello')] },
      { role: 2, content: [new parts.LanguageModelThinkingPart('abc', 'id1', { k: 1 }), text('hi'), new parts.LanguageModelToolCallPart('c1', 'read', { p: 1 })] },
      { role: 1, content: [new parts.LanguageModelToolResultPart('c1', [text('result!')])] },
    ],
    ctors
  );
  assert.equal(s.count, 3);
  assert.deepEqual(s.roleCounts, { user: 2, assistant: 1 });
  assert.deepEqual(s.partCounts, { text: 2, thinking: 1, toolCall: 1, toolResult: 1 });
  assert.equal(s.charsByRole.user, 5 + 7);
  assert.equal(s.perMessage[1].parts[0].detail, '3 chars, id=yes, metadata=k');
  assert.equal(s.perMessage[2].parts[0].detail, 'c1 [text] 7 chars');
});

test('scanRoundTrips finds nonces in assistant text, thinking and data parts only', () => {
  const n1 = 'smk-1-aaaaaa';
  const n2 = 'smk-2-bbbbbb';
  const messages = [
    { role: 1, content: [text(`user quoting ${n2}`)] },
    {
      role: 2,
      content: [
        new parts.LanguageModelThinkingPart(`thinking ${n1}`, `think-${n1}`, { smokeNonce: n1 }),
        text(`reply nonce ${n1}`),
        parts.LanguageModelDataPart.json({ smokeNonce: n1 }, inspect.SMOKE_MIME),
        parts.LanguageModelDataPart.json({ prompt_tokens: 1 }, inspect.USAGE_MIME),
      ],
    },
    { role: 2, content: [text(`second ${n2}`), new parts.LanguageModelThinkingPart([`split `, n2])] },
  ];
  const { roundTrips, usageParts } = inspect.scanRoundTrips(messages, ctors);
  assert.equal(usageParts, 1);
  const byNonce = Object.fromEntries(roundTrips.map((r) => [r.nonce, r]));
  assert.deepEqual(byNonce[n1], { nonce: n1, text: true, thinking: true, thinkingId: true, thinkingMetadata: true, data: true });
  assert.deepEqual(byNonce[n2], { nonce: n2, text: true, thinking: true, thinkingId: false, thinkingMetadata: false, data: false });
});

test('parseCommand finds directives inside wrapped prompts', () => {
  assert.deepEqual(inspect.parseCommand('<userRequest>\nplease smoke:tool read_file {"a":1}\n</userRequest>'), { command: 'tool', args: 'read_file {"a":1}' });
  assert.deepEqual(inspect.parseCommand('smoke:help'), { command: 'help', args: '' });
  assert.equal(inspect.parseCommand('smoke:unknown'), undefined);
  assert.equal(inspect.parseCommand('nothing here'), undefined);
});

test('parseToolArgs validates JSON objects', () => {
  assert.deepEqual(inspect.parseToolArgs('t'), { name: 't', input: {} });
  assert.deepEqual(inspect.parseToolArgs('t {"x": [1]}'), { name: 't', input: { x: [1] } });
  assert.equal(inspect.parseToolArgs('t [1]').error, 'tool input must be a JSON object');
  assert.match(String(inspect.parseToolArgs('t {bad').error), /^invalid JSON/);
  assert.match(String(inspect.parseToolArgs('t {"a": }').error), /^invalid JSON/);
  assert.deepEqual(inspect.parseToolArgs('t {"a":{"b":1}}</userRequest>'), { name: 't', input: { a: { b: 1 } } });
  assert.deepEqual(inspect.parseToolArgs('t</userRequest>'), { name: 't', input: {} });
});

test('describeKeys lists keys and types, never values', () => {
  assert.deepEqual(inspect.describeKeys({ b: 'secret', a: [1, 2], c: null, d: { x: 1 } }), ['a: array(2)', 'b: string(6)', 'c: null', 'd: object']);
  assert.deepEqual(inspect.describeKeys(undefined), []);
});

test('estimateTokens is chars/4 over text and tool results', () => {
  assert.equal(inspect.estimateTokens('12345678', ctors), 2);
  assert.equal(inspect.estimateTokens({ role: 1, content: [text('123'), new parts.LanguageModelToolResultPart('c', [text('45')])] }, ctors), 2);
});

test('fnv1a is stable, order-sensitive and distinguishes near-identical texts', () => {
  assert.equal(inspect.fnv1a('hello'), inspect.fnv1a('hello'));
  assert.notEqual(inspect.fnv1a('hello'), inspect.fnv1a('hellp'));
  assert.notEqual(inspect.fnv1a('ab'), inspect.fnv1a('ba'));
  assert.equal(inspect.fnv1a(''), 0x811c9dc5);
  assert.equal(inspect.fnv1a('a'), 0xe40c292c);
});
