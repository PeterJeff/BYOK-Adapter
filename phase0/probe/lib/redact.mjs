// @ts-check
// Fixture redaction for the Phase 0b API probe (PLAN.md §6). Pure: no fs, no network.
//
// Everything the probe records passes through a redactor before it is written:
//   - known secrets (API key, access token) and the account email are replaced verbatim
//   - anything shaped like a JWT or an email address is replaced
//   - identity fields (user/org ids, names, emails, tokens) are replaced by key name
//   - tenant host names are replaced by the tenant alias
//   - long synthetic strings in requests are elided to a hash and length, so fixtures stay small
// A final scan refuses to hand back text that still contains a known secret.

import { createHash } from 'node:crypto';

const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Keys whose values identify a person, an organization or a credential. */
export const IDENTITY_KEY_RE =
  /^(user|user_?id|userid|username|user_?name|email|e_?mail|first_?name|last_?name|full_?name|phone|org|org_?id|org_?name|organization|organization_?id|organization_?name|tenant_?id|account_?id|safety_identifier|api_?key|access_?token|refresh_?token|id_?token|token|x-access-tokens|x-api-key|x-goog-api-key|authorization|password|secret|ip|ip_?address)$/i;

/** Response headers worth keeping; everything else (cookies, internal hosts, request ids) is dropped. */
export const KEEP_HEADER_RE = /^(content-type|content-encoding|retry-after|x-ratelimit-.*|anthropic-ratelimit-.*|openai-processing-ms)$/i;

/** Request strings longer than this are elided (synthetic filler, tool lists). */
export const ELIDE_CHARS = 2000;
/** Response strings longer than this are truncated (long model output, opaque blobs). */
export const TRUNCATE_CHARS = 4000;

/** @param {string} s */
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/**
 * @param {{ secrets?: (string | undefined | null)[], hosts?: (string | undefined | null)[], alias: string }} opts
 */
export function createRedactor(opts) {
  if (!opts.alias) throw new Error('a tenant alias is required for redaction');
  const secrets = (opts.secrets || []).filter((s) => typeof s === 'string' && s.length >= 6).map(String);
  const hosts = (opts.hosts || []).filter((h) => typeof h === 'string' && h.length > 0).map((h) => String(h).toLowerCase());
  // Longest first, so "api.x.y" is replaced before "x.y".
  hosts.sort((a, b) => b.length - a.length);
  const aliasTag = `<${opts.alias}>`;

  /** @param {string} s */
  function text(s) {
    let out = s;
    for (const sec of secrets) out = out.split(sec).join('<redacted:secret>');
    out = out.replace(JWT_RE, '<redacted:jwt>');
    out = out.replace(EMAIL_RE, '<redacted:email>');
    for (const h of hosts) out = replaceCaseInsensitive(out, h, aliasTag);
    return out;
  }

  /**
   * Deep-redacts a JSON-compatible value.
   * @param {unknown} v
   * @param {{ elide?: number, truncate?: number }} [limits]
   * @returns {unknown}
   */
  function value(v, limits = {}) {
    return walk(v, undefined, limits);
  }

  /**
   * @param {unknown} v
   * @param {string | undefined} key
   * @param {{ elide?: number, truncate?: number }} limits
   * @returns {unknown}
   */
  function walk(v, key, limits) {
    if (key !== undefined && IDENTITY_KEY_RE.test(key) && v !== null && v !== undefined && v !== '' && typeof v !== 'boolean' && typeof v !== 'object') {
      return '<redacted>';
    }
    if (typeof v === 'string') return shorten(text(v), limits);
    if (Array.isArray(v)) return v.map((x) => walk(x, undefined, limits));
    if (v && typeof v === 'object') {
      /** @type {Record<string, unknown>} */
      const out = {};
      for (const [k, x] of Object.entries(v)) {
        if (IDENTITY_KEY_RE.test(k) && x && typeof x === 'object') out[k] = '<redacted:object>';
        else out[text(k)] = walk(x, k, limits);
      }
      return out;
    }
    return v;
  }

  /**
   * @param {string} s
   * @param {{ elide?: number, truncate?: number }} limits
   */
  function shorten(s, limits) {
    if (limits.elide && s.length > limits.elide) return `<elided chars=${s.length} sha256=${sha256(s).slice(0, 16)}>`;
    if (limits.truncate && s.length > limits.truncate) return `${s.slice(0, limits.truncate)}<truncated chars=${s.length}>`;
    return s;
  }

  /**
   * Throws if the text still contains something that must never be written.
   * @param {string} s
   */
  function assertClean(s) {
    for (const sec of secrets) if (s.includes(sec)) throw new Error('redaction failed: a secret is still present; nothing was written');
    if (JWT_RE.test(s)) throw new Error('redaction failed: a JWT is still present; nothing was written');
    JWT_RE.lastIndex = 0;
    const lower = s.toLowerCase();
    for (const h of hosts) if (lower.includes(h)) throw new Error(`redaction failed: tenant host still present; nothing was written`);
    return s;
  }

  /**
   * Serializes a record for writing: redacts, then scans.
   * @param {unknown} v
   */
  function serialize(v) {
    return assertClean(JSON.stringify(value(v), null, 1) + '\n');
  }

  /**
   * Adds a secret learned later (the access token).
   * @param {string | null | undefined} s
   */
  function addSecret(s) {
    if (typeof s === 'string' && s.length >= 6 && !secrets.includes(s)) secrets.push(s);
  }

  return { text, value, assertClean, serialize, addSecret, alias: opts.alias };
}

