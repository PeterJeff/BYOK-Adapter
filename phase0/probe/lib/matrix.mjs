// @ts-check
// T22 model matrix: which models and flavors to put through a compact per-model battery
// (cache repeat + reasoning tool loop). Pure; no I/O.
//
// The role-based tests T1–T21 each run once, on the cheapest model per role, which is right for
// endpoint mechanics but leaves flagship models, other hosts (Bedrock, Azure Gov, -com) and
// partner models untested. The matrix fills that gap one model at a time.

/** @typedef {import('./models.mjs').CatalogModel} CatalogModel */
/** @typedef {'M' | 'CC' | 'R' | 'G'} MatrixFlavor */
/** @typedef {{ model: CatalogModel, flavors: MatrixFlavor[], preset: string | null }} MatrixEntry */

/**
 * Named model sets. Ids are the test tenant's `get-models` ids (2026-09-25 catalog); an id the
 * tenant lacks is reported and skipped. Each preset answers a question the role tests cannot.
 * @type {Record<string, { purpose: string, ids: string[] }>}
 */
export const PRESETS = {
  flagship: {
    purpose: 'large models per family: caching (incl. GPT-5.6/6 cache writes), reasoning round trips at flagship scale',
    ids: ['google-claude-sonnet-5', 'google-claude-opus-5-5', 'gpt-5.6-sol', 'gpt-6-sol', 'gpt-5.5', 'google-gemini-3.1-pro-com'],
  },
  premium: {
    purpose: 'the most expensive tier, separately so it is a deliberate choice: Fable 5.1 read 0.025× and GPT-6 Astra are unmeasured',
    ids: ['aws-bedrock-claude-fable-5-1-gov', 'gpt-6-astra', 'claude-opus-4-7-com'],
  },
  hosts: {
    purpose: 'same families on other hosts: Bedrock Claude (count_tokens +28%), Anthropic-hosted -com Claude, Azure Gov GPT, Bedrock-served GPT',
    ids: ['aws-bedrock-claude-opus-5-5-gov', 'claude-sonnet-4-6-com', 'gpt-5.6-terra-gov', 'gpt-5.4-gov', 'aws-bedrock-gpt-5-6-luna-gov'],
  },
  gemini: {
    purpose: 'Gemini 3 thought signatures and implicit caching across tiers and hosts (T18 failed on 3.1-flash-lite-gov)',
    ids: ['google-gemini-3.1-flash-lite-com', 'google-gemini-3.5-flash-gov', 'google-gemini-3.7-flash', 'google-gemini-3.1-pro-com'],
  },
  partners: {
    purpose: 'partner-hosted models the plan routes through CC: tool calls, reasoning fields, any caching',
    ids: ['grok-4-20-reasoning', 'aws-bedrock-grok-4-6-gov', 'mistral-large-3', 'aws-bedrock-gpt-oss-120b-gov'],
  },
  small: {
    purpose: 'cheap baseline per family, including models the role tests skip (GPT-6 Luna, GPT-4.1 on CC)',
    ids: ['google-claude-45-haiku', 'gpt-5.4-nano', 'gpt-6-luna', 'gpt-4.1-mini', 'google-gemini-3.1-flash-lite-gov'],
  },
};

/** OpenAI GPT-5.4 and later (including -gov and Bedrock-served variants). */
const GPT_NEW = /^(aws-bedrock-)?gpt-(5[.-][4-9]|6)/i;
/** Older OpenAI reasoning models. */
const GPT_REASONING = /^gpt-(5(\.[0-2])?(-|$)|o\d)/i;

/**
 * Flavors to test per model, following PLAN §2.2: Claude on M; GPT-5.4+ on R and CC (to compare);
 * older reasoning GPTs on R and CC; GPT-4.1 on CC; Gemini on G and CC; everything else on CC.
 * @param {string} id
 * @returns {MatrixFlavor[]}
 */
export function defaultFlavors(id) {
  if (/claude/i.test(id)) return ['M'];
  if (GPT_NEW.test(id) || GPT_REASONING.test(id)) return ['R', 'CC'];
  if (/gemini/i.test(id)) return ['G', 'CC'];
  return ['CC'];
}

/**
 * Whether a model takes OpenAI reasoning parameters (`reasoning_effort`, `max_completion_tokens`).
 * @param {string} id
 */
export function isOpenAIReasoning(id) {
  return GPT_NEW.test(id) || GPT_REASONING.test(id);
}

