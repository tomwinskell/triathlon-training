import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDays, dayName, daysBetween, parseDate, todayIn, weekOf } from '../src/dates.ts';
import { d, plan } from './helpers.ts';

test('weekOf: Monday and Sunday boundaries', () => {
  assert.equal(weekOf(plan, d('2026-11-16'))?.n, 1); // first Monday
  assert.equal(weekOf(plan, d('2026-11-22'))?.n, 1); // first Sunday
  assert.equal(weekOf(plan, d('2026-11-23'))?.n, 2);
  assert.equal(weekOf(plan, d('2027-09-12'))?.n, 43); // last day
});

test('weekOf: undefined outside the plan', () => {
  assert.equal(weekOf(plan, d('2026-11-15')), undefined);
  assert.equal(weekOf(plan, d('2027-09-13')), undefined);
});

test('todayIn: still the previous day in Toronto after UTC midnight', () => {
  assert.equal(todayIn('America/Toronto', new Date('2026-11-20T00:30:00Z')), '2026-11-19'); // 19:30 EST
  assert.equal(todayIn('America/Toronto', new Date('2026-11-20T04:59:59Z')), '2026-11-19'); // 23:59:59 EST
  assert.equal(todayIn('America/Toronto', new Date('2026-11-20T05:00:00Z')), '2026-11-20'); // midnight EST
});

test('todayIn: day boundary moves from 05:00Z to 04:00Z when DST starts (2027-03-14)', () => {
  assert.equal(todayIn('America/Toronto', new Date('2027-03-13T04:59:59Z')), '2027-03-12');
  assert.equal(todayIn('America/Toronto', new Date('2027-03-13T05:00:00Z')), '2027-03-13');
  assert.equal(todayIn('America/Toronto', new Date('2027-03-15T03:59:59Z')), '2027-03-14'); // 23:59:59 EDT
  assert.equal(todayIn('America/Toronto', new Date('2027-03-15T04:00:00Z')), '2027-03-15'); // midnight EDT
});

test('todayIn: day boundary moves back to 05:00Z when DST ends (2026-11-01)', () => {
  assert.equal(todayIn('America/Toronto', new Date('2026-11-01T03:59:59Z')), '2026-10-31'); // 23:59:59 EDT
  assert.equal(todayIn('America/Toronto', new Date('2026-11-01T04:00:00Z')), '2026-11-01');
  assert.equal(todayIn('America/Toronto', new Date('2026-11-02T04:59:59Z')), '2026-11-01'); // 23:59:59 EST
  assert.equal(todayIn('America/Toronto', new Date('2026-11-02T05:00:00Z')), '2026-11-02');
});

test('addDays, daysBetween and dayName ignore DST', () => {
  assert.equal(addDays(d('2027-03-13'), 2), '2027-03-15');
  assert.equal(addDays(d('2026-11-30'), -1), '2026-11-29');
  assert.equal(daysBetween(d('2027-03-13'), d('2027-03-15')), 2);
  assert.equal(dayName(d('2026-11-19')), 'Thu');
  assert.equal(dayName(d('2026-11-22')), 'Sun');
});

test('parseDate rejects impossible dates', () => {
  assert.equal(parseDate('2026-02-30'), null);
  assert.equal(parseDate('2026-2-3'), null);
  assert.equal(parseDate('2026-11-19'), '2026-11-19');
});
