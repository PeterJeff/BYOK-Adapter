// @ts-check
// Rate-source comparison for one Ask Sage instance. Zero dependencies; nothing is billed.
//
// Compares three sources of per-model Ask Sage token rates:
//   api        POST /server/get-models?format=full → token_conversion_rate (public)
//   table      the chat web app's hardcoded rate table (public bundle); also its "legacy" list
//   tokenizer  POST /server/tokenizer with convert_to_asksage (+ completion_estimate), which
//              reproduced every measured bill on 2026-09-25 (research/rate-sources-investigation.md)
//
// The tokenizer calls are free (the used-tokens counter does not move), but they need whatever
// authentication the instance wants: ASKSAGE_API_KEY + ASKSAGE_EMAIL (JWT), or a gateway/proxy
// in front of --api that authenticates for you (then no key is needed; pass nothing).
//
// Usage:
//   node phase0/probe/rate-sources.mjs chat.asksage.ai
//   node phase0/probe/rate-sources.mjs chat.<tenant> --alias tenant-a --models 'claude|gpt-5'
//   node phase0/probe/rate-sources.mjs chat.asksage.ai --no-tokenizer        # public sources only
//
// Saved to research/live/<alias or host>/rates/<date>/: summary.md and summary.json hold ratios
// and model lists only. The absolute rates (table, legacy list, tokenizer) go to raw/, which is
// gitignored: the web app's table is not published in this repository without the author's approval.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { extractRateTable, extractLegacyConversions, bundlePath, compareToApi, ratioGroups, cacheMultipliers, tokenizerRates, ratioBetween } from './lib/webrates.mjs';
import { createClient } from './lib/client.mjs';
import { filler } from './lib/filler.mjs';
import { hostOf, redactHosts } from './catalog-audit.mjs';

const TIMEOUT_MS = 60000;
const COMPLETION_ESTIMATE = 1_000_000;
const BIG_TOKENS = 30000;

/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {{ instance?: string, api?: string, alias?: string, out?: string, models?: string, tokenizer: boolean, save: boolean }} */
  const o = { tokenizer: true, save: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--api') o.api = argv[++i];
    else if (a === '--alias') o.alias = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--models') o.models = argv[++i];
    else if (a === '--no-tokenizer') o.tokenizer = false;
    else if (a === '--no-save') o.save = false;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else if (!o.instance) o.instance = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  if (!o.instance) throw new Error('usage: rate-sources.mjs <chat host> [--api host] [--alias name] [--models regex] [--no-tokenizer] [--out dir] [--no-save]');
  if (o.alias && !/^[a-z0-9][a-z0-9_-]*$/i.test(o.alias)) throw new Error('--alias may contain only letters, digits, "-" and "_"');
  return o;
}

