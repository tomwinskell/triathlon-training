# tri

A small self-hosted triathlon training tracker for a 43-week plan (Mon 2026-11-16 to Sun 2027-09-12, America/Toronto). Effort is RPE only. TypeScript on Node, no runtime dependencies, no cloud service.

It loads the plan, records what you did, suggests deterministic adjustments you accept or reject, and sends an evening and a weekly message.

## Setup

Node 22.18 or newer runs the `.ts` files directly (type stripping), so there is no build step.

```sh
git clone <this repo> && cd <this repo>
npm install          # only for `npm run typecheck`: typescript and @types/node
node src/cli.ts today
```

Run it as `node src/cli.ts <command>`, `npm run tri -- <command>`, or `tri <command>` after `npm link`. The examples below use `tri`.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `TRI_DATA_DIR` | `./data` | Folder for `log.jsonl` and `overrides.jsonl` (gitignored by default) |
| `TRI_PLAN` | `plan/triathlon_plan_2026-27.json` | Baseline plan, never modified |
| `TZ_NAME` | `America/Toronto` | Zone that defines "today" and "tomorrow" |
| `NOTIFY_CHANNELS` | empty | Comma list of `ntfy`, `slack` |
| `NTFY_TOPIC` | | Required for `ntfy` |
| `NTFY_SERVER` | `https://ntfy.sh` | Self-hosted ntfy base URL |
| `NTFY_TOKEN` | | Optional bearer token |
| `SLACK_BOT_TOKEN` | | Required for `slack` (`chat:write` scope) |
| `SLACK_USER_ID` | | Required for `slack`; the DM goes to this user (`U...`) |
| `PORT` | `8787` | Default for `tri serve` when `--port` is absent |

## Data files

Both are append-only JSONL in `TRI_DATA_DIR`, one JSON object per line, readable with `cat` and diffable in git.

- `log.jsonl`: `session` entries (done or skipped, actual minutes, RPE, note) and `readiness` entries (sleep hours, fatigue 1-5, pain 0-10, location, trend). The last entry for a session wins, so you can correct by logging again.
- `overrides.jsonl`: plan edits (`move`, `skip`, `adjust`, `swap`) plus `accept` and `reject` markers for suggestions. Folding these over the baseline gives the effective plan.

A session key is `<date>#<position that day>`, for example `2026-11-19#1`. Every `today` and `week` line prints its key. `#2` alone means the second session of today.

## Commands

Every command takes `--today YYYY-MM-DD` to pretend it is that day, which is also how you backfill.

```sh
tri today                              # today's sessions with keys
tri week                               # this week; also: tri week 5, tri week 2027-01-12
tri status                             # week completion, today's readiness, open suggestions
tri show SW-E-1                        # the library workout behind a session

tri log 2026-11-19#1 done --min 70 --rpe 4 --note "windy"
tri log today done                     # every non-optional session today, at planned minutes
tri log #2 skipped                     # today's second session
tri log readiness --sleep 6.5 --fatigue 3 --pain 2 --where "left calf" --trend stable
tri log 2026-11-18#1 done --today 2026-11-19   # backfill

tri skip 2026-11-19#2                  # plan edit: drop a session
tri edit 2026-11-20#2 move 2026-11-22  # move to another day
tri edit 2026-11-22#1 minutes 45       # shorten
tri edit 2026-11-22#1 km 6             # long run distance (minutes are not rescaled)
tri edit 2026-11-19#1 swap 2026-11-20#1

tri suggest accept amber-readiness:2026-11-19
tri suggest reject amber-readiness:2026-11-19

tri notify tomorrow [--dry-run]        # tomorrow's sessions plus open suggestions
tri notify weekly [--force] [--dry-run]   # Sundays only unless --force
tri serve --port 8787                  # web page on 127.0.0.1
```

Edits are checked before they are saved. They are refused when they would make up a missed or skipped session on a later day, stack a second session of the same sport on one day, or raise minutes, km or RPE in a recovery or race week.

### Adaptation rules

Rules only suggest. Nothing changes until you accept. Thresholds live in `THRESHOLDS` in `src/rules/shared.ts`.

| Rule | Fires when | Suggests |
|---|---|---|
| `amber-readiness` | Today's or yesterday's readiness has 2+ flags: sleep under 6 h, fatigue 4+, pain 3+ | Skip this week's remaining optional runs; RPE -1 on the next session with RPE max 6+ |
| `pain-stop` | Pain 5+, or trend `sharp` or `worsening` | "Stop running and see a physio." and skip run and brick sessions for 7 days. Overrides amber run edits |
| `missed-long-run` | The latest past long run was missed or skipped and the next is longer | Repeat the missed distance, minutes scaled |
| `long-run-and-intensity` | Current or next non-protected week raises both long-run km and top run RPE over the week before | Ease the hardest run to last week's level |
| `return-after-gap` | 3+ days ending yesterday where every non-optional session was missed or skipped | 70% of minutes (to 5) for the next 3 days |

`return-after-gap` ignores days before your first log entry, so starting mid-week 1 does not count as a gap.

## Web page

`tri serve` serves one page on `127.0.0.1:8787` (`--host` to change, for example behind a VPN): today's sessions with Done and Skip buttons, a readiness form, open suggestions, and this week. It has no authentication, so keep it on localhost or put a reverse proxy with auth in front.

## Scheduling

Notifications need `NOTIFY_CHANNELS` and the matching variables. `weekly` exits 0 without sending unless it is Sunday in `TZ_NAME`, so one daily job runs both.

### cron

```cron
# 22:30 UTC daily (17:30 or 18:30 in Toronto)
30 22 * * * cd /home/me/tri && set -a && . ./.env && set +a && node src/cli.ts notify tomorrow && node src/cli.ts notify weekly
```

Put the variables in `.env` as `KEY=value` lines and keep it out of git.

### GitHub Actions

`.github/workflows/notify.yml` runs daily at 22:30 UTC and on manual dispatch (with a dry-run switch). Add the variables as repository secrets: `NOTIFY_CHANNELS`, `NTFY_TOPIC`, `NTFY_SERVER`, `NTFY_TOKEN`, `SLACK_BOT_TOKEN`, `SLACK_USER_ID`.

The runner only sees what is in the checkout, and `data/` is gitignored. Either:

- commit the data dir: remove `data/` from `.gitignore` and commit `data/*.jsonl` after logging (use a private repository), or
- point `TRI_DATA_DIR` at a folder another step fetches, for example a checkout of a separate private data repository.

Without data the Action still runs, but it sees an empty log and every past session as missed.

## Tests

```sh
npm test            # node:test: dates, overrides, edit validation, each rule, CLI end to end
npm run typecheck   # tsc --noEmit
```

Tests run against the real plan, using fixed dates such as 2026-11-19 (week 1 Thursday).
