// Pure plan state: baseline + overrides -> effective sessions, outcomes against the log, and edit validation.
import { weekOf } from './dates.ts';
import type { EffectiveSession, ISODate, LogEntry, Outcomes, OverrideRecord, Plan, PlanEdit, Result, SessionKey } from './types.ts';

type Draft = { -readonly [K in keyof EffectiveSession]: EffectiveSession[K] };
type Drafts = Map<SessionKey, Draft>;

const LONG_RUN_KM_IN_TITLE = /(—\s*)[\d.]+(\s*km)/;

const EDITS: { [O in PlanEdit['op']]: (s: Draft, e: Extract<PlanEdit, { op: O }>, all: Drafts) => void } = {
  move: (s, e) => { s.date = e.to; },
  skip: (s) => { s.skipped = true; },
  adjust: (s, e) => {
    if (e.minutes !== undefined) s.minutes = e.minutes;
    if (e.longRunKm !== undefined) {
      s.longRunKm = e.longRunKm;
      s.title = s.title.replace(LONG_RUN_KM_IN_TITLE, `$1${e.longRunKm}$2`);
    }
    if (e.rpeDelta !== undefined) s.rpe = { min: Math.max(1, s.rpe.min + e.rpeDelta), max: Math.max(1, s.rpe.max + e.rpeDelta) };
  },
  swap: (s, e, all) => {
    const other = all.get(e.with);
    if (!other) return;
    [s.date, other.date] = [other.date, s.date];
  },
};

/** Fold the overrides, in file order, over the baseline. Records for unknown keys and `accept`/`reject` records change nothing. */
export function applyOverrides(plan: Plan, overrides: readonly OverrideRecord[]): EffectiveSession[] {
  const all: Drafts = new Map(plan.weeks.flatMap((w) => w.sessions).map((s) => [s.key, { ...s, skipped: false, baselineDate: s.date, appliedOverrides: [] }]));
  for (const rec of overrides) {
    if (rec.op === 'reject' || rec.op === 'accept') continue;
    const s = all.get(rec.key);
    if (!s) continue;
    s.appliedOverrides = [...s.appliedOverrides, rec.id];
    if (rec.op === 'swap') {
      const other = all.get(rec.with);
      if (other) other.appliedOverrides = [...other.appliedOverrides, rec.id];
    }
    EDITS[rec.op](s, rec as never, all);
  }
  return [...all.values()].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}

/** The latest log entry per session key (later lines correct earlier ones). */
export const lastSessionLogs = (log: readonly LogEntry[]) =>
  new Map(log.flatMap((e) => (e.type === 'session' ? [[e.key, e] as const] : [])));

/** Logged status wins; else a plan-edit skip; else past = missed, today or later = pending. */
export function outcomes(sessions: readonly EffectiveSession[], log: readonly LogEntry[], today: ISODate): Outcomes {
  const logged = lastSessionLogs(log);
  return new Map(sessions.map((s) => [s.key, logged.get(s.key)?.status ?? (s.skipped ? 'skipped' : s.date < today ? 'missed' : 'pending')]));
}

export interface EditContext {
  readonly plan: Plan;
  readonly sessions: readonly EffectiveSession[];
  readonly outcomes: Outcomes;
}

const refuse = (error: string): Result => ({ ok: false, error });
const OK: Result = { ok: true };

function checkMove(s: EffectiveSession, to: ISODate, ctx: EditContext, ignore: readonly SessionKey[]): Result {
  const outcome = ctx.outcomes.get(s.key);
  if (to === s.date) return refuse(`${s.key} is already on ${to}`);
  if (!weekOf(ctx.plan, to)) return refuse(`${to} is outside the plan`);
  if ((outcome === 'missed' || outcome === 'skipped') && to > s.date) return refuse(`${s.key} was ${outcome}; no make-ups, it is not moved to a later day`);
  const clash = ctx.sessions.find((o) => !ignore.includes(o.key) && !o.skipped && o.date === to && o.sport === s.sport);
  return clash ? refuse(`${to} already has a ${s.sport} session (${clash.key}); no stacking`) : OK;
}

/** Refuses make-up moves, same-sport stacking, and any increase in a recovery or race week. */
export function validateEdit(edit: PlanEdit, ctx: EditContext): Result {
  const s = ctx.sessions.find((x) => x.key === edit.key);
  if (!s) return refuse(`no session ${edit.key}`);
  switch (edit.op) {
    case 'skip': return OK;
    case 'move': return checkMove(s, edit.to, ctx, []);
    case 'swap': {
      const other = ctx.sessions.find((x) => x.key === edit.with);
      if (!other || other.key === s.key) return refuse(`no other session ${edit.with}`);
      const both = [s.key, other.key];
      const first = checkMove(s, other.date, ctx, both);
      return first.ok ? checkMove(other, s.date, ctx, both) : first;
    }
    case 'adjust': {
      const week = weekOf(ctx.plan, s.date);
      if (edit.longRunKm !== undefined && s.longRunKm === null) return refuse(`${s.key} is not a long run`);
      const raises = (edit.minutes ?? 0) > s.minutes || (edit.longRunKm ?? 0) > (s.longRunKm ?? 0) || (edit.rpeDelta ?? 0) > 0;
      return raises && (week?.recovery || week?.race) ? refuse(`week ${week.n} is a ${week.race ? 'race' : 'recovery'} week; no increases`) : OK;
    }
  }
}
