// @ts-check
// Zero-dependency .vsix packer. Runs with any Node 18+, including the one inside VS Code:
//
//   Windows (PowerShell):
//     $env:ELECTRON_RUN_AS_NODE = "1"
//     & "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe" scripts\pack-vsix.mjs phase0\smoke-extension
//     Remove-Item Env:ELECTRON_RUN_AS_NODE
//   macOS / Linux:
//     ELECTRON_RUN_AS_NODE=1 "<path to VS Code's Electron binary>" scripts/pack-vsix.mjs phase0/smoke-extension
//
// Options: --out <file.vsix>   (default: dist/<publisher>.<name>-<version>.vsix)
//          --list <file.vsix>  (print the entries of an existing .vsix)
//
// Packs every file under the extension folder except dot-files, node_modules,
// test folders and existing .vsix files.

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip, readZip } from './lib/zip.mjs';

const EXCLUDE_DIRS = new Set(['node_modules', 'test', 'tests', 'dist']);

/** @param {string} s */
function xml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * @param {string} root
 * @param {string} [dir]
 * @returns {string[]}
 */
export function collectFiles(root, dir = root) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!EXCLUDE_DIRS.has(name)) out.push(...collectFiles(root, full));
    } else if (st.isFile() && !name.endsWith('.vsix')) {
      out.push(relative(root, full).split(sep).join('/'));
    }
  }
  return out;
}

/** @param {any} pkg */
function validate(pkg) {
  const missing = ['name', 'publisher', 'version', 'engines'].filter((k) => !pkg[k]);
  if (missing.length) throw new Error(`package.json is missing: ${missing.join(', ')}`);
  if (!pkg.engines.vscode) throw new Error('package.json is missing engines.vscode');
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(pkg.publisher) || !/^[a-z0-9][a-z0-9-]*$/i.test(pkg.name)) {
    throw new Error('publisher and name may contain only letters, digits and hyphens');
  }
}

/**
 * @param {any} pkg
 * @param {string[]} files paths relative to the extension root
 */
export function vsixManifest(pkg, files) {
  const assets = ['<Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />'];
  const readme = files.find((f) => /^readme\.md$/i.test(f));
  if (readme) assets.push(`<Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/${xml(readme)}" Addressable="true" />`);
  const license = files.find((f) => /^licen[cs]e(\.(md|txt))?$/i.test(f));
  if (license) assets.push(`<Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/${xml(license)}" Addressable="true" />`);
  const kind = Array.isArray(pkg.extensionKind) ? pkg.extensionKind.join(',') : pkg.extensionKind || 'workspace';
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${xml(pkg.name)}" Version="${xml(pkg.version)}" Publisher="${xml(pkg.publisher)}" />
    <DisplayName>${xml(pkg.displayName || pkg.name)}</DisplayName>
    <Description xml:space="preserve">${xml(pkg.description || '')}</Description>
    <Tags>${xml((pkg.keywords || []).join(','))}</Tags>
    <Categories>${xml((pkg.categories || ['Other']).join(','))}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${xml(pkg.engines.vscode)}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="${xml((pkg.extensionDependencies || []).join(','))}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="${xml((pkg.extensionPack || []).join(','))}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="${xml(kind)}" />
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    ${assets.join('\n    ')}
  </Assets>
</PackageManifest>
`;
}

/** @param {string[]} files */
export function contentTypes(files) {
  const types = /** @type {Record<string, string>} */ ({
    '.json': 'application/json',
    '.js': 'application/javascript',
    '.cjs': 'application/javascript',
    '.mjs': 'application/javascript',
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.vsixmanifest': 'text/xml',
  });
  const exts = new Set(['.vsixmanifest', ...files.map((f) => extname(f).toLowerCase() || '.bin')]);
  const defaults = [...exts].sort().map((e) => `<Default Extension="${xml(e)}" ContentType="${xml(types[e] || 'application/octet-stream')}" />`);
  return `<?xml version="1.0" encoding="utf-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults.join('')}</Types>\n`;
}

/**
 * @param {string} extDir
 * @param {string} [outPath]
 */
export function pack(extDir, outPath) {
  const root = resolve(extDir);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  validate(pkg);
  const files = collectFiles(root);
  if (pkg.main && !files.includes(pkg.main.replace(/^\.\//, ''))) throw new Error(`main file ${pkg.main} not found`);
  const entries = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes(files), 'utf8') },
    { name: 'extension.vsixmanifest', data: Buffer.from(vsixManifest(pkg, files), 'utf8') },
    ...files.map((f) => ({ name: `extension/${f}`, data: readFileSync(join(root, f)) })),
  ];
  const out = resolve(outPath || join('dist', `${pkg.publisher}.${pkg.name}-${pkg.version}.vsix`));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, createZip(entries));
  return { out, files: entries.map((e) => e.name) };
}

function main() {
  const args = process.argv.slice(2);
  /** @type {string | undefined} */ let dir;
  /** @type {string | undefined} */ let outPath;
  /** @type {string | undefined} */ let listPath;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') outPath = args[++i];
    else if (args[i] === '--list') listPath = args[++i];
    else if (!args[i].startsWith('--') && !dir) dir = args[i];
  }
  if (listPath) {
    for (const e of readZip(readFileSync(listPath))) console.log(`${String(e.data.length).padStart(9)}  ${e.name}`);
    return;
  }
  if (!dir || !existsSync(join(dir, 'package.json'))) {
    console.error('usage: pack-vsix.mjs <extension-folder> [--out file.vsix] | --list file.vsix');
    process.exit(2);
  }
  const { out, files } = pack(dir, outPath);
  console.log(`wrote ${out} (${files.length} entries)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
