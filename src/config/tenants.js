// @ts-check
'use strict';

// Tenant alias -> host table (PLAN.md §2.3: tenant is a first-class dimension). Pure.

/** @type {Record<string, string>} */
const TENANTS = {
  public: 'api.asksage.ai',
};

/**
 * Resolves the configured tenant/host into an API base host.
 * @param {{ tenant: string, host: string }} settings
 * @returns {string}
 */
function resolveHost(settings) {
  if (settings.tenant === 'custom') {
    if (!settings.host) throw new Error('asksage.tenant is "custom" but asksage.host is empty');
    return settings.host;
  }
  const host = TENANTS[settings.tenant];
  if (!host) throw new Error(`asksage.tenant "${settings.tenant}" is not a known alias (known: ${Object.keys(TENANTS).join(', ')}, or "custom" with asksage.host)`);
  return host;
}

module.exports = { TENANTS, resolveHost };
