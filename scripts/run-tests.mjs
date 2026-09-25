// @ts-check
// Runs every test/**/*.test.{js,cjs,mjs} with node:test. Importing the files is
// enough: node:test runs registered tests and sets the exit code. Works under a
// plain `node` and under VS Code's bundled Node (ELECTRON_RUN_AS_NODE=1), where
// the `--test` flag may not be available.
//
//   node scripts/run-tests.mjs [filter]

import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const filter = process.argv[2] || '';

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  return readdirSync(dir).sort().flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(join(root, 'test')).filter((f) => /\.test\.(c?js|mjs)$/.test(f) && f.includes(filter));
if (files.length === 0) {
  console.error(`no test files match "${filter}"`);
  process.exit(1);
}
for (const f of files) await import(pathToFileURL(f).href);
