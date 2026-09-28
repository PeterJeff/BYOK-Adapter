// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultThinkingShape, isThinkingShapeUnsupported, createThinkingShapes, ADAPTIVE_FALLBACK } = require('../../src/convert/thinking');

test('defaultThinkingShape: Opus 5.5 and Fable 5.x are always-on, no thinking field sent', () => {
  assert.deepEqual(defaultThinkingShape('google-claude-opus-5-5'), {});
  assert.deepEqual(defaultThinkingShape('aws-bedrock-fable-5-1'), {});
});

test('defaultThinkingShape: Haiku 4.5 gets the enabled+budget_tokens shape', () => {
  assert.deepEqual(defaultThinkingShape('google-claude-45-haiku'), { thinking: { type: 'enabled', budget_tokens: 1024 } });
});

test('defaultThinkingShape: everything else (e.g. Sonnet 5) gets the adaptive shape', () => {
  assert.deepEqual(defaultThinkingShape('google-claude-sonnet-5'), { thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } });
});

test('isThinkingShapeUnsupported matches the one measured Ask Sage rejection (T22, Sonnet 5)', () => {
  assert.equal(isThinkingShapeUnsupported({ message: '"thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort"' }), true);
  assert.equal(isThinkingShapeUnsupported({ message: 'some other error' }), false);
  assert.equal(isThinkingShapeUnsupported(null), false);
});

test('createThinkingShapes: correct() persists an override that get() then returns', () => {
  /** @type {Record<string, any>} */
  let saved = {};
  const shapes = createThinkingShapes({ get: () => saved, set: (v) => (saved = v) });
  assert.deepEqual(shapes.get('google-claude-sonnet-5'), { thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } });
  shapes.correct('google-claude-45-haiku', ADAPTIVE_FALLBACK);
  assert.deepEqual(shapes.get('google-claude-45-haiku'), ADAPTIVE_FALLBACK);
  assert.deepEqual(saved, { 'google-claude-45-haiku': ADAPTIVE_FALLBACK });
});

test('createThinkingShapes: reloads a persisted store on construction', () => {
  const store = { 'google-claude-sonnet-5': {} };
  const shapes = createThinkingShapes({ get: () => store, set: () => {} });
  assert.deepEqual(shapes.get('google-claude-sonnet-5'), {});
});