/**
 * @param {string} s
 * @param {string} needle lowercase
 * @param {string} repl
 */
function replaceCaseInsensitive(s, needle, repl) {
  if (!needle) return s;
  const lower = s.toLowerCase();
  let i = lower.indexOf(needle);
  if (i < 0) return s;
  let out = '';
  let last = 0;
  while (i >= 0) {
    out += s.slice(last, i) + repl;
    last = i + needle.length;
    i = lower.indexOf(needle, last);
  }
  return out + s.slice(last);
}

/**
 * Keeps only allow-listed response headers.
 * @param {Headers | Record<string, string> | undefined | null} headers
 */
export function keepHeaders(headers) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!headers) return out;
  const entries = typeof (/** @type {any} */ (headers).entries) === 'function' ? [.../** @type {Headers} */ (headers).entries()] : Object.entries(headers);
  for (const [k, v] of entries) if (KEEP_HEADER_RE.test(k)) out[k.toLowerCase()] = String(v);
  return out;
}

/** Fields of the full user object whose values are recorded (T0). Everything else is shape only. */
export const USER_VALUE_KEYS = [
  'max_tokens',
  'max_train_tokens',
  'force_models',
  'force_gov_models',
  'force_dod_models',
  'paid',
  'is_paid',
  'plan',
  'tier',
  'role',
  'deployment_type',
  'classification_level',
];

/**
 * Summarizes the full user object for a fixture: every key with its type, and values only
 * for allow-listed budget and model-restriction fields. Custom intro prompt: presence and
 * length only. Numeric fields whose names mention tokens, limits or pools keep their values,
 * because they are the budget signals T0 is looking for.
 * @param {unknown} user
 * @param {number} [depth]
 * @returns {unknown}
 */
export function summarizeUser(user, depth = 0) {
  if (!user || typeof user !== 'object' || Array.isArray(user)) return typeOf(user);
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(user)) {
    if (IDENTITY_KEY_RE.test(k)) out[k] = typeOf(v);
    else if (/intro_prompt|persona_prompt|system_prompt/i.test(k)) out[k] = { type: typeOf(v), chars: typeof v === 'string' ? v.length : 0 };
    else if (USER_VALUE_KEYS.includes(k) && (typeof v !== 'object' || v === null || Array.isArray(v))) out[k] = Array.isArray(v) ? v.filter((x) => typeof x === 'string' || typeof x === 'number') : v;
    else if (typeof v === 'number' && /token|limit|pool|quota|budget|cap|allocation/i.test(k)) out[k] = v;
    else if (typeof v === 'boolean' && /token|limit|pool|quota|budget|force|model|paid|cui/i.test(k)) out[k] = v;
    else if (v && typeof v === 'object' && !Array.isArray(v) && depth < 2) out[k] = summarizeUser(v, depth + 1);
    else out[k] = typeOf(v);
  }
  return out;
}

/** @param {unknown} v */
function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `array(${v.length})`;
  if (typeof v === 'string') return v === '' ? 'string(empty)' : 'string';
  return typeof v;
}

/**
 * Shape of a JWT: claim names and lifetime, never the claim values.
 * @param {string} token
 */
export function jwtShape(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return { jwt: false, chars: String(token || '').length };
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const lifetimeS = typeof payload.exp === 'number' && typeof payload.iat === 'number' ? payload.exp - payload.iat : null;
    return { jwt: true, alg: typeof header.alg === 'string' ? header.alg : null, claims: Object.keys(payload).sort(), lifetimeS };
  } catch {
    return { jwt: false, chars: token.length };
  }
}
