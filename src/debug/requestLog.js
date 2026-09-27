// @ts-check
'use strict';

// Opt-in only (asksage.debug.logRequests, default false). This is the one place in the
// codebase allowed to write prompt text to disk, and only because the user explicitly turned
// it on -- everywhere else (the ledger, output channel) never sees it by default (CLAUDE.md
// security rule; PLAN.md §3.4 "No prompt text by default; a debug setting can add ... it").
// Same one-file-per-process-per-month layout as ledger/writer.js, in its own subdirectory so
// the security boundary between "always written" and "opt-in only" is a folder, not a flag.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { monthKey } = require('../ledger/writer');

/**
 * @typedef {object} DebugRecord
 * @property {string} ts
 * @property {string} conversationId
 * @property {string} model
 * @property {'CC' | 'R'} flavor
 * @property {number} attempt
 * @property {unknown} request the exact body sent to the model
 * @property {string} responseText the concatenated streamed text, if any
 * @property {unknown} usage raw (un-normalized) usage from the response
 * @property {string | null} resolvedModel
 * @property {{ shape: string, message: string } | null} error
 */

/**
 * @param {string} dir globalStorageUri.fsPath + "/debug" (or an equivalent test directory)
 */
function createRequestLog(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${monthKey()}.${process.pid}-${crypto.randomBytes(3).toString('hex')}.jsonl`);
  return {
    filePath,
    /** @param {DebugRecord} record */
    write(record) {
      fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
    },
  };
}

module.exports = { createRequestLog };
