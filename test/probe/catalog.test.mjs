// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseVarsJs, extractAllowLists, activeProfile, suffixOf, audit, renderAuditMarkdown } from '../../phase0/probe/lib/catalog.mjs';
import { parseArgs, hostOf, deriveApiHost, redactHosts } from '../../phase0/probe/catalog-audit.mjs';

const CLI = fileURLToPath(new URL('../../phase0/probe/catalog-audit.mjs', import.meta.url));

// Shaped like the minified chat bundle: variable names are arbitrary on purpose.
const BUNDLE = [
  'var zz=window.RUNTIME_VARS.REACT_APP_asksage_chat_service||"https://api.example.test/server";',
  'var q=window.RUNTIME_VARS.REACT_APP_allowed_models||null;q==""&&(q=null);',
  'var AB=typeof window.RUNTIME_VARS.REACT_APP_allowed_models=="string"&&window.RUNTIME_VARS.REACT_APP_allowed_models.trim()!=="";',
  'q==null?q=["gpt-a","groq-x","m-com","m-gov","m-ts"]:q=q.split(",");',
  'var lm=window.RUNTIME_VARS.REACT_APP_local_models||null;',
  'var T=window.RUNTIME_VARS.REACT_APP_force_gov_models||!1;T==""&&(T=!1);T==="true"?T=!0:T=!1;T===!0&&!AB&&(q=["gpt-a","m-gov","m-ts"]);',
  'var E=window.RUNTIME_VARS.REACT_APP_force_dod_models||!1;E==""&&(E=!1);E==="true"?E=!0:E=!1;E===!0&&!AB&&(q=["m-gov","gone-model"]);',
].join('');

/** @param {string} id @param {boolean} cui @param {string[]} [aliases] */
const model = (id, cui, aliases = []) => ({ id, vendor: 'V', cui_capable: cui, aliases, token_conversion_rate: { prompt: 1, completion: 1 }, deprecation: { state: 'active' } });
const MODELS = [model('gpt-a', true, ['a-public']), model('groq-x', false), model('m-com', true, ['m-public', 'default']), model('m-gov', true, ['default']), model('m-ts', true), model('m-sec', true)];

test('parseVarsJs reads backtick, double and single quoted values', () => {
  const vars = parseVarsJs('window.RUNTIME_VARS = {\n "REACT_APP_deployment_type": `government`,\n "REACT_APP_x": "a,b",\n REACT_APP_y: \'z\',\n "REACT_APP_html": `<h1>Hi, there</h1>`\n};');
  assert.deepEqual(vars, { REACT_APP_deployment_type: 'government', REACT_APP_x: 'a,b', REACT_APP_y: 'z', REACT_APP_html: '<h1>Hi, there</h1>' });
});

test('extractAllowLists anchors on RUNTIME_VARS names, not minified variables', () => {
  const lists = extractAllowLists(BUNDLE);
  assert.deepEqual(lists.default, ['gpt-a', 'groq-x', 'm-com', 'm-gov', 'm-ts']);
  assert.deepEqual(lists.gov, ['gpt-a', 'm-gov', 'm-ts']);
  assert.deepEqual(lists.dod, ['m-gov', 'gone-model']);
  assert.equal(lists.defaultChatService, 'https://api.example.test/server');
});

test('extractAllowLists returns null rather than guessing when the shape changes', () => {
  const lists = extractAllowLists('var x=window.RUNTIME_VARS.REACT_APP_force_gov_models||!1;x&&(y=someFunction());');
  assert.equal(lists.gov, null);
  assert.equal(lists.default, null);
  assert.equal(lists.dod, null);
  assert.equal(extractAllowLists('nothing').defaultChatService, null);
});

