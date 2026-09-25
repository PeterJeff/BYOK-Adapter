// @ts-check
// Billing probe: sends small, synthetic requests and reads each one's exact bill back from the
// prompt log (POST /user/get-user-logs), then compares it with the rates the tokenizer reports
// (POST /server/tokenizer, convert_to_asksage) and the measured cache rules in lib/billing.mjs.
// This is how research/rate-sources-investigation.md was measured; run it on any tenant to check
// that its billing matches (PLAN.md §9 Phase 0c).
//
// THIS SPENDS ASK SAGE TOKENS (the default set is about 9k on the test tenant's rates). Without
// --yes it prints the plan and stops. Close the web app and other windows while it runs: the
// prompt log is per user, and another request in the same seconds would be attributed wrongly.
//
// Credentials as for api-probe.mjs: ASKSAGE_API_KEY + ASKSAGE_EMAIL (the prompt log and the
// tokenizer need the access token), or nothing when a gateway/proxy in front of --api adds it.
//
// Usage:
//   node phase0/probe/billing-probe.mjs --api api.<tenant> --alias tenant-a              # plan only
//   node phase0/probe/billing-probe.mjs --api api.<tenant> --alias tenant-a --yes
//   node phase0/probe/billing-probe.mjs ... --experiments cache,loop --model claude=google-claude-46-sonnet --yes
//
// Output: research/live/<alias>/billing/<date>-<run>/results.json and summary.md. Only usage
// numbers and prompt-log numbers are saved: no prompt or response text, no log or user ids.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createClient } from './lib/client.mjs';
import { filler } from './lib/filler.mjs';
import { tokenizerRates } from './lib/webrates.mjs';
import { rowsAfter, maxLogId, cacheRule, expectedBill, verdict } from './lib/billing.mjs';

const EXPERIMENTS = ['rates', 'cache', 'loop', 'ttl'];
const DEFAULT_MODELS = { claude: 'google-claude-45-haiku', gpt: 'gpt-5.6-luna', gptnano: 'gpt-5.4-nano', gemini: 'google-gemini-3.1-flash-lite-gov' };
const AV = { 'anthropic-version': '2023-06-01' };
const PATHS = { M: '/server/anthropic/v1/messages', CC: '/server/openai/v1/chat/completions', R: '/server/openai/v1/responses' };

/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {{ api?: string, alias?: string, out?: string, yes: boolean, experiments: string[], models: Record<string, string>, prefixTokens: number, ttlWaitMin: number }} */
  const o = { yes: false, experiments: ['rates', 'cache', 'loop'], models: { ...DEFAULT_MODELS }, prefixTokens: 5000, ttlWaitMin: 7 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--api') o.api = argv[++i];
    else if (a === '--alias') o.alias = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--yes') o.yes = true;
    else if (a === '--experiments') o.experiments = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--model') {
      const [role, id] = String(argv[++i]).split('=');
      if (!(role in DEFAULT_MODELS) || !id) throw new Error(`--model takes role=id with role one of ${Object.keys(DEFAULT_MODELS).join(', ')}`);
      o.models[role] = id;
    } else if (a === '--prefix-tokens') o.prefixTokens = Number(argv[++i]);
    else if (a === '--ttl-wait') o.ttlWaitMin = Number(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.api || !o.alias) throw new Error('usage: billing-probe.mjs --api <host> --alias <name> [--experiments rates,cache,loop,ttl] [--model role=id] [--prefix-tokens n] [--ttl-wait min] [--yes]');
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(o.alias)) throw new Error('--alias may contain only letters, digits, "-" and "_"');
  for (const e of o.experiments) if (!EXPERIMENTS.includes(e)) throw new Error(`unknown experiment ${e}; choose from ${EXPERIMENTS.join(', ')}`);
  if (!(o.prefixTokens >= 1100)) throw new Error('--prefix-tokens must be at least 1100 (OpenAI caches from 1,024 tokens; Haiku 4.5 from 4,096)');
  return o;
}

/**
 * The requests each experiment sends, as { name, flavor, model, body, headers? , waitMin? }.
 * @param {ReturnType<typeof parseArgs>} o
 * @param {string} run
 */
