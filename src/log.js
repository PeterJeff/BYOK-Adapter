// @ts-check
'use strict';

// Output-channel logger. Never accepts a secret directly: callers pass already-redacted
// values (CLAUDE.md security rule: the API key is never logged).

/**
 * @param {import('vscode')} vscode
 */
function createLog(vscode) {
  const channel = vscode.window.createOutputChannel('Ask Sage', { log: true });
  return {
    channel,
    /** @param {string} msg */
    info: (msg) => channel.info(msg),
    /** @param {string} msg */
    debug: (msg) => channel.debug(msg),
    /** @param {string} msg */
    warn: (msg) => channel.warn(msg),
    /** @param {string} msg */
    error: (msg) => channel.error(msg),
  };
}

module.exports = { createLog };
