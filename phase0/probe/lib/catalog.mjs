// @ts-check
// Pure logic for the model-catalog audit (catalog-audit.mjs). No network, no fs:
// the CLI fetches or loads the inputs and passes them in, so this runs under node:test.
//
// Inputs, all public and unauthenticated:
//   - POST /server/get-models?format=full   per-model flags (cui_capable, vendor, aliases, rates)
//   - GET  /server/openai/v1/models, /server/anthropic/v1/models   static compatibility catalogs
//   - https://chat.<instance>/vars.js        the deployment profile (window.RUNTIME_VARS)
//   - the chat web app bundle                hardcoded default / gov / DoD allow-lists

/** Model ids look like this; anything else in an extracted array means extraction went wrong. */
const MODEL_ID_RE = /^[a-z0-9][a-z0-9._@:-]*$/i;

/** Runtime variables that decide which models the web app offers. */
export const PROFILE_KEYS = [
  'REACT_APP_deployment_type',
  'REACT_APP_classification_level',
  'REACT_APP_allowed_classifications',
  'REACT_APP_force_gov_models',
  'REACT_APP_force_dod_models',
  'REACT_APP_allowed_models',
  'REACT_APP_customer_tenant',
  'REACT_APP_has_government_banner',
  'REACT_APP_hide_cui_chip',
  'REACT_APP_asksage_chat_service',
  'REACT_APP_asksage_user_service',
];

