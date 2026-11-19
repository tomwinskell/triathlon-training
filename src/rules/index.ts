import type { OverrideRecord, Rule, RuleContext, RuleName, Suggestion } from '../types.ts';
import { amberReadiness } from './amber-readiness.ts';
import { longRunAndIntensity } from './long-run-and-intensity.ts';
import { missedLongRun } from './missed-long-run.ts';
import { painStop } from './pain-stop.ts';
import { returnAfterGap } from './return-after-gap.ts';

export { THRESHOLDS } from './shared.ts';

export const RULES: Record<RuleName, Rule> = {
  'amber-readiness': amberReadiness,
  'pain-stop': painStop,
  'missed-long-run': missedLongRun,
  'long-run-and-intensity': longRunAndIntensity,
  'return-after-gap': returnAfterGap,
};

const SEVERITY_ORDER = { stop: 0, warn: 1, info: 2 } as const;

/** Ids the user already accepted or rejected. */
export const decidedIds = (overrides: readonly OverrideRecord[]): Set<string> =>
  new Set(overrides.flatMap((o) => (o.op === 'accept' || o.op === 'reject' ? [o.suggestion] : [])));

/** Every open suggestion: stop first, minus accepted and rejected ids. */
export function suggest(ctx: RuleContext, overrides: readonly OverrideRecord[]): Suggestion[] {
  const decided = decidedIds(overrides);
  return Object.values(RULES)
    .flatMap((rule) => rule(ctx))
    .filter((s) => !decided.has(s.id))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
