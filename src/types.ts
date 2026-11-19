// Domain types. Everything outside src/io/ trusts these; raw JSON is parsed into them at the boundary.

/** Calendar date in America/Toronto, `YYYY-MM-DD`. */
export type ISODate = string & { readonly __brand: 'ISODate' };

/**
 * Stable identity of one planned session: `<baseline date>#<position within that day>`, e.g. `2026-11-19#1`.
 * Plan ids repeat (RW-4) or are empty (race days), so the plan id is not an identity.
 */
export type SessionKey = string & { readonly __brand: 'SessionKey' };

export type Sport = 'swim' | 'bike' | 'run' | 'brick' | 'strength' | 'mobility' | 'race';

export interface RpeRange { readonly min: number; readonly max: number }

/** One session as the baseline plan defines it, enriched once at load time. */
export interface PlannedSession {
  readonly key: SessionKey;
  readonly date: ISODate;
  readonly planId: string;           // library id, '' for races
  readonly title: string;
  readonly minutes: number;
  readonly detail: string;
  readonly optional: boolean;
  readonly race: boolean;
  readonly sport: Sport;             // from the id family via a lookup table
  readonly rpe: RpeRange;            // parsed from detail, falling back to library rpe
  readonly longRunKm: number | null; // RL-* only, parsed from "— N km" in the title
}

export interface Week {
  readonly n: number;
  readonly start: ISODate;           // Monday
  readonly end: ISODate;             // Sunday
  readonly phase: string;
  readonly recovery: boolean;
  readonly race: boolean;
  readonly objective: string;
  readonly notes: string;
  readonly sessions: readonly PlannedSession[];
}

export interface Plan {
  readonly weeks: readonly Week[];
  readonly library: Readonly<Record<string, unknown>>; // shown verbatim by `tri show <id>`
}

/** A planned session after overrides. `skipped` is the plan edit, not the log. */
export interface EffectiveSession extends PlannedSession {
  readonly skipped: boolean;
  readonly baselineDate: ISODate;    // `date` may differ after a move
  readonly appliedOverrides: readonly string[]; // override ids, for display
}

// ---- overrides.jsonl (append-only plan edits) -------------------------------

export type PlanEdit =
  | { readonly op: 'move'; readonly key: SessionKey; readonly to: ISODate }
  | { readonly op: 'skip'; readonly key: SessionKey }
  | { readonly op: 'adjust'; readonly key: SessionKey; readonly minutes?: number; readonly longRunKm?: number; readonly rpeDelta?: number }
  | { readonly op: 'swap'; readonly key: SessionKey; readonly with: SessionKey };

export type OverrideRecord =
  | (PlanEdit & { readonly id: string; readonly at: string; readonly source: 'manual' | { readonly suggestion: string } })
  | { readonly op: 'accept'; readonly id: string; readonly at: string; readonly suggestion: string }
  | { readonly op: 'reject'; readonly id: string; readonly at: string; readonly suggestion: string };

// ---- log.jsonl (append-only) ------------------------------------------------

export type PainTrend = 'stable' | 'improving' | 'worsening' | 'sharp';

export type LogEntry =
  | { readonly type: 'session'; readonly at: string; readonly key: SessionKey; readonly status: 'done' | 'skipped'; readonly minutes: number | null; readonly rpe: number | null; readonly note?: string }
  | { readonly type: 'readiness'; readonly at: string; readonly date: ISODate; readonly sleepHours: number; readonly fatigue: 1 | 2 | 3 | 4 | 5; readonly pain: number; readonly painLocation?: string; readonly painTrend?: PainTrend };

/** A past session's outcome. Unlogged past sessions count as missed. */
export type Outcome = 'done' | 'skipped' | 'missed' | 'pending';

// ---- rules ------------------------------------------------------------------

export type RuleName =
  | 'amber-readiness'
  | 'pain-stop'
  | 'missed-long-run'
  | 'long-run-and-intensity'
  | 'return-after-gap';

export interface Suggestion {
  /** Deterministic: `<rule>:<anchor date or key>`, so recomputing yields the same id and accept/reject is idempotent. */
  readonly id: string;
  readonly rule: RuleName;
  readonly severity: 'info' | 'warn' | 'stop';
  readonly message: string;
  readonly edits: readonly PlanEdit[];   // empty for flag-only suggestions
}

export interface RuleContext {
  readonly today: ISODate;
  readonly plan: Plan;
  readonly sessions: readonly EffectiveSession[]; // overrides already applied
  readonly log: readonly LogEntry[];
}

export type Rule = (ctx: RuleContext) => readonly Suggestion[];

// ---- additions to the sketch
// OverrideRecord: `accept` joins `reject` as a decision marker, so accepting a flag-only suggestion (no edits) still hides it. ------------------------------------------------

export type Result = { readonly ok: true } | { readonly ok: false; readonly error: string };

export type Outcomes = ReadonlyMap<SessionKey, Outcome>;
