// Shared by the CLI and the web page: config, state loading, and the actions that append to the data files.
import { parseDate, todayIn } from './dates.ts';
import { appendLog, appendOverride, readLog, readOverrides } from './io/store.ts';
import { loadPlan } from './io/plan.ts';
import { applyOverrides, outcomes, validateEdit } from './plan-state.ts';
import { suggest } from './rules/index.ts';
import type { EffectiveSession, ISODate, LogEntry, OverrideRecord, Outcomes, Plan, PlanEdit, PainTrend, SessionKey, Suggestion } from './types.ts';

export class UserError extends Error {}

export interface Config { readonly dataDir: string; readonly planPath: string; readonly tz: string }
export const configFrom = (env: NodeJS.ProcessEnv): Config => ({
  dataDir: env.TRI_DATA_DIR || 'data',
  planPath: env.TRI_PLAN || 'plan/triathlon_plan_2026-27.json',
  tz: env.TZ_NAME || 'America/Toronto',
});

export interface State {
  readonly today: ISODate;
  readonly plan: Plan;
  readonly overrides: readonly OverrideRecord[];
  readonly log: readonly LogEntry[];
  readonly sessions: readonly EffectiveSession[];
  readonly outcomes: Outcomes;
  readonly suggestions: readonly Suggestion[];
}

export function loadState(cfg: Config, today: ISODate): State {
  const plan = loadPlan(cfg.planPath);
  const overrides = readOverrides(cfg.dataDir);
  const log = readLog(cfg.dataDir);
  const sessions = applyOverrides(plan, overrides);
  return { today, plan, overrides, log, sessions, outcomes: outcomes(sessions, log, today), suggestions: suggest({ today, plan, sessions, log }, overrides) };
}

/** `--today` or the real date in the configured zone. */
export function resolveToday(cfg: Config, flag: string | undefined): ISODate {
  if (flag === undefined) return todayIn(cfg.tz);
  const d = parseDate(flag);
  if (!d) throw new UserError(`--today must be YYYY-MM-DD, got "${flag}"`);
  return d;
}

// ---- argument parsing (boundary) ---------------------------------------------

function number(name: string, raw: string | undefined, lo: number, hi: number, integer = false): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < lo || n > hi || (integer && !Number.isInteger(n))) throw new UserError(`${name} must be ${integer ? 'an integer' : 'a number'} from ${lo} to ${hi}, got "${raw}"`);
  return n;
}
function required<T>(name: string, v: T | undefined): T {
  if (v === undefined) throw new UserError(`${name} is required`);
  return v;
}
const TRENDS: readonly string[] = ['stable', 'improving', 'worsening', 'sharp'];

/** `today` = every non-optional session today; `#2` = today's second session; else a full key. */
export function resolveKeys(state: State, arg: string): SessionKey[] {
  if (arg === 'today') {
    const keys = state.sessions.filter((s) => s.date === state.today && !s.skipped && !s.optional).map((s) => s.key);
    if (!keys.length) throw new UserError(`no sessions planned for ${state.today}`);
    return keys;
  }
  const key = (arg.startsWith('#') ? `${state.today}${arg}` : arg) as SessionKey;
  if (!state.sessions.some((s) => s.key === key)) throw new UserError(`no session "${arg}". Keys look like 2026-11-19#1; see "tri week".`);
  return [key];
}

const stamp = () => new Date().toISOString();
const nextId = (state: State, offset = 0) => `o${state.overrides.length + offset + 1}`;

// ---- actions: each returns the confirmation text -----------------------------

export interface SessionInput { readonly min?: string; readonly rpe?: string; readonly note?: string }

