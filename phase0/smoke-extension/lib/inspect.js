// @ts-check
'use strict';

// Pure helpers for looking at what VS Code hands a language-model provider.
// No `vscode` import: the part classes are passed in, so this runs under node:test.

/** MIME type of the private data part the smoke provider emits (E4). */
const SMOKE_MIME = 'application/vnd.asksage.smoke+json';
/** MIME type Copilot reads provider usage from (internal convention, plan §3.4). */
const USAGE_MIME = 'usage';
/** Matches nonces written by makeNonce(). */
const NONCE_RE = /smk-\d+-[a-z0-9]{6}/g;

/** vscode.LanguageModelChatMessageRole values. System (3) is proposed API. */
const ROLE_NAMES = /** @type {Record<number, string>} */ ({ 1: 'user', 2: 'assistant', 3: 'system' });

/**
 * Part classes looked up on the `vscode` module. Any of them may be missing,
 * because some are proposed API.
 * @typedef {{
 *   TextPart?: Function, ToolCallPart?: Function, ToolResultPart?: Function,
 *   DataPart?: Function, ThinkingPart?: Function, PromptTsxPart?: Function
 * }} PartCtors
 */

/**
 * @param {number} requestNumber
 * @param {() => number} [random]
 */
function makeNonce(requestNumber, random = Math.random) {
  let suffix = '';
  while (suffix.length < 6) suffix += Math.floor(random() * 36).toString(36);
  return `smk-${requestNumber}-${suffix}`;
}

/** @param {number} role */
function roleName(role) {
  return ROLE_NAMES[role] || `role(${role})`;
}

/**
 * Classifies one content part. Uses instanceof where the class exists and
 * falls back to duck typing, so unknown or proposed part types still get a name.
 * @param {unknown} part
 * @param {PartCtors} ctors
 * @returns {string}
 */
function classifyPart(part, ctors) {
  if (part === null || typeof part !== 'object') return typeof part;
  /** @param {Function | undefined} C */
  const is = (C) => typeof C === 'function' && part instanceof C;
  if (is(ctors.ThinkingPart)) return 'thinking';
  if (is(ctors.TextPart)) return 'text';
  if (is(ctors.ToolCallPart)) return 'toolCall';
  if (is(ctors.ToolResultPart)) return 'toolResult';
  if (is(ctors.DataPart)) return 'data';
  if (is(ctors.PromptTsxPart)) return 'promptTsx';
  const p = /** @type {any} */ (part);
  const ctorName = (p.constructor && p.constructor.name) || '';
  if (/thinking/i.test(ctorName)) return 'thinking';
  if ('callId' in p && 'name' in p && 'input' in p) return 'toolCall';
  if ('callId' in p && 'content' in p) return 'toolResult';
  if ('mimeType' in p && 'data' in p) return 'data';
  if (typeof p.value === 'string') return 'text';
  return `unknown(${ctorName || 'Object'}: ${Object.keys(p).slice(0, 6).join(',')})`;
}

/** @param {unknown} data */
function decodeBytes(data) {
  if (data instanceof Uint8Array) return new TextDecoder().decode(data);
  if (typeof data === 'string') return data;
  return '';
}

/** @param {any} part a thinking part */
function thinkingText(part) {
  return Array.isArray(part.value) ? part.value.join('') : String(part.value ?? '');
}

/**
 * All text in a message, including text inside tool results.
 * @param {any} message
 * @param {PartCtors} ctors
 */
function messageText(message, ctors) {
  let out = '';
  for (const part of message.content || []) {
    const kind = classifyPart(part, ctors);
    if (kind === 'text') out += part.value;
    else if (kind === 'toolResult') {
      for (const inner of part.content || []) {
        if (classifyPart(inner, ctors) === 'text') out += inner.value;
      }
    }
  }
  return out;
}

/**
 * One-line-per-part description of a request's messages.
 * @param {readonly any[]} messages
 * @param {PartCtors} ctors
 */
function summarizeMessages(messages, ctors) {
  const roleCounts = /** @type {Record<string, number>} */ ({});
  const charsByRole = /** @type {Record<string, number>} */ ({});
  const partCounts = /** @type {Record<string, number>} */ ({});
  const perMessage = messages.map((m, index) => {
    const role = roleName(m.role);
    roleCounts[role] = (roleCounts[role] || 0) + 1;
    /** @type {{ kind: string, detail: string }[]} */
    const parts = (m.content || []).map((/** @type {any} */ part) => {
      const kind = classifyPart(part, ctors);
      partCounts[kind] = (partCounts[kind] || 0) + 1;
      let chars = 0;
      let detail = '';
      if (kind === 'text') {
        chars = part.value.length;
        detail = `${chars} chars`;
      } else if (kind === 'thinking') {
        chars = thinkingText(part).length;
        detail = `${chars} chars, id=${part.id ? 'yes' : 'no'}, metadata=${part.metadata ? Object.keys(part.metadata).join('|') || '{}' : 'none'}`;
      } else if (kind === 'toolCall') {
        chars = JSON.stringify(part.input ?? null).length;
        detail = `${part.name} (${part.callId})`;
      } else if (kind === 'toolResult') {
        const inner = (part.content || []).map((/** @type {unknown} */ c) => classifyPart(c, ctors));
        chars = messageText({ content: [part] }, ctors).length;
        detail = `${part.callId} [${inner.join(', ')}] ${chars} chars`;
      } else if (kind === 'data') {
        const bytes = part.data && part.data.length ? part.data.length : 0;
        detail = `${part.mimeType} ${bytes} bytes`;
      }
      charsByRole[role] = (charsByRole[role] || 0) + chars;
      return { kind, detail };
    });
    return { index, role, name: m.name || undefined, parts };
  });
  return { count: messages.length, roleCounts, charsByRole, partCounts, perMessage };
}

