import { parseDate } from '../src/dates.ts';
import { loadPlan } from '../src/io/plan.ts';
import { applyOverrides } from '../src/plan-state.ts';
import { suggest } from '../src/rules/index.ts';
import type { ISODate, LogEntry, OverrideRecord, PlanEdit, RuleContext, SessionKey } from '../src/types.ts';

export const plan = loadPlan('plan/triathlon_plan_2026-27.json');

export const d = (s: string): ISODate => {
  const iso = parseDate(s);
  if (!iso) throw new Error(`bad test date ${s}`);
  return iso;
};
export const k = (s: string) => s as SessionKey;

export const ctxFor = (today: string, log: LogEntry[] = [], overrides: OverrideRecord[] = []): RuleContext =>
  ({ today: d(today), plan, sessions: applyOverrides(plan, overrides), log });

export const readiness = (date: string, r: { sleep?: number; fatigue?: number; pain?: number; trend?: 'stable' | 'improving' | 'worsening' | 'sharp' }): LogEntry =>
  ({ type: 'readiness', at: `${date}T12:00:00Z`, date: d(date), sleepHours: r.sleep ?? 8, fatigue: (r.fatigue ?? 2) as 1 | 2 | 3 | 4 | 5, pain: r.pain ?? 0, painTrend: r.trend });

export const logSession = (key: string, status: 'done' | 'skipped', minutes: number | null = null): LogEntry =>
  ({ type: 'session', at: '2026-01-01T00:00:00Z', key: k(key), status, minutes, rpe: null });

let n = 0;
export const record = (edit: PlanEdit, source: 'manual' | { suggestion: string } = 'manual'): OverrideRecord =>
  ({ ...edit, id: `t${++n}`, at: '2026-01-01T00:00:00Z', source });

/** Accepting a suggestion = its edits (with source) plus an accept marker, as the app does. */
export const accepted = (s: { id: string; edits: readonly PlanEdit[] }): OverrideRecord[] =>
  [...s.edits.map((e) => record(e, { suggestion: s.id })), { op: 'accept', id: `t${++n}`, at: '2026-01-01T00:00:00Z', suggestion: s.id }];

export const open = (ctx: RuleContext, overrides: OverrideRecord[] = []) => suggest(ctx, overrides);
