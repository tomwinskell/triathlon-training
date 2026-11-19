import { sessionsInWeek } from '../plan-state.ts';
import type { EffectiveSession, Plan, Rule, Week } from '../types.ts';
import { upcoming } from './shared.ts';

const inWeek = (sessions: readonly EffectiveSession[], w: Week) => sessionsInWeek(sessions, w).filter((s) => !s.skipped);
const longRunKm = (sessions: readonly EffectiveSession[], w: Week) => Math.max(0, ...inWeek(sessions, w).map((s) => s.longRunKm ?? 0));
const hardestRun = (sessions: readonly EffectiveSession[], w: Week) => Math.max(0, ...inWeek(sessions, w).filter((s) => s.sport === 'run').map((s) => s.rpe.max));
const weekAt = (plan: Plan, n: number): Week | undefined => plan.weeks.find((w) => w.n === n);

/** Never raise long-run distance and run intensity in the same week: ease the hardest run back to last week's level. */
export const longRunAndIntensity: Rule = (ctx) => {
  const current = ctx.plan.weeks.find((w) => w.start <= ctx.today && ctx.today <= w.end);
  if (!current) return [];
  return [current, weekAt(ctx.plan, current.n + 1)].flatMap((w) => {
    const prior = w && weekAt(ctx.plan, w.n - 1);
    if (!w || !prior || w.recovery || w.race) return [];
    const intensity = hardestRun(ctx.sessions, w);
    if (longRunKm(ctx.sessions, w) <= longRunKm(ctx.sessions, prior) || intensity <= hardestRun(ctx.sessions, prior)) return [];
    const target = sessionsInWeek(upcoming(ctx), w).find((s) => s.sport === 'run' && s.rpe.max === intensity);
    if (!target) return [];
    const rpeDelta = hardestRun(ctx.sessions, prior) - intensity;
    return [{
      id: `long-run-and-intensity:${w.start}`, rule: 'long-run-and-intensity' as const, severity: 'warn' as const,
      message: `Week ${w.n} raises both long-run distance and run intensity. Ease ${target.title} (${target.date}) by ${-rpeDelta} RPE.`,
      edits: [{ op: 'adjust' as const, key: target.key, rpeDelta }],
    }];
  });
};
