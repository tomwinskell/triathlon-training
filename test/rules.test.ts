import assert from 'node:assert/strict';
import { test } from 'node:test';
import { outcomes } from '../src/plan-state.ts';
import { RULES } from '../src/rules/index.ts';
import type { Suggestion } from '../src/types.ts';
import { accepted, ctxFor, logSession, open, readiness, record, k } from './helpers.ts';

const one = (list: readonly Suggestion[]) => {
  assert.equal(list.length, 1, `expected exactly one suggestion, got ${JSON.stringify(list.map((s) => s.id))}`);
  return list[0]!;
};

// ---- amber readiness (today 2026-11-19 is week 1 Thursday) -------------------

test('amber: two flags skip the optional Thursday run and ease the next hard session', () => {
  const s = one(RULES['amber-readiness'](ctxFor('2026-11-19', [readiness('2026-11-19', { sleep: 5, fatigue: 4 })])));
  assert.equal(s.id, 'amber-readiness:2026-11-19');
  assert.equal(s.severity, 'warn');
  assert.deepEqual(s.edits, [
    { op: 'skip', key: '2026-11-19#2' }, // optional 15 min run
    { op: 'adjust', key: '2026-11-20#1', rpeDelta: -1 }, // Fri Endurance 1: first upcoming session with RPE max 6
  ]);
});

test('amber: a single flag does not fire', () => {
  for (const r of [{ sleep: 5 }, { fatigue: 4 }, { pain: 3 }, { sleep: 6, fatigue: 3, pain: 2 }]) {
    assert.deepEqual(RULES['amber-readiness'](ctxFor('2026-11-19', [readiness('2026-11-19', r)])), [], JSON.stringify(r));
  }
});

test('amber: each flag combination at the threshold fires', () => {
  assert.equal(RULES['amber-readiness'](ctxFor('2026-11-19', [readiness('2026-11-19', { sleep: 5.9, pain: 3 })])).length, 1);
  assert.equal(RULES['amber-readiness'](ctxFor('2026-11-19', [readiness('2026-11-19', { fatigue: 4, pain: 3 })])).length, 1);
});

test('amber: yesterday counts, two days ago does not, the latest entry decides', () => {
  const bad = { sleep: 5, fatigue: 5 };
  assert.equal(RULES['amber-readiness'](ctxFor('2026-11-19', [readiness('2026-11-18', bad)])).length, 1);
  assert.equal(RULES['amber-readiness'](ctxFor('2026-11-19', [readiness('2026-11-17', bad)])).length, 0);
  assert.equal(RULES['amber-readiness'](ctxFor('2026-11-19', [readiness('2026-11-18', bad), readiness('2026-11-19', { sleep: 8 })])).length, 0);
});

test('amber: an already skipped or done optional run is not suggested again', () => {
  const log = [readiness('2026-11-19', { sleep: 5, fatigue: 4 }), logSession('2026-11-19#2', 'done')];
  assert.deepEqual(one(RULES['amber-readiness'](ctxFor('2026-11-19', log))).edits.map((e) => e.op), ['adjust']);
});

test('accepting the amber suggestion skips the optional run and hides the suggestion; rejecting hides it without edits', () => {
  const log = [readiness('2026-11-19', { sleep: 5, fatigue: 4 })];
  const s = one(open(ctxFor('2026-11-19', log)));

  const overrides = accepted(s);
  const after = ctxFor('2026-11-19', log, overrides);
  assert.deepEqual(open(after, overrides), []);
  const out = outcomes(after.sessions, log, after.today);
  assert.equal(out.get(k('2026-11-19#2')), 'skipped');
  assert.equal(after.sessions.find((x) => x.key === '2026-11-20#1')!.rpe.max, 5); // 6 -> 5

  const rejected = [{ op: 'reject' as const, id: 'r', at: 'x', suggestion: s.id }];
  const afterReject = ctxFor('2026-11-19', log, rejected);
  assert.deepEqual(open(afterReject, rejected), []);
  assert.equal(outcomes(afterReject.sessions, log, afterReject.today).get(k('2026-11-19#2')), 'pending');
});

