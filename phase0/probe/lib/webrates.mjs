// @ts-check
// Pulls the rate data out of the Ask Sage chat web app's bundle and compares it with the
// API's `token_conversion_rate`. Pure functions, no I/O. The bundle is minified, so this
// anchors on property names (`key`, `rates`, `conversion`, `modelTokens`), never on
// variable names, which change on every build.
//
// Two lists live in the bundle:
//   rate table  {key:"m",…,rates:{prompt:13.99,completion:2.797,cacheRead:…},longContextThreshold:2e5}
//               Unit: model tokens per 1 Ask Sage token ("bigger is cheaper").
//   legacy      {model:"…",…,conversion:{askSageTokens:1,modelTokens:{flatRate:void 0,prompt:18.18,completion:3.636},output:{…}},…,key:"m",…}
//               Same unit, per the web app's own caption.
// The API serves the inverse unit: Ask Sage tokens per model token (a multiplier).

/**
 * @typedef {{ key: string, provider?: string, contextTokens?: number, rates: Record<string, number>, longContextThreshold?: number }} TableRow
 * @typedef {{ key: string, askSageTokens: number, flatRate: number | null, prompt: number | null, completion: number | null }} LegacyRow
 * @typedef {{ id: string, token_conversion_rate?: { prompt?: number, completion?: number } | null }} ApiModel
 */

/** A JS numeric literal as minifiers write it (".5", "2e5", "1.3"), or `void 0`. */
const NUM = String.raw`(?:-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|void 0)`;

/** @param {string} s */
function num(s) {
  if (s === undefined || s === 'void 0') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * The web app's rate table: every object literal with a string `key` and a `rates:{…}` of
 * numbers. Later duplicates of a key are ignored (the first is what the dialog renders).
 * @param {string} bundle
 * @returns {TableRow[]}
 */
export function extractRateTable(bundle) {
  const re = new RegExp(String.raw`\{key:"([^"]+)"((?:,[A-Za-z]+:(?:"(?:[^"\\]|\\.)*"|${NUM}|!0|!1))*),rates:\{([^{}]*)\}(?:,longContextThreshold:(${NUM}))?\}`, 'g');
  /** @type {TableRow[]} */
  const rows = [];
  const seen = new Set();
  for (const m of bundle.matchAll(re)) {
    const key = m[1];
    if (seen.has(key)) continue;
    /** @type {Record<string, number>} */
    const rates = {};
    for (const p of m[3].matchAll(new RegExp(String.raw`([A-Za-z0-9]+):(${NUM})`, 'g'))) {
      const v = num(p[2]);
      if (v !== null) rates[p[1]] = v;
    }
    if (!Object.keys(rates).length) continue;
    seen.add(key);
    /** @type {TableRow} */
    const row = { key, rates };
    const provider = /,provider:"([^"]*)"/.exec(m[2]);
    if (provider) row.provider = provider[1];
    const ctx = new RegExp(String.raw`,contextTokens:(${NUM})`).exec(m[2]);
    if (ctx && num(ctx[1]) !== null) row.contextTokens = /** @type {number} */ (num(ctx[1]));
    const lct = num(m[4]);
    if (lct !== null) row.longContextThreshold = lct;
    rows.push(row);
  }
  return rows;
}

/**
 * The older model list's `conversion` objects. Each entry is an object literal opening with
 * `{model:"…"`; its `key` may come before or after the conversion, so the list is cut at every
 * `{model:"` and each piece is searched on its own.
 * @param {string} bundle
 * @returns {LegacyRow[]}
 */
export function extractLegacyConversions(bundle) {
  const conv = new RegExp(String.raw`conversion:\{askSageTokens:(${NUM}),modelTokens:\{flatRate:(${NUM}),prompt:(${NUM}),completion:(${NUM})\}`);
  /** @type {LegacyRow[]} */
  const rows = [];
  const seen = new Set();
  for (const piece of bundle.split('{model:"').slice(1)) {
    const m = conv.exec(piece);
    const k = /[{,]key:"([^"]+)"/.exec(piece);
    if (!m || !k || seen.has(k[1])) continue;
    seen.add(k[1]);
    rows.push({ key: k[1], askSageTokens: num(m[1]) ?? 1, flatRate: num(m[2]), prompt: num(m[3]), completion: num(m[4]) });
  }
  return rows;
}

