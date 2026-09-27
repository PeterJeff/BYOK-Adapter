// @ts-check
'use strict';

// Per-model billed rate (PLAN.md §3.1), ported from the shape of phase0/probe/lib/rates.mjs
// (research, ESM). `POST /server/tokenizer` with `convert_to_asksage` reproduced every measured
// bill on the test tenant (research/rate-sources-investigation.md) and is free (the used
// counter does not move). Falls back to the catalog's token_conversion_rate x 1.3, flagged
// unverified, only when the tokenizer is unreachable and there is no last-good copy.

const { request, describeFailure } = require('../transport/httpClient');

const CATALOG_MARKUP = 1.3;
const TTL_MS = 24 * 60 * 60 * 1000;

/** Deterministic filler text, long enough to measure a per-token slope. Not real data. */
function syntheticText(approxTokens) {
  const approxChars = Math.round(approxTokens * 4.3);
  const unit = 'The quick brown fox jumps over the lazy dog near the river bank today. ';
  let s = '';
  while (s.length < approxChars) s += unit;
  return s.slice(0, approxChars);
}

/**
 * @param {{ token_conversion_rate?: { prompt?: number, completion?: number } | null } | null | undefined} model
 */
function catalogRate(model) {
  const c = model?.token_conversion_rate;
  if (!c?.prompt || !c?.completion) return null;
  return { prompt: c.prompt * CATALOG_MARKUP, completion: c.completion * CATALOG_MARKUP, source: `catalog x${CATALOG_MARKUP}`, unverified: true };
}

/**
 * @param {{ apiBase: string, accessToken: import('../auth/accessToken').createAccessTokenService extends (...a: any) => infer R ? R : never,
 *   fetchImpl?: typeof fetch, store?: { get: () => Record<string, any> | undefined, set: (v: Record<string, any>) => unknown } }} opts
 */
function createTokenizerRates(opts) {
  /** @type {Record<string, any>} */
  const memory = (opts.store && opts.store.get()) || {};

  /** @param {string} id */
  async function fetchBilledRate(id) {
    const big = syntheticText(2000);
    const est = 1000000;
    /** @param {Record<string, any>} body */
    const tok = async (body) => {
      const result = await opts.accessToken.withRetry((token) =>
        request({ url: `${opts.apiBase}/server/tokenizer`, headers: { 'x-access-tokens': token }, body: { model: id, ...body }, fetchImpl: opts.fetchImpl })
      );
      const v = Number(/** @type {any} */ (result.body)?.response);
      const failure = describeFailure(result);
      if (failure || !Number.isFinite(v)) throw new Error(failure || 'tokenizer: no numeric response');
      return v;
    };
    const tokens = await tok({ content: big });
    const oneTokens = await tok({ content: 'x' });
    const asBig = await tok({ content: big, convert_to_asksage: true });
    const asOne = await tok({ content: 'x', convert_to_asksage: true });
    const asCompletion = await tok({ content: 'x', convert_to_asksage: true, completion_estimate: est });
    const one = oneTokens || 1;
    const prompt = tokens > one ? (asBig - asOne) / (tokens - one) : null;
    const completion = est > 0 ? (asCompletion - asOne) / est : null;
    if (!(prompt && prompt > 0) || !(completion !== null && completion >= 0)) throw new Error('Ask Sage: tokenizer gave no usable rate');
    return { prompt, completion, source: 'tokenizer', at: Date.now() };
  }

  return {
    /**
     * @param {{ id: string, token_conversion_rate?: { prompt?: number, completion?: number } | null }} model
     */
    async rateFor(model) {
      const cachedEntry = memory[model.id];
      if (cachedEntry && Date.now() - cachedEntry.at < TTL_MS) return cachedEntry;
      try {
        const fresh = await fetchBilledRate(model.id);
        memory[model.id] = fresh;
        if (opts.store) opts.store.set(memory);
        return fresh;
      } catch (e) {
        if (cachedEntry) return { ...cachedEntry, stale: true };
        const fallback = catalogRate(model);
        if (!fallback) throw e;
        return { ...fallback, at: Date.now() };
      }
    },
  };
}

module.exports = { createTokenizerRates, catalogRate, syntheticText, CATALOG_MARKUP };