/**
 * @typedef {{ nonce: string, text: boolean, thinking: boolean, thinkingId: boolean,
 *   thinkingMetadata: boolean, data: boolean }} RoundTrip
 */

/**
 * Finds parts that the smoke provider emitted on earlier turns and that VS Code
 * sent back in this request's history (E4). Only assistant messages count.
 * @param {readonly any[]} messages
 * @param {PartCtors} ctors
 * @returns {{ roundTrips: RoundTrip[], usageParts: number }}
 */
function scanRoundTrips(messages, ctors) {
  /** @type {Map<string, RoundTrip>} */
  const found = new Map();
  /** @param {string} nonce */
  const entry = (nonce) => {
    let e = found.get(nonce);
    if (!e) {
      e = { nonce, text: false, thinking: false, thinkingId: false, thinkingMetadata: false, data: false };
      found.set(nonce, e);
    }
    return e;
  };
  let usageParts = 0;
  for (const m of messages) {
    if (roleName(m.role) !== 'assistant') continue;
    for (const part of m.content || []) {
      const kind = classifyPart(part, ctors);
      if (kind === 'text') {
        for (const n of String(part.value).match(NONCE_RE) || []) entry(n).text = true;
      } else if (kind === 'thinking') {
        for (const n of thinkingText(part).match(NONCE_RE) || []) {
          const e = entry(n);
          e.thinking = true;
          if (part.id === `think-${n}`) e.thinkingId = true;
          if (part.metadata && part.metadata.smokeNonce === n) e.thinkingMetadata = true;
        }
      } else if (kind === 'data') {
        if (part.mimeType === USAGE_MIME) usageParts++;
        if (part.mimeType === SMOKE_MIME) {
          try {
            const n = JSON.parse(decodeBytes(part.data)).smokeNonce;
            if (typeof n === 'string') entry(n).data = true;
          } catch {
            // not ours
          }
        }
      }
    }
  }
  return { roundTrips: [...found.values()], usageParts };
}

/**
 * Finds a `smoke:<command> args` directive in the text of the last user message.
 * Copilot wraps user text in its own prompt markup, so the search is not anchored.
 * @param {string} text
 * @returns {{ command: 'help' | 'tool' | 'error' | 'slow', args: string } | undefined}
 */
function parseCommand(text) {
  const m = /smoke:(help|tool|error|slow)\b([^\n]*)/.exec(text);
  if (!m) return undefined;
  return { command: /** @type {any} */ (m[1]), args: m[2].trim() };
}

/**
 * Parses `NAME {json}` from a smoke:tool directive. Text after the JSON (such as
 * a closing tag Copilot adds on the same line) is ignored.
 * @param {string} args
 * @returns {{ name?: string, input: object, error?: string }}
 */
function parseToolArgs(args) {
  const m = /^([^\s<>{}]+)\s*(.*)$/.exec(args);
  if (!m) return { input: {} };
  const name = m[1];
  const rest = m[2].trim();
  if (!rest.startsWith('{')) {
    return rest.startsWith('[') ? { name, input: {}, error: 'tool input must be a JSON object' } : { name, input: {} };
  }
  // Longest prefix ending in "}" that parses.
  let lastError = '';
  for (let end = rest.lastIndexOf('}'); end > 0; end = rest.lastIndexOf('}', end - 1)) {
    try {
      return { name, input: JSON.parse(rest.slice(0, end + 1)) };
    } catch (e) {
      lastError = lastError || /** @type {Error} */ (e).message;
    }
  }
  return { name, input: {}, error: `invalid JSON: ${lastError || 'no closing brace'}` };
}

/**
 * Keys and value types of an options bag, without values (they can be large or private).
 * @param {unknown} obj
 */
function describeKeys(obj) {
  if (!obj || typeof obj !== 'object') return [];
  return Object.keys(obj).sort().map((k) => {
    const v = /** @type {any} */ (obj)[k];
    const type = Array.isArray(v) ? `array(${v.length})` : v === null ? 'null' : typeof v === 'string' ? `string(${v.length})` : typeof v;
    return `${k}: ${type}`;
  });
}

/**
 * Crude local token estimate (chars / 4); the real provider will do better.
 * @param {string | any} input
 * @param {PartCtors} ctors
 */
function estimateTokens(input, ctors) {
  const text = typeof input === 'string' ? input : messageText(input, ctors);
  return Math.ceil(text.length / 4);
}

/**
 * 32-bit FNV-1a hash, to tell whether a text has been measured before without keeping it.
 * @param {string} text
 */
function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

module.exports = {
  fnv1a,
  SMOKE_MIME,
  USAGE_MIME,
  makeNonce,
  roleName,
  classifyPart,
  messageText,
  summarizeMessages,
  scanRoundTrips,
  parseCommand,
  parseToolArgs,
  describeKeys,
  estimateTokens,
};
