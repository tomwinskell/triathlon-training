// Plain text for the CLI and notifications. Pure.
import { addDays, dayName, weekOf } from './dates.ts';
import type { State } from './app.ts';
import { readinessAverages, readinessIn, weekStats } from './stats.ts';
import { sessionsInWeek } from './plan-state.ts';
import type { EffectiveSession, Outcome, Suggestion, Week } from './types.ts';

const MARK: Record<Outcome, string> = { done: '[x]', skipped: '[-]', missed: '[!]', pending: '[ ]' };
const rpeText = (s: EffectiveSession) => (s.rpe.max ? `RPE ${s.rpe.min === s.rpe.max ? s.rpe.max : `${s.rpe.min}-${s.rpe.max}`}` : '');
const pct = (x: number | null) => (x === null ? 'n/a' : `${Math.round(x * 100)}%`);
const one = (n: number) => n.toFixed(1);

/** `[x] 2026-11-18#1  SW-T-1  Technique & endurance 1  45 min  RPE 3-5` */
export const sessionLine = (s: EffectiveSession, out: Outcome | undefined): string =>
  [MARK[out ?? 'pending'], s.key, s.planId || 'RACE', s.title, `${s.minutes} min`, rpeText(s), s.appliedOverrides.length ? '(edited)' : ''].filter(Boolean).join('  ');

export function formatToday(state: State): string {
  const week = weekOf(state.plan, state.today);
  const list = state.sessions.filter((s) => s.date === state.today);
  const head = `${dayName(state.today)} ${state.today}${week ? ` - week ${week.n} (${week.phase})` : ' - outside the plan'}`;
  return [head, ...(list.length ? list.map((s) => sessionLine(s, state.outcomes.get(s.key))) : ['No sessions planned.'])].join('\n');
}

export function formatWeek(state: State, week: Week): string {
  const list = sessionsInWeek(state.sessions, week);
  const stats = weekStats(week, state.sessions, state.outcomes, state.log);
  const days = [...new Set(list.map((s) => s.date))].flatMap((d) => [
    `${dayName(d)} ${d}${d === state.today ? '  <- today' : ''}`,
    ...list.filter((s) => s.date === d).map((s) => `  ${sessionLine(s, state.outcomes.get(s.key))}`),
  ]);
  return [
    `Week ${week.n} (${week.phase}${week.recovery ? ', recovery' : ''}${week.race ? ', race' : ''})  ${week.start} to ${week.end}`,
    `Objective: ${week.objective}`,
    `Done ${stats.done}/${stats.sessions} sessions (${pct(stats.completion)}), ${stats.doneMinutes} of ${stats.plannedMinutes} min`,
    '', ...days,
  ].join('\n');
}

export const formatSuggestions = (list: readonly Suggestion[]): string =>
  list.length
    ? list.map((s) => `- ${s.id} [${s.severity}] ${s.message}${s.edits.length ? ` (${s.edits.length} edit${s.edits.length > 1 ? 's' : ''})` : ''}\n  tri suggest accept ${s.id}  |  tri suggest reject ${s.id}`).join('\n')
    : 'No open suggestions.';

export function formatStatus(state: State): string {
  const week = weekOf(state.plan, state.today);
  const r = state.log.findLast((e) => e.type === 'readiness' && e.date === state.today);
  const readiness = r?.type === 'readiness'
    ? `sleep ${r.sleepHours} h, fatigue ${r.fatigue}, pain ${r.pain}${r.painLocation ? ` (${r.painLocation})` : ''}${r.painTrend ? `, ${r.painTrend}` : ''}`
    : 'not logged yet (tri log readiness --sleep H --fatigue N --pain N)';
  const stats = week && weekStats(week, state.sessions, state.outcomes, state.log);
  return [
    `${dayName(state.today)} ${state.today}`,
    week && stats ? `Week ${week.n} (${week.phase}): ${stats.done}/${stats.sessions} sessions done (${pct(stats.completion)}), ${stats.doneMinutes}/${stats.plannedMinutes} min` : 'Outside the plan.',
    `Readiness today: ${readiness}`,
    '', 'Suggestions:', formatSuggestions(state.suggestions),
  ].join('\n');
}

const plain = (s: EffectiveSession) => `- ${s.title}, ${s.minutes} min${rpeText(s) ? `, ${rpeText(s)}` : ''}`;
const suggestionTail = (list: readonly Suggestion[]) => (list.length ? ['', 'Open suggestions (tri suggest accept|reject <id>):', ...list.map((s) => `- ${s.id}: ${s.message}`)] : []);

/** Null when there is nothing to say (outside the plan and no suggestions). */
export function tomorrowText(state: State): string | null {
  const date = addDays(state.today, 1);
  const week = weekOf(state.plan, date);
  const list = state.sessions.filter((s) => s.date === date && !s.skipped);
  if (!week && !state.suggestions.length) return null;
  return [
    `Tomorrow ${dayName(date)} ${date}${week ? ` (week ${week.n}, ${week.phase})` : ''}`,
    ...(list.length ? list.map(plain) : ['Nothing planned.']),
    ...suggestionTail(state.suggestions),
  ].join('\n');
}

/** Summary of the week containing today, plus next week's objective. Null outside the plan. */
export function weeklyText(state: State): string | null {
  const week = weekOf(state.plan, state.today);
  if (!week) return null;
  const stats = weekStats(week, state.sessions, state.outcomes, state.log);
  const ready = readinessAverages(readinessIn(state.log, week));
  const next = weekOf(state.plan, addDays(week.end, 1));
  return [
    `Week ${week.n} (${week.phase}) ${week.start} to ${week.end}`,
    `Completed ${stats.done}/${stats.sessions} sessions (${pct(stats.completion)}); ${stats.doneMinutes} of ${stats.plannedMinutes} planned min`,
    ...(stats.missed.length ? [`Missed: ${stats.missed.map((s) => `${dayName(s.date)} ${s.title}`).join('; ')}`] : []),
    ready
      ? `Readiness over ${ready.days} day(s): sleep ${one(ready.sleep)} h, fatigue ${one(ready.fatigue)}/5, pain ${one(ready.pain)}/10 (worst ${ready.worst.pain}${ready.worst.painLocation ? ` ${ready.worst.painLocation}` : ''})`
      : 'Readiness: no entries this week',
    next ? `Next: week ${next.n} (${next.phase}) - ${next.objective}` : 'Next: end of the plan.',
    ...suggestionTail(state.suggestions),
  ].join('\n');
}
