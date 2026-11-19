import { weekOf } from '../dates.ts';
import type { PlanEdit, Rule } from '../types.ts';
import { painStopped, recentReadiness, RUNNING, skipEdit, THRESHOLDS as T, upcoming } from './shared.ts';

/** Two or more amber flags: drop this week's optional runs and ease the next hard session by one RPE point. */
export const amberReadiness: Rule = (ctx) => {
  const r = recentReadiness(ctx);
  if (!r) return [];
  const flags = [
    r.sleepHours < T.sleepHoursBelow && `sleep ${r.sleepHours} h`,
    r.fatigue >= T.fatigueAtLeast && `fatigue ${r.fatigue}`,
    r.pain >= T.painAtLeast && `pain ${r.pain}`,
  ].filter(Boolean);
  if (flags.length < T.amberFlags) return [];

  const covered = painStopped(r); // pain-stop already skips every run and brick
  const week = weekOf(ctx.plan, ctx.today);
  const todo = upcoming(ctx);
  const optionalRuns = covered ? [] : todo.filter((s) => s.optional && s.sport === 'run' && week && s.date >= week.start && s.date <= week.end);
  const hard = todo.find((s) => s.rpe.max >= T.hardRpe && !(covered && RUNNING.has(s.sport)));
  const edits: PlanEdit[] = [...optionalRuns.map(skipEdit), ...(hard ? [{ op: 'adjust', key: hard.key, rpeDelta: -1 } as const] : [])];
  const parts = [
    ...(optionalRuns.length ? [`skip ${optionalRuns.length} optional run(s) this week`] : []),
    ...(hard ? [`RPE -1 on ${hard.title} (${hard.date})`] : []),
  ];
  return [{
    id: `amber-readiness:${r.date}`, rule: 'amber-readiness', severity: 'warn',
    message: `Amber readiness (${flags.join(', ')}).${parts.length ? ` Suggest: ${parts.join('; ')}.` : ''}`,
    edits,
  }];
};
