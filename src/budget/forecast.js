// @ts-check
'use strict';

// PLAN.md §3.5: "Burn-rate forecast in the status bar tooltip, e.g. 'at this week's rate you run
// out on the 19th'." Pure: works on ledger records and the remaining-balance figure the caller
// already has (src/budget/budgetService.js), so no vscode or network import.

const DAY_MS = 24 * 60 * 60 * 1000;

/** @param {number} n */
function ordinal(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * @param {{ ts: string, estAsCost: number | null }[]} records the ledger, any order
 * @param {number | null | undefined} remaining tokens left this month (null/undefined: unknown, no forecast)
 * @param {object} [o]
 * @param {number} [o.windowDays] how far back counts as "this week's rate" (default 7)
 * @param {number} [o.now] injectable clock, ms since epoch
 * @returns {string | null} null when there isn't enough data (no spend in the window, or no known remaining balance) to forecast from
 */
function forecastBurnRate(records, remaining, o = {}) {
  if (typeof remaining !== 'number' || !(remaining > 0)) return null;
  const windowDays = o.windowDays ?? 7;
  const now = o.now ?? Date.now();
  const cutoff = now - windowDays * DAY_MS;
  let spend = 0;
  for (const r of records) {
    if (typeof r.estAsCost !== 'number' || !(r.estAsCost > 0)) continue;
    const at = Date.parse(r.ts);
    if (Number.isFinite(at) && at >= cutoff && at <= now) spend += r.estAsCost;
  }
  if (spend <= 0) return null;
  const perDay = spend / windowDays;
  const daysLeft = remaining / perDay;
  if (!Number.isFinite(daysLeft)) return null;
  if (daysLeft > 365) return `at this week's rate (${Math.round(perDay)} AS/day) this budget lasts well over a year`;
  const runOut = new Date(now + daysLeft * DAY_MS);
  return `at this week's rate (${Math.round(perDay)} AS/day) you run out around ${ordinal(runOut.getUTCDate())}`;
}

module.exports = { forecastBurnRate, ordinal };
