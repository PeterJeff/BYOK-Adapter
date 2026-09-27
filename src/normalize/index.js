// @ts-check
'use strict';

// Per-flavor usage normalization (PLAN.md §3.2), ported from phase0/probe/lib/usage.mjs
// (research, ESM, confirmed against real bills in research/rate-sources-investigation.md) to
// CommonJS for runtime use. Pure.

/** @typedef {'M' | 'CC' | 'R' | 'G' | 'N'} Flavor */

/**
 * @typedef {object} Norm
 * @property {number} inputUncached
 * @property {number} cacheRead
 * @property {number} cacheWrite5m
 * @property {number} cacheWrite1h
 * @property {number} cacheWriteUnsplit  cache writes reported without a TTL split
 * @property {number} visibleOutput
 * @property {number} thinking
 * @property {boolean} thinkingUnknown
 * @property {number} [thinkingHidden]  G only
 */

/**
 * @param {unknown} v
 * @returns {number}
 */
const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * @param {Flavor} flavor
 * @param {Record<string, any> | null} u
 * @returns {Norm | null}
 */
function normalize(flavor, u) {
  if (!u) return null;
  /** @type {Norm} */
  const z = { inputUncached: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheWriteUnsplit: 0, visibleOutput: 0, thinking: 0, thinkingUnknown: false };
  if (flavor === 'M') {
    z.inputUncached = n(u.input_tokens);
    z.cacheRead = n(u.cache_read_input_tokens);
    const split = u.cache_creation && typeof u.cache_creation === 'object' ? u.cache_creation : null;
    if (split && (n(split.ephemeral_5m_input_tokens) || n(split.ephemeral_1h_input_tokens))) {
      z.cacheWrite5m = n(split.ephemeral_5m_input_tokens);
      z.cacheWrite1h = n(split.ephemeral_1h_input_tokens);
    } else z.cacheWriteUnsplit = n(u.cache_creation_input_tokens);
    // Vertex Claude reports thinking inside output_tokens and separately as
    // output_tokens_details.thinking_tokens (measured 2026-09-26); other hosts may not.
    const thinking = u.output_tokens_details?.thinking_tokens;
    if (typeof thinking === 'number') {
      z.thinking = thinking;
      z.visibleOutput = Math.max(0, n(u.output_tokens) - thinking);
    } else {
      z.visibleOutput = n(u.output_tokens);
      z.thinkingUnknown = true;
    }
    return z;
  }
  // Claude served through CC answers with Anthropic-shaped usage (measured 2026-09-25).
  if (flavor === 'CC' && u.prompt_tokens === undefined && u.input_tokens !== undefined) return normalize('M', u);
  if (flavor === 'CC') {
    const cached = n(u.prompt_tokens_details?.cached_tokens);
    // GPT-5.6/6 report cache writes separately; Ask Sage bills them at 1.25x (measured 2026-09-25).
    const written = n(u.prompt_tokens_details?.cache_write_tokens);
    const reasoning = n(u.completion_tokens_details?.reasoning_tokens);
    z.cacheRead = cached;
    z.cacheWriteUnsplit = written;
    z.inputUncached = Math.max(0, n(u.prompt_tokens) - cached - written);
    z.thinking = reasoning;
    z.visibleOutput = Math.max(0, n(u.completion_tokens) - reasoning);
    return z;
  }
  if (flavor === 'R') {
    const cached = n(u.input_tokens_details?.cached_tokens);
    const written = n(u.input_tokens_details?.cache_write_tokens);
    const reasoning = n(u.output_tokens_details?.reasoning_tokens);
    z.cacheRead = cached;
    z.cacheWriteUnsplit = written;
    z.inputUncached = Math.max(0, n(u.input_tokens) - cached - written);
    z.thinking = reasoning;
    z.visibleOutput = Math.max(0, n(u.output_tokens) - reasoning);
    return z;
  }
  if (flavor === 'G') {
    const cached = n(u.cachedContentTokenCount);
    z.cacheRead = cached;
    z.inputUncached = Math.max(0, n(u.promptTokenCount) - cached);
    z.visibleOutput = n(u.candidatesTokenCount);
    z.thinking = n(u.thoughtsTokenCount);
    const hidden = n(u.totalTokenCount) - n(u.promptTokenCount) - z.visibleOutput - z.thinking - n(u.toolUsePromptTokenCount);
    if (u.thoughtsTokenCount === undefined && hidden > 0) z.thinkingHidden = hidden;
    return z;
  }
  return null;
}

module.exports = { normalize };
