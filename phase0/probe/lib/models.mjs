// @ts-check
// Picks the probe's models from the tenant's get-models?format=full catalog. Pure.
// Each role gets the cheapest matching model by prompt rate, unless --model role=id
// overrides it. Non-CUI models are skipped unless explicitly allowed.

/**
 * @typedef {{ id: string, vendor?: string, cui_capable?: boolean, capabilities?: string[], aliases?: string[],
 *   token_conversion_rate?: { prompt?: number, completion?: number } | null,
 *   limits?: { max_context?: number, max_output?: number }, deprecation?: { state?: string } }} CatalogModel
 */

/**
 * Roles, what they are for, and how a default is chosen.
 * @type {Record<string, { purpose: string, match: (m: CatalogModel) => boolean, optional?: boolean }>}
 */
export const ROLES = {
  claude: {
    purpose: 'Anthropic Messages (M): caching, TTLs, lookback, thinking round-trip (needs extended thinking and >= 4096-token cache minimum handling)',
    match: (m) => /claude/i.test(m.id) && !/fable/i.test(m.id),
  },
  gpt: {
    purpose: 'Chat Completions and Responses (CC, R): a GPT-5.4+ model that the rate table gives a cache rate',
    match: (m) => /^gpt-(5[.-][4-9]|6)/i.test(m.id) && !/-sec$/i.test(m.id) && (m.vendor || 'OpenAI') === 'OpenAI',
  },
  gemini: {
    purpose: 'Gemini (G) and Gemini through CC: implicit caching, thought signatures (Gemini 3 preferred)',
    match: (m) => /gemini-3/i.test(m.id) && !/image|veo|imagen/i.test(m.id),
  },
  embedding: {
    purpose: 'T20 embeddings (the public catalog lists none; pass --model embedding=<id>)',
    match: (m) => /embed/i.test(m.id),
    optional: true,
  },
  long: {
    purpose: 'T13 long-context pricing (opt-in, expensive): a model with a long-context threshold, e.g. a 1M-context Claude',
    match: () => false,
    optional: true,
  },
};

/**
 * @param {CatalogModel[]} catalog
 * @param {{ overrides?: Record<string, string>, allowNonCui?: boolean }} [o]
 * @returns {{ models: Record<string, CatalogModel | null>, notes: string[] }}
 */
export function pickModels(catalog, o = {}) {
  const overrides = o.overrides || {};
  /** @type {Record<string, CatalogModel | null>} */
  const models = {};
  const notes = [];
  const usable = (/** @type {CatalogModel} */ m) =>
    (o.allowNonCui || m.cui_capable !== false) && m.deprecation?.state !== 'retired' && (m.token_conversion_rate?.prompt ?? 0) > 0;
  for (const [role, def] of Object.entries(ROLES)) {
    const want = overrides[role];
    if (want) {
      const found = catalog.find((m) => m.id === want);
      if (!found) notes.push(`${role}: ${want} is not in this tenant's get-models catalog; it will be sent as given and is unpriced`);
      else if (found.cui_capable === false && !o.allowNonCui) throw new Error(`${role}: ${want} is cui_capable:false; pass --allow-non-cui if calling it is acceptable on this tenant`);
      models[role] = found || { id: want, token_conversion_rate: null };
      continue;
    }
    const candidates = catalog.filter((m) => def.match(m) && usable(m));
    // Commercial-hosted (-com) models only when nothing else matches: on a government tenant
    // the probe should exercise the hosting the account normally uses (model-catalog-findings.md).
    const com = (/** @type {CatalogModel} */ m) => (/-com$/i.test(m.id) ? 1 : 0);
    candidates.sort((a, b) => com(a) - com(b) || (a.token_conversion_rate?.prompt ?? Infinity) - (b.token_conversion_rate?.prompt ?? Infinity) || a.id.localeCompare(b.id));
    models[role] = candidates[0] || null;
    if (candidates[0] && com(candidates[0])) notes.push(`${role}: only commercial-hosted (-com) models match; using ${candidates[0].id}`);
    if (!candidates[0] && !def.optional) notes.push(`${role}: no matching model in the catalog; tests needing it are skipped (use --model ${role}=<id>)`);
  }
  return { models, notes };
}

/**
 * @param {Record<string, string>} target
 * @param {string} spec "role=id"
 */
export function parseModelOverride(target, spec) {
  const m = /^([a-z]+)=(.+)$/.exec(spec || '');
  if (!m || !(m[1] in ROLES)) throw new Error(`--model expects role=id with role one of ${Object.keys(ROLES).join(', ')}`);
  target[m[1]] = m[2];
  return target;
}
