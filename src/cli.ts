#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { type Config, UserError, configFrom, fail, decideSuggestion, editSession, loadState, logReadiness, logSession, resolveToday, type State } from './app.ts';
import { isSunday, parseDate, weekOf } from './dates.ts';
import { formatSuggestions, formatStatus, formatToday, formatWeek, tomorrowText, weeklyText } from './format.ts';
import { channelsFrom, notify } from './notify.ts';
import { serve } from './web.ts';

const OPTIONS = {
  today: { type: 'string' }, min: { type: 'string' }, rpe: { type: 'string' }, note: { type: 'string' },
  sleep: { type: 'string' }, fatigue: { type: 'string' }, pain: { type: 'string' }, where: { type: 'string' }, trend: { type: 'string' },
  force: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, port: { type: 'string' }, host: { type: 'string' }, help: { type: 'boolean', short: 'h' },
} as const;

type Args = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>;
interface Ctx { cfg: Config; state: State; args: Args['values']; pos: string[]; env: NodeJS.ProcessEnv }
type Command = (c: Ctx) => string | Promise<string>;

const HELP = `tri - triathlon training tracker

  tri today                                  today's sessions, with keys
  tri week [n|YYYY-MM-DD]                    one plan week (default: this week)
  tri status                                 week completion, today's readiness, open suggestions
  tri log <key|today|#N> done|skipped [--min N] [--rpe N] [--note TEXT]
  tri log readiness --sleep H --fatigue 1-5 --pain 0-10 [--where X] [--trend stable|improving|worsening|sharp]
  tri skip <key>
  tri edit <key> move <date> | minutes <N> | km <N> | swap <key>
  tri suggest accept|reject <id>
  tri show <planId>                          library workout, e.g. SW-T-1
  tri notify tomorrow|weekly [--force] [--dry-run]
  tri serve [--port 8787] [--host 127.0.0.1]

Global: --today YYYY-MM-DD (pretend it is that day; backfill). Env: TRI_DATA_DIR, TRI_PLAN, TZ_NAME, NOTIFY_CHANNELS, NTFY_*, SLACK_*.`;

const need = (v: string | undefined, what: string): string => v ?? fail(`missing ${what}. Try "tri --help".`);

function weekFor(state: State, arg: string | undefined) {
  const week = !arg ? weekOf(state.plan, state.today)
    : /^\d{1,2}$/.test(arg) ? state.plan.weeks.find((w) => w.n === Number(arg))
    : weekOf(state.plan, parseDate(arg) ?? fail(`week takes a number or YYYY-MM-DD, got "${arg}"`));
  if (!week) throw new UserError(`${arg ?? state.today} is outside the plan (${state.plan.weeks[0]!.start} to ${state.plan.weeks.at(-1)!.end})`);
  return week;
}

async function notifyCommand({ state, args, pos, env }: Ctx): Promise<string> {
  const kind = need(pos[1], 'notify kind (tomorrow|weekly)');
  const texts: Record<string, { title: string; text: () => string | null }> = {
    tomorrow: { title: "Tomorrow's training", text: () => tomorrowText(state) },
    weekly: { title: 'Weekly training summary', text: () => weeklyText(state) },
  };
  const spec = texts[kind] ?? fail(`notify takes tomorrow or weekly, got "${kind}"`);
  if (kind === 'weekly' && !isSunday(state.today) && !args.force) return `Not Sunday (${state.today}); skipping weekly summary. Use --force to send anyway.`;
  const text = spec.text();
  if (text === null) return 'Nothing to send.';
  if (args['dry-run']) return `[dry-run] channels: ${channelsFrom(env).join(', ') || '(none configured)'}\n${spec.title}\n${text}`;
  return `sent to ${(await notify({ title: spec.title, text }, env)).join(', ')}`;
}

const logStatus = (s: string): 'done' | 'skipped' => (s === 'done' || s === 'skipped' ? s : fail('log status must be done or skipped'));

const COMMANDS: Record<string, Command> = {
  today: ({ state }) => formatToday(state),
  week: ({ state, pos }) => formatWeek(state, weekFor(state, pos[1])),
  status: ({ state }) => formatStatus(state),
  log: ({ cfg, state, args, pos }) =>
    need(pos[1], 'log target') === 'readiness'
      ? logReadiness(cfg, state, args)
      : logSession(cfg, state, pos[1]!, logStatus(need(pos[2], 'done|skipped')), args),
  skip: ({ cfg, state, pos }) => editSession(cfg, state, need(pos[1], 'session key'), 'skip', undefined),
  edit: ({ cfg, state, pos }) => editSession(cfg, state, need(pos[1], 'session key'), need(pos[2], 'edit op'), pos[3]),
  suggest: ({ cfg, state, pos }) => {
    const decision = need(pos[1], 'accept|reject');
    if (decision === 'list') return formatSuggestions(state.suggestions);
    if (decision !== 'accept' && decision !== 'reject') fail('suggest takes accept|reject <id>');
    return decideSuggestion(cfg, state, decision, pos[2]);
  },
  show: ({ state, pos }) => {
    const id = need(pos[1], 'plan id, e.g. SW-T-1');
    return JSON.stringify(state.plan.library[id] ?? fail(`no library workout "${id}"`), null, 2);
  },
  notify: notifyCommand,
  serve: ({ cfg, args, env }) => serve(cfg, args.today, Number(args.port ?? env.PORT ?? 8787), args.host ?? '127.0.0.1'),
};

export async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<string> {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  const name = positionals[0];
  if (values.help || !name) return HELP;
  const run = COMMANDS[name] ?? fail(`unknown command "${name}". Try "tri --help".`);
  const cfg = configFrom(env);
  const state = loadState(cfg, resolveToday(cfg, values.today));
  return run({ cfg, state, args: values, pos: positionals, env });
}

if (import.meta.main) {
  main(process.argv.slice(2), process.env).then(
    (out) => { if (out) console.log(out); },
    (e: unknown) => {
      console.error(`error: ${e instanceof Error ? e.message : e}`);
      process.exitCode = 1;
    },
  );
}
