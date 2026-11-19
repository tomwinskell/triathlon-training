// Boundary: the Store interface (one read, one batched append) and the record field tables. No Node imports, so the Worker can bundle it.
import { parseDate } from '../dates.ts';
import type { LogEntry, OverrideRecord } from '../types.ts';

type Check = (v: unknown) => boolean;
const str: Check = (v) => typeof v === 'string';
const num = (lo: number, hi: number): Check => (v) => typeof v === 'number' && v >= lo && v <= hi;
const int = (lo: number, hi: number): Check => (v) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const oneOf = (...xs: string[]): Check => (v) => xs.includes(v as string);
const opt = (c: Check): Check => (v) => v === undefined || c(v);
const nullable = (c: Check): Check => (v) => v === null || c(v);
const key: Check = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}#\d+$/.test(v);
const date: Check = (v) => typeof v === 'string' && parseDate(v) !== null;
const source: Check = (v) => v === 'manual' || (typeof v === 'object' && v !== null && str((v as { suggestion?: unknown }).suggestion));

const base = { id: str, at: str };
const edit = { ...base, key, source };
const OVERRIDE_SHAPES: Record<string, Record<string, Check>> = {
  move: { ...edit, to: date },
  skip: edit,
  adjust: { ...edit, minutes: opt(num(1, 1440)), longRunKm: opt(num(0.1, 200)), rpeDelta: opt(num(-9, 9)) },
  swap: { ...edit, with: key },
  accept: { ...base, suggestion: str },
  reject: { ...base, suggestion: str },
};
const LOG_SHAPES: Record<string, Record<string, Check>> = {
  session: { at: str, key, status: oneOf('done', 'skipped'), minutes: nullable(num(0, 1440)), rpe: nullable(num(1, 10)), note: opt(str) },
  readiness: { at: str, date, sleepHours: num(0, 24), fatigue: int(1, 5), pain: num(0, 10), painLocation: opt(str), painTrend: opt(oneOf('stable', 'improving', 'worsening', 'sharp')) },
};

export interface RecOf { log: LogEntry; override: OverrideRecord }
export type Rec = { [K in keyof RecOf]: { readonly kind: K; readonly rec: RecOf[K] } }[keyof RecOf];
export interface StoreData { readonly log: LogEntry[]; readonly overrides: OverrideRecord[] }

/** Append-only storage. `append` writes every record or none where the backend can (D1 batch). */
export interface Store {
  read(): Promise<StoreData>;
  append(recs: readonly Rec[]): Promise<void>;
}

const SHAPES = { log: { tag: 'type', shapes: LOG_SHAPES }, override: { tag: 'op', shapes: OVERRIDE_SHAPES } } as const;

/** Applied to every record read from any backend. `where` names the source in the error. */
export function validate<K extends keyof RecOf>(kind: K, raw: unknown, where: string): RecOf[K] {
  const { tag, shapes } = SHAPES[kind];
  const rec = raw as Record<string, unknown>;
  if (typeof raw !== 'object' || raw === null) throw new Error(`${where}: not an object`);
  const shape = shapes[String(rec[tag])];
  if (!shape) throw new Error(`${where}: unknown ${tag} "${String(rec[tag])}"`);
  const bad = Object.entries(shape).find(([k, check]) => !check(rec[k]));
  if (bad) throw new Error(`${where}: bad field "${bad[0]}"`);
  return rec as RecOf[K];
}

export const parseJson = (text: string, where: string): unknown => {
  try { return JSON.parse(text); } catch { throw new Error(`${where}: not valid JSON`); }
};
