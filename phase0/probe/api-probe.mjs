// @ts-check
// Phase 0b API probe (PLAN.md §9, tests T0–T21). Zero dependencies; runs on VS Code's
// bundled Node (ELECTRON_RUN_AS_NODE=1) or any Node 22.
//
// THIS SPENDS ASK SAGE TOKENS. It shows the plan and a pessimistic cost estimate first, and
// needs --yes (or a typed "yes") before it sends anything billable. A running estimate is
// checked against --max-spend before every request.
//
// Credentials: ASKSAGE_API_KEY and ASKSAGE_EMAIL from the environment, or --key-file/--email.
// The key is never printed or written; every fixture is redacted (PLAN.md §6) and scanned for
// the key, the access token and the tenant host before it is written.
//
// When ASKSAGE_API_KEY (or --key-file) is not set, requests are sent with no client-supplied
// credential instead of prompting for one — this assumes a gateway in front of --api adds
// authentication itself. Pass --no-auth-headers to choose that mode explicitly (for example,
// to see how the API behaves through such a gateway even though a key is also available).
//
// Usage (see phase0/probe/README.md):
//   node phase0/probe/api-probe.mjs --api api.<tenant> --alias tenant-a --dry-run
//   node phase0/probe/api-probe.mjs --api api.<tenant> --alias tenant-a --tests T0,T19,T1
//   node phase0/probe/api-probe.mjs --api api.<tenant> --alias tenant-a --yes

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createClient, compactEvents } from './lib/client.mjs';
import { createRedactor, ELIDE_CHARS, TRUNCATE_CHARS } from './lib/redact.mjs';
import { readBudget, settle } from './lib/budget.mjs';
import { estimate } from './lib/usage.mjs';
import { estTokens } from './lib/filler.mjs';
import { pickModels, parseModelOverride, ROLES } from './lib/models.mjs';
import { TESTS, DEFAULT_ORDER, closest, usageFieldReport } from './lib/tests.mjs';
import { renderSummary } from './lib/summary.mjs';

/** Pessimistic rate for a model the catalog does not price. */
const UNPRICED = { prompt: 1, completion: 5 };
/** Output tokens assumed for the pre-request spend check when no cap is sent, and the most it assumes. */
const PRECHECK_OUT = 4096;

export class SpendCapError extends Error {}

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const o = {
    /** @type {string | undefined} */ api: undefined,
    /** @type {string | undefined} */ alias: undefined,
    /** @type {string[] | null} */ tests: null,
    /** @type {string[]} */ skip: [],
    /** @type {Record<string, string>} */ models: {},
    allowNonCui: false,
    maxSpend: 60000,
    prefixTokens: 6000,
    ttlWaitS: 360,
    /** @type {string | undefined} */ dataset: undefined,
    measure: true,
    dryRun: false,
    yes: false,
    /** @type {string | undefined} */ out: undefined,
    /** @type {string | undefined} */ catalog: undefined,
    /** @type {string | undefined} */ keyFile: undefined,
    /** @type {string | undefined} */ email: undefined,
    noAuthHeaders: false,
  };
  const num = (/** @type {string} */ flag, /** @type {string | undefined} */ v) => {
    const x = Number(v);
    if (!Number.isFinite(x) || x < 0) throw new Error(`${flag} expects a non-negative number`);
    return x;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--api') o.api = next();
    else if (a === '--alias') o.alias = next();
    else if (a === '--tests') o.tests = next().split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    else if (a === '--skip') o.skip = next().split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    else if (a === '--model') parseModelOverride(o.models, next());
    else if (a === '--allow-non-cui') o.allowNonCui = true;
    else if (a === '--max-spend') o.maxSpend = num(a, next());
    else if (a === '--prefix-tokens') o.prefixTokens = num(a, next());
    else if (a === '--ttl-wait') o.ttlWaitS = num(a, next());
    else if (a === '--dataset') o.dataset = next();
    else if (a === '--no-measure') o.measure = false;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--yes') o.yes = true;
    else if (a === '--out') o.out = next();
    else if (a === '--catalog') o.catalog = next();
    else if (a === '--key-file') o.keyFile = next();
    else if (a === '--email') o.email = next();
    else if (a === '--no-auth-headers') o.noAuthHeaders = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.api) throw new Error('--api <api host> is required (for example api.asksage.ai, or your tenant\'s API host)');
  if (!o.alias) throw new Error('--alias <name> is required: fixtures replace the tenant host with it (PLAN.md §6)');
  o.api = String(o.api).trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  if (!/^[a-z0-9.-]+(:\d+)?$/.test(o.api)) throw new Error(`--api is not a host name: ${o.api}`);
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(o.alias)) throw new Error('--alias may contain only letters, digits, "-" and "_"');
  if (o.prefixTokens < 4500) throw new Error('--prefix-tokens must be at least 4500 (Claude Haiku 4.5 does not cache prefixes under 4096 tokens)');
  const known = new Set(TESTS.map((t) => t.id));
  for (const t of [...(o.tests || []), ...o.skip]) if (!known.has(t)) throw new Error(`unknown test ${t}; known: ${[...known].join(', ')}`);
  return { ...o, api: o.api, alias: o.alias };
}

