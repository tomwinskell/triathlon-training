// Boundary: send a text to every channel in NOTIFY_CHANNELS using global fetch.
import { UserError } from './app.ts';

export interface Message { readonly title: string; readonly text: string }
type Env = NodeJS.ProcessEnv;
interface Channel { readonly env: readonly string[]; readonly send: (m: Message, env: Env) => Promise<void> }

const TIMEOUT_MS = 15_000;

async function post(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS), ...init });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res;
}

export const CHANNELS: Record<string, Channel> = {
  ntfy: {
    env: ['NTFY_TOPIC'],
    send: async (m, env) => {
      const server = (env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/$/, '');
      await post(`${server}/${encodeURIComponent(env.NTFY_TOPIC!)}`, {
        headers: { Title: m.title, ...(env.NTFY_TOKEN ? { Authorization: `Bearer ${env.NTFY_TOKEN}` } : {}) },
        body: m.text,
      });
    },
  },
  slack: {
    env: ['SLACK_BOT_TOKEN', 'SLACK_USER_ID'],
    send: async (m, env) => {
      const res = await post('https://slack.com/api/chat.postMessage', {
        headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ channel: env.SLACK_USER_ID, text: `*${m.title}*\n${m.text}` }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!body.ok) throw new Error(`Slack: ${body.error}`);
    },
  },
};

/** Configured channel names; throws on an unknown name or a missing variable. */
export function channelsFrom(env: Env): string[] {
  const names = (env.NOTIFY_CHANNELS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const problems = names.flatMap((n) => {
    const ch = CHANNELS[n];
    return !ch ? [`unknown channel "${n}" (use ${Object.keys(CHANNELS).join(', ')})`] : ch.env.filter((v) => !env[v]).map((v) => `${n} needs ${v}`);
  });
  if (problems.length) throw new UserError(`NOTIFY_CHANNELS: ${problems.join('; ')}`);
  return names;
}

/** Tries every channel; throws one error listing the failures. Returns the channels that delivered. */
export async function notify(m: Message, env: Env): Promise<string[]> {
  const names = channelsFrom(env);
  if (!names.length) throw new UserError('NOTIFY_CHANNELS is empty; set it to ntfy and/or slack (or use --dry-run)');
  const results = await Promise.allSettled(names.map((n) => CHANNELS[n]!.send(m, env)));
  const failed = results.flatMap((r, i) => (r.status === 'rejected' ? [`${names[i]}: ${r.reason instanceof Error ? r.reason.message : r.reason}`] : []));
  if (failed.length) throw new UserError(`notify failed: ${failed.join('; ')}`);
  return names;
}
