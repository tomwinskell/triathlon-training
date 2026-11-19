// Boundary: append-only JSONL files, one JSON object per line, validated against a field table on read.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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

function readJsonl<T>(file: string, discriminator: 'op' | 'type', shapes: typeof OVERRIDE_SHAPES): T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').flatMap((line, i) => {
    if (!line.trim()) return [];
    const where = `${file}:${i + 1}`;
    let rec: Record<string, unknown>;
    try { rec = JSON.parse(line); } catch { throw new Error(`${where}: not valid JSON`); }
    const shape = shapes[String(rec[discriminator])];
    if (!shape) throw new Error(`${where}: unknown ${discriminator} "${String(rec[discriminator])}"`);
    const bad = Object.entries(shape).find(([k, check]) => !check(rec[k]));
    if (bad) throw new Error(`${where}: bad field "${bad[0]}"`);
    return [rec as T];
  });
}

const append = (file: string, rec: object) => {
  mkdirSync(join(file, '..'), { recursive: true });
  appendFileSync(file, JSON.stringify(rec) + '\n');
};

export const overridesFile = (dir: string) => join(dir, 'overrides.jsonl');
export const logFile = (dir: string) => join(dir, 'log.jsonl');

export const readOverrides = (dir: string) => readJsonl<OverrideRecord>(overridesFile(dir), 'op', OVERRIDE_SHAPES);
export const readLog = (dir: string) => readJsonl<LogEntry>(logFile(dir), 'type', LOG_SHAPES);
export const appendOverride = (dir: string, rec: OverrideRecord) => append(overridesFile(dir), rec);
export const appendLog = (dir: string, rec: LogEntry) => append(logFile(dir), rec);
