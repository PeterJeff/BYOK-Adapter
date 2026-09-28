// @ts-check
'use strict';

// Per-model Claude "thinking" parameter shape (PLAN.md §4.1, §5). Pure: no vscode import.
//
// Measured through Ask Sage (research/live/FINDINGS.md, T7/T22): Haiku 4.5 accepts
// {type:"enabled", budget_tokens}; Sonnet 5 rejects that ("thinking.type.enabled" is not
// supported for this model. Use "thinking.type.adaptive" and "output_config.effort") and accepts
// {type:"adaptive"} + output_config:{effort}; Opus 5.5/Fable 5.x reject both enabled and disabled
// (always-on) per FINDINGS.md, so no `thinking` field is sent for them at all. Everything else in
// the generation table (Opus 4.7/4.8 default-off, the exact 4.6 boundary) is from Anthropic's own
// docs, not yet measured through Ask Sage -- see PLAN.md §4.1's "Checked against the docs" note.

/** @typedef {{ thinking?: { type: 'enabled', budget_tokens: number } | { type: 'adaptive' }, output_config?: { effort: string } }} ThinkingShape */

/** Always-on: sending either `enabled` or `disabled` is rejected (400) on Ask Sage. */
const ALWAYS_ON_RE = /opus-5-5|fable-5/;
/** Haiku 4.5 / the 4.5 generation: the older enabled+budget_tokens shape. */
const BUDGET_TOKENS_RE = /haiku-4-5|-45-haiku|claude-4-5/;

/**
 * @param {string} modelId
 * @returns {ThinkingShape}
 */
function defaultThinkingShape(modelId) {
  const id = modelId.toLowerCase();
  if (ALWAYS_ON_RE.test(id)) return {};
  if (BUDGET_TOKENS_RE.test(id)) return { thinking: { type: 'enabled', budget_tokens: 1024 } };
  // 4.6 and newer, Sonnet 5, and anything else: the adaptive shape (measured on Sonnet 5, T22).
  return { thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } };
}

/** The one measured rejection message (FINDINGS.md, T22 on Sonnet 5): the `enabled` shape asks to
 *  switch to `adaptive`. Matching on this lets the transport retry once instead of failing the
 *  model forever, the same pattern as src/rates/outputCaps.js's max_output correction. */
const ENABLED_UNSUPPORTED_RE = /thinking\.type\.enabled.*not supported for this model/i;

/**
 * @param {{ message: string } | null | undefined} detectedError
 */
function isThinkingShapeUnsupported(detectedError) {
  return !!detectedError && ENABLED_UNSUPPORTED_RE.test(detectedError.message);
}

/**
 * Persisted per-model override once a rejection has corrected the default guess (mirrors
 * src/rates/outputCaps.js's createOutputCaps).
 * @param {{ get: () => Record<string, ThinkingShape> | undefined, set: (v: Record<string, ThinkingShape>) => unknown } | undefined} store
 */
function createThinkingShapes(store) {
  /** @type {Record<string, ThinkingShape>} */
  const memory = (store && store.get()) || {};
  return {
    /** @param {string} modelId */
    get(modelId) {
      return memory[modelId] || defaultThinkingShape(modelId);
    },
    /**
     * @param {string} modelId
     * @param {ThinkingShape} correctedShape
     */
    correct(modelId, correctedShape) {
      memory[modelId] = correctedShape;
      if (store) store.set(memory);
    },
  };
}

/** The adaptive shape to retry with when `enabled` is rejected. */
const ADAPTIVE_FALLBACK = /** @type {ThinkingShape} */ ({ thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } });

module.exports = { defaultThinkingShape, isThinkingShapeUnsupported, createThinkingShapes, ADAPTIVE_FALLBACK };