export function logSession(cfg: Config, state: State, keyArg: string, status: 'done' | 'skipped', input: SessionInput): string {
  const minutes = status === 'done' ? number('--min', input.min, 1, 1440, true) ?? null : null;
  const rpe = status === 'done' ? number('--rpe', input.rpe, 1, 10) ?? null : null;
  const keys = resolveKeys(state, keyArg);
  for (const key of keys) appendLog(cfg.dataDir, { type: 'session', at: stamp(), key, status, minutes, rpe, ...(input.note ? { note: input.note } : {}) });
  return keys.map((k) => `logged ${k} ${status}${minutes ? ` ${minutes} min` : ''}${rpe ? ` RPE ${rpe}` : ''}`).join('\n');
}

export interface ReadinessInput { readonly sleep?: string; readonly fatigue?: string; readonly pain?: string; readonly where?: string; readonly trend?: string }

export function logReadiness(cfg: Config, state: State, input: ReadinessInput): string {
  const sleepHours = required('--sleep', number('--sleep', input.sleep, 0, 24));
  const fatigue = required('--fatigue', number('--fatigue', input.fatigue, 1, 5, true)) as 1 | 2 | 3 | 4 | 5;
  const pain = required('--pain', number('--pain', input.pain, 0, 10));
  if (input.trend && !TRENDS.includes(input.trend)) throw new UserError(`--trend must be one of ${TRENDS.join(', ')}`);
  appendLog(cfg.dataDir, {
    type: 'readiness', at: stamp(), date: state.today, sleepHours, fatigue, pain,
    ...(input.where ? { painLocation: input.where } : {}), ...(input.trend ? { painTrend: input.trend as PainTrend } : {}),
  });
  return `logged readiness for ${state.today}: sleep ${sleepHours} h, fatigue ${fatigue}, pain ${pain}`;
}

/** op: move <date> | minutes <N> | km <N> | swap <key> | skip */
export function editSession(cfg: Config, state: State, keyArg: string, op: string, arg: string | undefined): string {
  const [key] = resolveKeys(state, keyArg);
  const k = key!;
  const edit: PlanEdit = (() => {
    switch (op) {
      case 'skip': return { op: 'skip', key: k };
      case 'move': return { op: 'move', key: k, to: parseDate(arg ?? '') ?? fail(`move needs a date YYYY-MM-DD, got "${arg}"`) };
      case 'minutes': return { op: 'adjust', key: k, minutes: required('minutes', number('minutes', arg, 1, 1440, true)) };
      case 'km': return { op: 'adjust', key: k, longRunKm: required('km', number('km', arg, 0.1, 200)) };
      case 'swap': return { op: 'swap', key: k, with: resolveKeys(state, required('swap needs another session key', arg))[0]! };
      default: return fail(`unknown edit "${op}". Use move, minutes, km or swap (or "tri skip <key>").`);
    }
  })();
  const verdict = validateEdit(edit, { plan: state.plan, sessions: state.sessions, outcomes: state.outcomes });
  if (!verdict.ok) throw new UserError(verdict.error);
  appendOverride(cfg.dataDir, { ...edit, id: nextId(state), at: stamp(), source: 'manual' });
  return `edit saved: ${JSON.stringify(edit)}`;
}

export function fail(msg: string): never {
  throw new UserError(msg);
}

/** Accepting appends the suggestion's edits (with their source) and an accept marker; rejecting appends only the marker. */
export function decideSuggestion(cfg: Config, state: State, decision: 'accept' | 'reject', id: string | undefined): string {
  const s = state.suggestions.find((x) => x.id === id);
  if (!s) throw new UserError(`no open suggestion "${id}". Open: ${state.suggestions.map((x) => x.id).join(', ') || 'none'}`);
  const edits = decision === 'accept' ? s.edits : [];
  edits.forEach((e, i) => appendOverride(cfg.dataDir, { ...e, id: nextId(state, i), at: stamp(), source: { suggestion: s.id } }));
  appendOverride(cfg.dataDir, { op: decision, id: nextId(state, edits.length), at: stamp(), suggestion: s.id });
  return `${decision}ed ${s.id}${edits.length ? ` (${edits.length} edit${edits.length > 1 ? 's' : ''} applied)` : ''}`;
}

