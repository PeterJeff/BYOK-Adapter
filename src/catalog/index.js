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
  if (/^o\d/.test(lower)) return 'R'; // o-series reasoning models
  const gptMajor = /gpt-(\d+)/.exec(lower);
  if (gptMajor) return Number(gptMajor[1]) >= 5 ? 'R' : 'CC'; // 4.1 -> CC; 5, 5.1, 5.2, 5.4-5.6, 6 -> R
  return 'CC'; // partner-hosted, Grok, DeepSeek, Mistral, Llama, ...
}

/**
 * @param {{ apiBase: string, fetchImpl?: typeof fetch }} opts
 */
function createCatalog(opts) {
  /** @type {{ at: number, models: CatalogModel[] } | null} */
  let cached = null;
  const TTL_MS = 24 * 60 * 60 * 1000;

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
      const forceSet = o.forceModels && o.forceModels.length ? new Set(o.forceModels) : null;
      /** @type {(CatalogModel & { flavor: 'CC' | 'R' })[]} */
      const out = [];
      for (const m of cached.models) {
        if (!o.allowNonCui && m.cui_capable === false) continue;
        if (m.deprecation?.state === 'retired') continue;
        if (forceSet && !forceSet.has(m.id)) continue;
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

module.exports = { createCatalog, classifyFlavor };
