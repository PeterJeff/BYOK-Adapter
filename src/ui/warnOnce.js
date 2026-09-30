// @ts-check
'use strict';

// Rate limit for user-visible warnings: a warning that fires every round of an agent
// loop would bury the chat in notifications, so the same key is shown at most once per window.
// Pure: the clock is injected.

/**
 * @param {{ windowMs?: number, now?: () => number }} [o]
 * @returns {(key: string) => boolean} true when the warning for `key` should be shown now
 */
function createWarnOnce(o = {}) {
  const windowMs = o.windowMs ?? 10 * 60 * 1000;
  const now = o.now || Date.now;
  /** @type {Map<string, number>} */
  const shown = new Map();
  return (key) => {
    const t = now();
    for (const [k, at] of shown) if (t - at >= windowMs) shown.delete(k);
    if (shown.has(key)) return false;
    shown.set(key, t);
    return true;
  };
}

module.exports = { createWarnOnce };
