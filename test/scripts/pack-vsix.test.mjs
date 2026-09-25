// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, createZip, readZip } from '../../scripts/lib/zip.mjs';
import { pack, collectFiles, vsixManifest, contentTypes } from '../../scripts/pack-vsix.mjs';

const repo = fileURLToPath(new URL('../..', import.meta.url));

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test('zip round-trips stored and deflated entries, including UTF-8 names', () => {
  const entries = [
    { name: 'a.txt', data: Buffer.from('x'.repeat(5000)) },
    { name: 'dir/tiny.bin', data: Buffer.from([1]) },
    { name: 'dir/ünïcode.md', data: Buffer.from('# hi') },
    { name: 'empty', data: Buffer.alloc(0) },
  ];
  const zip = createZip(entries);
  assert.ok(zip.length < 5000, 'repetitive data is deflated');
  assert.deepEqual(readZip(zip).map((e) => [e.name, e.data.toString('hex')]), entries.map((e) => [e.name, e.data.toString('hex')]));
});

test('packs the smoke extension with manifest, content types and only runtime files', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'vsix-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { out, files } = pack(join(repo, 'phase0/smoke-extension'), join(dir, 'smoke.vsix'));
  assert.deepEqual(files.slice(0, 2), ['[Content_Types].xml', 'extension.vsixmanifest']);
  assert.ok(files.includes('extension/package.json'));
  assert.ok(files.includes('extension/extension.js'));
  assert.ok(files.includes('extension/lib/inspect.js'));
  const entries = Object.fromEntries(readZip(readFileSync(out)).map((e) => [e.name, e.data.toString('utf8')]));
  const pkg = JSON.parse(entries['extension/package.json']);
  assert.match(entries['extension.vsixmanifest'], new RegExp(`Id="${pkg.name}" Version="${pkg.version}" Publisher="${pkg.publisher}"`));
  assert.match(entries['extension.vsixmanifest'], /Microsoft\.VisualStudio\.Code\.Engine" Value="\^1\.104\.0"/);
  assert.match(entries['[Content_Types].xml'], /Extension="\.js" ContentType="application\/javascript"/);
});

test('collectFiles skips dot-files, node_modules, tests and old packages', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ext-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const d of ['lib', 'node_modules/x', 'test', '.vscode']) mkdirSync(join(dir, d), { recursive: true });
  for (const f of ['package.json', 'extension.js', 'lib/a.js', 'node_modules/x/i.js', 'test/t.js', '.vscode/s.json', '.env', 'old.vsix', 'README.md']) writeFileSync(join(dir, f), '{}');
  assert.deepEqual(collectFiles(dir), ['README.md', 'extension.js', 'lib/a.js', 'package.json']);
});

test('manifest escapes XML and lists readme and license assets', () => {
  const xml = vsixManifest({ name: 'n', publisher: 'p', version: '1.0.0', displayName: 'A & <B>', engines: { vscode: '^1.104.0' } }, ['README.md', 'LICENSE']);
  assert.match(xml, /<DisplayName>A &amp; &lt;B&gt;<\/DisplayName>/);
  assert.match(xml, /Content\.Details" Path="extension\/README\.md"/);
  assert.match(xml, /Content\.License" Path="extension\/LICENSE"/);
  assert.match(contentTypes(['LICENSE']), /Extension="\.bin"/);
});

test('rejects a package.json without engines.vscode', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ext-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'n', publisher: 'p', version: '1.0.0', engines: {} }));
  assert.throws(() => pack(dir, join(dir, 'x.vsix')), /engines\.vscode/);
});
