// @ts-check
// Pulls usage, the served model, output text and tool calls out of a recorded exchange,
// per flavor, and prices it. Pure.
//
// The normalization here is PROVISIONAL (PLAN.md §3.2 as written, before Phase 0 confirms
// it). It exists so the probe can budget itself and compare estimates with measured budget
// deltas. The probe's recordings are what confirm or correct it for Phase 1.

/** @typedef {'M' | 'CC' | 'R' | 'G' | 'N'} Flavor */

/**
 * @typedef {object} Norm
 * @property {number} inputUncached
 * @property {number} cacheRead
 * @property {number} cacheWrite5m
 * @property {number} cacheWrite1h
 * @property {number} cacheWriteUnsplit  cache writes reported without a TTL split
 * @property {number} visibleOutput
 * @property {number} thinking
 * @property {boolean} thinkingUnknown
 */

/**
 * @param {unknown} v
 * @returns {number}
 */
const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Raw usage object as the API reported it (merged across stream events).
 * @param {Flavor} flavor
 * @param {{ body?: any, events?: { data: any }[] }} ex
 * @returns {Record<string, any> | null}
 */
export function rawUsage(flavor, ex) {
  const events = (ex.events || []).map((e) => e.data).filter((d) => d && typeof d === 'object');
  if (flavor === 'M') {
    if (ex.body?.usage) return ex.body.usage;
    /** @type {Record<string, any> | null} */
    let u = null;
    for (const d of events) {
      const part = d.type === 'message_start' ? d.message?.usage : d.type === 'message_delta' ? d.usage : null;
      if (part) u = mergeDefined(u || {}, part);
    }
    return u;
  }
  if (flavor === 'CC') {
    if (ex.body?.usage) return ex.body.usage;
    for (let i = events.length - 1; i >= 0; i--) if (events[i].usage) return events[i].usage;
    return null;
  }
  if (flavor === 'R') {
    if (ex.body?.usage) return ex.body.usage;
    for (let i = events.length - 1; i >= 0; i--) if (events[i].response?.usage) return events[i].response.usage;
    return null;
  }
  if (flavor === 'G') {
    if (ex.body && !Array.isArray(ex.body) && ex.body.usageMetadata) return ex.body.usageMetadata;
    const list = Array.isArray(ex.body) ? ex.body : events;
    for (let i = list.length - 1; i >= 0; i--) if (list[i]?.usageMetadata) return list[i].usageMetadata;
    return null;
  }
  // N: whatever usage-like fields the final chunk carries.
  const last = ex.body && typeof ex.body === 'object' && !Array.isArray(ex.body) ? ex.body : events[events.length - 1];
  if (!last) return null;
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, v] of Object.entries(last)) if (/token|usage/i.test(k) && (typeof v === 'number' || (v && typeof v === 'object'))) out[k] = v;
  return Object.keys(out).length ? out : null;
}

/**
 * @param {Record<string, any>} a
 * @param {Record<string, any>} b
 */
function mergeDefined(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v === null || v === undefined) continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? mergeDefined(a[k], v) : v;
  }
  return out;
}

/**
 * Provisional normalization (PLAN.md §3.2).
 * @param {Flavor} flavor
 * @param {Record<string, any> | null} u
 * @returns {Norm | null}
 */
