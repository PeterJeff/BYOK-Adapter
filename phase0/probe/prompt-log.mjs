// @ts-check
// Reads the caller's recent Ask Sage prompt log (POST /user/get-user-logs) and prints only the
// billing numbers per request: id, time, model, prompt/completion tokens and total_tokens (the
// bill). Free: it sends no model request. Made for manual runs such as T12, whose traffic
// bypasses the extension's ledger. Prompt and response text are dropped on receipt and never
// printed or saved (lib/billing.mjs logNumbers).
//
//   ASKSAGE_API_KEY=... ASKSAGE_EMAIL=... node phase0/probe/prompt-log.mjs --api api.asksage.ai [--since 2026-09-27T23:05:00Z] [--limit 100] [--json]
//
// On VS Code's bundled Node: ELECTRON_RUN_AS_NODE=1 <Code executable> phase0/probe/prompt-log.mjs ...

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from './lib/client.mjs';
import { rowsSince } from './lib/billing.mjs';

/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {{ api?: string, since?: string, limit: number, json: boolean }} */
  const o = { limit: 50, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--api') o.api = argv[++i];
    else if (a === '--since') o.since = argv[++i];
    else if (a === '--limit') o.limit = Number(argv[++i]);
    else if (a === '--json') o.json = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.api) throw new Error('usage: prompt-log.mjs --api <host> [--since <ISO time>] [--limit 1..100] [--json]');
  if (!(o.limit >= 1 && o.limit <= 100)) throw new Error('--limit must be 1..100 (the endpoint caps it at 100)');
  if (o.since && Number.isNaN(Date.parse(o.since))) throw new Error(`--since is not a date: ${o.since}`);
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const key = (process.env.ASKSAGE_API_KEY || '').trim();
  const email = (process.env.ASKSAGE_EMAIL || '').trim();
  if (!key || !email) throw new Error('set ASKSAGE_API_KEY and ASKSAGE_EMAIL (the prompt log needs an access token)');
  const client = createClient({ apiBase: `https://${o.api}`, apiKey: key, email });
  const ex = await client.call({ label: 'get-user-logs', kind: 'user', path: '/user/get-user-logs', body: { limit: o.limit } });
  const response = /** @type {any} */ (ex.body)?.response;
  if (!Array.isArray(response)) throw new Error(`cannot read the prompt log: HTTP ${ex.status}${ex.error ? ` ${ex.error.message}` : ''}`);
  const { rows, byModel } = rowsSince(response, o.since);
  if (o.json) {
    console.log(JSON.stringify({ since: o.since ?? null, rows, byModel }, null, 1));
    return;
  }
  console.log('| id | time | model | prompt | completion | billed |');
  console.log('|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.id} | ${r.date_time ?? ''} | ${r.model} | ${r.prompt_tokens} | ${r.completion_tokens} | ${r.total_tokens} |`);
  console.log('');
  for (const [m, t] of Object.entries(byModel)) console.log(`${m}: ${t.requests} requests, ${t.prompt_tokens} prompt, ${t.completion_tokens} completion, ${t.total_tokens} billed`);
  if (response.length === o.limit && rows.length === response.length) console.log(`\n(all ${o.limit} rows fetched are in range; raise --limit or narrow --since if the run is longer)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`error: ${e.message}`);
    process.exit(1);
  });
}