/**
 * Parses `window.RUNTIME_VARS = { "KEY": `value`, ... }` (values may use backticks,
 * double or single quotes). Returns only string values; HTML in values is kept.
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseVarsJs(text) {
  /** @type {Record<string, string>} */
  const out = {};
  const re = /["']?(REACT_APP_[A-Za-z0-9_]+)["']?\s*:\s*(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,}\n]+)/g;
  for (const m of text.matchAll(re)) {
    let v = m[2].trim();
    if (/^[`"']/.test(v)) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

/** @param {string | undefined} v */
function truthy(v) {
  return typeof v === 'string' && v.trim().toLowerCase() === 'true';
}

/**
 * Parses a JSON array literal starting at `start` (which must point at "[").
 * @param {string} text
 * @param {number} start
 */
function arrayAt(text, start) {
  let depth = 0;
  for (let k = start; k < text.length; k++) {
    const c = text[k];
    if (c === '"') {
      // skip string
      for (k++; k < text.length && text[k] !== '"'; k++) if (text[k] === '\\') k++;
    } else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return JSON.parse(text.slice(start, k + 1));
  }
  throw new Error('unterminated array');
}

/**
 * First `=[...]` array of model ids at or after `from`, within `window` chars.
 * @param {string} text
 * @param {number} from
 * @param {number} [window]
 * @returns {string[] | null}
 */
function nextIdArray(text, from, window = 4000) {
  const slice = text.slice(from, from + window);
  const m = /=\s*\[\s*"/.exec(slice);
  if (!m) return null;
  const arr = arrayAt(text, from + m.index + slice.slice(m.index).indexOf('['));
  if (!Array.isArray(arr) || arr.length === 0 || !arr.every((x) => typeof x === 'string' && MODEL_ID_RE.test(x))) return null;
  return arr;
}

/**
 * Extracts the web app's hardcoded model allow-lists. Minified variable names change
 * with every build, so the search anchors on the RUNTIME_VARS names instead:
 *   ...REACT_APP_allowed_models...; X==null ? X=[default...] : ...
 *   ...REACT_APP_force_gov_models...; flag && !allowed && (X=[gov...])
 *   ...REACT_APP_force_dod_models...; flag && !allowed && (X=[dod...])
 * A list that cannot be found is null, never guessed.
 * @param {string} bundle
 */
export function extractAllowLists(bundle) {
  const govAt = bundle.indexOf('RUNTIME_VARS.REACT_APP_force_gov_models');
  const dodAt = bundle.indexOf('RUNTIME_VARS.REACT_APP_force_dod_models');
  const allowedAt = govAt > 0 ? bundle.lastIndexOf('RUNTIME_VARS.REACT_APP_allowed_models', govAt) : -1;
  const chatService = /RUNTIME_VARS\.REACT_APP_asksage_chat_service\s*\|\|\s*"([^"]+)"/.exec(bundle);
  return {
    default: allowedAt >= 0 ? nextIdArray(bundle, allowedAt) : null,
    gov: govAt >= 0 ? nextIdArray(bundle, govAt) : null,
    dod: dodAt >= 0 ? nextIdArray(bundle, dodAt) : null,
    defaultChatService: chatService ? chatService[1] : null,
  };
}

/**
 * Which list the web app shows, following the bundle's own precedence:
 * allowed_models (non-empty) wins; otherwise DoD, then gov, then default.
 * @param {Record<string, string>} vars
 * @param {{ default: string[] | null, gov: string[] | null, dod: string[] | null }} lists
 */
export function activeProfile(vars, lists) {
  const allowed = (vars.REACT_APP_allowed_models || '').trim();
  if (allowed) {
    let ids;
    try {
      ids = allowed.startsWith('[') ? JSON.parse(allowed) : allowed.split(',');
    } catch {
      ids = allowed.split(',');
    }
    return { name: 'allowed_models', ids: ids.map((/** @type {string} */ s) => String(s).trim()).filter(Boolean) };
  }
  // The bundle applies gov then DoD, so DoD wins when both are set.
  if (truthy(vars.REACT_APP_force_dod_models)) return { name: 'dod', ids: lists.dod };
  if (truthy(vars.REACT_APP_force_gov_models)) return { name: 'gov', ids: lists.gov };
  return { name: 'default', ids: lists.default };
}

/** @param {string} id */
export function suffixOf(id) {
  const m = /-(gov|com|ts|sec)$/.exec(id);
  return m ? `-${m[1]}` : '(none)';
}

/**
 * @typedef {{ id: string, vendor?: string, cui_capable?: boolean, aliases?: string[], capabilities?: string[],
 *   token_conversion_rate?: { prompt?: number, completion?: number } | null, deprecation?: { state?: string } }} FullModel
 * @typedef {{ severity: 'high' | 'medium' | 'info', code: string, title: string, detail: string, ids?: string[] }} Finding
 */

/**
 * Compares what an instance declares (vars.js), what its web app would offer (allow-lists)
 * and what its API serves (get-models), and reports the mismatches.
 * @param {{
 *   host: string,
 *   models: FullModel[],
 *   vars: Record<string, string> | null,
 *   lists: ReturnType<typeof extractAllowLists> | null,
 *   openaiIds?: string[] | null,
 *   anthropicIds?: string[] | null,
 * }} input
 */
export function audit(input) {
  const { models, vars, lists } = input;
  /** @type {Finding[]} */
  const findings = [];
  const byId = new Map(models.map((m) => [m.id, m]));
  const served = [...byId.keys()].sort();
  const nonCui = served.filter((id) => byId.get(id)?.cui_capable === false);
  const deployment = (vars?.REACT_APP_deployment_type || '').toLowerCase();
  const classification = (vars?.REACT_APP_classification_level || '').toLowerCase();
  const governmentLike = deployment === 'government' || deployment === 'dod' || classification === 'cui' || truthy(vars?.REACT_APP_has_government_banner);
  const profile = vars && lists ? activeProfile(vars, lists) : null;

  // 1. Non-CUI models on an instance that presents itself as government / CUI.
  if (nonCui.length) {
    findings.push({
      severity: governmentLike ? 'high' : 'info',
      code: 'non-cui-served',
      title: `${nonCui.length} model(s) flagged cui_capable:false are served`,
      detail: governmentLike
        ? `The instance declares deployment_type="${deployment || '?'}", classification_level="${classification || '?'}". Ask Sage docs: non-CUI models "are not found on all instances... If you are on a CUI-compliant instance, these models will not be available."`
        : 'Informational on a commercial deployment.',
      ids: nonCui,
    });
  }

  // 2. Declared profile does not switch on a restricted list.
  if (vars && governmentLike && profile && profile.name === 'default') {
    findings.push({
      severity: 'high',
      code: 'government-without-restricted-list',
      title: 'Government/CUI deployment runs the unrestricted default model list',
      detail: `vars.js sets deployment_type="${deployment}" but neither REACT_APP_force_gov_models, REACT_APP_force_dod_models nor REACT_APP_allowed_models, so the web app offers its default list.`,
    });
  }

  // 3. The list the web app offers contains non-CUI models.
  if (profile && profile.ids) {
    const offeredNonCui = profile.ids.filter((/** @type {string} */ id) => byId.get(id)?.cui_capable === false);
    if (offeredNonCui.length) {
      findings.push({
        severity: governmentLike ? 'high' : 'info',
        code: 'webapp-list-non-cui',
        title: `The web app's active list ("${profile.name}") offers ${offeredNonCui.length} non-CUI model(s)`,
        detail: 'These appear in the chat UI model picker for this deployment.',
        ids: offeredNonCui,
      });
    }
  }

  // 4. API serves models outside the list this deployment should be restricted to.
  const reference = profile && profile.name !== 'default' ? profile : governmentLike && lists?.gov ? { name: 'gov (reference: deployment is government-like but no list is forced)', ids: lists.gov } : null;
  if (reference && reference.ids) {
    const allowed = new Set(reference.ids);
    const outside = served.filter((id) => !allowed.has(id));
    if (outside.length) {
      findings.push({
        severity: 'medium',
        code: 'served-outside-allow-list',
        title: `${outside.length} served model(s) are outside the "${reference.name}" allow-list`,
        detail: 'get-models is unauthenticated and, per Ask Sage docs, not filtered per environment; the server may still refuse these per account. Listed is not proof of callable.',
        ids: outside,
      });
    }
  }

  // 5. Hosting-marker mismatches.
  const bySuffix = (/** @type {string} */ s) => served.filter((id) => suffixOf(id) === s);
  if (governmentLike && bySuffix('-com').length) {
    findings.push({ severity: 'medium', code: 'commercial-hosting-on-government', title: `${bySuffix('-com').length} "-com" (commercial hosting / provider-direct) model(s) served on a government-like deployment`, detail: '', ids: bySuffix('-com') });
  }
  if (deployment === 'commercial' && (bySuffix('-gov').length || bySuffix('-ts').length)) {
    findings.push({ severity: 'info', code: 'government-hosting-on-commercial', title: `"-gov"/"-ts" model(s) served on a commercial deployment`, detail: '', ids: [...bySuffix('-gov'), ...bySuffix('-ts')] });
  }
  const undocumented = [...bySuffix('-ts'), ...bySuffix('-sec')];
  if (undocumented.length) {
    findings.push({ severity: 'info', code: 'undocumented-suffix', title: 'Model suffixes with no published definition (-ts, -sec)', detail: 'Treat their data handling as unknown until Ask Sage defines them.', ids: undocumented });
  }

  // 6. Profile self-contradictions.
  if (deployment === 'commercial' && classification === 'cui') {
    findings.push({ severity: 'medium', code: 'commercial-marked-cui', title: 'Commercial deployment declares classification_level "cui"', detail: 'The Instances page lists the commercial instance as "Not FedRAMP".' });
  }

  // 7. Alias collisions: one alias resolving to several models.
  /** @type {Map<string, string[]>} */
  const aliasIdx = new Map();
  for (const m of models) for (const a of m.aliases || []) aliasIdx.set(a, [...(aliasIdx.get(a) || []), m.id]);
  const collisions = [...aliasIdx].filter(([, ids]) => ids.length > 1);
  if (collisions.length) {
    findings.push({ severity: 'medium', code: 'alias-collision', title: `${collisions.length} alias(es) map to more than one model`, detail: collisions.map(([a, ids]) => `"${a}" -> ${ids.join(', ')}`).join('; '), ids: collisions.map(([a]) => a) });
  }

  // 8. Static compatibility catalogs. Their ids are often public aliases
  //    (claude-opus-4-7), so resolve each one to the model(s) behind it.
  /** @param {string} id */
  const resolve = (id) => (byId.has(id) ? [id] : aliasIdx.get(id) || []);
  for (const [name, ids] of /** @type {[string, string[] | null | undefined][]} */ ([['openai/v1/models', input.openaiIds], ['anthropic/v1/models', input.anthropicIds]])) {
    if (!ids) continue;
    const unresolved = ids.filter((id) => resolve(id).length === 0);
    const viaAlias = ids.filter((id) => !byId.has(id) && resolve(id).length > 0);
    const nonCuiThere = ids.filter((id) => resolve(id).some((r) => byId.get(r)?.cui_capable === false));
    const commercialBacked = ids.filter((id) => resolve(id).some((r) => suffixOf(r) === '-com'));
    if (unresolved.length) findings.push({ severity: 'info', code: 'catalog-unresolved', title: `${name} lists ${unresolved.length} id(s) that are neither a get-models id nor an alias`, detail: 'The server maps these to a backing model per environment (per the BYOK docs, e.g. Commercial -> provider-direct "-com", Gov/DoD -> Vertex). Which backend, and so which hosting and CUI status, cannot be determined from public data: send exact get-models ids instead.', ids: unresolved });
    if (viaAlias.length) {
      findings.push({
        severity: 'info',
        code: 'catalog-alias-resolution',
        title: `${name}: ${viaAlias.length} public id(s) resolve through aliases`,
        detail: viaAlias.map((id) => `\`${id}\` -> ${resolve(id).map((r) => `${r}${byId.get(r)?.cui_capable === false ? ' (non-CUI)' : ''}`).join(' | ')}`).join('; '),
        ids: viaAlias,
      });
    }
    if (nonCuiThere.length && governmentLike) findings.push({ severity: 'medium', code: 'catalog-non-cui', title: `${name} lists ${nonCuiThere.length} id(s) backed by a non-CUI model`, detail: '', ids: nonCuiThere });
    if (commercialBacked.length && governmentLike) findings.push({ severity: 'medium', code: 'catalog-commercial-backed', title: `${name} lists ${commercialBacked.length} id(s) that resolve to a "-com" model on a government-like deployment`, detail: commercialBacked.map((id) => `\`${id}\` -> ${resolve(id).join(' | ')}`).join('; '), ids: commercialBacked });
  }

  // 9. Stale or unpriced entries.
  if (lists) {
    const listed = new Set([...(lists.default || []), ...(lists.gov || []), ...(lists.dod || [])]);
    const stale = [...listed].filter((id) => !byId.has(id)).sort();
    if (stale.length) findings.push({ severity: 'info', code: 'webapp-list-stale', title: `${stale.length} id(s) in the web app lists are not served`, detail: '', ids: stale });
  }
  const unpriced = served.filter((id) => !byId.get(id)?.token_conversion_rate);
  if (unpriced.length) findings.push({ severity: 'info', code: 'unpriced', title: `${unpriced.length} model(s) have no token_conversion_rate`, detail: 'The extension must treat these as "unpriced" (plan §3.1).', ids: unpriced });

  const rank = { high: 0, medium: 1, info: 2 };
  findings.sort((a, b) => rank[a.severity] - rank[b.severity]);

  /** @type {Record<string, { true: number, false: number }>} */
  const suffixTable = {};
  for (const id of served) {
    const s = suffixOf(id);
    suffixTable[s] = suffixTable[s] || { true: 0, false: 0 };
    suffixTable[s][byId.get(id)?.cui_capable === false ? 'false' : 'true']++;
  }

  return {
    host: input.host,
    profile: {
      deploymentType: deployment || null,
      classificationLevel: classification || null,
      governmentLike,
      activeList: profile ? profile.name : null,
      activeListSize: profile && profile.ids ? profile.ids.length : null,
      declared: vars ? Object.fromEntries(PROFILE_KEYS.filter((k) => k in vars).map((k) => [k, vars[k]])) : null,
    },
    counts: {
      served: served.length,
      nonCui: nonCui.length,
      lists: lists ? { default: lists.default?.length ?? null, gov: lists.gov?.length ?? null, dod: lists.dod?.length ?? null } : null,
    },
    suffixTable,
    findings,
  };
}

