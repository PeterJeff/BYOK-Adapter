// @ts-check
// Model-catalog audit for one Ask Sage instance. Zero dependencies; public,
// unauthenticated requests only (no API key is read or sent, nothing is billed).
//
// It compares three things and reports where they disagree:
//   1. what the instance declares         https://<chat host>/vars.js
//   2. what its web app would offer       allow-lists hardcoded in the chat bundle
//   3. what its API serves                POST /server/get-models?format=full (+ the
//                                         static openai/anthropic /v1/models catalogs)
//
// Usage (see phase0/probe/README.md for Windows / VS Code's bundled Node):
//   node phase0/probe/catalog-audit.mjs chat.asksage.ai
//   node phase0/probe/catalog-audit.mjs chat.<your-tenant> --alias tenant-a
//   node phase0/probe/catalog-audit.mjs --from research/live/<alias>/catalog/<date>
//
// Options:
//   --api <host>     API host, if it cannot be derived from vars.js or the chat host
//   --alias <name>   name used for the output folder; the real host names are replaced
//                    by it in everything saved (PLAN.md §6 fixture redaction)
//   --out <dir>      output folder (default research/live/<alias>/catalog/<YYYY-MM-DD>)
//   --no-save        print the report only
//   --json           print the audit as JSON instead of markdown
//   --from <dir>     re-audit saved snapshots instead of fetching

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseVarsJs, extractAllowLists, audit, renderAuditMarkdown, PROFILE_KEYS } from './lib/catalog.mjs';

const TIMEOUT_MS = 60000;

/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {{ instance?: string, api?: string, alias?: string, out?: string, from?: string, save: boolean, json: boolean }} */
  const o = { save: true, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--api') o.api = argv[++i];
    else if (a === '--alias') o.alias = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--from') o.from = argv[++i];
    else if (a === '--no-save') o.save = false;
    else if (a === '--json') o.json = true;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else if (!o.instance) o.instance = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  if (o.alias && !/^[a-z0-9][a-z0-9_-]*$/i.test(o.alias)) throw new Error('--alias may contain only letters, digits, "-" and "_"');
  return o;
}

/** @param {string} input */
export function hostOf(input) {
  const h = String(input).trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  if (!/^[a-z0-9.-]+(:\d+)?$/.test(h)) throw new Error(`not a host name: ${input}`);
  return h;
}

/**
 * The API host: vars.js REACT_APP_asksage_chat_service, else chat.X -> api.X.
 * @param {string} chatHost
 * @param {Record<string, string> | null} vars
 * @param {string | null} bundleDefault
 */
export function deriveApiHost(chatHost, vars, bundleDefault) {
  const fromVars = vars && vars.REACT_APP_asksage_chat_service;
  if (fromVars) return { host: hostOf(fromVars), via: 'vars.js REACT_APP_asksage_chat_service' };
  const guess = chatHost.startsWith('chat.') ? `api.${chatHost.slice(5)}` : null;
  if (guess) return { host: guess, via: `chat.* -> api.* (bundle default is ${bundleDefault || 'unknown'})` };
  if (bundleDefault) return { host: hostOf(bundleDefault), via: 'bundle default REACT_APP_asksage_chat_service' };
  throw new Error('cannot derive the API host; pass --api <host>');
}

/**
 * @param {string} url
 * @param {RequestInit} [init]
 */
async function get(url, init) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 200)}`);
    return text;
  } catch (e) {
    const err = /** @type {any} */ (e);
    const code = err?.cause?.code || err?.code || err?.name;
    const hint = /CERT|SELF_SIGNED|UNABLE_TO/.test(String(code))
      ? ' (TLS inspection? set NODE_EXTRA_CA_CERTS to your CA bundle, or run node with --use-system-ca)'
      : /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|UND_ERR_CONNECT|AbortError/.test(String(code))
        ? ' (behind a proxy? set HTTPS_PROXY and NODE_USE_ENV_PROXY=1)'
        : '';
    throw new Error(`${url}: ${code || ''} ${err?.message || err}${hint}`, { cause: e });
  } finally {
    clearTimeout(timer);
  }
}

/** @param {string} text */
function idsFromCatalog(text) {
  const j = JSON.parse(text);
  const data = Array.isArray(j) ? j : j.data || j.models || [];
  return data.map((/** @type {any} */ m) => (typeof m === 'string' ? m : m.id)).filter(Boolean);
}

/** @param {string} text */
function modelsFromFull(text) {
  const j = JSON.parse(text);
  const list = Array.isArray(j) ? j : j.response || j.data;
  if (!Array.isArray(list) || !list.length || typeof list[0] !== 'object') throw new Error('get-models?format=full did not return model objects (older server?)');
  return list;
}

/**
 * Replaces real host names with the alias in text that will be saved.
 * @param {string} text
 * @param {string[]} hosts
 * @param {string | undefined} alias
 */
export function redactHosts(text, hosts, alias) {
  if (!alias) return text;
  let out = text;
  for (const h of hosts.filter(Boolean).sort((a, b) => b.length - a.length)) out = out.split(h).join(`<${alias}>`);
  return out;
}

/** @param {ReturnType<typeof parseArgs>} o */
async function fetchInputs(o) {
  if (!o.instance) throw new Error('usage: catalog-audit.mjs <chat host> [--api host] [--alias name] [--out dir] [--no-save] [--json] | --from <dir>');
  const chatHost = hostOf(o.instance.replace(/^api\./, 'chat.'));
  const varsText = await get(`https://${chatHost}/vars.js`).catch((e) => {
    console.error(`warning: ${e.message}`);
    return null;
  });
  const vars = varsText ? parseVarsJs(varsText) : null;
  const html = await get(`https://${chatHost}/`).catch(() => '');
  const bundlePath = /\/assets\/index-[A-Za-z0-9_-]+\.js/.exec(html)?.[0];
  let lists = null;
  let bundleInfo = null;
  if (bundlePath) {
    const bundle = await get(`https://${chatHost}${bundlePath}`);
    lists = extractAllowLists(bundle);
    bundleInfo = { path: bundlePath, sha256: createHash('sha256').update(bundle).digest('hex'), bytes: Buffer.byteLength(bundle) };
  } else console.error('warning: chat web app bundle not found; allow-list checks skipped');

  const api = o.api ? { host: hostOf(o.api), via: '--api' } : deriveApiHost(chatHost, vars, lists?.defaultChatService ?? null);
  const base = `https://${api.host}/server`;
  const fullText = await get(`${base}/get-models?format=full`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const openaiText = await get(`${base}/openai/v1/models`).catch(() => null);
  const anthropicText = await get(`${base}/anthropic/v1/models`).catch(() => null);
  return {
    chatHost,
    apiHost: api.host,
    apiVia: api.via,
    vars,
    lists,
    bundleInfo,
    models: modelsFromFull(fullText),
    openaiIds: openaiText ? idsFromCatalog(openaiText) : null,
    anthropicIds: anthropicText ? idsFromCatalog(anthropicText) : null,
    fetchedAt: new Date().toISOString(),
  };
}

