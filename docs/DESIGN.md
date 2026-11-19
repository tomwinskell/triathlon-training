# Design sketch

Goal: a self-hosted training tracker that reads the fixed plan, records what happened, applies deterministic adaptation rules as suggestions, and sends evening and weekly notifications. No LLM, no cloud lock-in.

## Shape chosen

Plan state is `fold(baseline, overrides)`. Everything that changes is an append-only JSONL file. Nothing mutates the baseline.

| State | Owner | File |
|---|---|---|
| Baseline plan | `plan/triathlon_plan_2026-27.json` (read-only) | `src/io/plan.ts` parses it |
| Plan edits and suggestion decisions | `overrides.jsonl` | `src/io/store.ts` appends |
| Session results and readiness | `log.jsonl` | `src/io/store.ts` appends |

Rejected alternative: SQLite with mutable rows. It adds a native dependency and makes "what did the plan say before I edited it" a migration problem. JSONL keeps the history readable with `cat` and diffable in git, which matters if the GitHub Actions job reads a committed data dir.

## Modules

```
src/types.ts          domain types (this sketch)
src/dates.ts          pure date math on ISODate: todayIn(tz, now), addDays, dayOfWeek, weekOf(plan, date), daysBetween
src/io/plan.ts        loadPlan(path): Plan               boundary: validates raw JSON, derives sport/rpe/longRunKm
src/io/store.ts       readOverrides/appendOverride, readLog/appendLog   boundary: one JSON object per line, validated on read
src/plan-state.ts     applyOverrides(plan, overrides): EffectiveSession[]   pure
                      outcomes(sessions, log, today): Map<SessionKey, Outcome>   pure
                      validateEdit(edit, ctx): Result   pure (refuses make-ups and progression in protected weeks)
src/rules/index.ts    RULES: Record<RuleName, Rule>; suggest(ctx): Suggestion[] (minus rejected/accepted ids)
src/rules/*.ts        one file per rule, pure
src/format.ts         text for CLI and notifications (today, week, tomorrow, weekly summary)
src/notify.ts         CHANNELS: Record<'ntfy'|'slack', Sender>; send(text, env)   boundary: env vars
src/cli.ts            thin shell: parse argv → call pure functions → append → print
src/web.ts            optional node:http page over the same functions
```

Node 22 runs `.ts` directly (type stripping), so there is no build step. Use only erasable TypeScript: no `enum`, no parameter properties, `.ts` extensions on relative imports. Dev dependencies are `typescript` and `@types/node` only, for `tsc --noEmit`. Tests use `node:test`.

## Rule semantics

Thresholds live in one exported `THRESHOLDS` object.

- Amber flags, counted on the latest readiness entry for today or yesterday: sleep under 6 h, fatigue 4 or more, pain 3 or more. Two or more flags produce one suggestion: skip every optional run in the current week that has not happened, and `rpeDelta: -1` on the next session whose `rpe.max >= 6`.
- Pain stop: pain 5 or more, or `painTrend` of `sharp` or `worsening`. Severity `stop`, message "Stop running and see a physio." Edits skip run and brick sessions for the next 7 days. Takes precedence: when it fires, amber-readiness edits to runs are redundant and are not emitted.
- Missed long run: the most recent past `RL` session is missed or skipped and the next `RL` has a larger `longRunKm`. Edit `adjust` it to the missed distance, with minutes scaled by km.
- Long run and intensity: for a non-protected upcoming week (current and next), if its long run km exceeds the prior week's and its maximum run `rpe.max` exceeds the prior week's, suggest `rpeDelta` on that week's hardest run to bring it level with the prior week.
- Return after gap: 3 or more consecutive past days with planned non-optional sessions, all missed or skipped, ending yesterday. Edit the next 3 days' sessions to 70% of minutes, rounded to 5.
- Never stack, never make up: no rule ever moves a session forward. `validateEdit` refuses a `move` of a missed or skipped session to a later date, and refuses a move onto a day that already holds a session of the same sport.
- Protected weeks: `recovery` or `race`. `validateEdit` refuses any edit that raises minutes, km or RPE there. The long-run-and-intensity rule skips them.

Suggestion ids are `<rule>:<anchor>`. Accepting appends the edits to `overrides.jsonl` with `source: { suggestion: id }`. Rejecting appends a `reject` record. Both hide the suggestion from later runs.

## Notifications

`tri notify tomorrow` and `tri notify weekly` format text and send it to every channel in `NOTIFY_CHANNELS` (comma-separated). ntfy needs `NTFY_TOPIC` (and optional `NTFY_SERVER`, `NTFY_TOKEN`). Slack DM needs `SLACK_BOT_TOKEN` and `SLACK_USER_ID` and posts with `chat.postMessage`. "Tomorrow" and "today" are computed in `TZ_NAME`, default `America/Toronto`, never in the host's zone. `weekly` on a non-Sunday exits 0 without sending unless `--force`, so a single daily cron entry can run both.
