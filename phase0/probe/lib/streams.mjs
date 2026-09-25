// @ts-check
// Stream and error-envelope parsing for the probe. Pure.
//
//   SSE          Anthropic Messages, OpenAI Chat Completions / Responses, Gemini (?alt=sse)
//   @|@sep@|@    Ask Sage native /query_stream (text/plain, JSON chunks split on a delimiter)
//   envelopes    Ask Sage answers many errors with HTTP 200 and {"response": "...", "status": 400}

/**
 * Incremental Server-Sent Events parser. Feed decoded text chunks; complete events come out.
 * Handles CRLF, multi-line `data:`, comments and a final event without a trailing blank line.
 */
export class SseParser {
  constructor() {
    this.buf = '';
    /** @type {{ event?: string, data: string[] }} */
    this.cur = { data: [] };
  }

  /**
   * @param {string} chunk
   * @returns {{ event?: string, data: string }[]}
   */
  feed(chunk) {
    this.buf += chunk;
    /** @type {{ event?: string, data: string }[]} */
    const out = [];
    let nl;
    while ((nl = this.buf.search(/\r\n|\r|\n/)) >= 0) {
      const line = this.buf.slice(0, nl);
      const sepLen = this.buf.startsWith('\r\n', nl) ? 2 : 1;
      // A lone trailing "\r" may be the first half of "\r\n": wait for more input.
      if (sepLen === 1 && this.buf[nl] === '\r' && nl === this.buf.length - 1) break;
      this.buf = this.buf.slice(nl + sepLen);
      this.line(line, out);
    }
    return out;
  }

  /** @returns {{ event?: string, data: string }[]} */
  end() {
    /** @type {{ event?: string, data: string }[]} */
    const out = [];
    if (this.buf) this.line(this.buf, out);
    this.buf = '';
    this.line('', out);
    return out;
  }

  /**
   * @param {string} line
   * @param {{ event?: string, data: string }[]} out
   */
  line(line, out) {
    if (line === '') {
      if (this.cur.data.length || this.cur.event) out.push({ ...(this.cur.event ? { event: this.cur.event } : {}), data: this.cur.data.join('\n') });
      this.cur = { data: [] };
      return;
    }
    if (line.startsWith(':')) return;
    const i = line.indexOf(':');
    const field = i < 0 ? line : line.slice(0, i);
    let val = i < 0 ? '' : line.slice(i + 1);
    if (val.startsWith(' ')) val = val.slice(1);
    if (field === 'data') this.cur.data.push(val);
    else if (field === 'event') this.cur.event = val;
  }
}

/**
 * Parses a complete SSE body into events with JSON data where possible.
 * @param {string} text
 */
export function parseSse(text) {
  const p = new SseParser();
  return [...p.feed(text), ...p.end()].map(sseEventJson);
}

/**
 * @param {{ event?: string, data: string }} e
 * @returns {{ event?: string, data: unknown, raw?: string }}
 */
export function sseEventJson(e) {
  if (e.data === '[DONE]') return { ...(e.event ? { event: e.event } : {}), data: '[DONE]' };
  try {
    return { ...(e.event ? { event: e.event } : {}), data: JSON.parse(e.data) };
  } catch {
    return { ...(e.event ? { event: e.event } : {}), data: null, raw: e.data };
  }
}

export const SEP = '@|@sep@|@';
const SEP_ESCAPED = '@|@@sep@@|@';

/**
 * Splits an Ask Sage /query_stream body into JSON chunks.
 * @param {string} text
 * @returns {{ data: unknown, raw?: string }[]}
 */
export function splitSepStream(text) {
  return text
    .split(SEP)
    .map((s) => s.split(SEP_ESCAPED).join(SEP).trim())
    .filter(Boolean)
    .map((s) => {
      try {
        return { data: JSON.parse(s) };
      } catch {
        return { data: null, raw: s };
      }
    });
}

/**
 * Detects an error in a parsed body or stream event, in any of the shapes seen:
 *   Ask Sage envelope    {"response": "Token is invalid [1]", "status": 400}
 *   Anthropic            {"type": "error", "error": {"type": "...", "message": "..."}}
 *   OpenAI               {"error": {"message": "...", "type": "...", "code": ...}}
 *   Responses stream     {"type": "response.failed" | "error", ...}
 *   Gemini               {"error": {"code": 400, "message": "...", "status": "INVALID_ARGUMENT"}}
 * @param {unknown} j
 * @returns {{ shape: string, status?: number | string, message: string } | null}
 */
export function detectError(j) {
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

/** @param {unknown} m */
function messageOf(m) {
  const s = typeof m === 'string' ? m : JSON.stringify(m);
  return String(s ?? '').slice(0, 500);
}
