// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { logNumbers, rowsAfter, maxLogId, cacheRule, expectedBill, verdict } from '../../phase0/probe/lib/billing.mjs';
import { normalize } from '../../phase0/probe/lib/usage.mjs';
import { parseArgs, buildPlan, renderSummary } from '../../phase0/probe/billing-probe.mjs';

const ROW = { id: 7, date_time: 't', model: 'm', prompt: 'SECRET PROMPT', response: 'SECRET REPLY', ip: '10.0.0.1', user_id: 42, prompt_tokens: 100, completion_tokens: 5, total_tokens: 9, teach: 'False' };

test('prompt-log rows keep only numeric billing fields', () => {
  assert.deepEqual(logNumbers(ROW), { id: 7, date_time: 't', model: 'm', prompt_tokens: 100, completion_tokens: 5, total_tokens: 9 });
  const rows = rowsAfter([{ ...ROW, id: 9 }, ROW, { ...ROW, id: 8 }], 7);
  assert.deepEqual(rows.map((r) => r.id), [8, 9]);
  assert.ok(!JSON.stringify(rows).includes('SECRET'));
  assert.equal(maxLogId([ROW, { ...ROW, id: 3 }]), 7);
  assert.deepEqual(rowsAfter({ status: 400 }, 0), []);
});

test('cacheRule follows the measured hosts', () => {
  assert.deepEqual(cacheRule('M', 'google-claude-45-haiku'), { read: 0.1, write5m: 1.25, write1h: 2 });
  assert.ok(cacheRule('CC', 'gpt-4.1-nano'));
  assert.equal(cacheRule('CC', 'aws-bedrock-gpt-5-6-luna-gov'), null);
  assert.equal(cacheRule('G', 'google-gemini-2.5-flash'), null);
  assert.equal(cacheRule('N', 'x'), null);
});

test('expectedBill reproduces measured bills (2026-09-25) within the +1..5 constant', () => {
  const haiku = { prompt: 0.071477, completion: 0.3575 };
  // 40k Haiku write billed 3105, then read billed 253
  const w = expectedBill(normalize('M', { input_tokens: 11, cache_creation_input_tokens: 34683, cache_creation: { ephemeral_5m_input_tokens: 34683, ephemeral_1h_input_tokens: 0 }, cache_read_input_tokens: 0, output_tokens: 4 }), haiku, cacheRule('M', 'h'));
  const r = expectedBill(normalize('M', { input_tokens: 11, cache_creation_input_tokens: 0, cache_read_input_tokens: 34683, output_tokens: 4 }), haiku, cacheRule('M', 'h'));
  assert.equal(verdict(3105, w), 'fits');
  assert.equal(verdict(253, r), 'fits');
  // Gemini: cached tokens reported but billed in full; thoughts not billed (billed 678)
  const g = expectedBill(normalize('G', { promptTokenCount: 34622, cachedContentTokenCount: 33764, candidatesTokenCount: 1, thoughtsTokenCount: 16 }), { prompt: 0.01952, completion: 0.1625 }, cacheRule('G', 'g'), { flavor: 'G' });
  assert.equal(verdict(678, g), 'fits');
  assert.equal(verdict(0, 5), 'unbilled');
  assert.equal(verdict(50, 20), 'over');
  assert.equal(verdict(null, 20), 'unknown');
});

test('billing-probe parseArgs and plan', () => {
  assert.throws(() => parseArgs([]), /usage/);
  assert.throws(() => parseArgs(['--api', 'a', '--alias', 'x', '--experiments', 'bogus']), /unknown experiment/);
  assert.throws(() => parseArgs(['--api', 'a', '--alias', 'x', '--model', 'nope=1']), /role=id/);
  const o = parseArgs(['--api', 'api.x.test', '--alias', 'x', '--model', 'claude=c-1', '--experiments', 'cache,loop,ttl', '--ttl-wait', '8']);
  const plan = buildPlan(o, 'r1');
  assert.equal(plan.filter((p) => p.experiment === 'loop').length, 12);
  assert.ok(plan.every((p) => p.model && p.flavor && p.body));
  assert.ok(plan.some((p) => p.experiment === 'ttl' && p.waitMin === 8));
  const cached = plan.find((p) => p.name === 'loop cached round 3');
  assert.equal(cached?.body.tools.at(-1).cache_control.type, 'ephemeral');
  assert.equal(cached?.body.messages.length, 5);
  assert.equal(plan.find((p) => p.name === 'loop uncached round 3')?.body.tools.at(-1).cache_control, undefined);
  const md = renderSummary([{ experiment: 'loop', name: 'loop cached round 1', flavor: 'M', model: 'c-1', norm: null, log: { model: 'c-1', total_tokens: 10 }, logRows: 1, expected: 8, verdict: 'fits', error: null }], { alias: 'x', run: 'r1', startedAt: 'a', endedAt: 'b' });
  assert.match(md, /Agent loop totals: uncached 0, cached 10/);
});
