// @ts-check
// Budget counters for the probe (PLAN.md §3.3, §3.6, T19).
//   used       GET  /server/count-monthly-tokens               (all apps; POST filters by app_name)
//   remaining  POST /server/count-monthly-tokens-left-with-org  (user cap combined with org pool)
// Counters may update with a lag, so a delta is read by polling until the value settles.

/**
 * @typedef {{ tMs: number, used: number | null, left: number | null }} Reading
 * @typedef {{ call: (o: import('./client.mjs').CallOptions) => Promise<import('./client.mjs').Exchange> }} Client
 */

/** @param {unknown} v */
function num(v) {
  const x = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null;
}

/**
 * @param {Client} client
 * @param {() => number} [clock]
 * @returns {Promise<Reading & { exchanges: import('./client.mjs').Exchange[] }>}
 */
export async function readBudget(client, clock = Date.now) {
  const [u, l] = await Promise.all([
    client.call({ label: 'count-monthly-tokens', kind: 'server', method: 'GET', path: '/server/count-monthly-tokens' }),
    client.call({ label: 'count-monthly-tokens-left-with-org', kind: 'server', path: '/server/count-monthly-tokens-left-with-org', body: {} }),
  ]);
  return { tMs: clock(), used: num(/** @type {any} */ (u.body)?.response), left: num(/** @type {any} */ (l.body)?.response), exchanges: [u, l] };
}

/**
 * Polls until `used` has moved away from `before` and then stays put for `stablePolls`
 * consecutive readings, or until `maxMs` passes.
 * @param {Client} client
 * @param {Reading} before
 * @param {{ pollMs?: number, maxMs?: number, minMs?: number, stablePolls?: number,
 *   sleep?: (ms: number) => Promise<void>, clock?: () => number }} [o]
 */
export async function settle(client, before, o = {}) {
  const pollMs = o.pollMs ?? 5000;
  const maxMs = o.maxMs ?? 60000;
  const minMs = o.minMs ?? 0;
  const stablePolls = o.stablePolls ?? 1;
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const clock = o.clock || Date.now;
  const start = clock();
  /** @type {Reading[]} */
  const polls = [];
  let moved = false;
  let stable = 0;
  /** @type {Reading} */
  let last = before;
  for (;;) {
    await sleep(pollMs);
    const r = await readBudget(client, clock);
    const reading = { tMs: r.tMs - start, used: r.used, left: r.left };
    polls.push(reading);
    const changed = reading.used !== last.used || reading.left !== last.left;
    if (reading.used !== before.used || reading.left !== before.left) moved = true;
    stable = moved && !changed ? stable + 1 : 0;
    last = reading;
    const elapsed = clock() - start;
    if (moved && stable >= stablePolls && elapsed >= minMs) break;
    if (elapsed >= maxMs) break;
  }
  return {
    polls,
    settled: moved && stable >= stablePolls,
    usedDelta: last.used !== null && before.used !== null ? last.used - before.used : null,
    leftDelta: last.left !== null && before.left !== null ? before.left - last.left : null,
    after: last,
    firstMoveMs: polls.find((p) => p.used !== before.used || p.left !== before.left)?.tMs ?? null,
  };
}
