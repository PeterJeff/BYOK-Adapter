// @ts-check
'use strict';

// Cache discount rules by flavor and model host (PLAN.md §2.1), ported from
// phase0/probe/lib/billing.mjs (research, ESM, measured on the test tenant 2026-09-25/26) to
// CommonJS for runtime use. Pure.

/** @typedef {{ read: number, write5m: number, write1h: number } | null} CacheRule  null: no discount */

/**
 * Which cache discount Ask Sage applied, by flavor and model host (measured on the test tenant):
 * Claude on M (Vertex, Bedrock) 0.1 / 1.25 / 2; OpenAI on Azure through CC or R: read 0.1 and
 * write 1.25 (writes only appear where the model reports cache_write_tokens); none on G (the
 * implicit cache hits but is billed in full), Bedrock-hosted GPT, or N.
 * @param {string} flavor
 * @param {string} model
 * @returns {CacheRule}
 */
function cacheRule(flavor, model) {
  if (flavor === 'N' || flavor === 'G') return null;
  if (/^aws-bedrock-gpt/.test(model)) return null;
  // Opus 5.5 reads at 0.05x (measured 2026-09-26, T15 on google-claude-opus-5-5, as the web
  // app's table says); Fable 5.1 at 0.025x per that table (not yet measured).
  if (flavor === 'M' && /opus-5-5/.test(model)) return { read: 0.05, write5m: 1.25, write1h: 2 };
  if (flavor === 'M' && /fable-5/.test(model)) return { read: 0.025, write5m: 1.25, write1h: 2 };
  if (flavor === 'M' || flavor === 'CC' || flavor === 'R') return { read: 0.1, write5m: 1.25, write1h: 2 };
  return null;
}

module.exports = { cacheRule };
