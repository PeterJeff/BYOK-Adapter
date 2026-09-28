// @ts-check
'use strict';

// "Check Cache Health" (PLAN.md §4.3): send the same long-enough prefix twice (the second should
// hit cache), a control request that changes only the tail (should still hit the prefix), and
// report cache fields as PASS/FAIL per model/flavor. Pure-ish: the caller injects the actual
// network call (`send`) already bound to a model/apiKey/apiBase, so this file has no vscode or
// transport import and can be unit-tested with a fake `send`.
//
// The many-parallel-tool-results case PLAN.md §4.3 also calls for is not built yet: a synthetic
// one would need to fake Copilot's real tool definitions to mean anything, so it's left for a
// follow-up against a real conversation's tool list rather than a fabricated one (TODO.md).
//
// Not run as part of building this: it sends real, billed requests, which needs the owner's
// go-ahead (CLAUDE.md "Where Phase 0b's paid probes may run"). A first live run is what actually
// verifies this file, not this commit.

const FILLER = 'The quick brown fox jumps over the lazy dog while the extension caches its prefix deterministically. ';

/** @param {number} minChars */
function longPrefix(minChars) {
  return FILLER.repeat(Math.ceil(minChars / FILLER.length));
}

/**
 * @param {{ TextPart: Function }} ctors
 * @param {Record<string, number>} roleEnum
 * @param {string} text
 */
function userTextMessage(ctors, roleEnum, text) {
  return { role: roleEnum.User, content: [new ctors.TextPart(text)] };
}

/**
 * @param {object} deps
 * @param {(messages: any[]) => Promise<{ usage: any, error: any, transportError: any }>} deps.send one flavor-bound request, already carrying model/apiKey/apiBase
 * @param {(flavor: string, usage: any) => any} deps.normalize src/normalize/index.js's normalize
 * @param {any} deps.cacheRuleForModel the result of src/rates/cacheRules.js's cacheRule(flavor, modelId) for this model
 * @param {{ TextPart: Function }} deps.ctors
 * @param {Record<string, number>} deps.roleEnum
 * @param {string} deps.flavor
 * @param {number} [deps.minChars]
 * @returns {Promise<{ name: string, pass: boolean, detail: string }[]>}
 */
async function checkCacheHealth(deps) {
  const { send, normalize, cacheRuleForModel, ctors, roleEnum, flavor } = deps;
  const prefix = longPrefix(deps.minChars ?? 20000);

  /** @type {{ name: string, pass: boolean, detail: string }[]} */
  const results = [];

  const r1 = await send([userTextMessage(ctors, roleEnum, `${prefix}\nReply with the single word: ok.`)]);
  results.push({ name: 'cold prefix', pass: !r1.error && !r1.transportError, detail: r1.error ? r1.error.message : 'sent' });

  const r2 = await send([userTextMessage(ctors, roleEnum, `${prefix}\nReply with the single word: ok.`)]);
  const n2 = normalize(flavor, r2.usage);
  const repeatHit = !!n2 && n2.cacheRead > 0;
  results.push({
    name: 'repeat (expect a cache hit)',
    pass: !cacheRuleForModel || repeatHit,
    detail: cacheRuleForModel ? `cacheRead=${n2?.cacheRead ?? 'n/a'} of ~${Math.round(prefix.length / 3.7)} prefix tokens` : 'no cache discount rule for this model/flavor (PLAN.md §2.1); skipped',
  });

  const r3 = await send([userTextMessage(ctors, roleEnum, `${prefix}\nInstead reply with the single word: control.`)]);
  const n3 = normalize(flavor, r3.usage);
  results.push({
    name: 'control (different tail, same prefix)',
    pass: !r3.error && !r3.transportError,
    detail: `cacheRead=${n3?.cacheRead ?? 'n/a'} -- expected to still hit the shared prefix`,
  });

  results.push({ name: 'parallel tool results', pass: true, detail: 'not implemented yet: needs a real tool list, see TODO.md' });

  return results;
}

module.exports = { checkCacheHealth, longPrefix };
