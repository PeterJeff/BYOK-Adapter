// @ts-check
'use strict';

const { resolveHost } = require('./tenants');

const SECTION = 'asksage';

/**
 * Scoped config reader (CLAUDE.md security rule: tenant/host/endpoint settings are
 * "application"-scoped in package.json, so a workspace's .vscode/settings.json cannot
 * redirect requests or the bearer token to another host).
 * @param {import('vscode')} vscode
 */
function readSettings(vscode) {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  const tenant = /** @type {string} */ (cfg.get('tenant', 'public'));
  const host = /** @type {string} */ (cfg.get('host', ''));
  const email = /** @type {string} */ (cfg.get('email', ''));
  const sessionCapTokens = /** @type {number} */ (cfg.get('budget.sessionCapTokens', 50000));
  const hourlyCapTokens = /** @type {number} */ (cfg.get('budget.hourlyCapTokens', 200000));
  const debugLogRequests = /** @type {boolean} */ (cfg.get('debug.logRequests', false));
  const apiBase = `https://${resolveHost({ tenant, host })}`;
  return { tenant, host, email, apiBase, sessionCapTokens, hourlyCapTokens, debugLogRequests };
}

module.exports = { readSettings, SECTION };
