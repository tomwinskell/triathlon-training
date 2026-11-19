// Boundary: build the evening and weekly messages and send them to ntfy using global fetch.
import { UserError, fail, type State } from './app.ts';
import { tomorrowText, weeklyText } from './format.ts';

export interface Message { readonly title: string; readonly text: string }
/** The ntfy settings; Node's `process.env` and the Worker's env both fit. */
export interface NtfyEnv {
  readonly NTFY_TOPIC?: string;
  readonly NTFY_SERVER?: string;
  readonly NTFY_TOKEN?: string;
  /** The page's address; ntfy opens it when you tap the notification. */
  readonly APP_URL?: string;
}

const TIMEOUT_MS = 15_000;

const KINDS: Record<string, { title: string; text: (state: State) => string | null }> = {
  tomorrow: { title: "Tomorrow's training", text: tomorrowText },
  weekly: { title: 'Weekly training summary', text: weeklyText },
};

/** The message for `kind`, or null when there is nothing to say. Throws on an unknown kind. */
export function messageFor(kind: string, state: State): Message | null {
  const spec = KINDS[kind] ?? fail(`notify takes ${Object.keys(KINDS).join(' or ')}, got "${kind}"`);
  const text = spec.text(state);
  return text === null ? null : { title: spec.title, text };
}

export async function notify(m: Message, env: NtfyEnv): Promise<void> {
  if (!env.NTFY_TOPIC) throw new UserError('NTFY_TOPIC is not set (or use --dry-run)');
  const server = (env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/$/, '');
  const url = `${server}/${encodeURIComponent(env.NTFY_TOPIC)}`;
  const res = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Title: m.title, ...(env.APP_URL ? { Click: env.APP_URL } : {}), ...(env.NTFY_TOKEN ? { Authorization: `Bearer ${env.NTFY_TOKEN}` } : {}) },
    body: m.text,
  });
  if (!res.ok) throw new UserError(`notify failed: HTTP ${res.status} from ${new URL(url).host}`);
}