export function normalize(flavor, u) {
  if (!u) return null;
  /** @type {Norm} */
  const z = { inputUncached: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheWriteUnsplit: 0, visibleOutput: 0, thinking: 0, thinkingUnknown: false };
  if (flavor === 'M') {
    z.inputUncached = n(u.input_tokens);
    z.cacheRead = n(u.cache_read_input_tokens);
    const split = u.cache_creation && typeof u.cache_creation === 'object' ? u.cache_creation : null;
    if (split && (n(split.ephemeral_5m_input_tokens) || n(split.ephemeral_1h_input_tokens))) {
      z.cacheWrite5m = n(split.ephemeral_5m_input_tokens);
      z.cacheWrite1h = n(split.ephemeral_1h_input_tokens);
    } else z.cacheWriteUnsplit = n(u.cache_creation_input_tokens);
    // Vertex Claude reports thinking inside output_tokens and separately as
    // output_tokens_details.thinking_tokens (measured 2026-09-26); other hosts may not.
    const thinking = u.output_tokens_details?.thinking_tokens;
    if (typeof thinking === 'number') {
      z.thinking = thinking;
      z.visibleOutput = Math.max(0, n(u.output_tokens) - thinking);
    } else {
      z.visibleOutput = n(u.output_tokens);
      z.thinkingUnknown = true;
    }
    return z;
  }
  // Claude served through CC answers with Anthropic-shaped usage (measured 2026-09-25).
  if (flavor === 'CC' && u.prompt_tokens === undefined && u.input_tokens !== undefined) return normalize('M', u);
  if (flavor === 'CC') {
    const cached = n(u.prompt_tokens_details?.cached_tokens);
    // GPT-5.6/6 report cache writes separately; Ask Sage bills them at 1.25x (measured 2026-09-25).
    const written = n(u.prompt_tokens_details?.cache_write_tokens);
    const reasoning = n(u.completion_tokens_details?.reasoning_tokens);
    z.cacheRead = cached;
    z.cacheWriteUnsplit = written;
    z.inputUncached = Math.max(0, n(u.prompt_tokens) - cached - written);
    z.thinking = reasoning;
    z.visibleOutput = Math.max(0, n(u.completion_tokens) - reasoning);
    return z;
  }
  if (flavor === 'R') {
    const cached = n(u.input_tokens_details?.cached_tokens);
    const written = n(u.input_tokens_details?.cache_write_tokens);
    const reasoning = n(u.output_tokens_details?.reasoning_tokens);
    z.cacheRead = cached;
    z.cacheWriteUnsplit = written;
    z.inputUncached = Math.max(0, n(u.input_tokens) - cached - written);
    z.thinking = reasoning;
    z.visibleOutput = Math.max(0, n(u.output_tokens) - reasoning);
    return z;
  }
  if (flavor === 'G') {
    const cached = n(u.cachedContentTokenCount);
    z.cacheRead = cached;
    z.inputUncached = Math.max(0, n(u.promptTokenCount) - cached);
    z.visibleOutput = n(u.candidatesTokenCount);
    z.thinking = n(u.thoughtsTokenCount);
    return z;
  }
  return null;
}

/** Default cache multipliers relative to the prompt rate (PLAN.md §2.1). */
export const CACHE_MULT = { read: 0.1, write5m: 1.25, write1h: 2 };

/**
 * Ask Sage token estimates for one request under three hypotheses, so a measured budget
 * delta can pick between them:
 *   discounted   cache reads and writes priced with the standard multipliers
 *   full         every input token at the prompt rate (cache not discounted)
 *   inverse      rates read as "model tokens per Ask Sage token" (divide instead of multiply)
 * `token_conversion_rate` from get-models is used for prompt and completion. Reasoning and
 * thinking tokens are priced at the completion rate.
 * @param {Norm | null} z
 * @param {{ prompt?: number, completion?: number } | null | undefined} rate
 */
export function estimate(z, rate) {
  if (!z || !rate || !(n(rate.prompt) > 0) || !(n(rate.completion) >= 0)) return null;
  const p = n(rate.prompt);
  const c = n(rate.completion);
  const writes5 = z.cacheWrite5m + z.cacheWriteUnsplit;
  const input = z.inputUncached + z.cacheRead + writes5 + z.cacheWrite1h;
  const output = z.visibleOutput + z.thinking;
  const discounted = z.inputUncached * p + z.cacheRead * p * CACHE_MULT.read + writes5 * p * CACHE_MULT.write5m + z.cacheWrite1h * p * CACHE_MULT.write1h + output * c;
  const full = input * p + output * c;
  const inverse = input / p + (c > 0 ? output / c : 0);
  return { discounted: round(discounted), full: round(full), inverse: round(inverse), inputTokens: input, outputTokens: output };
}

/** @param {number} x */
const round = (x) => Math.round(x * 100) / 100;

/**
 * Served model id, as the response reports it.
 * @param {Flavor} flavor
 * @param {{ body?: any, events?: { data: any }[] }} ex
 * @returns {string | null}
 */
export function resolvedModel(flavor, ex) {
  const b = ex.body && typeof ex.body === 'object' && !Array.isArray(ex.body) ? ex.body : null;
  if (b?.model) return String(b.model);
  if (b?.modelVersion) return String(b.modelVersion);
  if (b?.response?.model) return String(b.response.model);
  for (const e of ex.events || []) {
    const d = e.data;
    if (!d || typeof d !== 'object') continue;
    if (d.message?.model) return String(d.message.model);
    if (d.response?.model) return String(d.response.model);
    if (d.model) return String(d.model);
    if (d.modelVersion) return String(d.modelVersion);
  }
  if (Array.isArray(ex.body)) for (const c of ex.body) if (c?.modelVersion) return String(c.modelVersion);
  return null;
}

/**
 * Visible text, thinking/reasoning items and tool calls from a response, for later rounds.
 * @param {Flavor} flavor
 * @param {{ body?: any, events?: { data: any }[] }} ex
 */