/**
 * @param {ReturnType<typeof audit>} r
 * @param {{ generatedAt?: string, sources?: Record<string, string> }} [meta]
 */
export function renderAuditMarkdown(r, meta = {}) {
  const L = [];
  L.push(`# Model catalog audit: ${r.host}`, '');
  L.push(`Generated ${meta.generatedAt || new Date().toISOString()} from public, unauthenticated sources. Listed is not proof of callable: the server may still restrict models per account or organization.`, '');
  L.push('## Declared profile', '', '| Key | Value |', '|---|---|');
  for (const [k, v] of Object.entries(r.profile.declared || {})) L.push(`| \`${k}\` | \`${String(v).replace(/\|/g, '\\|').slice(0, 120)}\` |`);
  L.push('', `- Government/CUI-like: **${r.profile.governmentLike ? 'yes' : 'no'}**`);
  L.push(`- Web app's active list: **${r.profile.activeList ?? 'unknown'}** (${r.profile.activeListSize ?? '?'} ids)`);
  L.push(`- Served by get-models: ${r.counts.served} (${r.counts.nonCui} flagged \`cui_capable: false\`)`);
  if (r.counts.lists) L.push(`- Web app lists: default ${r.counts.lists.default ?? 'not found'}, gov ${r.counts.lists.gov ?? 'not found'}, DoD ${r.counts.lists.dod ?? 'not found'}`);
  L.push('', '| Suffix | cui_capable true | cui_capable false |', '|---|---|---|');
  for (const [s, c] of Object.entries(r.suffixTable).sort()) L.push(`| \`${s}\` | ${c.true} | ${c.false} |`);
  L.push('', '## Findings', '');
  if (!r.findings.length) L.push('None.');
  for (const f of r.findings) {
    L.push(`### [${f.severity.toUpperCase()}] ${f.title}`, '');
    if (f.detail) L.push(f.detail, '');
    if (f.ids && f.ids.length) L.push(f.ids.map((i) => `\`${i}\``).join(', '), '');
  }
  if (meta.sources) {
    L.push('## Sources', '');
    for (const [k, v] of Object.entries(meta.sources)) L.push(`- ${k}: ${v}`);
  }
  return L.join('\n') + '\n';
}
