// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCatalog, classifyFlavor, applyForceModels } = require('../../src/catalog');

test('classifyFlavor: Phase 1 default flavor per family (PLAN §2.2)', () => {
  assert.equal(classifyFlavor('gpt-4.1-nano'), 'CC');
  assert.equal(classifyFlavor('gpt-5.4-nano'), 'R');
  assert.equal(classifyFlavor('gpt-5.6-luna'), 'R');
  assert.equal(classifyFlavor('gpt-6-sol'), 'R');
  assert.equal(classifyFlavor('gpt-5.1'), 'R');
  assert.equal(classifyFlavor('aws-bedrock-gpt-5-6-luna-gov'), 'CC'); // never R: no caching on Bedrock GPT
  assert.equal(classifyFlavor('o3-mini'), 'R');
  assert.equal(classifyFlavor('gpt-o3-mini'), 'R'); // Ask Sage's real o-series ids carry a gpt- prefix
  assert.equal(classifyFlavor('gpt-o3-mini-gov'), 'R');
  assert.equal(classifyFlavor('gpt-oss-20b'), 'CC'); // not o-series
  assert.equal(classifyFlavor('aws-bedrock-gpt-oss-20b-gov'), 'CC');
  assert.equal(classifyFlavor('google-claude-45-haiku'), 'M');
  assert.equal(classifyFlavor('google-gemini-3.5-flash'), 'G');
  assert.equal(classifyFlavor('grok-4'), 'CC');
  assert.equal(classifyFlavor('deepseek-r1'), 'CC');
});

/** @param {unknown} body */
function jsonResponse(body) {
  return { status: 200, headers: { get: (/** @type {string} */ h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) };
}

test('list(): filters cui_capable:false and retired, excludes G models, tags M/CC/R flavor', async () => {
  const models = [
    { id: 'gpt-5.4-nano', cui_capable: true },
    { id: 'gpt-4.1-nano', cui_capable: true },
    { id: 'google-claude-45-haiku', cui_capable: true }, // M: Phase 2
    { id: 'google-gemini-3.5-flash', cui_capable: true }, // G: still not offered (Phase 4)
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
  assert.deepEqual(list.map((m) => [m.id, m.flavor]).sort(), [
    ['google-claude-45-haiku', 'M'],
    ['gpt-4.1-nano', 'CC'],
    ['gpt-5.4-nano', 'R'],
  ]);
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

test('applyForceModels: empty or missing list means no restriction', () => {
  const models = [{ id: 'a' }, { id: 'b' }];
  for (const force of [undefined, null, []]) assert.deepEqual(applyForceModels(models, force), { models, unmatched: [], ignored: false });
});

test('applyForceModels: matches ids and aliases ignoring case, and reports names it could not match', () => {
  const models = [{ id: 'gpt-4.1-nano' }, { id: 'gpt-5.4-nano', aliases: ['GPT 5.4 Nano'] }, { id: 'grok-4' }];
  const r = applyForceModels(models, ['GPT-4.1-NANO', 'gpt 5.4 nano', 'not-a-model']);
  assert.deepEqual(r.models.map((m) => m.id), ['gpt-4.1-nano', 'gpt-5.4-nano']);
  assert.deepEqual(r.unmatched, ['not-a-model']);
  assert.equal(r.ignored, false);
});

test('applyForceModels: no match at all leaves the list unfiltered and flags it', () => {
  const models = [{ id: 'a' }, { id: 'b' }];
  const r = applyForceModels(models, ['x', 'y']);
  assert.equal(r.models, models);
  assert.deepEqual(r.unmatched, ['x', 'y']);
  assert.equal(r.ignored, true);
});

test('list(): warns once per distinct force_models mismatch', async () => {
  const models = [{ id: 'gpt-4.1-nano' }, { id: 'gpt-5.4-nano' }];
  /** @type {string[]} */
  const warnings = [];
  const catalog = createCatalog({ apiBase: 'https://api.test', fetchImpl: async () => jsonResponse(models), warn: (m) => warnings.push(m) });
  assert.equal((await catalog.list({ forceModels: ['nope'] })).length, 2);
  await catalog.list({ forceModels: ['nope'] });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /none of the organization's force_models \(nope\)/);
  await catalog.list({ forceModels: ['gpt-4.1-nano', 'nope'] });
  assert.equal(warnings.length, 2);
  assert.match(warnings[1], /not in this tenant's catalog: nope/);
  await catalog.list({ forceModels: ['gpt-4.1-nano'] });
  assert.equal(warnings.length, 2);
});

test('list(): a network failure or an unexpected body says why, instead of "did not return a model list" alone', async () => {
  const down = createCatalog({ apiBase: 'https://api.test', fetchImpl: /** @type {any} */ (async () => { throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND api.test') }); }) });
  await assert.rejects(down.list(), /get-models failed: fetch failed \(getaddrinfo ENOTFOUND api\.test\)/);
  const odd = createCatalog({ apiBase: 'https://api.test', fetchImpl: async () => jsonResponse({ message: 'maintenance' }) });
  await assert.rejects(odd.list(), /did not return a model list \(HTTP 200, application\/json, keys: message\)/);
});
