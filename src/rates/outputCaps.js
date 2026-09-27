// @ts-check
'use strict';

// Ask Sage's get-models `limits.max_output` field cannot be trusted as the real completion-token
// ceiling: on the public catalog (2026-09-27) 77 of 105 models report a max_output within 70% of
// max_context, and a live request using it (gpt-5.6-luna, catalog max_output 900000) was
// rejected with "This model supports at most 32768 completion tokens". PLAN.md §3.5 says to
// always send an explicit cap rather than rely on a server default, but blindly trusting the
// catalog value defeats that: it turns "always capped" into "often hard-rejected". Instead this
// starts from the catalog value and learns the real one from a rejection, persisting it so the
// same model doesn't pay for the same failed round-trip every session.

/**
 * @param {{ get: () => Record<string, number> | undefined, set: (v: Record<string, number>) => unknown } | undefined} store
 */
function createOutputCaps(store) {
  /** @type {Record<string, number>} */
  const memory = (store && store.get()) || {};
  return {
    /**
     * @param {string} modelId
     * @param {number | undefined} catalogDefault
     */
    get(modelId, catalogDefault) {
      return memory[modelId] ?? catalogDefault;
    },
    /**
     * @param {string} modelId
     * @param {number} correctedValue
     */
    correct(modelId, correctedValue) {
      memory[modelId] = correctedValue;
      if (store) store.set(memory);
    },
  };
}

module.exports = { createOutputCaps };
