// @ts-check
'use strict';

// The cost formula (PLAN.md §3.1), ported from phase0/probe/lib/billing.mjs (research, ESM,
// measured against real bills in research/rate-sources-investigation.md) to CommonJS for
// runtime use. Pure; no I/O.

/** @typedef {import('../normalize/index').Norm} Norm */
/** @typedef {{ prompt: number, completion: number }} Rates  Ask Sage tokens per model token */
/** @typedef {import('./cacheRules').CacheRule} CacheRule */

/**
 * Expected bill before the endpoint's small per-request constant (+1 to +5 measured). Thinking:
 * Gemini thoughts were not billed through G; OpenAI reasoning is inside the completion count.
 * @param {Norm | null} z
 * @param {Rates | null | undefined} rates
 * @param {CacheRule} rule
 * @param {{ flavor?: string }} [o]
 */
function expectedBill(z, rates, rule, o = {}) {
  if (!z || !rates) return null;
  const p = rates.prompt;
  const c = rates.completion;
  const w5 = z.cacheWrite5m + z.cacheWriteUnsplit;
  const input = rule
    ? z.inputUncached * p + z.cacheRead * p * rule.read + w5 * p * rule.write5m + z.cacheWrite1h * p * rule.write1h
    : (z.inputUncached + z.cacheRead + w5 + z.cacheWrite1h) * p;
  const thinking = o.flavor === 'G' ? 0 : z.thinking;
  return Math.round((input + (z.visibleOutput + thinking) * c) * 100) / 100;
}

/**
 * Compares a measured bill with the expectation. `constant` is the measured per-request
 * round-up band.
 * @param {number | null} billed
 * @param {number | null} expected
 * @param {{ min: number, max: number }} [constant]
 */
function verdict(billed, expected, constant = { min: 0, max: 6 }) {
  if (billed === null || expected === null) return 'unknown';
  if (billed === 0 && expected > 0) return 'unbilled';
  const d = billed - expected;
  if (d >= constant.min - 0.5 && d <= constant.max + 0.5) return 'fits';
  return d > 0 ? 'over' : 'under';
}

module.exports = { expectedBill, verdict };
