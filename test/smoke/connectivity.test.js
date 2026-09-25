// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const conn = require('../../phase0/smoke-extension/lib/connectivity');

test('normalizeHost accepts hosts and URLs, rejects junk', () => {
  assert.equal(conn.normalizeHost('api.asksage.ai'), 'api.asksage.ai');
  assert.equal(conn.normalizeHost(' https://API.AskSage.ai/server/x '), 'api.asksage.ai');
  assert.equal(conn.normalizeHost('localhost:8443'), 'localhost:8443');
  assert.throws(() => conn.normalizeHost('user@evil.example'));
  assert.throws(() => conn.normalizeHost(''));
});

test('classifyBody recognises the Ask Sage auth rejection', () => {
  assert.equal(conn.classifyBody('{"response":"Token is invalid [1]","status":400}'), 'asksage-auth-rejected');
  assert.equal(conn.classifyBody('{"a":1}'), 'json');
  assert.equal(conn.classifyBody('<html>blocked by proxy</html>'), 'html');
  assert.equal(conn.classifyBody('nope'), 'other');
});

test('describeError walks the cause chain', () => {
  const inner = Object.assign(new Error('self-signed certificate in certificate chain'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' });
  const outer = new TypeError('fetch failed', { cause: inner });
  assert.deepEqual(conn.describeError(outer), [
    { name: 'TypeError', code: undefined, message: 'fetch failed' },
    { name: 'Error', code: 'SELF_SIGNED_CERT_IN_CHAIN', message: 'self-signed certificate in certificate chain' },
  ]);
});

test('probeAll reports both transports against a local server', async (t) => {
  /** @type {string[]} */
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push(`${req.method} ${req.url} auth=${req.headers.authorization || req.headers['x-access-tokens'] || 'none'} body=${body}`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"response":"Token is invalid [1]","status":400}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
  t.after(() => server.close());
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;

  const result = await conn.probeAll(`127.0.0.1:${port}`, { fetch: globalThis.fetch, https: http, scheme: 'http', timeoutMs: 5000 });
  assert.equal(result.url, `http://127.0.0.1:${port}${conn.PROBE_PATH}`);
  assert.deepEqual(result.results.map((r) => [r.method, r.ok, r.status, r.bodyClass]), [
    ['fetch', true, 200, 'asksage-auth-rejected'],
    ['https', true, 200, 'asksage-auth-rejected'],
  ]);
  // No credentials are ever sent.
  assert.deepEqual(seen, [`POST ${conn.PROBE_PATH} auth=none body={}`, `POST ${conn.PROBE_PATH} auth=none body={}`]);
});

test('probeAll reports connection failures with codes', async () => {
  // A port that was just free: connection is refused quickly. (fetch refuses some
  // well-known ports outright, so a low fixed port would test the wrong thing.)
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', () => r(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (probe.address()).port;
  await new Promise((r) => probe.close(() => r(undefined)));
  const result = await conn.probeAll(`127.0.0.1:${port}`, { fetch: globalThis.fetch, https: http, scheme: 'http', timeoutMs: 5000 });
  for (const r of result.results) {
    assert.equal(r.ok, false);
    assert.ok(r.error && r.error.some((e) => e.code === 'ECONNREFUSED'), JSON.stringify(r.error));
  }
});

test('probeAll without fetch still runs the https probe', async () => {
  const result = await conn.probeAll('127.0.0.1:9', { https: http, scheme: 'http', timeoutMs: 2000 });
  assert.equal(result.results[0].method, 'fetch');
  assert.equal(result.results[0].error?.[0].name, 'Unavailable');
  assert.equal(result.results[1].method, 'https');
});