// ---- pain stop ---------------------------------------------------------------

test('pain-stop: pain 5 stops running for 7 days, including bricks and the long run, but not swim or bike', () => {
  const s = one(RULES['pain-stop'](ctxFor('2026-11-19', [readiness('2026-11-19', { pain: 5 })])));
  assert.equal(s.severity, 'stop');
  assert.equal(s.message, 'Stop running and see a physio.');
  const keys = s.edits.map((e) => e.key as string);
  for (const must of ['2026-11-19#2', '2026-11-21#2', '2026-11-22#1', '2026-11-24#1']) assert.ok(keys.includes(must), must);
  for (const mustNot of ['2026-11-19#1', '2026-11-20#1', '2026-11-21#1', '2026-11-26#2']) assert.ok(!keys.includes(mustNot), mustNot);
  assert.ok(s.edits.every((e) => e.op === 'skip'));
});

test('pain-stop: sharp or worsening trend fires at low pain; stable pain 4 does not', () => {
  for (const trend of ['sharp', 'worsening'] as const) assert.equal(RULES['pain-stop'](ctxFor('2026-11-19', [readiness('2026-11-19', { pain: 1, trend })])).length, 1, trend);
  assert.deepEqual(RULES['pain-stop'](ctxFor('2026-11-19', [readiness('2026-11-19', { pain: 4, trend: 'stable' })])), []);
  assert.deepEqual(RULES['pain-stop'](ctxFor('2026-11-19', [])), []);
});

test('pain-stop takes precedence: amber then emits no run edits', () => {
  const log = [readiness('2026-11-19', { pain: 6, sleep: 5 })];
  const list = open(ctxFor('2026-11-19', log));
  assert.deepEqual(list.map((s) => s.rule), ['pain-stop', 'amber-readiness']); // stop first
  const amber = list[1]!;
  assert.ok(!amber.edits.some((e) => e.op === 'skip' && e.key === '2026-11-19#2'));
  assert.deepEqual(amber.edits, [{ op: 'adjust', key: '2026-11-20#1', rpeDelta: -1 }]); // a swim, not a run
});

// ---- missed long run ---------------------------------------------------------

test('missed-long-run: missed 8 km run and a longer 9 km next run -> repeat 8 km, minutes scaled', () => {
  // today Tue 2026-12-01: Sun 11-29 (8 km) unlogged = missed; Sun 12-06 is 9 km, 65 min
  const s = one(RULES['missed-long-run'](ctxFor('2026-12-01')));
  assert.equal(s.id, 'missed-long-run:2026-11-29#1');
  assert.deepEqual(s.edits, [{ op: 'adjust', key: '2026-12-06#1', longRunKm: 8, minutes: 60 }]); // 65 * 8/9 = 57.8 -> 60
});

test('missed-long-run: a skipped long run counts the same; a done one does not fire', () => {
  assert.equal(RULES['missed-long-run'](ctxFor('2026-12-01', [logSession('2026-11-29#1', 'skipped')])).length, 1);
  assert.deepEqual(RULES['missed-long-run'](ctxFor('2026-12-01', [logSession('2026-11-29#1', 'done', 60)])), []);
});

test('missed-long-run: no fire when the next long run is not longer', () => {
  // today 2026-11-25: Sun 11-22 (8 km) missed, Sun 11-29 is also 8 km
  assert.deepEqual(RULES['missed-long-run'](ctxFor('2026-11-25')), []);
});

test('missed-long-run: after accepting, the next run is 8 km and the suggestion stays hidden', () => {
  const s = one(open(ctxFor('2026-12-01')).filter((x) => x.rule === 'missed-long-run'));
  const overrides = accepted(s);
  const after = ctxFor('2026-12-01', [], overrides);
  assert.equal(after.sessions.find((x) => x.key === '2026-12-06#1')!.longRunKm, 8);
  assert.deepEqual(open(after, overrides).filter((x) => x.rule === 'missed-long-run'), []);
});

// ---- long run and intensity --------------------------------------------------

