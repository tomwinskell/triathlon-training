// Pure weekly numbers for status and the weekly notification.
import { lastSessionLogs, sessionsInWeek } from './plan-state.ts';
import type { EffectiveSession, LogEntry, Outcomes, Week } from './types.ts';

export interface WeekStats {
  readonly sessions: number;        // counted: not plan-skipped, optional ones only when done
  readonly done: number;
  readonly plannedMinutes: number;
  readonly doneMinutes: number;     // logged minutes, else the planned minutes
  readonly completion: number | null; // 0..1
  readonly missed: readonly EffectiveSession[];
}

export function weekStats(week: Week, sessions: readonly EffectiveSession[], out: Outcomes, log: readonly LogEntry[]): WeekStats {
  const logged = lastSessionLogs(log);
  const counted = sessionsInWeek(sessions, week).filter((s) => (!s.skipped || out.get(s.key) === 'done') && (!s.optional || out.get(s.key) === 'done'));
  const done = counted.filter((s) => out.get(s.key) === 'done');
  const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
  return {
    sessions: counted.length,
    done: done.length,
    plannedMinutes: sum(counted.map((s) => s.minutes)),
    doneMinutes: sum(done.map((s) => logged.get(s.key)?.minutes ?? s.minutes)),
    completion: counted.length ? done.length / counted.length : null,
    missed: counted.filter((s) => out.get(s.key) === 'missed'),
  };
}

export type Readiness = Extract<LogEntry, { type: 'readiness' }>;

/** One entry per date (the last logged) within the week. */
export const readinessIn = (log: readonly LogEntry[], week: Week): Readiness[] =>
  [...new Map(log.flatMap((e) => (e.type === 'readiness' && e.date >= week.start && e.date <= week.end ? [[e.date, e] as const] : []))).values()];

export interface ReadinessAverages { readonly days: number; readonly sleep: number; readonly fatigue: number; readonly pain: number; readonly worst: Readiness }

export function readinessAverages(entries: readonly Readiness[]): ReadinessAverages | null {
  if (!entries.length) return null;
  const avg = (f: (r: Readiness) => number) => entries.reduce((a, r) => a + f(r), 0) / entries.length;
  return { days: entries.length, sleep: avg((r) => r.sleepHours), fatigue: avg((r) => r.fatigue), pain: avg((r) => r.pain), worst: entries.reduce((w, r) => (r.pain > w.pain ? r : w)) };
}
