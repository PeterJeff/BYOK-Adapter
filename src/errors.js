// @ts-check
'use strict';

// Error-envelope detection, ported from phase0/probe/lib/streams.mjs `detectError` (research,
// ESM) to CommonJS for runtime use. Pure: detectError takes no vscode import. toLanguageModelError
// is the only vscode-touching part, and it feature-detects.

/**
 * @typedef {{ shape: string, status?: number | string, message: string }} DetectedError
 */

/** @param {unknown} m */
function messageOf(m) {
  const s = typeof m === 'string' ? m : JSON.stringify(m);
  return String(s ?? '').slice(0, 500);
}

/**
 * Detects an error in a parsed body or stream event, in any of the shapes seen:
 *   Ask Sage envelope    {"response": "Token is invalid [1]", "status": 400}   (HTTP 200)
 *   Anthropic            {"type": "error", "error": {"type": "...", "message": "..."}}
 *   OpenAI               {"error": {"message": "...", "type": "...", "code": ...}}
 *   Responses stream     {"type": "response.failed" | "error", ...}
 *   Gemini               {"error": {"code": 400, "message": "...", "status": "INVALID_ARGUMENT"}}
 * @param {unknown} j
 * @returns {DetectedError | null}
 */
function detectError(j) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const o = /** @type {Record<string, any>} */ (j);
  if ('status' in o && 'response' in o && !('choices' in o) && !('content' in o)) {
    const st = Number(o.status);
    if (Number.isFinite(st) && st >= 400) return { shape: 'asksage-envelope', status: o.status, message: messageOf(o.response) };
  }
  if (o.type === 'error' && o.error) return { shape: 'anthropic-error', status: o.error.type, message: messageOf(o.error.message ?? o.error) };
  if (o.type === 'response.failed' || o.type === 'response.error') return { shape: 'responses-failed', status: o.response?.error?.code, message: messageOf(o.response?.error?.message ?? o.response?.error ?? o) };
  if (o.type === 'error' && ('message' in o || 'code' in o)) return { shape: 'responses-error', status: o.code, message: messageOf(o.message) };
  if (o.error && typeof o.error === 'object') return { shape: o.error.status ? 'gemini-error' : 'openai-error', status: o.error.code ?? o.error.status ?? o.error.type, message: messageOf(o.error.message ?? o.error) };
  if (typeof o.error === 'string' && o.error) return { shape: 'string-error', status: o.status, message: o.error };
  return null;
}

/** Bad-credential message text every flavor returns (CLAUDE.md, PLAN.md §7). */
const AUTH_INVALID_RE = /token is invalid/i;

/**
 * @param {DetectedError | null} e
 */
function isAuthInvalid(e) {
  return !!e && AUTH_INVALID_RE.test(e.message);
}

/** The real cap, when a request is rejected for exceeding it (observed 2026-09-27, gpt-5.6-luna:
 *  "max_tokens is too large: 100000. This model supports at most 32768 completion tokens..."). */
const OUTPUT_CAP_RE = /supports at most ([\d,]+) (?:completion|output) tokens/i;

/**
 * @param {DetectedError | null} e
 * @returns {number | null}
 */
function parseOutputCapTooLarge(e) {
  const m = e && OUTPUT_CAP_RE.exec(e.message);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Preserved-thinking rejection (PLAN.md §5, Opus 5.5/Fable 5.1): editing the prefix a signed
 *  thinking block is bound to (a changed system prompt, a summarized/trimmed history) returns a
 *  400 on accounts that enforce the check. The exact wording is unconfirmed through Ask Sage
 *  (REQUIREMENTS.md §3, "untested"), so this matches loosely on the concepts Anthropic's own docs
 *  use rather than one exact string, and a false negative just surfaces the raw error instead of
 *  retrying -- the safe failure direction. */
const THINKING_BOUND_RE = /thinking/i;
const SIGNATURE_OR_PREFIX_RE = /signature|bound to|different conversation|prefix/i;

/**
 * @param {DetectedError | null} e
 */
function isThinkingBoundRejection(e) {
  return !!e && THINKING_BOUND_RE.test(e.message) && SIGNATURE_OR_PREFIX_RE.test(e.message);
}

/**
 * Converts a detected error (or a transport-level exception) into a vscode.LanguageModelError
 * when the API is present, else a plain Error. Feature-detected per CLAUDE.md's stable-API rule.
 * @param {import('vscode')} vscode
 * @param {DetectedError | Error | null} e
 */
function toLanguageModelError(vscode, e) {
  const message = e instanceof Error ? e.message : e ? `${e.shape}: ${e.message}` : 'unknown error';
  const LanguageModelError = /** @type {any} */ (vscode).LanguageModelError;
  if (LanguageModelError && typeof LanguageModelError.Blocked === 'function') return LanguageModelError.Blocked(message);
  return new Error(message);
}

module.exports = { detectError, isAuthInvalid, parseOutputCapTooLarge, isThinkingBoundRejection, toLanguageModelError };