test('long-run-and-intensity: week 9 adds distance (9 vs 8 km) and a RPE 6 run (vs 4) -> ease the hardest run to RPE 4', () => {
  // today Tue 2027-01-05 is week 8 (recovery, protected); next week 9 starts 2027-01-11
  const s = one(RULES['long-run-and-intensity'](ctxFor('2027-01-05')));
  assert.equal(s.id, 'long-run-and-intensity:2027-01-11');
  assert.deepEqual(s.edits, [{ op: 'adjust', key: '2027-01-12#1', rpeDelta: -2 }]);
});

test('long-run-and-intensity: does not fire when only one of the two rises, or for protected weeks', () => {
  assert.deepEqual(RULES['long-run-and-intensity'](ctxFor('2027-01-19')), []); // wk10 9 km = wk9; wk11 10 km but RPE 6 = 6
  assert.deepEqual(RULES['long-run-and-intensity'](ctxFor('2026-12-08')), []); // wk4 recovery; wk5 9 km vs 7 but RPE 4 = 4
  assert.deepEqual(RULES['long-run-and-intensity'](ctxFor('2026-11-19')), []); // week 1 has no prior week
});

test('long-run-and-intensity: nothing to ease once the hardest run is done', () => {
  assert.deepEqual(RULES['long-run-and-intensity'](ctxFor('2027-01-13')), []); // Wed of week 9; the 01-12 run is past
});

// ---- return after gap --------------------------------------------------------

test('return-after-gap: 3 missed days ending yesterday cut the next 3 days to 70% (rounded to 5)', () => {
  // tracking began Mon 11-16; Tue, Wed, Thu are all unlogged; today is Fri 11-20
  const s = one(RULES['return-after-gap'](ctxFor('2026-11-20', [logSession('2026-11-16#1', 'done', 10)])));
  assert.equal(s.id, 'return-after-gap:2026-11-17');
  const minutes = Object.fromEntries(s.edits.map((e) => [e.key, e.op === 'adjust' ? e.minutes : undefined]));
  assert.equal(minutes['2026-11-20#1'], 35); // swim 50
  assert.equal(minutes['2026-11-20#2'], 20); // strength 30 -> 21
  assert.equal(minutes['2026-11-22#1'], 40); // long run 60 -> 42
  assert.equal(minutes['2026-11-23#1'], undefined); // day 4 is outside the window
});

test('return-after-gap: skipped days count, a done session or a 2-day gap does not', () => {
  const skippedDays = ['2026-11-17#1', '2026-11-17#2', '2026-11-18#1', '2026-11-19#1', '2026-11-19#2'].map((x) => logSession(x, 'skipped'));
  const base = logSession('2026-11-16#1', 'done');
  assert.equal(RULES['return-after-gap'](ctxFor('2026-11-20', [base, ...skippedDays])).length, 1);
  assert.deepEqual(RULES['return-after-gap'](ctxFor('2026-11-20', [base, logSession('2026-11-18#1', 'done')])), []); // 11-19 only
  assert.deepEqual(RULES['return-after-gap'](ctxFor('2026-11-19', [base])), []); // 11-17, 11-18 only
});

test('return-after-gap: nothing before the first log entry counts (week 1 starts mid-week)', () => {
  assert.deepEqual(RULES['return-after-gap'](ctxFor('2026-11-19', [readiness('2026-11-19', { sleep: 5, fatigue: 4 })])), []);
  assert.deepEqual(RULES['return-after-gap'](ctxFor('2026-11-19', [])), []);
});

test('return-after-gap: accepted once, the 70% minutes apply and the suggestion stays hidden', () => {
  const log = [logSession('2026-11-16#1', 'done', 10)];
  const s = one(open(ctxFor('2026-11-20', log)));
  const overrides = accepted(s);
  const after = ctxFor('2026-11-20', log, overrides);
  assert.equal(after.sessions.find((x) => x.key === '2026-11-20#1')!.minutes, 35);
  assert.deepEqual(open(after, overrides), []);
});

test('record helper keeps edits manual by default', () => {
  assert.equal(record({ op: 'skip', key: k('2026-11-19#2') }).source, 'manual');
});
