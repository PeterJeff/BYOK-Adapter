// @ts-check
'use strict';

// Merges every JSONL file in the ledger directory (one per process per month, §3.4).

const fs = require('fs');
const path = require('path');

/**
 * @param {string} dir
 * @returns {import('./writer').LedgerRecord[]}
 */
function readAll(dir) {
  if (!fs.existsSync(dir)) return [];
  /** @type {import('./writer').LedgerRecord[]} */
  const records = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.jsonl')) continue;
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        // a partial/corrupt line: skip it rather than fail the whole read
      }
    }
  }
  records.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
  return records;
}

/** @param {string} dir */
function last(dir) {
  const all = readAll(dir);
  return all.length ? all[all.length - 1] : null;
}

module.exports = { readAll, last };
