// @ts-check
'use strict';

// PLAN.md §4.3 "Check Cache Health" passive analysis mode / §3.7's cold-turn attribution, folded
// into one command instead of a separate script (TODO.md 2026-09-28). No new spend: reconciles
// the ledger (src/ledger/reader.js) that this extension already wrote against Ask Sage's own
// prompt log (src/auth/promptLog.js, POST /user/get-user-logs) for the *same* requests, to check
// what the ledger's own usage fields claimed against what was actually billed, and to attribute
// each cold or partly-cold turn to a cause using fields the ledger already carries. Pure: matching
// and attribution are plain data transforms, no vscode or network import, so this is unit-testable
// with fixture arrays. `expectedBill`/`verdict` are src/rates/formula.js (itself ported from
// phase0/probe/lib/billing.mjs); this file doesn't duplicate them.

/** @typedef {import('./writer').LedgerRecord} LedgerRecord */
/** @typedef {{ id: number, date_time?: string, model: string, prompt_tokens: number, completion_tokens: number, total_tokens: number }} LogRow */

/** Keeps only the numeric billing fields of a raw get-user-logs row (drops prompt/response text, ip, user id). */
const LOG_KEEP = ['id', 'date_time', 'model', 'prompt_tokens', 'completion_tokens', 'total_tokens'];

/**
 * @param {Record<string, any>} row
 * @returns {LogRow}
 */
function logNumbers(row) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const k of LOG_KEEP) if (k in row) out[k] = row[k];
  return /** @type {LogRow} */ (out);
}

/**
 * Pairs each billable ledger record with the nearest not-yet-used log row of the same model,
 * within `toleranceMs`. There is no shared request id between the two systems, so this is a
 * greedy nearest-timestamp match per model rather than an exact join; both logs are chronological
 * for the same real traffic, so in practice matches are unambiguous unless two requests to the
 * same model land within the tolerance window of each other (left unmatched rather than guessed).
 * @param {LedgerRecord[]} ledgerRecords
 * @param {unknown[]} rawLogRows
 * @param {{ toleranceMs?: number }} [o]
 * @returns {{ ledger: LedgerRecord, log: LogRow | null }[]}
 */
function matchLogRows(ledgerRecords, rawLogRows, o = {}) {
  const toleranceMs = o.toleranceMs ?? 120000;
  const logRows = rawLogRows.map(logNumbers);
  const usedLogIds = new Set();
  /** @type {{ ledger: LedgerRecord, log: LogRow | null }[]} */
  const out = [];
  const billable = ledgerRecords.filter((r) => r.status === 'ok');
  for (const rec of billable) {
    const recAt = Date.parse(rec.ts);
    let best = null;
    let bestDelta = Infinity;
    for (const row of logRows) {
      if (usedLogIds.has(row.id)) continue;
      if (row.model !== rec.model) continue;
      const rowAt = Date.parse(String(row.date_time ?? ''));
      if (Number.isNaN(rowAt) || Number.isNaN(recAt)) continue;
      const delta = Math.abs(rowAt - recAt);
      if (delta <= toleranceMs && delta < bestDelta) {
        best = row;
        bestDelta = delta;
      }
    }
    if (best) usedLogIds.add(best.id);
    out.push({ ledger: rec, log: best });
  }
  return out;
}

/**
 * Why a cold (or partly-cold) turn's cache read was 0, from fields the ledger already carries,
 * compared against the *previous* record in the same conversation (PLAN.md §3.4/§4.3): tool-list
 * churn, a thinking/reasoning-config change, a host failover (resolvedModel changed though the
 * requested model didn't), a changed/injected prefix, or TTL expiry. `null` when the turn wasn't
 * cold, or there is no previous turn to compare against (a conversation's first request is always
 * cold and needs no attribution).
 * @param {LedgerRecord | null} prev
 * @param {LedgerRecord} curr
 * @param {'5m' | 'mixed' | '1h'} ttlMode
 * @returns {string | null}
 */