export function buildPlan(o, run) {
  const m = o.models;
  /** @param {string} tag @param {number} [n] */
  const pre = (tag, n = o.prefixTokens) => `[billing-probe ${run} ${tag}] Reference material follows.\n\n` + filler([...tag].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7), n);
  const ok = 'Reply with exactly: OK';
  const story = 'Write a 400-word short story about a lighthouse keeper who collects lost umbrellas.';
  /** @type {{ experiment: string, name: string, flavor: 'M' | 'CC' | 'R' | 'G', model: string, body: any, headers?: Record<string, string>, waitMin?: number }[]} */
  const plan = [];
  const cc = (model, messages, extra = {}) => ({ model, max_completion_tokens: 1500, ...(/gpt-5|gpt-6/.test(model) ? { reasoning_effort: 'low' } : {}), messages, ...extra });
  const g = (text, max = 1200) => ({ contents: [{ role: 'user', parts: [{ text }] }], generationConfig: { maxOutputTokens: max } });
  if (o.experiments.includes('rates')) {
    plan.push({ experiment: 'rates', name: 'claude prompt-heavy', flavor: 'M', model: m.claude, headers: AV, body: { model: m.claude, max_tokens: 16, messages: [{ role: 'user', content: pre('rp-c') + '\n' + ok }] } });
    plan.push({ experiment: 'rates', name: 'claude output-heavy', flavor: 'M', model: m.claude, headers: AV, body: { model: m.claude, max_tokens: 700, messages: [{ role: 'user', content: story }] } });
    for (const k of ['gpt', 'gptnano']) {
      plan.push({ experiment: 'rates', name: `${k} prompt-heavy`, flavor: 'CC', model: m[k], body: cc(m[k], [{ role: 'user', content: pre(`rp-${k}`, 1000) + '\n' + ok }]) });
      plan.push({ experiment: 'rates', name: `${k} output-heavy`, flavor: 'CC', model: m[k], body: cc(m[k], [{ role: 'user', content: story }]) });
    }
    plan.push({ experiment: 'rates', name: 'gemini prompt-heavy', flavor: 'G', model: m.gemini, body: g(pre('rp-g') + '\n' + ok, 50) });
    plan.push({ experiment: 'rates', name: 'gemini output-heavy', flavor: 'G', model: m.gemini, body: g(story) });
  }
  if (o.experiments.includes('cache')) {
    const sys5 = [{ type: 'text', text: pre('c-m5'), cache_control: { type: 'ephemeral' } }];
    for (const i of [1, 2]) plan.push({ experiment: 'cache', name: `M 5m #${i}`, flavor: 'M', model: m.claude, headers: AV, body: { model: m.claude, max_tokens: 8, system: sys5, messages: [{ role: 'user', content: ok }] } });
    const sys1 = [{ type: 'text', text: pre('c-m1h'), cache_control: { type: 'ephemeral', ttl: '1h' } }];
    for (const i of [1, 2]) plan.push({ experiment: 'cache', name: `M 1h #${i}`, flavor: 'M', model: m.claude, headers: AV, body: { model: m.claude, max_tokens: 8, system: sys1, messages: [{ role: 'user', content: ok }] } });
    const sysNo = pre('c-mno');
    for (const i of [1, 2]) plan.push({ experiment: 'cache', name: `M no cache_control #${i}`, flavor: 'M', model: m.claude, headers: AV, body: { model: m.claude, max_tokens: 8, system: sysNo, messages: [{ role: 'user', content: ok }] } });
    for (const k of ['gpt', 'gptnano']) {
      const sys = pre(`c-${k}`);
      for (const i of [1, 2, 3]) plan.push({ experiment: 'cache', name: `CC ${k} #${i}`, flavor: 'CC', model: m[k], body: cc(m[k], [{ role: 'system', content: sys }, { role: 'user', content: ok }], { prompt_cache_key: `billing-probe-${run}-${k}`, max_completion_tokens: 200 }) });
    }
    const rsys = pre('c-r');
    for (const i of [1, 2]) plan.push({ experiment: 'cache', name: `R gpt #${i}`, flavor: 'R', model: m.gpt, body: { model: m.gpt, store: false, max_output_tokens: 200, reasoning: { effort: 'low' }, prompt_cache_key: `billing-probe-${run}-r`, instructions: rsys, input: ok } });
    const gsys = pre('c-g');
    for (const i of [1, 2]) plan.push({ experiment: 'cache', name: `G gemini #${i}`, flavor: 'G', model: m.gemini, body: { systemInstruction: { parts: [{ text: gsys }] }, ...g(ok, 50) } });
    plan.push({ experiment: 'cache', name: 'CC claude (billed at all?)', flavor: 'CC', model: m.claude, body: { model: m.claude, max_tokens: 8, messages: [{ role: 'system', content: pre('c-ccc', 1200) }, { role: 'user', content: ok }] } });
  }
  if (o.experiments.includes('loop')) {
    const tools = Array.from({ length: 8 }, (_, i) => ({ name: `tool_${i}`, description: filler(900 + i, 120), input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }));
    for (const variant of ['uncached', 'cached']) {
      const sys = pre(`loop-${variant}`, 4500);
      /** @type {any[]} */
      const history = [{ role: 'user', content: [{ type: 'text', text: 'Investigate the repository. ' + ok }] }];
      for (let round = 1; round <= 6; round++) {
        const msgs = JSON.parse(JSON.stringify(history));
        const tl = JSON.parse(JSON.stringify(tools));
        /** @type {any} */
        let system = sys;
        if (variant === 'cached') {
          tl[tl.length - 1].cache_control = { type: 'ephemeral' };
          system = [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }];
          for (const x of msgs.slice(-2)) x.content[x.content.length - 1].cache_control = { type: 'ephemeral' };
        }
        plan.push({ experiment: 'loop', name: `loop ${variant} round ${round}`, flavor: 'M', model: m.claude, headers: AV, body: { model: m.claude, max_tokens: 8, system, tools: tl, messages: msgs } });
        const id = `toolu_${run}_${variant}_${round}`;
        history.push({ role: 'assistant', content: [{ type: 'tool_use', id, name: `tool_${round % 8}`, input: { path: `src/file${round}.js` } }] });
        history.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: filler(1000 + round, 1500) }, { type: 'text', text: 'Continue. ' + ok }] });
      }
    }
  }
  if (o.experiments.includes('ttl')) {
    const s5 = [{ type: 'text', text: pre('t-m5'), cache_control: { type: 'ephemeral' } }];
    const s1 = [{ type: 'text', text: pre('t-m1h'), cache_control: { type: 'ephemeral', ttl: '1h' } }];
    const gsys = pre('t-gpt');
    const req = (/** @type {any} */ sys, /** @type {string} */ name, /** @type {number} */ waitMin) => ({ experiment: 'ttl', name, flavor: /** @type {const} */ ('M'), model: m.claude, headers: AV, waitMin, body: { model: m.claude, max_tokens: 8, system: sys, messages: [{ role: 'user', content: ok }] } });
    plan.push(req(s5, 'TTL 5m write', 0), req(s1, 'TTL 1h write', 0));
    plan.push({ experiment: 'ttl', name: 'TTL gpt write', flavor: 'CC', model: m.gpt, body: cc(m.gpt, [{ role: 'system', content: gsys }, { role: 'user', content: ok }], { prompt_cache_key: `billing-probe-${run}-ttl`, max_completion_tokens: 200 }) });
    plan.push(req(s5, `TTL 5m after ${o.ttlWaitMin} min`, o.ttlWaitMin), req(s1, `TTL 1h after ${o.ttlWaitMin} min`, 0));
    plan.push({ experiment: 'ttl', name: `TTL gpt after ${o.ttlWaitMin} min`, flavor: 'CC', model: m.gpt, body: cc(m.gpt, [{ role: 'system', content: gsys }, { role: 'user', content: ok }], { prompt_cache_key: `billing-probe-${run}-ttl`, max_completion_tokens: 200 }) });
  }
  return plan;
}

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @param {any[]} results */
export function renderSummary(results, meta) {
  const L = [`# Billing probe: <${meta.alias}>`, '', `Run \`${meta.run}\`, ${meta.startedAt} to ${meta.endedAt}. Generated by \`phase0/probe/billing-probe.mjs\`.`, ''];
  L.push('`billed` is the prompt-log row\'s `total_tokens`; `expected` uses the tokenizer\'s rates and the cache rules in `lib/billing.mjs` (before the +1..5 per-request constant).', '');
  L.push('| experiment | request | flavor | model (logged) | uncached / read / write / out | billed | expected | verdict |', '|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const z = r.norm;
    const b = z ? `${z.inputUncached} / ${z.cacheRead} / ${z.cacheWrite5m + z.cacheWriteUnsplit + z.cacheWrite1h} / ${z.visibleOutput + z.thinking}` : '-';
    L.push(`| ${r.experiment} | ${r.name} | ${r.flavor} | \`${r.log?.model ?? r.model}\` | ${b} | ${r.log?.total_tokens ?? (r.logRows === 0 ? 'no row' : '-')} | ${r.expected ?? '-'} | ${r.verdict}${r.error ? ` (${String(r.error).slice(0, 60)})` : ''} |`);
  }
  const loops = ['uncached', 'cached'].map((v) => [v, results.filter((r) => r.experiment === 'loop' && r.name.includes(` ${v} `)).reduce((s, r) => s + (r.log?.total_tokens || 0), 0)]);
  if (loops.some(([, t]) => t)) L.push('', `Agent loop totals: ${loops.map(([v, t]) => `${v} ${t}`).join(', ')}.`);
  return L.join('\n') + '\n';
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const run = `${new Date().toISOString().slice(11, 16).replace(':', '')}-${randomBytes(3).toString('hex')}`;
  const plan = buildPlan(o, run);
  console.log(`Billing probe on ${o.api} as <${o.alias}>: ${plan.length} billed requests (${o.experiments.join(', ')}).`);
  for (const p of plan) console.log(`  ${p.experiment.padEnd(6)} ${p.flavor.padEnd(2)} ${p.model.padEnd(34)} ${p.name}${p.waitMin ? ` (waits ${p.waitMin} min first)` : ''}`);
  if (!o.yes) {
    console.log('\nPlan only. Add --yes to send these requests and spend Ask Sage tokens.');
    return;
  }
  const key = (process.env.ASKSAGE_API_KEY || '').trim();
  const email = (process.env.ASKSAGE_EMAIL || '').trim();
  const client = createClient({ apiBase: `https://${o.api}`, apiKey: key || undefined, email: email || undefined, noAuthHeaders: !key });

  const logs = async (/** @type {number} */ limit) => /** @type {any} */ ((await client.call({ label: 'get-user-logs', kind: 'user', path: '/user/get-user-logs', body: { limit } })).body)?.response;
  const tok = async (/** @type {object} */ body) => Number(/** @type {any} */ ((await client.call({ label: 'tokenizer', kind: 'server', path: '/server/tokenizer', body })).body)?.response);
  /** @type {Record<string, { prompt: number, completion: number } | null>} */
  const rates = {};
  const big = filler(20260925, 30000);
  for (const model of new Set(plan.map((p) => p.model))) {
    const [tokens, oneTokens, asBig, asOne, asCompletion] = [await tok({ content: big, model }), await tok({ content: 'x', model }), await tok({ content: big, model, convert_to_asksage: true }), await tok({ content: 'x', model, convert_to_asksage: true }), await tok({ content: 'x', model, convert_to_asksage: true, completion_estimate: 1e6 })];
    const r = tokenizerRates({ tokens, oneTokens, asBig, asOne, asCompletion, completionEstimate: 1e6 });
    rates[model] = r.prompt && r.completion ? { prompt: r.prompt, completion: r.completion } : null;
    console.log(`rates ${model}: ${rates[model] ? `prompt ${r.prompt?.toFixed(5)} completion ${r.completion?.toFixed(5)}` : 'unavailable (tokenizer auth?)'}`);
  }
  if (!Array.isArray(await logs(1))) throw new Error('cannot read /user/get-user-logs (auth?); the probe needs it to read bills');

  const startedAt = new Date().toISOString();
  const results = [];
  for (const p of plan) {
    if (p.waitMin) {
      console.log(`waiting ${p.waitMin} min…`);
      await sleep(p.waitMin * 60000);
    }
    const before = maxLogId(await logs(5));
    const path = p.flavor === 'G' ? `/server/google/v1beta/models/${p.model}:generateContent` : PATHS[p.flavor];
    const ex = await client.call({ label: p.name, kind: p.flavor, path, body: p.body, model: p.model, headers: p.headers || {} });
    let rows = [];
    for (let t = 0; t < 12 && !rows.length; t++) {
      await sleep(2500);
      rows = rowsAfter(await logs(10), before);
    }
    const log = rows[0] || null;
    const expected = expectedBill(ex.norm, rates[p.model], cacheRule(p.flavor, p.model), { flavor: p.flavor });
    const v = log ? verdict(log.total_tokens, expected) : 'no log row';
    const { id: _id, date_time: _dt, ...logNums } = log || /** @type {any} */ ({});
    results.push({ experiment: p.experiment, name: p.name, flavor: p.flavor, model: p.model, served: ex.resolvedModel, http: ex.status, error: ex.error?.message ?? null, norm: ex.norm, log: log ? logNums : null, logRows: rows.length, expected, verdict: v });
    console.log(`${p.name.padEnd(28)} billed ${log ? log.total_tokens : '-'} expected ${expected ?? '-'} → ${v}`);
  }
  const endedAt = new Date().toISOString();
  const dir = resolve(o.out || join('research', 'live', o.alias, 'billing', `${startedAt.slice(0, 10)}-${run}`));
  mkdirSync(dir, { recursive: true });
  const hostless = (/** @type {string} */ s) => s.split(o.api).join(`<${o.alias}>`);
  writeFileSync(join(dir, 'results.json'), hostless(JSON.stringify({ run, startedAt, endedAt, models: o.models, results }, null, 1)) + '\n');
  writeFileSync(join(dir, 'summary.md'), hostless(renderSummary(results, { alias: o.alias, run, startedAt, endedAt })));
  console.log(`\nSaved to ${dir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`error: ${e.message}`);
    process.exit(1);
  });
}