/**
 * @param {string[] | null} only
 * @param {string[]} skip
 * @param {boolean} measure
 */
export function selectTests(only, skip, measure) {
  const byId = new Map(TESTS.map((t) => [t.id, t]));
  const ids = DEFAULT_ORDER.filter((id) => (only ? only.includes(id) : !byId.get(id)?.optIn) && !skip.includes(id));
  // T14 is derived from every exchange; T0 provides the access token check. Keep T0 first when present.
  return ids.map((id) => /** @type {import('./lib/tests.mjs').TestDef} */ (byId.get(id))).filter((t) => measure || !t.needsMeasure || (only && only.includes(t.id)));
}

/**
 * Pessimistic plan: every input token at the prompt rate, every allowed output token at the
 * completion rate.
 * @param {import('./lib/tests.mjs').TestDef[]} tests
 * @param {Record<string, import('./lib/models.mjs').CatalogModel | null>} models
 * @param {{ prefixTokens: number, ttlWaitS: number, measure: boolean, dataset?: string }} options
 */
export function planCost(tests, models, options) {
  const rows = [];
  let total = 0;
  for (const t of tests) {
    const missing = t.needs.filter((r) => !models[r]);
    if (missing.length || t.manual) {
      rows.push({ id: t.id, title: t.title, requests: 0, cost: 0, note: t.manual ? 'manual' : `skipped: no model for ${missing.join(', ')}` });
      continue;
    }
    let cost = 0;
    const est = t.estimate(models, /** @type {any} */ (options));
    for (const e of est) {
      const rate = models[e.role]?.token_conversion_rate || UNPRICED;
      cost += e.inTokens * (rate.prompt || UNPRICED.prompt) + e.outTokens * (rate.completion || UNPRICED.completion);
    }
    total += cost;
    rows.push({ id: t.id, title: t.title, requests: est.length, cost: Math.round(cost), note: '' });
  }
  return { rows, total: Math.round(total) };
}

/**
 * Rough pre-request cost for the spend cap.
 * @param {unknown} body
 * @param {{ prompt?: number, completion?: number } | null | undefined} rate
 */
export function preEstimate(body, rate) {
  const b = /** @type {any} */ (body) || {};
  const r = rate && rate.prompt ? rate : UNPRICED;
  const out = Math.min(PRECHECK_OUT, Number(b.max_tokens ?? b.max_completion_tokens ?? b.max_output_tokens ?? b.generationConfig?.maxOutputTokens ?? PRECHECK_OUT) || PRECHECK_OUT);
  return estTokens(JSON.stringify(b)) * (r.prompt || 0) + out * (r.completion || 0);
}

/** @param {string} s */
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'x';

