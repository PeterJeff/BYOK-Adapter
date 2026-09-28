// @ts-check
'use strict';

// PLAN.md §3.5 "Pre-flight estimate": before a request is sent, estimate its Ask Sage token cost
// from the same local, fast character-based approximation provideTokenCount uses for one message
// (src/extension.js), scaled by this conversation's own recent cache-read share (0, the
// conservative full-price assumption, until it has run at least one turn) and this model's rates,
// then compare the projected spend against the remaining session/hourly budget (src/budget/
// spendCap.js already tracks what has actually been spent). Pure: no vscode or network import, so
// it doesn't make the optional remote count PLAN.md §3.5 allows near a threshold (`count_tokens`/
// `/server/tokenizer`) -- not yet built, see TODO.md.

const { textOf, toolCallsOf, toolResultsOf, toolResultText } = require('../convert/messages');

const CHARS_PER_TOKEN = 3.7; // same local estimate as provider.provideTokenCount (src/extension.js)

/**
 * Raw character count of an outgoing request across every message part and tool definition --
 * not just plain text: an agent round's biggest prompt growth is usually tool_result content.
 * @param {readonly any[]} messages
 * @param {readonly { name: string, description?: string, inputSchema?: unknown }[]} tools
 * @param {{ TextPart: Function, ToolCallPart: Function, ToolResultPart: Function, ThinkingPart?: Function }} ctors
 */
function charsOfRequest(messages, tools, ctors) {
  let chars = 0;
  for (const m of messages) {
    chars += textOf(m, ctors).length;
    for (const c of toolCallsOf(m, ctors)) chars += JSON.stringify(c.input ?? {}).length + (c.name?.length || 0);
    for (const r of toolResultsOf(m, ctors)) chars += toolResultText(r.content, ctors).length;
    if (ctors.ThinkingPart) for (const p of m.content || []) if (p instanceof ctors.ThinkingPart) chars += (p.value || '').length;
  }
  for (const t of tools || []) chars += JSON.stringify(t).length;
  return chars;
}

/**
 * PLAN.md §3.5's formula: "local token estimate x expected cache split for this conversation x
 * rates" -- input only. Output is deliberately not guessed here: the catalog's `limits.max_output`
 * (the only pre-flight-available figure) is unreliable on most models (REQUIREMENTS.md §5 phase-1
 * row: 77 of 105 public-catalog models report one within 70% of max_context, and real caps have
 * been rejected outright), so treating it as "expected output" would make the estimate wildly
 * pessimistic on high-cap models rather than merely approximate. The already-built post-hoc spend
 * cap (src/budget/spendCap.js) still catches actual output cost once a response completes.
 * @param {number} chars
 * @param {{ prompt: number, completion: number }} rates AS tokens per model token
 * @param {import('../rates/cacheRules').CacheRule} cacheRule
 * @param {number} recentCacheReadRatio 0..1, this conversation's recent share of cacheable input tokens that were cache reads (0 if no history yet)
 * @returns {number} an estimated Ask Sage token cost, before the request is sent
 */
function estimatePreflightCost(chars, rates, cacheRule, recentCacheReadRatio) {
  const inputTokens = Math.ceil(chars / CHARS_PER_TOKEN);
  const readMultiplier = cacheRule ? cacheRule.read : 1;
  const ratio = Math.max(0, Math.min(1, recentCacheReadRatio));
  const blendedInputRate = rates.prompt * (1 - ratio + ratio * readMultiplier);
  return Math.round(inputTokens * blendedInputRate * 100) / 100;
}

/**
 * @param {object} o
 * @param {number} o.estimatedCost
 * @param {{ conversation: number, hourly: number }} o.spent
 * @param {{ sessionCapTokens: number, hourlyCapTokens: number }} o.limits
 * @param {number} [o.warnFraction] fraction of the cap at which to warn instead of block (default 0.8)
 * @param {number} [o.reserve] AS tokens of headroom the hard stop keeps back (default 0)
 * @returns {{ level: 'ok' | 'warn' | 'stop', message: string | null }}
 */
function checkPreflight(o) {
  const warnFraction = o.warnFraction ?? 0.8;
  const reserve = o.reserve ?? 0;
  const checks = [
    { label: 'session', spent: o.spent.conversation, cap: o.limits.sessionCapTokens },
    { label: 'hourly', spent: o.spent.hourly, cap: o.limits.hourlyCapTokens },
  ];
  for (const c of checks) {
    if (!(c.cap > 0)) continue;
    const projected = c.spent + o.estimatedCost;
    if (projected > c.cap - reserve) {
      return {
        level: 'stop',
        message: `Ask Sage: this request is estimated at ~${o.estimatedCost} AS tokens and would push the ${c.label} spend to ~${Math.round(projected)} of ${c.cap} AS tokens. Raise "Ask Sage > Budget: ${c.label === 'session' ? 'Session Cap Tokens' : 'Hourly Cap Tokens'}", run "Ask Sage: Request More Tokens", switch to a cheaper model, or start a new conversation.`,
      };
    }
    if (projected > c.cap * warnFraction) {
      return {
        level: 'warn',
        message: `Ask Sage: this request is estimated at ~${o.estimatedCost} AS tokens; the ${c.label} spend would reach ~${Math.round(projected)} of ${c.cap} AS tokens (${Math.round((projected / c.cap) * 100)}%).`,
      };
    }
  }
  return { level: 'ok', message: null };
}

module.exports = { charsOfRequest, estimatePreflightCost, checkPreflight, CHARS_PER_TOKEN };
