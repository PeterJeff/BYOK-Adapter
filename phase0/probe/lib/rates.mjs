// @ts-check
// Billed rates for planning and the spend cap. The catalog's token_conversion_rate is not the
// bill: it is 1.30x low on most models and 0.65x to 3.6x off on the rest (PLAN §3.1). The free
// tokenizer conversion is the bill, so the probe asks it when it can and otherwise marks up the
// catalog rate.

import { filler } from './filler.mjs';
import { tokenizerRates } from './webrates.mjs';

/** The usual gap between the catalog rate and the bill (66 of 105 models, 2026-09-25). */
export const CATALOG_MARKUP = 1.3;

/** @typedef {{ prompt: number, completion: number, source: string }} BilledRate */

/**
 * Catalog rate × markup, for when the tokenizer is unavailable.
 * @param {{ token_conversion_rate?: { prompt?: number, completion?: number } | null } | null | undefined} model
 * @returns {BilledRate | null}
 */
export function catalogRate(model) {
  const c = model?.token_conversion_rate;
  if (!c?.prompt || !c?.completion) return null;
  return { prompt: c.prompt * CATALOG_MARKUP, completion: c.completion * CATALOG_MARKUP, source: `catalog x${CATALOG_MARKUP}` };
}

/**
 * The model's billed rates from POST /server/tokenizer with convert_to_asksage (free: the used
 * counter does not move). Five calls: the token counts of a large and a one-character content,
 * their Ask Sage conversions, and one with a completion estimate.
 * @param {(o: import('./client.mjs').CallOptions) => Promise<import('./client.mjs').Exchange>} call
 * @param {string} id
 * @returns {Promise<BilledRate>}
 */
export async function fetchBilledRate(call, id) {
  const tok = async (/** @type {Record<string, any>} */ body) => {
    const ex = await call({ label: 'tokenizer', kind: 'server', path: '/server/tokenizer', body: { model: id, ...body } });
    const v = Number(/** @type {any} */ (ex.body)?.response);
    if (ex.error || !Number.isFinite(v)) throw new Error(ex.error ? ex.error.message : `HTTP ${ex.status}`);
    return v;
  };
  const big = filler(20260926, 2000);
  const est = 1000000;
  const r = tokenizerRates({
    tokens: await tok({ content: big }),
    oneTokens: await tok({ content: 'x' }),
    asBig: await tok({ content: big, convert_to_asksage: true }),
    asOne: await tok({ content: 'x', convert_to_asksage: true }),
    asCompletion: await tok({ content: 'x', convert_to_asksage: true, completion_estimate: est }),
    completionEstimate: est,
  });
  if (!(r.prompt && r.prompt > 0) || !(r.completion && r.completion > 0)) throw new Error('tokenizer gave no usable rate');
  return { prompt: r.prompt, completion: r.completion, source: 'tokenizer' };
}
