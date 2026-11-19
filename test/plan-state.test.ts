import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyOverrides, outcomes, validateEdit } from '../src/plan-state.ts';
import { ctxFor, d, k, logSession, plan, record } from './helpers.ts';

const find = (sessions: ReturnType<typeof applyOverrides>, key: string) => sessions.find((s) => s.key === key)!;

test('plan load: keys, sport, rpe and long-run km come from the real plan', () => {
  const all = plan.weeks.flatMap((w) => w.sessions);
  const thu = all.filter((s) => s.date === '2026-11-19');
  assert.deepEqual(thu.map((s) => [s.key, s.sport, s.optional]), [['2026-11-19#1', 'bike', false], ['2026-11-19#2', 'run', true]]);
  assert.deepEqual(find(applyOverrides(plan, []), '2026-11-18#1').rpe, { min: 3, max: 5 }); // "RPE 3–4 (50s at RPE 5)"
  const rl = all.find((s) => s.key === '2026-11-22#1')!;
  assert.equal(rl.longRunKm, 8);
  assert.equal(all.find((s) => s.planId === 'RW-2')!.sport, 'swim'); // race-week swim, not a run
  const race = all.find((s) => s.race)!;
  assert.deepEqual([race.key, race.sport, race.planId], ['2027-05-22#1', 'race', '']);
});

test('applyOverrides: move, skip, adjust, swap, and the baseline stays untouched', () => {
  const overrides = [
    record({ op: 'move', key: k('2026-11-19#1'), to: d('2026-11-23') }),
    record({ op: 'skip', key: k('2026-11-19#2') }),
    record({ op: 'adjust', key: k('2026-11-22#1'), minutes: 45, longRunKm: 6 }),
    record({ op: 'adjust', key: k('2026-11-20#1'), rpeDelta: -1 }),
    record({ op: 'swap', key: k('2026-11-17#2'), with: k('2026-11-20#2') }),
  ];
  const s = applyOverrides(plan, overrides);
  const bike = find(s, '2026-11-19#1');
  assert.equal(bike.date, '2026-11-23');
  assert.equal(bike.baselineDate, '2026-11-19');
  assert.deepEqual(bike.appliedOverrides, [overrides[0]!.id]);
  assert.equal(find(s, '2026-11-19#2').skipped, true);
  const lr = find(s, '2026-11-22#1');
  assert.deepEqual([lr.minutes, lr.longRunKm, lr.title], [45, 6, 'Long easy run — 6 km']);
  assert.deepEqual(find(s, '2026-11-20#1').rpe, { min: 3, max: 5 }); // was 4-6
  assert.deepEqual([find(s, '2026-11-17#2').date, find(s, '2026-11-20#2').date], ['2026-11-20', '2026-11-17']); // strength A <-> B
  assert.deepEqual(s.map((x) => x.date), [...s.map((x) => x.date)].sort()); // sorted by date
  // baseline never mutated
  assert.equal(plan.weeks[0]!.sessions.find((x) => x.key === '2026-11-19#1')!.date, '2026-11-19');
});

test('applyOverrides: later records win and decision records change nothing', () => {
  const s = applyOverrides(plan, [
    record({ op: 'adjust', key: k('2026-11-20#1'), minutes: 40 }),
    record({ op: 'adjust', key: k('2026-11-20#1'), minutes: 30 }),
    { op: 'reject', id: 'r1', at: 'x', suggestion: 'amber-readiness:2026-11-19' },
    { op: 'accept', id: 'a1', at: 'x', suggestion: 'pain-stop:2026-11-19' },
  ]);
  assert.equal(find(s, '2026-11-20#1').minutes, 30);
  assert.equal(s.filter((x) => x.skipped).length, 0);
});

test('outcomes: logged wins, unlogged past is missed, today onward is pending, plan skip is skipped', () => {
  const ctx = ctxFor('2026-11-19', [logSession('2026-11-18#1', 'done'), logSession('2026-11-19#1', 'skipped')], [record({ op: 'skip', key: k('2026-11-19#2') })]);
  const out = outcomes(ctx.sessions, ctx.log, ctx.today);
  assert.equal(out.get(k('2026-11-17#1')), 'missed');
  assert.equal(out.get(k('2026-11-18#1')), 'done');
  assert.equal(out.get(k('2026-11-19#1')), 'skipped');
  assert.equal(out.get(k('2026-11-19#2')), 'skipped');
  assert.equal(out.get(k('2026-11-20#1')), 'pending');
});