function attributeCause(prev, curr, ttlMode) {
  if (curr.cacheRead > 0) return null;
  if (!prev) return null;
  if (prev.toolSetHash && curr.toolSetHash && prev.toolSetHash !== curr.toolSetHash) return 'tool-churn';
  if (prev.thinkingConfigHash && curr.thinkingConfigHash && prev.thinkingConfigHash !== curr.thinkingConfigHash) return 'thinking-config-change';
  if (prev.resolvedModel && curr.resolvedModel && prev.resolvedModel !== curr.resolvedModel) return 'host-failover';
  if (prev.prefixHash && curr.prefixHash && prev.prefixHash !== curr.prefixHash) return 'prefix-changed';
  const prevAt = Date.parse(prev.ts);
  const currAt = Date.parse(curr.ts);
  const ttlMs = ttlMode === '1h' ? 60 * 60 * 1000 : 5 * 60 * 1000;
  if (Number.isFinite(prevAt) && Number.isFinite(currAt) && currAt - prevAt > ttlMs) return 'ttl-expiry';
  return 'unknown';
}

/**
 * @typedef {object} ReconciledRow
 * @property {LedgerRecord} ledger
 * @property {LogRow | null} log
 * @property {number | null} billed  the log row's total_tokens, or null if unmatched
 * @property {'fits' | 'over' | 'under' | 'unbilled' | 'unknown'} verdict
 * @property {string | null} coldCause
 */

/**
 * @param {object} o
 * @param {LedgerRecord[]} o.ledgerRecords  already filtered to the range/model/conversation of interest, oldest first
 * @param {unknown[]} o.logRows  raw get-user-logs rows for roughly the same window
 * @param {(billed: number | null, expected: number | null) => 'fits' | 'over' | 'under' | 'unbilled' | 'unknown'} o.verdict src/rates/formula.js's verdict
 * @param {'5m' | 'mixed' | '1h'} [o.ttlMode]
 * @param {number} [o.toleranceMs]
 * @returns {{ rows: ReconciledRow[], summary: { matched: number, unmatched: number, cacheReadPct: number, coldByCause: Record<string, number> } }}
 */
function reconcile(o) {
  const ttlMode = o.ttlMode || 'mixed';
  const pairs = matchLogRows(o.ledgerRecords, o.logRows, { toleranceMs: o.toleranceMs });

  /** @type {Map<string, LedgerRecord | null>} last billable record seen per conversation, in order */
  const lastByConversation = new Map();
  /** @type {ReconciledRow[]} */
  const rows = [];
  let cacheableTotal = 0;
  let cacheReadTotal = 0;
  /** @type {Record<string, number>} */
  const coldByCause = {};

  for (const { ledger, log } of pairs) {
    const prev = lastByConversation.get(ledger.conversationId) || null;
    const coldCause = attributeCause(prev, ledger, ttlMode);
    lastByConversation.set(ledger.conversationId, ledger);

    const billed = log ? log.total_tokens : null;
    const v = o.verdict(billed, typeof ledger.estAsCost === 'number' ? ledger.estAsCost : null);
    rows.push({ ledger, log, billed, verdict: v, coldCause });

    const total = ledger.inputUncached + ledger.cacheRead + ledger.cacheWrite5m + ledger.cacheWrite1h;
    if (total > 0) {
      cacheableTotal += total;
      cacheReadTotal += ledger.cacheRead;
    }
    if (coldCause) coldByCause[coldCause] = (coldByCause[coldCause] || 0) + 1;
  }

  const matched = rows.filter((r) => r.log).length;
  return {
    rows,
    summary: {
      matched,
      unmatched: rows.length - matched,
      cacheReadPct: cacheableTotal > 0 ? Math.round((cacheReadTotal / cacheableTotal) * 1000) / 10 : 0,
      coldByCause,
    },
  };
}

module.exports = { logNumbers, matchLogRows, attributeCause, reconcile };
