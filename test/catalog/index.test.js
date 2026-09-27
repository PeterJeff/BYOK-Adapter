// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCatalog, classifyFlavor } = require('../../src/catalog');

test('classifyFlavor: Phase 1 default flavor per family (PLAN §2.2)', () => {
  assert.equal(classifyFlavor('gpt-4.1-nano'), 'CC');
  assert.equal(classifyFlavor('gpt-5.4-nano'), 'R');
  assert.equal(classifyFlavor('gpt-5.6-luna'), 'R');
  assert.equal(classifyFlavor('gpt-6-sol'), 'R');
  assert.equal(classifyFlavor('gpt-5.1'), 'R');
  assert.equal(classifyFlavor('aws-bedrock-gpt-5-6-luna-gov'), 'CC'); // never R: no caching on Bedrock GPT
  assert.equal(classifyFlavor('o3-mini'), 'R');
  assert.equal(classifyFlavor('google-claude-45-haiku'), 'M');
  assert.equal(classifyFlavor('google-gemini-3.5-flash'), 'G');
  assert.equal(classifyFlavor('grok-4'), 'CC');
  assert.equal(classifyFlavor('deepseek-r1'), 'CC');
});

/** @param {unknown} body */
function jsonResponse(body) {
  return { status: 200, headers: { get: (/** @type {string} */ h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) };
}

test('list(): filters cui_capable:false and retired, excludes M/G models, tags CC/R flavor', async () => {
  const models = [
    { id: 'gpt-5.4-nano', cui_capable: true },
    { id: 'gpt-4.1-nano', cui_capable: true },
    { id: 'google-claude-45-haiku', cui_capable: true }, // M: not offered in Phase 1
    { id: 'google-gemini-3.5-flash', cui_capable: true }, // G: not offered in Phase 1
    { id: 'some-gov-model', cui_capable: false },
    { id: 'retired-model', deprecation: { state: 'retired' } },
  ];
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return jsonResponse(models);
  };
  const catalog = createCatalog({ apiBase: 'https://api.test', fetchImpl });
  const list = await catalog.list();
  assert.deepEqual(list.map((m) => [m.id, m.flavor]).sort(), [['gpt-4.1-nano', 'CC'], ['gpt-5.4-nano', 'R']]);
  await catalog.list(); // cached: no second fetch within the TTL
  assert.equal(calls, 1);
  catalog.invalidate();
  await catalog.list();
  assert.equal(calls, 2);
});

test('list(): unwraps {response: [...]} and {data: [...]} envelopes, not just a bare array', async () => {
  // A live tenant returned get-models?format=full wrapped in {response: [...]} (2026-09-27);
  // phase0/probe/catalog-audit.mjs and api-probe.mjs's loadCatalog both already handle this.
  const models = [{ id: 'gpt-4.1-nano', cui_capable: true }];
  for (const wrapped of [models, { response: models }, { data: models }]) {
    const catalog = createCatalog({ apiBase: 'https://api.test', fetchImpl: async () => jsonResponse(wrapped) });
    const list = await catalog.list();
    assert.deepEqual(list.map((m) => m.id), ['gpt-4.1-nano'], `failed to unwrap ${JSON.stringify(wrapped)}`);
  }
});

test('list(): forceModels intersects the offered set', async () => {
  const models = [{ id: 'gpt-4.1-nano' }, { id: 'gpt-5.4-nano' }];
  const catalog = createCatalog({ apiBase: 'https://api.test', fetchImpl: async () => jsonResponse(models) });
  const list = await catalog.list({ forceModels: ['gpt-4.1-nano'] });
  assert.deepEqual(list.map((m) => m.id), ['gpt-4.1-nano']);
});
