// Thresholds and helpers shared by the rules.
import { addDays } from '../dates.ts';
import { outcomes } from '../plan-state.ts';
import type { Readiness } from '../stats.ts';
import type { EffectiveSession, PlanEdit, RuleContext, Sport } from '../types.ts';

export const THRESHOLDS = {
  sleepHoursBelow: 6,
  fatigueAtLeast: 4,
  painAtLeast: 3,
  amberFlags: 2,
  painStopAtLeast: 5,
  painStopTrends: ['sharp', 'worsening'],
  painStopDays: 7,
  hardRpe: 6,
  gapDays: 3,
  gapReduceDays: 3,
  gapFactor: 0.7,
} as const;

export const RUNNING: ReadonlySet<Sport> = new Set(['run', 'brick']);



/** The latest readiness entry dated today or yesterday (file order breaks ties). */
export function recentReadiness(ctx: RuleContext): Readiness | undefined {
  const yesterday = addDays(ctx.today, -1);
  return ctx.log
    .filter((e): e is Readiness => e.type === 'readiness' && (e.date === ctx.today || e.date === yesterday))
    .reduce<Readiness | undefined>((best, e) => (!best || e.date >= best.date ? e : best), undefined);
}

export const painStopped = (r: Readiness): boolean =>
  r.pain >= THRESHOLDS.painStopAtLeast || (r.painTrend !== undefined && (THRESHOLDS.painStopTrends as readonly string[]).includes(r.painTrend));

/** Sessions that have not happened: today or later, not logged, not skipped. */
export function upcoming(ctx: RuleContext): EffectiveSession[] {
  const out = outcomes(ctx.sessions, ctx.log, ctx.today);
  return ctx.sessions.filter((s) => out.get(s.key) === 'pending');
}

export const roundTo5 = (n: number): number => Math.round(n / 5) * 5;

export const skipEdit = (s: EffectiveSession): PlanEdit => ({ op: 'skip', key: s.key });
