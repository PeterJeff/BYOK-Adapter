// @ts-check
'use strict';

// PLAN.md §3.4: every request appends one line to a JSONL file in globalStorageUri. One file
// per month per extension-host process (concurrent appends from several windows are not
// reliably atomic on Windows). No prompt text by default (CLAUDE.md security rule).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** @param {Date} [d] */
function monthKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * @typedef {object} LedgerRecord
 * @property {string} ts
 * @property {string} conversationId
 * @property {string} tenant
 * @property {string} model
 * @property {string | null} resolvedModel
 * @property {'M' | 'CC' | 'R' | 'n/a'} flavor  'n/a': an intercepted utility request (src/convert/utilityRequest.js), no transport used
 * @property {number} inputUncached
 * @property {number} cacheRead
 * @property {number} cacheWrite5m
 * @property {number} cacheWrite1h
 * @property {number} visibleOutput
 * @property {number} thinking
 * @property {boolean} thinkingUnknown
 * @property {number | null} estAsCost
 * @property {string} rateSource
 * @property {number} latencyMs
 * @property {string} status  "ok" | "error" | "cancelled" | "intercepted"
 * @property {string | null} errorClass
 * @property {boolean} cancelled
 * @property {number} toolCallCount
 * @property {string} [toolSetHash]  PLAN.md §3.4: attributes a cold turn to tool-list churn
 * @property {string} [thinkingConfigHash]  PLAN.md §3.4: attributes a cold turn to a thinking-config change
 * @property {boolean} [reasoningStateLost]  PLAN.md §5: this round sent no thinking/reasoning block though the turn had one to carry
 */

/**
 * @param {string} dir globalStorageUri.fsPath (or an equivalent test directory)
 */
function createLedgerWriter(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${monthKey()}.${process.pid}-${crypto.randomBytes(3).toString('hex')}.jsonl`);
  return {
    filePath,
    /** @param {LedgerRecord} record */
    append(record) {
      fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
    },
  };
}

module.exports = { createLedgerWriter, monthKey };