/** @param {string} dir */
function loadInputs(dir) {
  /** @param {string} f */
  const read = (f) => (existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), 'utf8')) : null);
  const meta = read('meta.json') || {};
  const models = read('get-models-full.json');
  if (!models) throw new Error(`${dir} has no get-models-full.json`);
  return {
    chatHost: meta.chatHost || '(saved)',
    apiHost: meta.apiHost || '(saved)',
    apiVia: meta.apiVia || '(saved)',
    vars: read('vars.json'),
    lists: read('webapp-allowlists.json'),
    bundleInfo: meta.bundleInfo || null,
    models,
    openaiIds: read('openai-models.json'),
    anthropicIds: read('anthropic-models.json'),
    fetchedAt: meta.fetchedAt || '(saved)',
  };
}

/**
 * @param {Awaited<ReturnType<typeof fetchInputs>>} inp
 * @param {string} dir
 * @param {string | undefined} alias
 * @param {string} markdown
 * @param {object} result
 */
function save(inp, dir, alias, markdown, result) {
  mkdirSync(dir, { recursive: true });
  const hosts = [inp.chatHost, inp.apiHost];
  /** @param {string} f @param {unknown} v */
  const put = (f, v) => writeFileSync(join(dir, f), redactHosts(typeof v === 'string' ? v : JSON.stringify(v, null, 1) + '\n', hosts, alias));
  // Only the profile-relevant runtime variables are kept.
  const all = inp.vars;
  const vars = all ? Object.fromEntries(PROFILE_KEYS.filter((k) => k in all).map((k) => [k, all[k]])) : null;
  put('meta.json', { chatHost: inp.chatHost, apiHost: inp.apiHost, apiVia: inp.apiVia, fetchedAt: inp.fetchedAt, bundleInfo: inp.bundleInfo, tool: 'phase0/probe/catalog-audit.mjs' });
  if (vars) put('vars.json', vars);
  if (inp.lists) put('webapp-allowlists.json', inp.lists);
  put('get-models-full.json', inp.models);
  if (inp.openaiIds) put('openai-models.json', inp.openaiIds);
  if (inp.anthropicIds) put('anthropic-models.json', inp.anthropicIds);
  put('audit.json', result);
  put('audit.md', markdown);
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const inp = o.from ? loadInputs(resolve(o.from)) : await fetchInputs(o);
  const label = o.alias ? `<${o.alias}>` : inp.chatHost;
  const result = audit({ host: label, models: inp.models, vars: inp.vars, lists: inp.lists, openaiIds: inp.openaiIds, anthropicIds: inp.anthropicIds });
  const sources = {
    'deployment profile': `https://${inp.chatHost}/vars.js`,
    'web app bundle': inp.bundleInfo ? `https://${inp.chatHost}${inp.bundleInfo.path} (sha256 ${inp.bundleInfo.sha256.slice(0, 16)}...)` : 'not fetched',
    'model catalog': `POST https://${inp.apiHost}/server/get-models?format=full (API host via ${inp.apiVia})`,
    fetched: inp.fetchedAt,
  };
  const markdown = renderAuditMarkdown(result, { generatedAt: inp.fetchedAt, sources });
  const hosts = [inp.chatHost, inp.apiHost];
  console.log(o.json ? redactHosts(JSON.stringify(result, null, 1), hosts, o.alias) : redactHosts(markdown, hosts, o.alias));
  if (o.save && !o.from) {
    const day = inp.fetchedAt.slice(0, 10);
    const dir = resolve(o.out || join('research', 'live', o.alias || inp.chatHost, 'catalog', day));
    save(inp, dir, o.alias, markdown, result);
    console.error(`saved snapshots and audit to ${dir}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`error: ${e.message}`);
    process.exit(1);
  });
}