/** The main bundle's path from the chat app's index.html. @param {string} html */
export function bundlePath(html) {
  const m = /<script[^>]+type="module"[^>]+src="([^"]+\.js)"/.exec(html) || /src="(\/assets\/index-[^"]+\.js)"/.exec(html);
  return m ? m[1] : null;
}

/** @param {number | null | undefined} x @param {number} [d] */
const round = (x, d = 4) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

/**
 * Per model: the ratio of what the API charges to what a web-app list charges, per prompt and
 * completion token. Both are turned into Ask Sage tokens per model token first, so 1 means
 * "the same price" and 0.769 means "the API is 1/1.3 of the list".
 * @param {ApiModel[]} api
 * @param {{ key: string, prompt: number | null, completion: number | null }[]} list  model tokens per Ask Sage token
 */
export function compareToApi(api, list) {
  const byKey = new Map(list.map((r) => [r.key, r]));
  /** @type {{ id: string, prompt: number | null, completion: number | null }[]} */
  const rows = [];
  let apiOnly = 0;
  for (const m of api) {
    const t = byKey.get(m.id);
    if (!t) {
      apiOnly++;
      continue;
    }
    const ap = m.token_conversion_rate?.prompt;
    const ac = m.token_conversion_rate?.completion;
    rows.push({
      id: m.id,
      prompt: ap && t.prompt ? round(ap * t.prompt) : null,
      completion: ac && t.completion ? round(ac * t.completion) : null,
    });
  }
  const apiIds = new Set(api.map((m) => m.id));
  return { rows, apiOnly, listOnly: list.filter((r) => !apiIds.has(r.key)).length };
}

/**
 * Groups comparison rows by their (prompt, completion) ratio pair, rounded to 3 places, so a
 * uniform markup shows up as one large group.
 * @param {{ id: string, prompt: number | null, completion: number | null }[]} rows
 */
export function ratioGroups(rows) {
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.prompt === null ? '-' : r.prompt.toFixed(3)} / ${r.completion === null ? '-' : r.completion.toFixed(3)}`;
    groups.set(k, [...(groups.get(k) || []), r.id]);
  }
  return [...groups.entries()].map(([ratio, ids]) => ({ ratio, count: ids.length, ids })).sort((a, b) => b.count - a.count);
}

/**
 * Cache and long-context rates as multiples of the same row's prompt price (in Ask Sage terms:
 * prompt / cacheRead is the cache-read price as a fraction of the prompt price, since the table's
 * unit is tokens per Ask Sage token).
 * @param {TableRow[]} table
 */
export function cacheMultipliers(table) {
  return table
    .filter((r) => r.rates.cacheRead || r.rates.cacheWrite5Min || r.rates.cacheWrite1Hr)
    .map((r) => {
      const p = r.rates.prompt;
      /** @param {string} k */
      const mult = (k) => (p && r.rates[k] ? round(p / r.rates[k], 3) : null);
      return { key: r.key, provider: r.provider, read: mult('cacheRead'), write5m: mult('cacheWrite5Min'), write1h: mult('cacheWrite1Hr') };
    });
}

/**
 * A model's billed rates from `/server/tokenizer` with `convert_to_asksage` (Ask Sage tokens per
 * model token). The endpoint rounds to an integer and adds a small constant, so the prompt rate
 * is a difference between a large and a one-character content, and the completion rate a
 * difference over a large `completion_estimate`.
 * @param {{ tokens: number, asBig: number, asOne: number, asCompletion: number, completionEstimate: number, oneTokens?: number }} m
 *   tokens: plain token count of the large content; asBig/asOne: its and a tiny content's converted
 *   value; asCompletion: the tiny content's converted value with `completion_estimate`
 */
export function tokenizerRates(m) {
  const one = m.oneTokens ?? 1;
  const prompt = m.tokens > one ? (m.asBig - m.asOne) / (m.tokens - one) : null;
  const completion = m.completionEstimate > 0 ? (m.asCompletion - m.asOne) / m.completionEstimate : null;
  return { prompt, completion, constant: m.asOne };
}

/**
 * Ratio of one rate source to another per model, both as multipliers (Ask Sage tokens per
 * model token). Rows missing either side are counted, not compared.
 * @param {Record<string, { prompt: number | null, completion: number | null }>} a
 * @param {Record<string, { prompt: number | null, completion: number | null }>} b
 */
export function ratioBetween(a, b) {
  /** @type {{ id: string, prompt: number | null, completion: number | null }[]} */
  const rows = [];
  let missing = 0;
  for (const [id, x] of Object.entries(a)) {
    const y = b[id];
    if (!y) {
      missing++;
      continue;
    }
    rows.push({ id, prompt: x.prompt && y.prompt ? round(x.prompt / y.prompt) : null, completion: x.completion && y.completion ? round(x.completion / y.completion) : null });
  }
  return { rows, missing };
}
