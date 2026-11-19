// Cloudflare Worker host: the same fetch handler as `tri serve`, plus the evening ntfy message on a Cron Trigger.
import planJson from '../plan/triathlon_plan_2026-27.json' with { type: 'json' };
import { loadState } from './app.ts';
import { isSunday, todayIn } from './dates.ts';
import { type D1Database, d1Store } from './io/d1.ts';
import { parsePlan } from './io/plan.ts';
import { type NtfyEnv, messageFor, notify } from './notify.ts';
import { createHandler } from './web.ts';

interface Env extends NtfyEnv {
  readonly DB: D1Database;
  readonly TZ_NAME?: string;
}

const plan = parsePlan(planJson); // once per isolate, not per request
const tzOf = (env: Env) => env.TZ_NAME || 'America/Toronto';

export default {
  fetch: (req: Request, env: Env): Promise<Response> => createHandler(d1Store(env.DB), plan, tzOf(env))(req),

  /** Tomorrow's sessions every day, plus the weekly summary on Sundays in TZ_NAME. Does nothing until NTFY_TOPIC is set. */
  async scheduled(_event: unknown, env: Env): Promise<void> {
    if (!env.NTFY_TOPIC) return;
    const state = await loadState(d1Store(env.DB), plan, todayIn(tzOf(env)));
    for (const kind of ['tomorrow', ...(isSunday(state.today) ? ['weekly'] : [])]) {
      const message = messageFor(kind, state);
      if (message) await notify(message, env);
    }
  },
};