test('activeProfile follows the bundle precedence: allowed_models, DoD, gov, default', () => {
  const lists = extractAllowLists(BUNDLE);
  assert.equal(activeProfile({}, lists).name, 'default');
  assert.equal(activeProfile({ REACT_APP_force_gov_models: 'true' }, lists).name, 'gov');
  assert.equal(activeProfile({ REACT_APP_force_gov_models: 'true', REACT_APP_force_dod_models: 'TRUE' }, lists).name, 'dod');
  assert.deepEqual(activeProfile({ REACT_APP_force_dod_models: 'true', REACT_APP_allowed_models: 'a, b' }, lists), { name: 'allowed_models', ids: ['a', 'b'] });
  assert.deepEqual(activeProfile({ REACT_APP_allowed_models: '["c"]' }, lists).ids, ['c']);
  assert.equal(activeProfile({ REACT_APP_force_gov_models: 'false' }, lists).name, 'default');
});

test('suffixOf', () => {
  assert.deepEqual(['a-gov', 'a-com', 'a-ts', 'a-sec', 'a-gov-x', 'plain'].map(suffixOf), ['-gov', '-com', '-ts', '-sec', '(none)', '(none)']);
});

test('government deployment without a forced list: high findings for non-CUI and the default list', () => {
  const r = audit({ host: 'h', models: MODELS, vars: { REACT_APP_deployment_type: 'government' }, lists: extractAllowLists(BUNDLE), openaiIds: ['gpt-a', 'groq-x'], anthropicIds: ['a-public', 'm-public', 'bare-public'] });
  const byCode = Object.fromEntries(r.findings.map((f) => [f.code, f]));
  assert.equal(r.profile.governmentLike, true);
  assert.equal(r.profile.activeList, 'default');
  assert.equal(byCode['non-cui-served'].severity, 'high');
  assert.deepEqual(byCode['non-cui-served'].ids, ['groq-x']);
  assert.equal(byCode['government-without-restricted-list'].severity, 'high');
  assert.deepEqual(byCode['webapp-list-non-cui'].ids, ['groq-x']);
  assert.deepEqual(byCode['served-outside-allow-list'].ids, ['groq-x', 'm-com', 'm-sec']);
  assert.deepEqual(byCode['commercial-hosting-on-government'].ids, ['m-com']);
  assert.deepEqual(byCode['undocumented-suffix'].ids, ['m-ts', 'm-sec']);
  assert.match(byCode['alias-collision'].detail, /"default" -> m-com, m-gov/);
  assert.deepEqual(byCode['catalog-non-cui'].ids, ['groq-x']);
  assert.deepEqual(byCode['catalog-unresolved'].ids, ['bare-public']);
  assert.deepEqual(byCode['catalog-alias-resolution'].ids, ['a-public', 'm-public']);
  assert.deepEqual(byCode['catalog-commercial-backed'].ids, ['m-public']);
  assert.deepEqual(byCode['webapp-list-stale'].ids, ['gone-model']);
  // Highest severity first.
  assert.equal(r.findings[0].severity, 'high');
  assert.equal(r.findings.at(-1)?.severity, 'info');
});

test('forced DoD list is used as the reference and a clean catalog has no high findings', () => {
  const clean = [model('m-gov', true)];
  const r = audit({ host: 'h', models: clean, vars: { REACT_APP_deployment_type: 'government', REACT_APP_force_dod_models: 'true' }, lists: extractAllowLists(BUNDLE) });
  assert.equal(r.profile.activeList, 'dod');
  assert.equal(r.findings.filter((f) => f.severity === 'high').length, 0);
  assert.equal(r.findings.find((f) => f.code === 'served-outside-allow-list'), undefined);
});

test('commercial deployment: non-CUI is informational, CUI classification is flagged', () => {
  const r = audit({ host: 'h', models: MODELS, vars: { REACT_APP_deployment_type: 'commercial' }, lists: extractAllowLists(BUNDLE) });
  assert.equal(r.profile.governmentLike, false);
  assert.equal(r.findings.find((f) => f.code === 'non-cui-served')?.severity, 'info');
  assert.equal(r.findings.find((f) => f.code === 'government-without-restricted-list'), undefined);
  assert.ok(r.findings.find((f) => f.code === 'government-hosting-on-commercial'));
  const cui = audit({ host: 'h', models: MODELS, vars: { REACT_APP_deployment_type: 'commercial', REACT_APP_classification_level: 'cui' }, lists: null });
  assert.ok(cui.findings.find((f) => f.code === 'commercial-marked-cui'));
  assert.equal(cui.profile.governmentLike, true);
});

