// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const report = require('../../phase0/smoke-extension/lib/report');

const back = (/** @type {Partial<import('../../phase0/smoke-extension/lib/report').BackFlags>} */ b = {}) => ({ text: false, thinking: false, thinkingId: false, thinkingMetadata: false, data: false, ...b });

test('fresh findings: E1, E2, E4, E5 not run; E3 passes', () => {
  const s = report.deriveStatus(report.createFindings(), { installSource: 'vsix' });
  assert.equal(s.E1.status, 'NOT RUN');
  assert.equal(s.E2.status, 'NOT RUN');
  assert.equal(s.E3.status, 'PASS');
  assert.match(s.E3.detail, /vsix/);
  assert.equal(s.E4.status, 'NOT RUN');
  assert.equal(s.E5.status, 'NOT RUN');
});

test('E1 and E2 progress from partial to pass', () => {
  const f = report.createFindings();
  f.infoCalls = 1;
  assert.equal(report.deriveStatus(f, {}).E1.status, 'PARTIAL');
  f.requests = 1;
  assert.equal(report.deriveStatus(f, {}).E1.status, 'PASS');
  f.e2.requestsWithTools = 1;
  f.e2.maxTools = 40;
  assert.equal(report.deriveStatus(f, {}).E2.status, 'PARTIAL');
  f.e2.toolResultsReceived = 1;
  assert.equal(report.deriveStatus(f, {}).E2.status, 'PASS');
});

test('E4 verdicts', () => {
  const f = report.createFindings();
  const emit = { thinking: 'ok', data: 'ok', usage: 'ok' };
  report.addEmitted(f, { nonce: 'smk-1-aaaaaa', at: '', model: 'm', emit, back: back() });
  assert.equal(report.deriveStatus(f, {}).E4.status, 'NOT RUN');

  report.mergeRoundTrips(f, [{ nonce: 'smk-1-aaaaaa', ...back({ text: true }) }]);
  assert.equal(report.deriveStatus(f, {}).E4.status, 'FAIL');

  report.mergeRoundTrips(f, [{ nonce: 'smk-1-aaaaaa', ...back({ thinking: true }) }]);
  assert.equal(report.deriveStatus(f, {}).E4.status, 'PARTIAL');

  report.mergeRoundTrips(f, [{ nonce: 'smk-1-aaaaaa', ...back({ data: true }) }]);
  const s = report.deriveStatus(f, {}).E4;
  assert.equal(s.status, 'PASS');
  assert.match(s.detail, /private data part back 1\/1/);
  // Flags merge OR-wise: a later request without the part does not undo it.
  report.mergeRoundTrips(f, [{ nonce: 'smk-1-aaaaaa', ...back({ text: true }) }]);
  assert.equal(report.deriveStatus(f, {}).E4.status, 'PASS');
});

test('E4 fails clearly when nothing could be emitted', () => {
  const f = report.createFindings();
  report.addEmitted(f, { nonce: 'smk-1-aaaaaa', at: '', model: 'm', emit: { thinking: 'unavailable', data: 'unavailable', usage: 'unavailable' }, back: back({ text: true }) });
  const s = report.deriveStatus(f, {}).E4;
  assert.equal(s.status, 'FAIL');
  assert.match(s.detail, /Neither part type could be emitted/);
});

test('E5 verdicts', () => {
  const f = report.createFindings();
  f.e5 = { at: '', url: 'https://h/server/get-models', results: [{ method: 'fetch', ok: true, status: 200, bodyClass: 'asksage-auth-rejected' }, { method: 'https', ok: false, error: [{ name: 'Error', code: 'SELF_SIGNED_CERT_IN_CHAIN' }] }] };
  const s = report.deriveStatus(f, {}).E5;
  assert.equal(s.status, 'PARTIAL');
  assert.match(s.detail, /SELF_SIGNED_CERT_IN_CHAIN/);
  f.e5.results[1] = { method: 'https', ok: true, status: 200, bodyClass: 'asksage-auth-rejected' };
  assert.equal(report.deriveStatus(f, {}).E5.status, 'PASS');
});

test('emitted records and errors are capped', () => {
  const f = report.createFindings();
  for (let i = 0; i < 60; i++) report.addEmitted(f, { nonce: `smk-${i}-aaaaaa`, at: '', model: 'm', emit: { thinking: 'ok', data: 'ok', usage: 'ok' }, back: back() });
  for (let i = 0; i < 30; i++) report.addError(f, 'x', new Error(String(i)));
  assert.equal(f.e4.emitted.length, 50);
  assert.equal(f.e4.emitted[0].nonce, 'smk-10-aaaaaa');
  assert.equal(f.errors.length, 20);
});

test('restoreFindings keeps defaults and drops other versions', () => {
  const restored = report.restoreFindings({ version: 1, requests: 3, e2: { maxTools: 9 } });
  assert.equal(restored.requests, 3);
  assert.equal(restored.e2.maxTools, 9);
  assert.equal(restored.e2.toolCallsEmitted, 0);
  assert.deepEqual(restored.e4.emitted, []);
  assert.equal(report.restoreFindings({ version: 0, requests: 3 }).requests, 0);
  assert.equal(report.restoreFindings(undefined).requests, 0);
});

test('redactText hides home directories and URL credentials', () => {
  const out = report.redactText('path C:\\Users\\pat\\x and C:/Users/pat/y, proxy http://pat:s3cret@proxy:8080 ok', ['C:\\Users\\pat']);
  assert.equal(out, 'path ~\\x and ~/y, proxy http://***@proxy:8080 ok');
});

test('renderReport includes the summary table and is redacted', () => {
  const f = report.createFindings();
  f.requests = 2;
  const md = report.renderReport(f, {
    extensionId: 'byok-adapter.asksage-smoke',
    extensionPath: '/home/pat/.vscode/extensions/x',
    homeDirs: ['/home/pat'],
    api: { 'lm.registerLanguageModelChatProvider': true },
    settings: { 'http.proxy': 'http://u:p@proxy:3128' },
  });
  assert.match(md, /\| E1 Models in picker \| \*\*PASS\*\* \|/);
  assert.match(md, /~\/\.vscode\/extensions\/x/);
  assert.doesNotMatch(md, /\/home\/pat/);
  assert.doesNotMatch(md, /u:p@/);
});