/** @param {string} url @param {RequestInit} [init] */
async function get(url, init) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 200)}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** @param {{ ratio: string, count: number, ids: string[] }[]} groups */
const groupLines = (groups) => groups.map((g) => `| ${g.ratio} | ${g.count} | ${g.count <= 12 ? g.ids.map((i) => `\`${i}\``).join(', ') : '(many)'} |`);

/**
 * @param {{ label: string, fetchedAt: string, bundle: { path: string, sha256: string } | null, api: ReturnType<typeof compareToApi>,
 *   legacy: ReturnType<typeof compareToApi>, tableRows: number, legacyRows: number, cache: ReturnType<typeof cacheMultipliers>,
 *   tokVsTable: ReturnType<typeof ratioBetween> | null, tokVsApi: ReturnType<typeof ratioBetween> | null, tokErrors: string[] }} r
 */
export function renderSummary(r) {
  const L = [`# Rate sources: ${r.label}`, '', `Fetched ${r.fetchedAt} by \`phase0/probe/rate-sources.mjs\`. Ratios only; absolute rates are in \`raw/\` (gitignored).`, ''];
  L.push(`Web app bundle: ${r.bundle ? `\`${r.bundle.path}\` (sha256 ${r.bundle.sha256.slice(0, 16)}…)` : 'not found'}; rate table ${r.tableRows} rows, legacy list ${r.legacyRows} rows.`, '');
  L.push('Every ratio below is source A ÷ source B, both as Ask Sage tokens per model token (prompt / completion). 1.000 means the same price.', '');
  L.push(`## API ÷ web app table (${r.api.rows.length} models; ${r.api.apiOnly} API-only, ${r.api.listOnly} table-only)`, '', '| ratio | models | which |', '|---|---|---|', ...groupLines(ratioGroups(r.api.rows)), '');
  L.push(`## API ÷ legacy list (${r.legacy.rows.length} models)`, '', '| ratio | models | which |', '|---|---|---|', ...groupLines(ratioGroups(r.legacy.rows)), '');
  if (r.tokVsTable && r.tokVsApi) {
    L.push(`## Tokenizer ÷ web app table (${r.tokVsTable.rows.length} models)`, '', '| ratio | models | which |', '|---|---|---|', ...groupLines(ratioGroups(r.tokVsTable.rows)), '');
    L.push(`## Tokenizer ÷ API (${r.tokVsApi.rows.length} models)`, '', '| ratio | models | which |', '|---|---|---|', ...groupLines(ratioGroups(r.tokVsApi.rows)), '');
  } else L.push('## Tokenizer', '', 'Not run (`--no-tokenizer`).', '');
  if (r.tokErrors.length) L.push('Tokenizer errors:', '', ...r.tokErrors.map((e) => `- ${e}`), '');
  const byMult = ratioGroups(r.cache.map((c) => ({ id: c.key, prompt: c.read, completion: c.write5m })));
  L.push(`## Cache multipliers in the web app table (${r.cache.length} rows; read / 5-minute write, × prompt price)`, '', '| read / write5m | rows | which |', '|---|---|---|', ...groupLines(byMult), '');
  return L.join('\n');
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const chatHost = hostOf(o.instance.replace(/^api\./, 'chat.'));
  const apiHost = o.api ? hostOf(o.api) : chatHost.replace(/^chat\./, 'api.');
  const fetchedAt = new Date().toISOString();
  const html = await get(`https://${chatHost}/`);
  const bp = bundlePath(html);
  const bundle = bp ? await get(`https://${chatHost}${bp}`) : '';
  const table = extractRateTable(bundle);
  const legacy = extractLegacyConversions(bundle);
  const full = JSON.parse(await get(`https://${apiHost}/server/get-models?format=full`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
  /** @type {import('./lib/webrates.mjs').ApiModel[]} */
  let models = Array.isArray(full) ? full : full.response || full.data;
  if (o.models) models = models.filter((m) => new RegExp(/** @type {string} */ (o.models)).test(m.id));

  const tableList = table.map((t) => ({ key: t.key, prompt: t.rates.prompt ?? null, completion: t.rates.completion ?? null }));
  const api = compareToApi(models, tableList);
  const leg = compareToApi(models, legacy);
  const cache = cacheMultipliers(table);

  /** @param {{ prompt?: number | null, completion?: number | null } | undefined} r */
  const inv = (r) => ({ prompt: r?.prompt ? 1 / r.prompt : null, completion: r?.completion ? 1 / r.completion : null });
  /** @type {Record<string, { prompt: number | null, completion: number | null }>} */
  const tableMult = Object.fromEntries(tableList.map((t) => [t.key, inv(t)]));
  /** @type {Record<string, { prompt: number | null, completion: number | null }>} */
  const apiMult = Object.fromEntries(models.map((m) => [m.id, { prompt: m.token_conversion_rate?.prompt || null, completion: m.token_conversion_rate?.completion || null }]));

  /** @type {Record<string, { prompt: number | null, completion: number | null, constant: number }>} */
  const tok = {};
  /** @type {string[]} */
  const tokErrors = [];
  if (o.tokenizer) {
    const key = (process.env.ASKSAGE_API_KEY || '').trim();
    const email = (process.env.ASKSAGE_EMAIL || '').trim();
    const client = createClient({ apiBase: `https://${apiHost}`, apiKey: key || undefined, email: email || undefined, noAuthHeaders: !key || !email });
    const big = filler(20260925, BIG_TOKENS);
    /** @param {object} body */
    const call = async (body) => {
      const ex = await client.call({ label: 'tokenizer', kind: 'server', path: '/server/tokenizer', body });
      const v = Number(/** @type {any} */ (ex.body)?.response);
      if (ex.error || !Number.isFinite(v)) throw new Error(ex.error ? ex.error.message : `HTTP ${ex.status}`);
      return v;
    };
    for (const m of models) {
      try {
        const tokens = await call({ content: big, model: m.id });
        const oneTokens = await call({ content: 'x', model: m.id });
        const asBig = await call({ content: big, model: m.id, convert_to_asksage: true });
        const asOne = await call({ content: 'x', model: m.id, convert_to_asksage: true });
        const asCompletion = await call({ content: 'x', model: m.id, convert_to_asksage: true, completion_estimate: COMPLETION_ESTIMATE });
        tok[m.id] = tokenizerRates({ tokens, asBig, asOne, asCompletion, completionEstimate: COMPLETION_ESTIMATE, oneTokens });
      } catch (e) {
        tokErrors.push(`\`${m.id}\`: ${/** @type {Error} */ (e).message.slice(0, 120)}`);
      }
    }
  }
  const hasTok = Object.keys(tok).length > 0;
  const label = o.alias ? `<${o.alias}>` : chatHost;
  const md = renderSummary({
    label,
    fetchedAt,
    bundle: bp ? { path: bp, sha256: createHash('sha256').update(bundle).digest('hex') } : null,
    api,
    legacy: leg,
    tableRows: table.length,
    legacyRows: legacy.length,
    cache,
    tokVsTable: hasTok ? ratioBetween(tok, tableMult) : null,
    tokVsApi: hasTok ? ratioBetween(tok, apiMult) : null,
    tokErrors,
  });
  const hosts = [chatHost, apiHost];
  console.log(redactHosts(md, hosts, o.alias));
  if (o.save) {
    const dir = resolve(o.out || join('research', 'live', o.alias || chatHost, 'rates', fetchedAt.slice(0, 10)));
    mkdirSync(join(dir, 'raw'), { recursive: true });
    /** @param {string} f @param {unknown} v */
    const put = (f, v) => writeFileSync(join(dir, f), redactHosts(typeof v === 'string' ? v : JSON.stringify(v, null, 1) + '\n', hosts, o.alias));
    put('summary.md', md);
    put('summary.json', { fetchedAt, bundle: bp, apiVsTable: api, apiVsLegacy: leg, tokenizerVsTable: hasTok ? ratioBetween(tok, tableMult) : null, tokenizerVsApi: hasTok ? ratioBetween(tok, apiMult) : null, tokErrors, cacheRows: cache.length });
    put(join('raw', 'webapp-rate-table.json'), table);
    put(join('raw', 'webapp-legacy-conversions.json'), legacy);
    if (hasTok) put(join('raw', 'tokenizer-rates.json'), tok);
    console.error(`saved to ${dir} (absolute rates only under raw/, which is gitignored)`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`error: ${e.message}`);
    process.exit(1);
  });
}
