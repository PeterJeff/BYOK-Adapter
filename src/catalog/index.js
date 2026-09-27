// @ts-check
'use strict';

// Per-tenant model catalog (PLAN.md §2.3): POST /server/get-models?format=full (public,
// unauthenticated), filtered by cui_capable and the org's force_models, with a default
// transport flavor assigned per model (PLAN.md §2.2). Phase 1 only implements CC and R
// transports, so only models whose default flavor is CC or R are offered; Claude (M) and
// Gemini (G) models are left out rather than silently misrouted through the wrong endpoint.

const { request } = require('../transport/httpClient');

/**
 * @typedef {{ id: string, vendor?: string, cui_capable?: boolean, aliases?: string[],
 *   token_conversion_rate?: { prompt?: number, completion?: number } | null,
 *   limits?: { max_context?: number, max_output?: number }, deprecation?: { state?: string },
 *   capabilities?: string[] }} CatalogModel
 */

/**
 * Default transport flavor per model family (PLAN.md §2.2), Phase 1 subset.
 * @param {string} id
 * @returns {'M' | 'CC' | 'R' | 'G'}
 */
function classifyFlavor(id) {
  const lower = id.toLowerCase();
  if (/claude/.test(lower)) return 'M';
  if (/gemini/.test(lower)) return 'G';
  if (/^aws-bedrock-gpt/.test(lower)) return 'CC'; // no caching at all (measured): stays CC, never R
  if (/^(gpt-)?o\d/.test(lower)) return 'R'; // o-series reasoning models; Ask Sage ids are gpt-o3, gpt-o3-mini, gpt-o4-mini
  const gptMajor = /gpt-(\d+)/.exec(lower);
  if (gptMajor) return Number(gptMajor[1]) >= 5 ? 'R' : 'CC'; // 4.1 -> CC; 5, 5.1, 5.2, 5.4-5.6, 6 -> R
  return 'CC'; // partner-hosted, Grok, DeepSeek, Mistral, Llama, ...
}

/**
 * Intersects the catalog with the organization's force_models (PLAN.md §2.3). Matches a name
 * against each model's id and aliases, ignoring case: whether orgs list exact get-models ids is
 * not yet seen on a tenant that sets it (the public test account's list is empty). If no model
 * matches any name, the list is left unfiltered and `ignored` is set, because an empty picker
 * would hide the mismatch; Ask Sage still enforces the restriction server-side. Pure.
 * @template {CatalogModel} T
 * @param {T[]} models
 * @param {string[] | null | undefined} forceModels
 * @returns {{ models: T[], unmatched: string[], ignored: boolean }}
 */
function applyForceModels(models, forceModels) {
  if (!forceModels || !forceModels.length) return { models, unmatched: [], ignored: false };
  const wanted = new Map(forceModels.map((n) => [n.toLowerCase(), n]));
  const matched = new Set();
  const kept = models.filter((m) => {
    const names = [m.id, ...(m.aliases || [])].map((n) => n.toLowerCase()).filter((n) => wanted.has(n));
    for (const n of names) matched.add(n);
    return names.length > 0;
  });
  const unmatched = [...wanted].filter(([k]) => !matched.has(k)).map(([, v]) => v);
  if (!kept.length) return { models, unmatched, ignored: true };
  return { models: kept, unmatched, ignored: false };
}

/**
 * @param {{ apiBase: string, fetchImpl?: typeof fetch, warn?: (msg: string) => void }} opts
 */
function createCatalog(opts) {
  /** @type {{ at: number, models: CatalogModel[] } | null} */
  let cached = null;
  const TTL_MS = 24 * 60 * 60 * 1000;
  let lastForceWarning = '';

  async function fetchRaw() {
    const res = await request({
      url: `${opts.apiBase}/server/get-models?format=full`,
      headers: {},
      body: {},
      fetchImpl: opts.fetchImpl,
    });
    if (res.error) throw new Error(`Ask Sage: get-models failed: ${res.error.message}`);
    const body = /** @type {any} */ (res.body);
    // Observed shapes across tenants (research/model-catalog-findings.md, phase0/probe/catalog-audit.mjs,
    // phase0/probe/api-probe.mjs's loadCatalog): a bare array on some hosts, {response: [...]} or
    // {data: [...]} on others.
    const list = Array.isArray(body) ? body : body?.response || body?.data || body?.models;
    if (!Array.isArray(list)) throw new Error('Ask Sage: get-models?format=full did not return a model list');
    return /** @type {CatalogModel[]} */ (list);
  }

  return {
    /**
     * @param {{ allowNonCui?: boolean, forceModels?: string[] }} [o]
     * @returns {Promise<(CatalogModel & { flavor: 'CC' | 'R' })[]>}
     */
    async list(o = {}) {
      if (!cached || Date.now() - cached.at > TTL_MS) cached = { at: Date.now(), models: await fetchRaw() };
      const forced = applyForceModels(cached.models, o.forceModels);
      const warning = forced.ignored
        ? `Ask Sage: none of the organization's force_models (${forced.unmatched.join(', ')}) is in this tenant's catalog; showing all models (the server still enforces the restriction)`
        : forced.unmatched.length
          ? `Ask Sage: force_models not in this tenant's catalog: ${forced.unmatched.join(', ')}`
          : '';
      if (warning && warning !== lastForceWarning && opts.warn) opts.warn(warning);
      lastForceWarning = warning;
      /** @type {(CatalogModel & { flavor: 'CC' | 'R' })[]} */
      const out = [];
      for (const m of forced.models) {
        if (!o.allowNonCui && m.cui_capable === false) continue;
        if (m.deprecation?.state === 'retired') continue;
        const flavor = classifyFlavor(m.id);
        if (flavor !== 'CC' && flavor !== 'R') continue; // M/G: not built yet, don't misroute
        out.push({ ...m, flavor });
      }
      return out;
    },
    invalidate() {
      cached = null;
    },
  };
}

module.exports = { createCatalog, classifyFlavor, applyForceModels };
