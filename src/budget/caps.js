// @ts-check
'use strict';

// Effective session/hourly caps (PLAN.md §3.5). A cap the user never set defaults to
// a share of the account's monthly limit, capped by the declared setting default, so the default
// tracks the balance instead of being a fixed number. The fixed 200,000 hourly default equalled
// the whole monthly limit of a small account and protected nothing. A cap the user did set is
// used exactly as written, and 0 still means "no cap".

const SESSION_FRACTION = 0.1;
const HOURLY_FRACTION = 0.25;

/**
 * @param {{ sessionCapTokens: number, hourlyCapTokens: number, sessionCapExplicit: boolean, hourlyCapExplicit: boolean }} s
 * @param {number | null | undefined} monthlyLimit the account's monthly token limit, if known
 * @returns {{ sessionCapTokens: number, hourlyCapTokens: number }}
 */
function effectiveCaps(s, monthlyLimit) {
  /** @param {number} setting @param {boolean} explicit @param {number} fraction */
  const derive = (setting, explicit, fraction) => (explicit || !(setting > 0) || !monthlyLimit || !(monthlyLimit > 0) ? setting : Math.min(setting, Math.round(monthlyLimit * fraction)));
  return {
    sessionCapTokens: derive(s.sessionCapTokens, s.sessionCapExplicit, SESSION_FRACTION),
    hourlyCapTokens: derive(s.hourlyCapTokens, s.hourlyCapExplicit, HOURLY_FRACTION),
  };
}

module.exports = { effectiveCaps, SESSION_FRACTION, HOURLY_FRACTION };
