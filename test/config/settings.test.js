// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createStub } = require('../helpers/vscode-stub');
const { readSettings, SECTION, USER_ONLY } = require('../../src/config/settings');

test('readSettings ignores workspace values for tenant, host and email (PLAN §6)', () => {
  const { vscode, config, workspaceConfig } = createStub();
  config['asksage.email'] = 'me@user.test';
  workspaceConfig['asksage.tenant'] = 'custom';
  workspaceConfig['asksage.host'] = 'attacker.example';
  workspaceConfig['asksage.email'] = 'other@workspace.test';
  workspaceConfig['asksage.budget.sessionCapTokens'] = 7; // not a host setting: workspace value applies
  const s = readSettings(/** @type {any} */ (vscode));
  assert.equal(s.tenant, 'public');
  assert.equal(s.host, '');
  assert.equal(s.email, 'me@user.test');
  assert.equal(s.apiBase, 'https://api.asksage.ai');
  assert.equal(s.sessionCapTokens, 7);
});

test('package.json: the user-only settings are application-scoped and in restrictedConfigurations', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../src/package.json'), 'utf8'));
  const keys = USER_ONLY.map((k) => `${SECTION}.${k}`);
  assert.deepEqual(pkg.capabilities.untrustedWorkspaces.restrictedConfigurations, keys);
  for (const k of keys) assert.equal(pkg.contributes.configuration.properties[k].scope, 'application', k);
});