/**
 * Parses `--matrix`: a comma list of preset names and model ids, each optionally with
 * `@FLAVOR[+FLAVOR]` (e.g. `flagship,gpt-5.6-sol@R,google-claude-sonnet-5`).
 * @param {string} spec
 * @param {CatalogModel[]} catalog
 * @param {{ allowNonCui?: boolean }} [o]
 * @returns {{ entries: MatrixEntry[], notes: string[] }}
 */
export function resolveMatrix(spec, catalog, o = {}) {
  /** @type {MatrixEntry[]} */
  const entries = [];
  const notes = [];
  const seen = new Set();
  for (const raw of String(spec || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const [name, flavorSpec] = raw.split('@');
    const preset = PRESETS[name];
    const ids = preset ? preset.ids : [name];
    for (const id of ids) {
      const model = catalog.find((m) => m.id === id);
      if (!model) {
        notes.push(`${id}${preset ? ` (preset ${name})` : ''}: not in this tenant's catalog; skipped`);
        continue;
      }
      if (model.cui_capable === false && !o.allowNonCui) {
        notes.push(`${id}: cui_capable:false; skipped (pass --allow-non-cui if calling it is acceptable on this tenant)`);
        continue;
      }
      if (model.deprecation?.state === 'retired') {
        notes.push(`${id}: retired; skipped`);
        continue;
      }
      /** @type {MatrixFlavor[]} */
      const flavors = flavorSpec ? /** @type {MatrixFlavor[]} */ (flavorSpec.toUpperCase().split('+').filter(Boolean)) : defaultFlavors(id);
      for (const f of flavors) if (!['M', 'CC', 'R', 'G'].includes(f)) throw new Error(`--matrix: unknown flavor ${f} for ${id} (use M, CC, R or G)`);
      const key = `${id}@${flavors.join('+')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ model, flavors, preset: preset ? name : null });
    }
    if (!preset && !catalog.some((m) => m.id === name) && !/[-.]/.test(name)) notes.push(`${name}: not a preset (${Object.keys(PRESETS).join(', ')}) or a known model id`);
  }
  return { entries, notes };
}

/** Cache prefix size per flavor: Claude and Gemini Pro need ≥4096 tokens; OpenAI caches from 1,024. */
export const MATRIX_PREFIX = { M: 6000, G: 6000, CC: 2500, R: 2500 };
/** Output caps used by the matrix requests (also what the pessimistic estimate assumes). */
export const MATRIX_CAPS = { cache: 256, loop: 768, loopM: 1280 };

/**
 * Pessimistic request list for one entry, for the dry-run plan: two cache requests and three
 * loop requests per flavor, every allowed output token billed.
 * @param {MatrixEntry} e
 * @param {{ prefixTokens?: number }} [o]
 */
export function entryEstimate(e, o = {}) {
  /** @type {{ model: CatalogModel, inTokens: number, outTokens: number }[]} */
  const reqs = [];
  for (const f of e.flavors) {
    const pre = f === 'M' || f === 'G' ? Math.max(o.prefixTokens || 0, MATRIX_PREFIX[f]) : MATRIX_PREFIX[f];
    for (let i = 0; i < 2; i++) reqs.push({ model: e.model, inTokens: pre + 40, outTokens: MATRIX_CAPS.cache });
    const cap = f === 'M' ? MATRIX_CAPS.loopM : MATRIX_CAPS.loop;
    for (let i = 0; i < 3; i++) reqs.push({ model: e.model, inTokens: 400, outTokens: cap });
  }
  return reqs;
}

/**
 * Cache multiplier implied by a measured bill: what the cached tokens cost per token, relative to
 * the model's billed prompt rate, after taking out the uncached input, the output and the
 * endpoint's small per-request constant (+1 to +5 measured, so +3 is assumed). Returns null when
 * there is too little cached input for the constant's uncertainty to leave a usable ratio.
 * @param {{ billed: number | null, cachedTokens: number, uncachedTokens: number, outputTokens: number,
 *   rates: { prompt: number | null, completion: number | null } | null }} x
 */
export function impliedMultiplier(x) {
  if (x.billed === null || !x.rates?.prompt || !x.rates?.completion || x.cachedTokens <= 0) return null;
  const cachedAtFull = x.cachedTokens * x.rates.prompt;
  // With a ±2 constant, a ratio is only meaningful when the cached part is worth ≥20 tokens at full price.
  if (cachedAtFull < 20) return null;
  const rest = x.uncachedTokens * x.rates.prompt + x.outputTokens * x.rates.completion + 3;
  return Math.round(((x.billed - rest) / cachedAtFull) * 100) / 100;
}
