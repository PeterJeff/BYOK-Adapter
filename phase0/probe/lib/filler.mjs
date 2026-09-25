// @ts-check
// Deterministic synthetic text for cache tests. No real data ever goes into a probe prompt.
// The same seed always gives the same text, so fixtures can elide it to a hash and a
// reader can regenerate it.

const WORDS = (
  'the of and to in is it that for on with as was at by be this have from or one had not but what all were when we there can an ' +
  'your which their said if do will each about how up out them then she many some so these would other into has more her two like ' +
  'him see time could no make than first been its who now people my made over did down only way find use may water long little very ' +
  'after words called just where most know get through back much before go good new write our used me man too any day same right ' +
  'look think also around another came come work three word must because does part even place well such here take why things help ' +
  'put years different away again off went old number great tell men say small every found still between name should home big give ' +
  'air line set own under read last never us left end along while might next sound below saw something thought both few those always ' +
  'looked show large often together asked house world going want school important until form food keep children feet land side without ' +
  'boy once animals life enough took sometimes four head above kind began almost live page got earth need far hand high year mother ' +
  'light parts country father let night following picture being study second eyes soon times story boys since white days ever paper ' +
  'hard near sentence better best across during today others however sure means knew try told young miles sun ways thing whole hear ' +
  'example heard several change answer room sea against top turned learn point city play toward five using himself usually river'
).split(' ');

/**
 * @param {number} seed
 */
function rng(seed) {
  let x = seed >>> 0 || 0x9e3779b9;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0x100000000;
  };
}

/**
 * About `tokens` tokens of plain English-like filler (about 4.3 characters per token).
 * @param {number} seed
 * @param {number} tokens
 */
export function filler(seed, tokens) {
  const r = rng(seed);
  const targetChars = Math.round(tokens * 4.3);
  const out = [];
  let chars = 0;
  let para = 0;
  while (chars < targetChars) {
    const len = 8 + Math.floor(r() * 12);
    const words = [];
    for (let i = 0; i < len; i++) words.push(WORDS[Math.floor(r() * WORDS.length)]);
    let s = words.join(' ');
    s = s[0].toUpperCase() + s.slice(1) + '.';
    out.push(s);
    chars += s.length + 1;
    if (++para % 6 === 0) out.push('\n\n');
  }
  return out.join(' ').replace(/ \n\n /g, '\n\n');
}

/** Rough local token estimate (the APIs report the real count). @param {string} s */
export const estTokens = (s) => Math.ceil(String(s).length / 4);

/**
 * A run-unique marker placed at the very start of cached prefixes, so a previous run's
 * cache entries can never be read by this run.
 * @param {string} runId
 * @param {string} tag
 */
export const nonce = (runId, tag) => `[probe ${runId} ${tag}]`;
