// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parts } = require('../helpers/vscode-stub');
const { textOf } = require('../../src/convert/messages');
const { classifyUtilityRequest, synthesizeProgressMessages, synthesizeTitle } = require('../../src/convert/utilityRequest');

const CTORS = { TextPart: parts.LanguageModelTextPart, ToolCallPart: parts.LanguageModelToolCallPart, ToolResultPart: parts.LanguageModelToolResultPart };
const text = (/** @type {string} */ v) => new parts.LanguageModelTextPart(v);
const msg = (/** @type {string} */ v) => ({ role: 1, content: [text(v)] });

// Real payloads pasted into this project 2026-09-27, trimmed to the parts that matter for classification.
const TITLE_SYSTEM =
  'You are an expert in crafting ultra-compact titles for chatbot conversations. You are presented with a chat request, and you reply with only a brief title that captures the main topic of that request.';
const TITLE_USER = 'Please write a brief title for the following request:\n\nReview the main readme and todo files in this project, then write your opinion in a small file\n\nThis is test T12';
const PROGRESS_SYSTEM = 'You are an expert in writing short, catchy, and encouraging progress messages for a coding assistant.\nThe messages are shown to users while they wait.';
const PROGRESS_USER = 'Please generate exactly 10 unique progress messages for the "edit code" scenario.\nReturn only a JSON array of strings, no other text.';

test('classifyUtilityRequest: recognizes the real title-generation payload', () => {
  const result = classifyUtilityRequest([msg(TITLE_SYSTEM), msg(TITLE_USER)], CTORS, textOf, undefined);
  assert.equal(result.kind, 'title');
  assert.match(result.userText, /^Review the main readme/);
});

test('classifyUtilityRequest: recognizes the real progress-message payload', () => {
  const result = classifyUtilityRequest([msg(PROGRESS_SYSTEM), msg(PROGRESS_USER)], CTORS, textOf, undefined);
  assert.equal(result.kind, 'progress');
});

test('classifyUtilityRequest: a normal chat turn (with tools) never matches, even with similar wording', () => {
  const result = classifyUtilityRequest([msg(TITLE_SYSTEM), msg(TITLE_USER)], CTORS, textOf, [{ name: 'readFile' }]);
  assert.equal(result, null);
});

test('classifyUtilityRequest: ordinary chat content does not match', () => {
  const result = classifyUtilityRequest([msg('You are a helpful coding assistant.'), msg('Fix the bug in foo.js')], CTORS, textOf, undefined);
  assert.equal(result, null);
});

test('classifyUtilityRequest: no messages does not throw', () => {
  assert.equal(classifyUtilityRequest([], CTORS, textOf, undefined), null);
});

test('synthesizeProgressMessages: returns exactly the requested count as a JSON array of strings', () => {
  const out = JSON.parse(synthesizeProgressMessages('generate exactly 3 unique progress messages'));
  assert.equal(out.length, 3);
  for (const s of out) assert.equal(typeof s, 'string');
});

test('synthesizeProgressMessages: no count found falls back to a full set', () => {
  const out = JSON.parse(synthesizeProgressMessages('no count here'));
  assert.ok(out.length > 0);
});

test('synthesizeTitle: derives a short title from the user\'s own request text', () => {
  const title = synthesizeTitle('Fix the null pointer exception in the login handler.\n\nThis is a follow-up.');
  assert.ok(title.length > 0);
  assert.ok(title.split(' ').length <= 6);
  assert.equal(title[0], title[0].toUpperCase());
});

test('synthesizeTitle: empty input does not throw', () => {
  assert.equal(synthesizeTitle(''), 'Chat');
});
