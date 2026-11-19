import { addDays } from '../dates.ts';
import type { Rule } from '../types.ts';
import { painStopped, recentReadiness, RUNNING, skipEdit, THRESHOLDS as T, upcoming } from './shared.ts';

/** Pain 5+ or a sharp/worsening trend: no running for a week. */
export const painStop: Rule = (ctx) => {
  const r = recentReadiness(ctx);
  if (!r || !painStopped(r)) return [];
  const until = addDays(ctx.today, T.painStopDays);
  return [{
    id: `pain-stop:${r.date}`, rule: 'pain-stop', severity: 'stop',
    message: 'Stop running and see a physio.',
    edits: upcoming(ctx).filter((s) => RUNNING.has(s.sport) && s.date < until).map(skipEdit),
  }];
};
