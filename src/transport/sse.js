// @ts-check
'use strict';

// Server-Sent Events parsing, ported from phase0/probe/lib/streams.mjs (research, ESM) to
// CommonJS for runtime use. Pure; no vscode or network imports.

/**
 * Incremental Server-Sent Events parser. Feed decoded text chunks; complete events come out.
 * Handles CRLF, multi-line `data:`, comments and a final event without a trailing blank line.
 */
class SseParser {
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
function parseSse(text) {
  const p = new SseParser();
  return [...p.feed(text), ...p.end()].map(sseEventJson);
}

/**
 * @param {{ event?: string, data: string }} e
 * @returns {{ event?: string, data: unknown, raw?: string }}
 */
function sseEventJson(e) {
  if (e.data === '[DONE]') return { ...(e.event ? { event: e.event } : {}), data: '[DONE]' };
  try {
    return { ...(e.event ? { event: e.event } : {}), data: JSON.parse(e.data) };
  } catch {
    return { ...(e.event ? { event: e.event } : {}), data: null, raw: e.data };
  }
}

module.exports = { SseParser, parseSse, sseEventJson };