export function outputOf(flavor, ex) {
  /** @type {{ text: string, toolCalls: { id: string, name: string, args: string }[], stopReason: string | null, content: any[], items: any[], parts: any[], reasoningChars: number }} */
  const out = { text: '', toolCalls: [], stopReason: null, content: [], items: [], parts: [], reasoningChars: 0 };
  const events = (ex.events || []).map((e) => e.data).filter((d) => d && typeof d === 'object');
  if (flavor === 'M') {
    /** @type {any[]} */
    let blocks = ex.body?.content;
    if (!blocks) {
      blocks = [];
      for (const d of events) {
        if (d.type === 'content_block_start') blocks[d.index] = structuredClone(d.content_block);
        else if (d.type === 'content_block_delta') {
          const b = blocks[d.index];
          if (!b) continue;
          const dl = d.delta || {};
          if (dl.type === 'text_delta') b.text = (b.text || '') + dl.text;
          else if (dl.type === 'thinking_delta') b.thinking = (b.thinking || '') + dl.thinking;
          else if (dl.type === 'signature_delta') b.signature = (b.signature || '') + dl.signature;
          else if (dl.type === 'input_json_delta') b._json = (b._json || '') + dl.partial_json;
        } else if (d.type === 'message_delta' && d.delta?.stop_reason) out.stopReason = d.delta.stop_reason;
      }
      for (const b of blocks) if (b && b.type === 'tool_use' && '_json' in b) {
        try { b.input = b._json ? JSON.parse(b._json) : {}; } catch { b.input = {}; }
        delete b._json;
      }
      blocks = blocks.filter(Boolean);
    } else out.stopReason = ex.body.stop_reason ?? null;
    out.content = blocks;
    for (const b of blocks) {
      if (b.type === 'text') out.text += b.text || '';
      else if (b.type === 'thinking') out.reasoningChars += (b.thinking || '').length;
      else if (b.type === 'tool_use') out.toolCalls.push({ id: b.id, name: b.name, args: JSON.stringify(b.input ?? {}) });
    }
    return out;
  }
  if (flavor === 'CC') {
    const msg = ex.body?.choices?.[0]?.message;
    if (msg) {
      out.text = msg.content || '';
      out.stopReason = ex.body.choices[0].finish_reason ?? null;
      for (const t of msg.tool_calls || []) out.toolCalls.push({ id: t.id, name: t.function?.name, args: t.function?.arguments || '' });
      out.content = [msg];
      out.reasoningChars = String(msg.reasoning_content || msg.reasoning || '').length;
      return out;
    }
    /** @type {Record<number, { id: string, name: string, args: string }>} */
    const calls = {};
    for (const d of events) {
      const ch = d.choices?.[0];
      if (!ch) continue;
      if (ch.delta?.content) out.text += ch.delta.content;
      if (ch.delta?.reasoning_content) out.reasoningChars += String(ch.delta.reasoning_content).length;
      for (const t of ch.delta?.tool_calls || []) {
        const c = (calls[t.index ?? 0] ||= { id: '', name: '', args: '' });
        if (t.id) c.id = t.id;
        if (t.function?.name) c.name += t.function.name;
        if (t.function?.arguments) c.args += t.function.arguments;
      }
      if (ch.finish_reason) out.stopReason = ch.finish_reason;
    }
    out.toolCalls = Object.values(calls);
    return out;
  }
  if (flavor === 'R') {
    /** @type {any[]} */
    let items = ex.body?.output;
    if (!items) {
      const done = events.find((d) => d.type === 'response.completed' || d.type === 'response.incomplete');
      items = done?.response?.output || events.filter((d) => d.type === 'response.output_item.done').map((d) => d.item);
      out.stopReason = done?.response?.status ?? null;
    } else out.stopReason = ex.body.status ?? null;
    out.items = items || [];
    for (const it of out.items) {
      if (it.type === 'message') for (const c of it.content || []) if (c.type === 'output_text') out.text += c.text || '';
      if (it.type === 'function_call') out.toolCalls.push({ id: it.call_id, name: it.name, args: it.arguments || '' });
      if (it.type === 'reasoning') out.reasoningChars += String(it.encrypted_content || '').length;
    }
    return out;
  }
  if (flavor === 'G') {
    const chunks = Array.isArray(ex.body) ? ex.body : ex.body ? [ex.body] : events;
    for (const c of chunks) {
      const cand = c?.candidates?.[0];
      if (!cand) continue;
      if (cand.finishReason) out.stopReason = cand.finishReason;
      for (const p of cand.content?.parts || []) {
        out.parts.push(p);
        if (p.thought) out.reasoningChars += String(p.text || '').length;
        else if (typeof p.text === 'string') out.text += p.text;
        if (p.functionCall) out.toolCalls.push({ id: p.functionCall.id || '', name: p.functionCall.name, args: JSON.stringify(p.functionCall.args ?? {}) });
      }
    }
    return out;
  }
  for (const c of Array.isArray(ex.body) ? ex.body : events) if (c && typeof c.message === 'string') out.text = c.message;
  return out;
}
