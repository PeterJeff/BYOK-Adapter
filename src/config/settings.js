// @ts-check
'use strict';

const { resolveHost } = require('./tenants');

const SECTION = 'asksage';

/** Settings that decide where the bearer token goes; listed in package.json's restrictedConfigurations. */
const USER_ONLY = ['tenant', 'host', 'email'];

/**
 * The user-settings value of a key, never a workspace or folder value. package.json already
 * makes these "application"-scoped and lists them in restrictedConfigurations; reading
 * globalValue here keeps the guarantee even if a VS Code build honoured a workspace value.
 * @param {import('vscode').WorkspaceConfiguration} cfg
 * @param {string} key
 * @param {string} def
 * @returns {string}
 */
function userValue(cfg, key, def) {
  const i = typeof cfg.inspect === 'function' ? cfg.inspect(key) : undefined;
  if (!i) return /** @type {string} */ (cfg.get(key, def));
  return /** @type {string} */ (i.globalValue ?? i.defaultValue ?? def);
}

/**
 * Scoped config reader (CLAUDE.md security rule: a workspace's .vscode/settings.json cannot
 * redirect requests or the bearer token to another host).
 * @param {import('vscode')} vscode
 */
function readSettings(vscode) {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  const tenant = userValue(cfg, 'tenant', 'public');
  const host = userValue(cfg, 'host', '');
  const email = userValue(cfg, 'email', '');
  const sessionCapTokens = /** @type {number} */ (cfg.get('budget.sessionCapTokens', 50000));
  const hourlyCapTokens = /** @type {number} */ (cfg.get('budget.hourlyCapTokens', 200000));
  const budgetWarnFraction = /** @type {number} */ (cfg.get('budget.warnFraction', 0.8));
  const budgetReserveTokens = /** @type {number} */ (cfg.get('budget.reserveTokens', 0));
  const debugLogRequests = /** @type {boolean} */ (cfg.get('debug.logRequests', false));
  const cacheTtlMode = /** @type {'5m' | 'mixed' | '1h'} */ (cfg.get('cache.ttlMode', 'mixed'));
  const pinToolList = /** @type {boolean} */ (cfg.get('cache.pinToolList', true));
  const interceptUtilityRequests = /** @type {boolean} */ (cfg.get('interceptUtilityRequests', false));
  const apiBase = `https://${resolveHost({ tenant, host })}`;
  return { tenant, host, email, apiBase, sessionCapTokens, hourlyCapTokens, budgetWarnFraction, budgetReserveTokens, debugLogRequests, cacheTtlMode, pinToolList, interceptUtilityRequests };
}

module.exports = { readSettings, SECTION, USER_ONLY };
