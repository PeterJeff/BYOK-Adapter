// @ts-check
'use strict';

// Cache breakpoint placement for the Anthropic Messages ("M") flavor (PLAN.md §4.1). Pure: works
// on the already-built Anthropic request body (system/messages/tools in Anthropic's own content-
// block shape), so it has no vscode import and no knowledge of VS Code's part classes.
//
// Four breakpoints, in Copilot's own messagesApi.ts order: 1) the last tool definition, 2) the
// last system block, 3) the last cacheable block of the most recent message, 4) the last
// cacheable block of the second-most-recent message. Mixed TTLs put 1-2 (the stable tools+system
// prefix) on the long TTL and 3-4 on the short one, so a longer-lived breakpoint always precedes a
// shorter one (Anthropic requires this ordering). Breakpoints below a model's minimum cacheable
// prefix are skipped rather than placed (they would silently not cache).
//
// The ~20-content-block cache lookback window (T16) turned out not to bite in practice -- a
// breakpoint 50 blocks past the last cached one still hit (research/live/FINDINGS.md) -- so it is
// documented here as a non-requirement, not implemented as an extra breakpoint: PLAN.md §4.1 calls
// it "cheap insurance, not a correctness requirement", and spending breakpoint 4 on an
// intermediate block instead of the second-most-recent message is left undone until it is.

const CHARS_PER_TOKEN = 3.7; // same local estimate as provider.provideTokenCount (src/extension.js)

/** @param {string} ttl '' for the default (5m), '1h' for the extended TTL */
function cacheControl(ttl) {
  return ttl ? { type: 'ephemeral', ttl } : { type: 'ephemeral' };
}

/** @param {unknown} block */
function blockChars(block) {
  const b = /** @type {any} */ (block);
  if (typeof b?.text === 'string') return b.text.length;
  if (typeof b?.thinking === 'string') return b.thinking.length;
  if (b?.type === 'tool_use') return JSON.stringify(b.input ?? {}).length + (b.name?.length || 0);
  if (b?.type === 'tool_result') return (b.content || []).reduce((/** @type {number} */ n, /** @type {any} */ c) => n + (c.text?.length || 0), 0);
  return JSON.stringify(b ?? '').length;
}

/**
 * @param {readonly any[]} messages Anthropic-shaped {role, content: object[]}[]
 * @returns {number[]} indexes into `messages` of messages that carry at least one content block
 */
function cacheableMessageIndexes(messages) {
  /** @type {number[]} */
  const out = [];
  for (let i = 0; i < messages.length; i++) if (messages[i]?.content?.length) out.push(i);
  return out;
}

/**
 * @param {{ system?: readonly any[], messages: readonly any[], tools?: readonly any[] }} body
 * @param {{ ttlMode?: '5m' | 'mixed' | '1h', minPrefixTokens?: number }} [opts]
 * @returns {{ system?: any[], messages: any[], tools?: any[] }}
 */
function placeBreakpoints(body, opts = {}) {
  const ttlMode = opts.ttlMode || 'mixed';
  const minPrefixChars = (opts.minPrefixTokens ?? 1024) * CHARS_PER_TOKEN;
  const stableTtl = ttlMode === '5m' ? '' : '1h';
  const recentTtl = ttlMode === '1h' ? '1h' : '';

  const tools = body.tools ? body.tools.map((/** @type {any} */ t) => ({ ...t })) : undefined;
  const system = body.system ? body.system.map((/** @type {any} */ s) => ({ ...s })) : undefined;
  const messages = body.messages.map((/** @type {any} */ m) => ({ ...m, content: Array.isArray(m.content) ? m.content.map((/** @type {any} */ c) => ({ ...c })) : m.content }));

  let prefixChars = 0;

  if (tools && tools.length) {
    prefixChars += tools.reduce((/** @type {number} */ n, /** @type {any} */ t) => n + JSON.stringify(t).length, 0);
    if (prefixChars >= minPrefixChars) tools[tools.length - 1].cache_control = cacheControl(stableTtl);
  }

  if (system && system.length) {
    prefixChars += system.reduce((/** @type {number} */ n, /** @type {any} */ s) => n + blockChars(s), 0);
    if (prefixChars >= minPrefixChars) system[system.length - 1].cache_control = cacheControl(stableTtl);
  }

  const cacheable = cacheableMessageIndexes(messages);
  let running = prefixChars;
  /** @type {number[]} */
  const cumCharsByCacheableIndex = [];
  let ci = 0;
  for (let i = 0; i < messages.length; i++) {
    const chars = (messages[i].content || []).reduce((/** @type {number} */ n, /** @type {any} */ c) => n + blockChars(c), 0);
    running += chars;
    if (cacheable[ci] === i) {
      cumCharsByCacheableIndex.push(running);
      ci++;
    }
  }

  if (cacheable.length >= 1) {
    const idx = cacheable[cacheable.length - 1];
    if (cumCharsByCacheableIndex[cacheable.length - 1] >= minPrefixChars) {
      const content = messages[idx].content;
      content[content.length - 1].cache_control = cacheControl(recentTtl);
    }
  }
  if (cacheable.length >= 2) {
    const idx = cacheable[cacheable.length - 2];
    if (cumCharsByCacheableIndex[cacheable.length - 2] >= minPrefixChars) {
      const content = messages[idx].content;
      content[content.length - 1].cache_control = cacheControl(recentTtl);
    }
  }

  return { system, messages, tools };
}

module.exports = { placeBreakpoints, cacheControl };
