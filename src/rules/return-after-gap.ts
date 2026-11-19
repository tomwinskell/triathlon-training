import { addDays } from '../dates.ts';
import { outcomes } from '../plan-state.ts';
import type { ISODate, LogEntry, PlanEdit, Rule } from '../types.ts';
import { roundTo5, THRESHOLDS as T, upcoming } from './shared.ts';

const entryDate = (e: LogEntry): ISODate => (e.type === 'readiness' ? e.date : (e.key.slice(0, 10) as ISODate));

/**
 * 3+ consecutive days ending yesterday where every planned non-optional session was missed or skipped:
 * cut the next 3 days to 70%. Days before the first log entry are not a gap, they are before tracking began.
 */
export const returnAfterGap: Rule = (ctx) => {
  const trackingFrom = ctx.log.map(entryDate).sort()[0];
  if (!trackingFrom) return [];
  const out = outcomes(ctx.sessions, ctx.log, ctx.today);
  const gapDay = (d: ISODate) => {
    const required = ctx.sessions.filter((s) => s.date === d && !s.optional);
    return required.length > 0 && required.every((s) => out.get(s.key) === 'missed' || out.get(s.key) === 'skipped');
  };
  let start: ISODate | undefined;
  let days = 0;
  for (let d = addDays(ctx.today, -1); d >= trackingFrom && gapDay(d); d = addDays(d, -1)) [start, days] = [d, days + 1];
  if (!start || days < T.gapDays) return [];

  const until = addDays(ctx.today, T.gapReduceDays);
  const edits = upcoming(ctx)
    .filter((s) => s.date < until && !s.race)
    .map((s) => ({ s, minutes: Math.max(5, roundTo5(s.minutes * T.gapFactor)) }))
    .filter(({ s, minutes }) => minutes < s.minutes)
    .map(({ s, minutes }): PlanEdit => ({ op: 'adjust', key: s.key, minutes }));
  return [{
    id: `return-after-gap:${start}`, rule: 'return-after-gap', severity: 'warn',
    message: `${days} days with no completed sessions (since ${start}). Suggest ${T.gapFactor * 100}% of minutes for the next ${T.gapReduceDays} days.`,
    edits,
  }];
};
