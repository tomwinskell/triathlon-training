import { outcomes } from '../plan-state.ts';
import type { Rule } from '../types.ts';
import { roundTo5, upcoming } from './shared.ts';

/** The latest past long run was missed and the next is longer: repeat the missed distance instead of jumping. */
export const missedLongRun: Rule = (ctx) => {
  const out = outcomes(ctx.sessions, ctx.log, ctx.today);
  const isLong = (s: { planId: string; longRunKm: number | null }) => s.planId.startsWith('RL') && s.longRunKm !== null;
  const missed = ctx.sessions.filter((s) => isLong(s) && s.date < ctx.today).at(-1);
  if (!missed || !['missed', 'skipped'].includes(out.get(missed.key)!)) return [];
  const next = upcoming(ctx).find(isLong);
  if (!next || next.longRunKm! <= missed.longRunKm!) return [];
  const minutes = roundTo5((next.minutes * missed.longRunKm!) / next.longRunKm!);
  return [{
    id: `missed-long-run:${missed.key}`, rule: 'missed-long-run', severity: 'info',
    message: `Missed the ${missed.longRunKm} km long run on ${missed.date}. Repeat ${missed.longRunKm} km on ${next.date} instead of ${next.longRunKm} km (${minutes} min).`,
    edits: [{ op: 'adjust', key: next.key, longRunKm: missed.longRunKm!, minutes }],
  }];
};