const edit = (today: string, e: Parameters<typeof validateEdit>[0], log = [] as Parameters<typeof ctxFor>[1]) => {
  const ctx = ctxFor(today, log);
  return validateEdit(e, { plan, sessions: ctx.sessions, outcomes: outcomes(ctx.sessions, ctx.log, ctx.today) });
};

test('validateEdit refuses moving a missed or skipped session later (no make-ups)', () => {
  const missed = edit('2026-11-19', { op: 'move', key: k('2026-11-17#2'), to: d('2026-11-21') }); // Tue strength, unlogged
  assert.equal(missed.ok, false);
  assert.match((missed as { error: string }).error, /make-up/);
  const skipped = edit('2026-11-19', { op: 'move', key: k('2026-11-20#2'), to: d('2026-11-22') }, [logSession('2026-11-20#2', 'skipped')]);
  assert.equal(skipped.ok, false);
  assert.equal(edit('2026-11-19', { op: 'move', key: k('2026-11-20#2'), to: d('2026-11-22') }).ok, true); // pending: fine
});

test('validateEdit refuses stacking the same sport on one day', () => {
  const r = edit('2026-11-19', { op: 'move', key: k('2026-11-19#1'), to: d('2026-11-21') }); // bike onto the Saturday ride
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /bike/);
  assert.equal(edit('2026-11-19', { op: 'move', key: k('2026-11-19#1'), to: d('2026-11-22') }).ok, true); // Sunday has no bike
  assert.equal(edit('2026-11-19', { op: 'move', key: k('2026-11-19#1'), to: d('2027-09-20') }).ok, false); // outside plan
});

test('validateEdit refuses increases in recovery and race weeks, allows decreases and normal weeks', () => {
  assert.equal(edit('2026-12-08', { op: 'adjust', key: k('2026-12-08#1'), minutes: 40 }).ok, false); // week 4 recovery, 30 -> 40
  assert.equal(edit('2026-12-08', { op: 'adjust', key: k('2026-12-13#1'), longRunKm: 9 }).ok, false); // 7 km long run -> 9
  assert.equal(edit('2026-12-08', { op: 'adjust', key: k('2026-12-08#1'), rpeDelta: 1 }).ok, false);
  assert.equal(edit('2027-05-18', { op: 'adjust', key: k('2027-05-18#1'), minutes: 45 }).ok, false); // race week 27
  assert.equal(edit('2026-12-08', { op: 'adjust', key: k('2026-12-08#1'), minutes: 20 }).ok, true);
  assert.equal(edit('2026-11-19', { op: 'adjust', key: k('2026-11-20#1'), minutes: 55 }).ok, true); // week 1, 50 -> 55
  assert.equal(edit('2026-11-19', { op: 'adjust', key: k('2026-11-20#1'), longRunKm: 9 }).ok, false); // not a long run
});

test('validateEdit swap: allowed for pending sessions, refused when it stacks or makes up', () => {
  assert.equal(edit('2026-11-19', { op: 'swap', key: k('2026-11-20#2'), with: k('2026-11-27#2') }).ok, true); // Fri strength <-> next Fri strength
  assert.equal(edit('2026-11-19', { op: 'swap', key: k('2026-11-19#1'), with: k('2026-11-20#2') }).ok, true); // Thu ride <-> Fri strength
  assert.equal(edit('2026-11-19', { op: 'swap', key: k('2026-11-19#1'), with: k('2026-11-21#2') }).ok, false); // ride lands on Saturday's ride
  assert.equal(edit('2026-11-19', { op: 'swap', key: k('2026-11-17#2'), with: k('2026-11-20#2') }).ok, false); // missed Tue strength would move later
  assert.equal(edit('2026-11-19', { op: 'swap', key: k('2026-11-19#1'), with: k('2026-11-19#1') }).ok, false);
});
