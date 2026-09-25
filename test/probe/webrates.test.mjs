// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractRateTable, extractLegacyConversions, bundlePath, compareToApi, ratioGroups, cacheMultipliers, tokenizerRates, ratioBetween } from '../../phase0/probe/lib/webrates.mjs';
import { parseArgs, renderSummary } from '../../phase0/probe/rate-sources.mjs';

// Shaped like the minified chat bundle; model names and numbers are made up.
const BUNDLE = [
  'var zz=5,PSa=[{key:"m-a",name:"Model A",provider:"anthropic",contextTokens:2e5,contextDisplay:"200,000 (500 pages)",',
  'rates:{prompt:10,completion:2,thinking:2,cacheRead:100,cacheWrite5Min:8,cacheWrite1Hr:5}},',
  '{key:"m-b",name:"Model B",provider:"openai",contextTokens:1e6,contextDisplay:"1,000,000",',
  'rates:{prompt:.5,completion:.1,longContextPrompt:.25,longContextCompletion:.05},longContextThreshold:272e3},',
  '{key:"m-img",name:"Image",provider:"google",rates:{prompt:1.3}},',
  '{key:"m-a",name:"dup",provider:"x",rates:{prompt:999,completion:999}}];',
  'var lSe=[{key:"gpt-5",name:"gpt-5",provider:"OpenAI",tier:"pro",tags:["flagship"]}];',
  'var xh=[{model:"Auto",value:"Auto*",key:"auto",conversion:"Depends on model selected",comment:"x"},',
  '{model:"A",contextSize:"200,000",conversion:{askSageTokens:1,modelTokens:{flatRate:void 0,prompt:13,completion:2.6},output:{quantity:void 0,unit:"tokens"}},comment:"a",key:"m-a",cui:!0},',
  '{model:"Img",conversion:{askSageTokens:1,modelTokens:{flatRate:10,prompt:void 0,completion:void 0},output:{quantity:1,unit:"image"}},key:"m-img"}];',
].join('');

test('extractRateTable reads rows, rates, long-context threshold; first duplicate wins', () => {
  const t = extractRateTable(BUNDLE);
  assert.deepEqual(t.map((r) => r.key), ['m-a', 'm-b', 'm-img']);
  assert.deepEqual(t[0].rates, { prompt: 10, completion: 2, thinking: 2, cacheRead: 100, cacheWrite5Min: 8, cacheWrite1Hr: 5 });
  assert.equal(t[0].provider, 'anthropic');
  assert.equal(t[0].contextTokens, 200000);
  assert.equal(t[1].rates.prompt, 0.5);
  assert.equal(t[1].longContextThreshold, 272000);
  assert.equal(t[2].rates.completion, undefined);
});

test('extractLegacyConversions finds the key after the conversion object and skips string conversions', () => {
  const l = extractLegacyConversions(BUNDLE);
  assert.deepEqual(l, [
    { key: 'm-a', askSageTokens: 1, flatRate: null, prompt: 13, completion: 2.6 },
    { key: 'm-img', askSageTokens: 1, flatRate: 10, prompt: null, completion: null },
  ]);
});

test('bundlePath finds the module script', () => {
  assert.equal(bundlePath('<script src="/vars.js"></script><script type="module" crossorigin src="/assets/index-AbC123.js"></script>'), '/assets/index-AbC123.js');
  assert.equal(bundlePath('<html></html>'), null);
});

test('compareToApi turns both units into multipliers; ratioGroups groups a uniform markup', () => {
  const api = [
    { id: 'm-a', token_conversion_rate: { prompt: 0.1 / 1.3, completion: 0.5 / 1.3 } },
    { id: 'm-b', token_conversion_rate: { prompt: 2, completion: 10 } },
    { id: 'm-img', token_conversion_rate: null },
    { id: 'api-only', token_conversion_rate: { prompt: 1, completion: 1 } },
  ];
  const table = extractRateTable(BUNDLE).map((r) => ({ key: r.key, prompt: r.rates.prompt ?? null, completion: r.rates.completion ?? null }));
  const c = compareToApi(api, table);
  assert.equal(c.apiOnly, 1);
  assert.equal(c.listOnly, 0);
  assert.deepEqual(c.rows.find((r) => r.id === 'm-a'), { id: 'm-a', prompt: 0.7692, completion: 0.7692 });
  assert.deepEqual(c.rows.find((r) => r.id === 'm-b'), { id: 'm-b', prompt: 1, completion: 1 });
  assert.deepEqual(c.rows.find((r) => r.id === 'm-img'), { id: 'm-img', prompt: null, completion: null });
  const g = ratioGroups([{ id: 'x', prompt: 0.769, completion: 0.769 }, { id: 'y', prompt: 0.7692, completion: 0.7691 }, { id: 'z', prompt: 1, completion: null }]);
  assert.deepEqual(g[0], { ratio: '0.769 / 0.769', count: 2, ids: ['x', 'y'] });
  assert.equal(g[1].ratio, '1.000 / -');
});

test('cacheMultipliers expresses cache rates as multiples of the prompt price', () => {
  assert.deepEqual(cacheMultipliers(extractRateTable(BUNDLE)), [{ key: 'm-a', provider: 'anthropic', read: 0.1, write5m: 1.25, write1h: 2 }]);
});

test('tokenizerRates takes differences so the endpoint\'s rounding constant cancels', () => {
  // prompt rate 0.0715, completion 0.3575, 20-token wrapper, +2 constant
  const r = tokenizerRates({ tokens: 30020, oneTokens: 20, asBig: Math.round(30020 * 0.0715) + 2, asOne: Math.round(20 * 0.0715) + 2, asCompletion: Math.round(20 * 0.0715 + 1e6 * 0.3575) + 2, completionEstimate: 1e6 });
  assert.ok(Math.abs(/** @type {number} */ (r.prompt) - 0.0715) < 0.0001);
  assert.ok(Math.abs(/** @type {number} */ (r.completion) - 0.3575) < 0.000001);
  assert.equal(r.constant, 3);
  assert.equal(tokenizerRates({ tokens: 1, asBig: 3, asOne: 3, asCompletion: 3, completionEstimate: 0 }).prompt, null);
});

test('ratioBetween divides matching models and counts the rest', () => {
  const r = ratioBetween({ a: { prompt: 0.2, completion: 1 }, b: { prompt: 1, completion: null }, c: { prompt: 1, completion: 1 } }, { a: { prompt: 0.1, completion: 1 }, b: { prompt: 2, completion: 3 } });
  assert.deepEqual(r, { rows: [{ id: 'a', prompt: 2, completion: 1 }, { id: 'b', prompt: 0.5, completion: null }], missing: 1 });
});

test('rate-sources parseArgs and renderSummary', () => {
  assert.deepEqual(parseArgs(['chat.x.test', '--alias', 't-a', '--no-tokenizer']), { instance: 'chat.x.test', alias: 't-a', tokenizer: false, save: true });
  assert.throws(() => parseArgs([]), /usage/);
  assert.throws(() => parseArgs(['h', '--alias', 'bad alias']), /alias/);
  const md = renderSummary({ label: '<t>', fetchedAt: 'now', bundle: null, api: { rows: [{ id: 'm', prompt: 0.769, completion: 0.769 }], apiOnly: 0, listOnly: 0 }, legacy: { rows: [], apiOnly: 0, listOnly: 0 }, tableRows: 1, legacyRows: 0, cache: [], tokVsTable: null, tokVsApi: null, tokErrors: [] });
  assert.match(md, /\| 0\.769 \/ 0\.769 \| 1 \| `m` \|/);
  assert.match(md, /Not run/);
});
