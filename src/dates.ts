// Pure date math on ISODate. All arithmetic is in UTC on calendar dates, so DST never shifts a day.
import type { ISODate, Plan, Week } from './types.ts';

const DAY_MS = 86_400_000;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Parse at a boundary: accepts only real `YYYY-MM-DD` calendar dates. */
export function parseDate(s: string): ISODate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.toISOString().slice(0, 10) === s ? (s as ISODate) : null;
}

const ms = (d: ISODate) => Date.parse(`${d}T00:00:00Z`);

export const addDays = (d: ISODate, n: number): ISODate =>
  new Date(ms(d) + n * DAY_MS).toISOString().slice(0, 10) as ISODate;

export const daysBetween = (a: ISODate, b: ISODate): number => Math.round((ms(b) - ms(a)) / DAY_MS);

/** `Mon`..`Sun`. */
export const dayName = (d: ISODate): string => DAY_NAMES[new Date(ms(d)).getUTCDay()]!;

export const isSunday = (d: ISODate): boolean => dayName(d) === 'Sun';

/** The calendar date it is right now in `tz`, whatever the host zone is. */
export function todayIn(tz: string, now: Date = new Date()): ISODate {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now) as ISODate;
}

/** The plan week containing `date`, or undefined outside the plan. ISO strings compare lexically. */
export const weekOf = (plan: Plan, date: ISODate): Week | undefined =>
  plan.weeks.find((w) => w.start <= date && date <= w.end);
