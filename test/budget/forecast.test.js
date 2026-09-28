// @ts-check
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { forecastBurnRate, ordinal } = require('../../src/budget/forecast');

test('ordinal: the 11th/12th/13th are "th", not "st"/"nd"/"rd"', () => {
  assert.equal(ordinal(1), '1st');
  assert.equal(ordinal(2), '2nd');
  assert.equal(ordinal(3), '3rd');
  assert.equal(ordinal(4), '4th');
  assert.equal(ordinal(11), '11th');
  assert.equal(ordinal(12), '12th');
  assert.equal(ordinal(13), '13th');
  assert.equal(ordinal(21), '21st');
  assert.equal(ordinal(22), '22nd');
});

test('forecastBurnRate: null when the remaining balance is unknown', () => {
  assert.equal(forecastBurnRate([], null), null);
  assert.equal(forecastBurnRate([], undefined), null);
});

test('forecastBurnRate: null when there is no spend in the window', () => {
  assert.equal(forecastBurnRate([], 1000), null);
  const old = [{ ts: '2026-01-01T00:00:00.000Z', estAsCost: 500 }];
  assert.equal(forecastBurnRate(old, 1000, { now: Date.parse('2026-09-28T00:00:00.000Z') }), null);
});

test('forecastBurnRate: projects a run-out date from this window\'s daily average', () => {
  const now = Date.parse('2026-09-28T12:00:00.000Z');
  const records = [
    { ts: '2026-09-22T00:00:00.000Z', estAsCost: 700 }, // 700 AS over 7 days = 100 AS/day
  ];
  const text = forecastBurnRate(records, 500, { now, windowDays: 7 });
  // 500 remaining / 100 per day = 5 days out from 2026-09-28 -> 2026-10-03
  assert.match(/** @type {string} */ (text), /100 AS\/day/);
  assert.match(/** @type {string} */ (text), /3rd/);
});

test('forecastBurnRate: only counts spend inside the window, ignores older/future records', () => {
  const now = Date.parse('2026-09-28T00:00:00.000Z');
  const records = [
    { ts: '2026-09-27T00:00:00.000Z', estAsCost: 70 }, // inside window
    { ts: '2026-01-01T00:00:00.000Z', estAsCost: 10000 }, // too old
    { ts: '2026-10-01T00:00:00.000Z', estAsCost: 10000 }, // in the future
    { ts: '2026-09-27T00:00:00.000Z', estAsCost: null }, // intercepted/no-cost record
  ];
  const text = forecastBurnRate(records, 700, { now, windowDays: 7 });
  // 70 AS / 7 days = 10 AS/day; 700 remaining / 10 = 70 days out
  assert.match(/** @type {string} */ (text), /10 AS\/day/);
});

test('forecastBurnRate: a very slow burn rate says the budget lasts well over a year instead of a bogus date', () => {
  const now = Date.parse('2026-09-28T00:00:00.000Z');
  const records = [{ ts: '2026-09-27T00:00:00.000Z', estAsCost: 0.01 }];
  const text = forecastBurnRate(records, 1000000, { now, windowDays: 7 });
  assert.match(/** @type {string} */ (text), /well over a year/);
});