/**
 * Runs the selected tests. Everything external is injected so tests can drive it.
 * @param {{ args: ReturnType<typeof parseArgs>, apiKey: string, email: string, noAuthHeaders?: boolean,
 *   catalog: import('./lib/models.mjs').CatalogModel[], fetchImpl?: typeof fetch,
 *   sleep?: (ms: number) => Promise<void>, outDir: string, log?: (s: string) => void,
 *   runId?: string }} p
 */
export async function runProbe(p) {
  const { args } = p;
  const log = p.log || ((s) => console.error(s));
  const sleep = p.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const runId = p.runId || `${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}-${randomBytes(3).toString('hex')}`;
  const { models } = pickModels(p.catalog, { overrides: args.models, allowNonCui: args.allowNonCui });
  const tests = selectTests(args.tests, args.skip, args.measure);
  const redactor = createRedactor({ secrets: [p.apiKey, p.email], hosts: [args.api, args.api.replace(/^api\./, 'chat.'), args.api.replace(/^api\./, '')], alias: args.alias });
  const client = createClient({ apiBase: `https://${args.api}`, apiKey: p.apiKey, email: p.email, fetchImpl: p.fetchImpl, noAuthHeaders: p.noAuthHeaders });
  const rateOf = (/** @type {string | undefined} */ id) => (id ? p.catalog.find((m) => m.id === id)?.token_conversion_rate : null) || null;
  mkdirSync(p.outDir, { recursive: true });

  /** @type {import('./lib/client.mjs').Exchange[]} */
  const exchanges = [];
  /** @type {any[]} */
  const measurements = [];
  /** @type {import('./lib/summary.mjs').TestResult[]} */
  const results = [];
  let spent = 0;
  let seq = 0;
  let settleOpts = { pollMs: 5000, maxMs: 60000 };
  /** @type {Record<string, any>} */
  const shared = {};
  /** @type {import('./lib/summary.mjs').TestResult | null} */
  let current = null;
  const startedAt = new Date().toISOString();

  /** @param {import('./lib/client.mjs').Exchange} ex */
  const write = (ex) => {
    if (!current) return;
    redactor.addSecret(client.currentToken());
    seq++;
    current.exchanges++;
    const est = ex.norm ? estimate(ex.norm, rateOf(ex.model)) : null;
    const rec = {
      test: current.id,
      seq,
      label: ex.label,
      kind: ex.kind,
      model: ex.model ?? null,
      resolvedModel: ex.resolvedModel,
      method: ex.method,
      path: ex.path,
      stream: ex.stream,
      startedAt: ex.startedAt,
      ms: ex.ms,
      ttftMs: ex.ttftMs,
      aborted: ex.aborted,
      request: redactor.value(ex.request, { elide: ELIDE_CHARS }),
      status: ex.status,
      contentType: ex.contentType,
      headers: ex.headers,
      error: ex.error,
      transportError: ex.transportError,
      usage: ex.usage,
      normalized: ex.norm,
      estimate: est,
      body: redactor.value(ex.body, { truncate: TRUNCATE_CHARS }),
      events: redactor.value(compactEvents(ex.events), { truncate: TRUNCATE_CHARS }),
    };
    const dir = join(p.outDir, current.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${String(seq).padStart(3, '0')}-${slug(ex.label)}.json`), redactor.serialize(rec));
  };

  /** @type {import('./lib/tests.mjs').Ctx['call']} */
  const call = async (o, extra = {}) => {
    const billable = ['M', 'CC', 'R', 'G', 'N'].includes(o.kind) && o.auth !== 'bad' && !/count_tokens$/.test(o.path);
    if (billable) {
      const pre = preEstimate(o.body, rateOf(o.model));
      if (spent + pre > args.maxSpend) throw new SpendCapError(`spend cap: estimated ${Math.round(spent)} spent + ${Math.round(pre)} for "${o.label}" exceeds --max-spend ${args.maxSpend}`);
    }
    const ex = await client.call(o);
    redactor.addSecret(client.currentToken());
    if (billable) {
      const est = ex.norm ? estimate(ex.norm, rateOf(o.model) || UNPRICED) : null;
      spent += est ? est.full : ex.error || ex.transportError ? 0 : preEstimate(o.body, rateOf(o.model));
    }
    exchanges.push(ex);
    if (extra.transform) extra.transform(ex);
    if (extra.record !== false) write(ex);
    const tag = ex.error || ex.transportError ? ` ERROR ${ex.error?.message || ex.transportError?.[0]?.code || ''}`.slice(0, 120) : '';
    log(`  ${current?.id} ${ex.label}: HTTP ${ex.status ?? '-'} ${ex.ms} ms${ex.norm ? ` in=${ex.norm.inputUncached} read=${ex.norm.cacheRead} write=${ex.norm.cacheWrite5m + ex.norm.cacheWrite1h + ex.norm.cacheWriteUnsplit} out=${ex.norm.visibleOutput + ex.norm.thinking}` : ''}${tag}`);
    return ex;
  };

  /** @type {import('./lib/tests.mjs').Ctx} */
  const ctx = {
    runId,
    models,
    catalog: p.catalog,
    options: { prefixTokens: args.prefixTokens, ttlWaitS: args.ttlWaitS, dataset: args.dataset, measure: args.measure },
    call,
    record: (ex) => write(ex),
    async measure(label, fn) {
      if (!args.measure) return { result: await fn(), measured: null };
      const before = await readBudget(client);
      const start = exchanges.length;
      const result = await fn();
      const s = await settle(client, before, { ...settleOpts, sleep });
      const billed = exchanges.slice(start).filter((ex) => ex.norm);
      /** @type {{ discounted: number, full: number, inverse: number } | null} */
      let est = null;
      for (const ex of billed) {
        const e = estimate(ex.norm, rateOf(ex.model));
        if (!e) continue;
        est = est ? { discounted: est.discounted + e.discounted, full: est.full + e.full, inverse: est.inverse + e.inverse } : { discounted: e.discounted, full: e.full, inverse: e.inverse };
      }
      const measured = { label, usedDelta: s.usedDelta, leftDelta: s.leftDelta, settled: s.settled, firstMoveMs: s.firstMoveMs, est, closest: est && s.usedDelta ? closest(s.usedDelta, est) : null };
      measurements.push({ test: current?.id, ...measured, polls: s.polls });
      return { result, measured };
    },
    check: (name, result, detail) => current?.checks.push({ name, result, ...(detail ? { detail: redactor.text(detail) } : {}) }),
    observe: (key, value) => {
      if (current) current.observations[key] = redactor.value(value, { truncate: TRUNCATE_CHARS });
    },
    sleep,
    log,
    client,
    setSettle: (o) => (settleOpts = { ...settleOpts, ...o }),
    shared,
  };

  const budgetBefore = args.measure ? await safeBudget(client) : null;
  /** @type {string | null} */
  let stoppedBy = null;
  for (const t of tests) {
    current = { id: t.id, title: t.title, status: 'ok', checks: [], observations: {}, exchanges: 0 };
    results.push(current);
    const missing = t.needs.filter((r) => !models[r]);
    if (stoppedBy) {
      current.status = 'skipped';
      current.reason = 'run stopped';
      continue;
    }
    if (missing.length) {
      current.status = 'skipped';
      current.reason = `no model for ${missing.join(', ')} (use --model ${missing[0]}=<id>)`;
      continue;
    }
    log(`${t.id}: ${t.title}`);
    try {
      await t.run(ctx);
    } catch (e) {
      const err = /** @type {Error} */ (e);
      current.status = 'error';
      current.reason = redactor.text(err.message || String(err));
      log(`  ${t.id} failed: ${current.reason}`);
      if (err instanceof SpendCapError) stoppedBy = current.reason;
      else if (t.id === 'T0' && !client.hasJwt()) stoppedBy = `T0 could not obtain an access token: ${current.reason}`;
    }
  }
  current = null;
  const budgetAfter = args.measure ? await safeBudget(client) : null;

  /** @type {Map<string, { requested: string, served: string, count: number }>} */
  const served = new Map();
  for (const ex of exchanges) {
    if (!ex.model || !ex.norm || ex.error) continue;
    const k = `${ex.model}\u0000${ex.resolvedModel}`;
    const row = served.get(k) || { requested: ex.model, served: ex.resolvedModel || '', count: 0 };
    row.count++;
    served.set(k, row);
  }
  const usageFields = usageFieldReport(exchanges);
  const t14 = results.find((r) => r.id === 'T14');
  if (t14) t14.observations.usageFields = usageFields;

  const run = {
    alias: args.alias,
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    apiVia: '--api',
    models: Object.fromEntries(Object.entries(models).map(([k, m]) => [k, m ? { id: m.id, token_conversion_rate: m.token_conversion_rate ?? null, cui_capable: m.cui_capable ?? null } : null])),
    options: { tests: tests.map((t) => t.id), maxSpend: args.maxSpend, prefixTokens: args.prefixTokens, ttlWaitS: args.ttlWaitS, measure: args.measure, allowNonCui: args.allowNonCui, dataset: args.dataset ? '<given>' : null },
    budget: args.measure ? { before: budgetBefore, after: budgetAfter } : null,
    spentEstimate: spent,
    maxSpend: args.maxSpend,
    results,
    measurements,
    usageFields,
    servedModels: [...served.values()],
    stoppedBy,
    tool: 'phase0/probe/api-probe.mjs',
  };
  writeFileSync(join(p.outDir, 'summary.json'), redactor.serialize(run));
  const md = redactor.assertClean(redactor.text(renderSummary(/** @type {any} */ (run))));
  writeFileSync(join(p.outDir, 'summary.md'), md);
  return { run, summaryPath: join(p.outDir, 'summary.md') };
}

/** @param {ReturnType<typeof createClient>} client */
async function safeBudget(client) {
  try {
    const r = await readBudget(client);
    return { used: r.used, left: r.left };
  } catch {
    return null;
  }
}

/**
 * @param {string} apiHost
 * @param {string | undefined} file
 */
async function loadCatalog(apiHost, file) {
  const text = file
    ? readFileSync(file, 'utf8')
    : await (await fetch(`https://${apiHost}/server/get-models?format=full`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).text();
  const j = JSON.parse(text);
  const list = Array.isArray(j) ? j : j.response || j.data;
  if (!Array.isArray(list) || !list.length || typeof list[0] !== 'object') throw new Error('get-models?format=full did not return model objects');
  return /** @type {import('./lib/models.mjs').CatalogModel[]} */ (list);
}

/**
 * Reads a line without echoing it (for the API key). Falls back to a plain read when stdin
 * is not a terminal (then nothing is echoed anyway).
 * @param {string} prompt
 * @param {boolean} hidden
 */
function ask(prompt, hidden) {
  return new Promise((res, rej) => {
    const stdin = process.stdin;
    process.stderr.write(prompt);
    let buf = '';
    const raw = hidden && stdin.isTTY;
    if (raw) stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    /** @param {string} chunk */
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\u0003') {
          cleanup();
          rej(new Error('cancelled'));
          return;
        }
        if (ch === '\r' || ch === '\n') {
          cleanup();
          process.stderr.write('\n');
          res(buf.trim());
          return;
        }
        if (ch === '\u007f' || ch === '\b') buf = buf.slice(0, -1);
        else buf += ch;
      }
    };
    const cleanup = () => {
      stdin.off('data', onData);
      if (raw) stdin.setRawMode(false);
      stdin.pause();
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const catalog = await loadCatalog(args.api, args.catalog);
  const { models, notes } = pickModels(catalog, { overrides: args.models, allowNonCui: args.allowNonCui });
  const tests = selectTests(args.tests, args.skip, args.measure);
  const plan = planCost(tests, models, args);

  const out = [];
  out.push(`Ask Sage API probe, tenant <${args.alias}>`, '', 'Models:');
  for (const [role, m] of Object.entries(models)) out.push(`  ${role.padEnd(9)} ${m ? `${m.id} (prompt ${m.token_conversion_rate?.prompt ?? '?'}, completion ${m.token_conversion_rate?.completion ?? '?'})` : '-'}   ${ROLES[role].purpose}`);
  for (const nte of notes) out.push(`  note: ${nte}`);
  out.push('', 'Tests (pessimistic Ask Sage token estimate):');
  for (const r of plan.rows) out.push(`  ${r.id.padEnd(4)} ${String(r.cost).padStart(8)}  ${r.requests ? `${r.requests} billed request(s)` : ''} ${r.title}${r.note ? ` [${r.note}]` : ''}`);
  out.push(`  total ${plan.total} (cap --max-spend ${args.maxSpend})`);
  if (args.measure) out.push('', 'Budget measurement is on: each measured step polls the counters until they settle (slow; --no-measure to skip).', 'Do not use Ask Sage elsewhere (web app, other windows) while this runs; it would pollute the deltas.');
  if (tests.some((t) => t.id === 'T15') && args.ttlWaitS > 0) out.push(`T15 waits ${args.ttlWaitS} s to test TTL expiry (--ttl-wait 0 to skip).`);
  console.log(out.join('\n'));
  if (args.dryRun) return;
  if (plan.total > args.maxSpend) throw new Error(`the plan's estimate (${plan.total}) exceeds --max-spend (${args.maxSpend}); raise the cap or run fewer tests`);

  if (!args.yes) {
    const a = await ask('\nType "yes" to run and spend tokens: ', false);
    if (a.toLowerCase() !== 'yes') {
      console.error('not confirmed; nothing was sent');
      return;
    }
  }
  const keySource = (args.keyFile ? readFileSync(args.keyFile, 'utf8') : process.env.ASKSAGE_API_KEY || '').trim();
  const noAuthHeaders = args.noAuthHeaders || !keySource;
  let apiKey = '';
  let email = '';
  if (noAuthHeaders) {
    console.log(
      args.noAuthHeaders
        ? '\n--no-auth-headers: requests carry no client-supplied credential; a gateway in front of --api is assumed to authenticate them.'
        : '\nNo ASKSAGE_API_KEY (or --key-file) in the environment; running with no client-supplied credential, as if a gateway in front of --api authenticates requests itself. Set the key (or pass --key-file/--email) to authenticate directly instead.',
    );
  } else {
    apiKey = keySource;
    email = (args.email || process.env.ASKSAGE_EMAIL || '').trim();
    if (!/^\S{32,}$/.test(apiKey)) throw new Error('that does not look like an API key');
    if (email && !/@/.test(email)) throw new Error('that does not look like an email address');
    if (!email) {
      console.log(
        '\nNo ASKSAGE_EMAIL (or --email): running key-only. M/CC/R/G model-call tests (T1-T9, T11, T15-T18, T20) ' +
          'authenticate fine with just the API key. Budget/counter and native-query checks (T0’s budget bits, ' +
          'T19, T21) need the email-based access token and will show as auth errors.',
      );
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  const probeRunId = `${new Date().toISOString().slice(11, 16).replace(':', '')}-${randomBytes(3).toString('hex')}`;
  const outDir = resolve(args.out || join('research', 'live', args.alias, 'probe', `${date}-${probeRunId}`));
  const { summaryPath, run } = await runProbe({ args, apiKey, email, noAuthHeaders, catalog, outDir, runId: probeRunId });
  const counts = { pass: 0, fail: 0, other: 0 };
  for (const r of run.results) for (const c of r.checks) c.result === 'pass' ? counts.pass++ : c.result === 'fail' ? counts.fail++ : counts.other++;
  console.log(`\nDone. ${counts.pass} pass, ${counts.fail} fail, ${counts.other} informational. Estimated spend ${Math.round(run.spentEstimate)}.`);
  if (run.stoppedBy) console.log(`Stopped early: ${run.stoppedBy}`);
  console.log(`Summary: ${summaryPath}`);
  console.log('Review the fixtures before committing them (they are redacted, but check for anything tenant-specific).');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`error: ${e.message}`);
    process.exit(1);
  });
}