test('unpriced models are listed', () => {
  const r = audit({ host: 'h', models: [{ id: 'x', cui_capable: true }], vars: null, lists: null });
  assert.deepEqual(r.findings.find((f) => f.code === 'unpriced')?.ids, ['x']);
  assert.equal(r.profile.activeList, null);
});

test('renderAuditMarkdown shows profile, suffix table and findings', () => {
  const r = audit({ host: 'h', models: MODELS, vars: { REACT_APP_deployment_type: 'government' }, lists: extractAllowLists(BUNDLE) });
  const md = renderAuditMarkdown(r, { generatedAt: 'T', sources: { a: 'b' } });
  assert.match(md, /^# Model catalog audit: h/);
  assert.match(md, /\| `REACT_APP_deployment_type` \| `government` \|/);
  assert.match(md, /\| `-com` \| 1 \| 0 \|/);
  assert.match(md, /### \[HIGH\] 1 model\(s\) flagged cui_capable:false are served/);
  assert.match(md, /- a: b/);
});

test('CLI helpers: args, hosts, API host derivation, redaction', () => {
  assert.deepEqual(parseArgs(['chat.x.test', '--alias', 'tenant-a', '--no-save', '--json']), { instance: 'chat.x.test', alias: 'tenant-a', save: false, json: true });
  assert.throws(() => parseArgs(['--alias', 'bad/alias']), /--alias/);
  assert.throws(() => parseArgs(['--bogus']), /unknown option/);
  assert.equal(hostOf('https://Chat.X.test/path'), 'chat.x.test');
  assert.throws(() => hostOf('a b'));
  assert.deepEqual(deriveApiHost('chat.x.test', { REACT_APP_asksage_chat_service: 'https://api.other.test/server' }, null), { host: 'api.other.test', via: 'vars.js REACT_APP_asksage_chat_service' });
  assert.equal(deriveApiHost('chat.x.test', {}, 'https://api.default.test/server').host, 'api.x.test');
  assert.equal(deriveApiHost('portal.x.test', null, 'https://api.default.test/server').host, 'api.default.test');
  assert.throws(() => deriveApiHost('portal.x.test', null, null), /--api/);
  assert.equal(redactHosts('https://chat.x.test and api.x.test', ['chat.x.test', 'api.x.test'], 'tenant-a'), 'https://<tenant-a> and <tenant-a>');
  assert.equal(redactHosts('unchanged', ['x'], undefined), 'unchanged');
});

test('CLI --from re-audits saved snapshots offline', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'get-models-full.json'), JSON.stringify(MODELS));
  writeFileSync(join(dir, 'vars.json'), JSON.stringify({ REACT_APP_deployment_type: 'government' }));
  writeFileSync(join(dir, 'webapp-allowlists.json'), JSON.stringify(extractAllowLists(BUNDLE)));
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ chatHost: 'chat.x.test', apiHost: 'api.x.test' }));
  const out = execFileSync(process.execPath, [CLI, '--from', dir, '--json'], { encoding: 'utf8' });
  const r = JSON.parse(out);
  assert.equal(r.host, 'chat.x.test');
  assert.ok(r.findings.some((/** @type {any} */ f) => f.code === 'government-without-restricted-list'));
  // --from never writes into the snapshot folder.
  assert.deepEqual(readdirSync(dir).sort(), ['get-models-full.json', 'meta.json', 'vars.json', 'webapp-allowlists.json']);
  assert.match(readFileSync(join(dir, 'meta.json'), 'utf8'), /chat\.x\.test/);
});
