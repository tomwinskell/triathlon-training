// Boundary: raw plan JSON -> Plan. Everything downstream trusts the types.
import { readFileSync } from 'node:fs';
import { parseDate } from '../dates.ts';
import type { Plan, PlannedSession, RpeRange, SessionKey, Sport, Week } from '../types.ts';

/** Sport by id family. RW is mixed, so it is keyed by full id below. */
const SPORT_BY_FAMILY: Record<string, Sport> = {
  SW: 'swim', BK: 'bike', BL: 'bike', BR: 'brick', RN: 'run', RL: 'run', ST: 'strength', MB: 'mobility', '': 'race',
};
const SPORT_BY_RW_ID: Record<string, Sport> = {
  'RW-1': 'run', 'RW-2': 'swim', 'RW-3': 'bike', 'RW-4': 'brick', 'RW-5': 'bike',
  'RW-6': 'run', 'RW-7': 'swim', 'RW-8': 'bike', 'RW-9': 'swim',
  'RW-10': 'run', 'RW-11': 'swim', 'RW-12': 'bike', 'RW-13': 'brick',
};

const sportOf = (id: string): Sport | undefined => SPORT_BY_RW_ID[id] ?? (id.startsWith('RW') ? undefined : SPORT_BY_FAMILY[id.split('-')[0]!]);

/** Min and max of every number after "RPE" ("RPE 3–4", "RPE 4 → 6", "(50s at RPE 5)"); null when there is none. */
export function parseRpe(text: string): RpeRange | null {
  const nums = [...text.matchAll(/RPE\s*(\d+)(?:\s*[–→-]\s*(\d+))?/g)].flatMap((m) => [+m[1]!, ...(m[2] ? [+m[2]] : [])]);
  return nums.length ? { min: Math.min(...nums), max: Math.max(...nums) } : null;
}

const longRunKmOf = (id: string, title: string): number | null =>
  id.startsWith('RL') ? Number(/—\s*([\d.]+)\s*km/.exec(title)?.[1] ?? NaN) || null : null;

type Raw = Record<string, any>;
function need(cond: unknown, what: string): asserts cond {
  if (!cond) throw new Error(`plan: bad ${what}`);
}

function parseSession(raw: Raw, library: Raw, index: number): PlannedSession {
  const date = parseDate(String(raw.date));
  need(date, `session date ${raw.date}`);
  const planId: unknown = raw.id;
  need(typeof planId === 'string', `session id on ${date}`);
  const sport = sportOf(planId);
  need(sport, `session id "${planId}" (no sport mapping)`);
  const title: unknown = raw.title;
  need(typeof title === 'string', `title on ${date}`);
  need(Number.isFinite(raw.minutes), `minutes on ${date}`);
  const libRpe = typeof library[planId]?.rpe === 'string' ? parseRpe(library[planId].rpe) : null;
  return {
    key: `${date}#${index}` as SessionKey, date, planId, title, minutes: raw.minutes, detail: String(raw.detail ?? ''),
    optional: raw.optional === true, race: raw.race === true, sport,
    rpe: parseRpe(String(raw.detail ?? '')) ?? libRpe ?? { min: 0, max: 0 },
    longRunKm: longRunKmOf(planId, title),
  };
}

function parseWeek(raw: Raw, library: Raw): Week {
  const start = parseDate(String(raw.start));
  const end = parseDate(String(raw.end));
  need(start && end, `week ${raw.n} start/end`);
  need(Array.isArray(raw.sessions), `week ${raw.n} sessions`);
  const perDay = new Map<string, number>();
  const sessions = (raw.sessions as Raw[]).map((s) => {
    const i = (perDay.get(s.date) ?? 0) + 1;
    perDay.set(s.date, i);
    return parseSession(s, library, i);
  });
  return { n: raw.n, start, end, phase: String(raw.phase), recovery: raw.recovery === true, race: raw.race === true, objective: String(raw.objective ?? ''), notes: String(raw.notes ?? ''), sessions };
}

export function parsePlan(raw: Raw): Plan {
  need(Array.isArray(raw?.weeks) && raw.library && typeof raw.library === 'object', 'plan shape (weeks[], library{})');
  return { weeks: raw.weeks.map((w: Raw) => parseWeek(w, raw.library)), library: raw.library };
}

export const loadPlan = (path: string): Plan => parsePlan(JSON.parse(readFileSync(path, 'utf8')));
