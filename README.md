# Triathlon training tracker

A phone page for a 43-week triathlon plan (Mon 2026-11-16 to Sun 2027-09-12, Toronto time). Open it after a session and tap Done or Skip. Log how you slept and how your body feels. It suggests small changes to the plan, such as dropping an optional run when you are tired, and you accept or reject each one. Every evening your phone gets a short message with tomorrow's sessions, and on Sundays a summary of the week. Effort is RPE only (how hard it felt, 1 to 10).

It all runs free on Cloudflare: a Worker (a small program Cloudflare runs for you) serves the page, a D1 database (Cloudflare's small database) keeps your log, and a scheduled trigger sends the evening message through ntfy (a free app that shows notifications on your phone). There is no server to look after. A free Cloudflare account is all you need, with no card.

## Set it up

You need Node 22.18 or newer on your computer ([nodejs.org](https://nodejs.org)). Each step is a command to copy into a terminal, or a thing to tap on your phone.

1. **Make a free Cloudflare account** at [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up). Confirm your email.

2. **Get the code.**

   ```sh
   git clone https://github.com/tomwinskell/triathlon-training
   cd triathlon-training
   npm install
   ```

3. **Sign in to Cloudflare from the terminal.** A browser tab opens; click Allow.

   ```sh
   npx wrangler login
   ```

4. **Create the database.**

   ```sh
   npx wrangler d1 create triathlon
   ```

   It prints a `database_id`, a long code like `a1b2c3d4-...`. Open `wrangler.jsonc` and paste it in place of `PASTE-YOUR-DATABASE-ID-HERE`.

5. **Create the table inside the database.**

   ```sh
   npm run db:migrate
   ```

   Answer `y` if it asks to continue.

6. **On your phone, install the ntfy app** (App Store or Google Play). Tap +, and subscribe to a topic name that nobody could guess, for example `tri-` followed by 20 random letters and digits. Anyone who knows the topic name can read your messages, so treat it like a password.

7. **Give the topic to the Worker as a secret** (a value Cloudflare keeps hidden). Paste the topic name when it asks.

   ```sh
   npx wrangler secret put NTFY_TOPIC
   ```

8. **Deploy.**

   ```sh
   npm run deploy
   ```

   It prints your address, like `https://triathlon-training.<your-name>.workers.dev`. Open `wrangler.jsonc`, add `"APP_URL": "https://triathlon-training.<your-name>.workers.dev"` next to `TZ_NAME` inside `vars`, and run `npm run deploy` again. Now tapping an evening notification opens the page.

9. **Lock it down.** Right now anyone who learns the address could log sessions or change your plan, because the page has no password. Cloudflare Access puts a login in front of it for free. In the Cloudflare dashboard go to Workers & Pages, open `triathlon-training`, then Settings, then Domains & Routes. Next to the `workers.dev` row, turn on Cloudflare Access. Set the policy to allow only your own email address. You will then log in with a one-time code sent to that email. (Names in the dashboard may differ slightly; look for "Access" on the workers.dev route.)

10. **On your phone, open the address and sign in.** Then add it to your home screen: Share, then Add to Home Screen on iPhone; the three-dot menu, then Add to Home screen on Android.

The evening message is sent at 17:30 in winter and 18:30 in summer, Toronto time. To change the time, edit `crons` in `wrangler.jsonc` (it is in UTC) and deploy again.

## Using it day to day

- **Log a session.** On the Today card, optionally type the real minutes and RPE, then tap Done or Skip. Skip here means "I did not do it".
- **Log readiness each morning.** Sleep hours, fatigue from 1 (fresh) to 5 (wrecked), and pain from 0 to 10. If anything hurts, add where and whether it is getting better or worse. The rules below read this.
- **Suggestions.** When a rule fires, a card appears under Suggestions. Accept applies its changes to the plan. Reject hides it. Nothing changes unless you accept.
- **Edit the plan.** Every card has an Edit section. Skip (plan edit) takes a session out of the plan. Move to date puts it on another day. Set minutes shortens or lengthens it. Edits are checked first, and refused with a message when they would make up a missed session on a later day, stack two sessions of the same sport on one day, or raise minutes in a recovery or race week.
- **Other weeks.** Under Week, the arrows step to the previous and next plan week, so you can look ahead, edit upcoming sessions, or log one you forgot.

## The adaptation rules

Rules only suggest. Nothing changes until you accept. Thresholds live in `THRESHOLDS` in `src/rules/shared.ts`.

| Rule | Fires when | Suggests |
|---|---|---|
| `amber-readiness` | Today's or yesterday's readiness has 2+ flags: sleep under 6 h, fatigue 4+, pain 3+ | Skip this week's remaining optional runs; RPE -1 on the next session with RPE max 6+ |
| `pain-stop` | Pain 5+, or trend `sharp` or `worsening` | "Stop running and see a physio." and skip run and brick sessions for 7 days. Overrides amber run edits |
| `missed-long-run` | The latest past long run was missed or skipped and the next is longer | Repeat the missed distance, minutes scaled |
| `long-run-and-intensity` | Current or next non-protected week raises both long-run km and top run RPE over the last normal week | Ease the hardest run to the level of the last week that was not a cutback or race week |
| `return-after-gap` | 3+ days ending yesterday where every non-optional session was missed or skipped | 70% of minutes (to 5) for the next 3 days |

`return-after-gap` ignores days before your first log entry, so starting mid-week 1 does not count as a gap.

## Working on it locally

`npm run dev` runs the whole thing on your computer at `http://localhost:8787`, with its own empty test database. Create that database once with `npm run db:migrate:local`. For evening messages while testing, put `NTFY_TOPIC=...` in a file named `.dev.vars` (kept out of git), and run `curl "http://localhost:8787/__scheduled?cron=30+22+*+*+*"` to trigger the scheduled job by hand.

The command line (`tri`) works on plain files in `data/`, separate from the Cloudflare database. It is handy for trying things out and for tests.

```sh
node src/cli.ts today            # or: npm run tri -- today
node src/cli.ts serve            # the same page on http://127.0.0.1:8787, using data/
npm test                         # dates, plan edits, each rule, the web page, the Worker, the CLI
npm run typecheck
```

A session key is `<date>#<position that day>`, for example `2026-11-19#1`. Every `today` and `week` line prints its key. `#2` alone means the second session of today.

### CLI commands

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


## Settings

| Variable | Default | Meaning |
|---|---|---|
| `TZ_NAME` | `America/Toronto` | Time zone that defines "today" and "tomorrow" (a `vars` entry in `wrangler.jsonc`) |
| `NTFY_TOPIC` | | Turns notifications on. A secret on Cloudflare |
| `NTFY_SERVER` | `https://ntfy.sh` | Your own ntfy server, if you have one |
| `NTFY_TOKEN` | | Optional access token for a private ntfy server |
| `APP_URL` | | The page's address. Tapping a notification opens it |
| `TRI_DATA_DIR` | `./data` | CLI only: folder for `log.jsonl` and `overrides.jsonl` |
| `TRI_PLAN` | `plan/triathlon_plan_2026-27.json` | CLI only: the baseline plan, never modified |
| `PORT` | `8787` | CLI only: default for `tri serve` |

## What it costs

Nothing, within these free limits. A personal tracker uses a tiny fraction of them.

| Service | Free limit |
|---|---|
| Workers Free | 100,000 requests per day; 10 ms of computing time per request |
| D1 Free | 5 million rows read and 100,000 rows written per day; 500 MB of storage |
| Cloudflare Access | Free for up to 50 users |
| ntfy.sh | Free |

Each page load reads every row you have logged. A year of daily use is a few thousand rows, so the daily limit is far away. Measured on a laptop with 300 log entries and 50 plan edits, building the page takes under 1 ms.

## Backups

Your data lives in the D1 database. Save a copy now and then:

```sh
npx wrangler d1 export triathlon --remote --output backup.sql
```

Keep `backup.sql` somewhere private. It holds everything you logged.

## If something goes wrong

- **Error 1102 (Worker exceeded resource limits).** The page used more than 10 ms of computing time. Reload once. If it keeps happening, open an issue with how many entries you have logged.
- **No evening message.** Check that you set the secret (step 7) and that your phone is subscribed to the same topic. In the dashboard, open the Worker's Logs to see errors from the scheduled run.
- **`database_id` errors on deploy.** Step 4 was skipped, or the id was pasted with extra characters.
