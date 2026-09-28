// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStatusBar } = require('../../src/ui/statusBar');

test('a cost-only update keeps the last known balance (live finding 2026-09-27: it showed "? left")', () => {
  /** @type {any} */
  const item = { show() {}, dispose() {} };
  const bar = createStatusBar(/** @type {any} */ ({ window: { createStatusBarItem: () => item }, StatusBarAlignment: { Right: 2 } }));
  bar.update({ remaining: 199000 });
  bar.update({ lastCostAs: 38.8 });
  assert.match(item.text, /199[,.\s]?000 left/);
  assert.equal(item.tooltip, 'Last request: ~38.8 Ask Sage tokens');
});

test('the burn-rate forecast (PLAN §3.5) appears in the tooltip alongside the last cost', () => {
  /** @type {any} */
  const item = { show() {}, dispose() {} };
  const bar = createStatusBar(/** @type {any} */ ({ window: { createStatusBarItem: () => item }, StatusBarAlignment: { Right: 2 } }));
  bar.update({ remaining: 500, lastCostAs: 10, forecast: "at this week's rate (100 AS/day) you run out around 3rd" });
  assert.equal(item.tooltip, "Last request: ~10 Ask Sage tokens\nat this week's rate (100 AS/day) you run out around 3rd");
});

test('a null forecast (not enough data yet) falls back to just the last cost', () => {
  /** @type {any} */
  const item = { show() {}, dispose() {} };
  const bar = createStatusBar(/** @type {any} */ ({ window: { createStatusBarItem: () => item }, StatusBarAlignment: { Right: 2 } }));
  bar.update({ remaining: 500, lastCostAs: 10, forecast: null });
  assert.equal(item.tooltip, 'Last request: ~10 Ask Sage tokens');
});
