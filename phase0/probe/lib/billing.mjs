// @ts-check
// Billing rules measured on 2026-09-25 (research/rate-sources-investigation.md) and the helpers
// that read Ask Sage's per-request bill from the prompt log. Pure; no I/O.
//
// The bill for one request is one row of POST /user/get-user-logs: `total_tokens` Ask Sage
// tokens, which summed exactly to the used-tokens counter. Rows also carry the prompt and the
// response text, so only the numeric fields are ever kept.

/** @typedef {import('./usage.mjs').Norm} Norm */
/** @typedef {{ prompt: number, completion: number }} Rates  Ask Sage tokens per model token */
/** @typedef {{ read: number, write5m: number, write1h: number } | null} CacheRule  null: no discount */
/** @typedef {{ id: number, date_time?: string, model: string, prompt_tokens: number, completion_tokens: number, total_tokens: number }} LogRow */

/** The only fields of a prompt-log row that are kept. */
export const LOG_KEEP = ['id', 'date_time', 'model', 'prompt_tokens', 'completion_tokens', 'total_tokens'];

/**
 * Strips a prompt-log row to its numeric billing fields (drops prompt, response, ip, user id).
 * @param {Record<string, any>} row
 * @returns {LogRow}
 */
export function logNumbers(row) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const k of LOG_KEEP) if (k in row) out[k] = row[k];
  return /** @type {LogRow} */ (out);
}

/**
 * Rows newer than `afterId`, oldest first, numbers only.
 * @param {unknown} response  the `response` field of get-user-logs
 * @param {number} afterId
 */
export function rowsAfter(response, afterId) {
  if (!Array.isArray(response)) return [];
  return response.filter((r) => r && typeof r.id === 'number' && r.id > afterId).sort((a, b) => a.id - b.id).map(logNumbers);
}

/** @param {unknown} response */
export function maxLogId(response) {
  return Array.isArray(response) ? response.reduce((m, r) => (r && typeof r.id === 'number' && r.id > m ? r.id : m), 0) : 0;
}

/**
 * Which cache discount Ask Sage applied, by flavor and model host (measured on the test tenant):
 * Claude on M (Vertex, Bedrock) 0.1 / 1.25 / 2; OpenAI on Azure through CC or R: read 0.1 and
 * write 1.25 (writes only appear where the model reports cache_write_tokens); none on G (the
 * implicit cache hits but is billed in full), Bedrock-hosted GPT, or N.
 * @param {string} flavor
 * @param {string} model
 * @returns {CacheRule}
 */
export function cacheRule(flavor, model) {
  if (flavor === 'N' || flavor === 'G') return null;
  if (/^aws-bedrock-gpt/.test(model)) return null;
  // Opus 5.5 reads at 0.05x (measured 2026-09-26, T15 on google-claude-opus-5-5, as the web
  // app's table says); Fable 5.1 at 0.025x per that table (not yet measured).
  if (flavor === 'M' && /opus-5-5/.test(model)) return { read: 0.05, write5m: 1.25, write1h: 2 };
  if (flavor === 'M' && /fable-5/.test(model)) return { read: 0.025, write5m: 1.25, write1h: 2 };
  if (flavor === 'M' || flavor === 'CC' || flavor === 'R') return { read: 0.1, write5m: 1.25, write1h: 2 };
  return null;
}

/**
 * Expected bill before the endpoint's small per-request constant (+1 to +5 measured). Thinking:
 * Gemini thoughts were not billed through G; OpenAI reasoning is inside the completion count.
 * @param {Norm | null} z
 * @param {Rates | null | undefined} rates
 * @param {CacheRule} rule
 * @param {{ flavor?: string }} [o]
 */
export function expectedBill(z, rates, rule, o = {}) {
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
export function verdict(billed, expected, constant = { min: 0, max: 6 }) {
  if (billed === null || expected === null) return 'unknown';
  if (billed === 0 && expected > 0) return 'unbilled';
  const d = billed - expected;
  if (d >= constant.min - 0.5 && d <= constant.max + 0.5) return 'fits';
  return d > 0 ? 'over' : 'under';
}
