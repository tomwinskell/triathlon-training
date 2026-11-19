// One server-rendered page over the same state and actions as the CLI. Forms POST, the server redirects back.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { type Config, UserError, decideSuggestion, loadState, logReadiness, logSession, resolveToday, type State } from './app.ts';
import { dayName, weekOf } from './dates.ts';
import { sessionsInWeek } from './plan-state.ts';
import type { EffectiveSession } from './types.ts';

const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const MAX_BODY = 16_384;

const STATUS_LABEL = { done: 'done', skipped: 'skipped', missed: 'missed', pending: '' } as const;

function sessionCard(state: State, s: EffectiveSession): string {
  const out = state.outcomes.get(s.key) ?? 'pending';
  const rpe = s.rpe.max ? ` &middot; RPE ${s.rpe.min === s.rpe.max ? s.rpe.max : `${s.rpe.min}-${s.rpe.max}`}` : '';
  return `<li class="card ${out}">
  <div><strong>${esc(s.title)}</strong> <span class="tag">${esc(STATUS_LABEL[out])}</span></div>
  <div class="meta">${esc(s.planId || 'RACE')} &middot; ${s.minutes} min${rpe} &middot; <code>${esc(s.key)}</code></div>
  <form method="post" action="/log">
    <input type="hidden" name="key" value="${esc(s.key)}">
    <input name="min" type="number" inputmode="numeric" min="1" placeholder="min (${s.minutes})" aria-label="Actual minutes">
    <input name="rpe" type="number" inputmode="decimal" min="1" max="10" step="0.5" placeholder="RPE" aria-label="RPE">
    <button name="status" value="done">Done</button>
    <button name="status" value="skipped" class="alt">Skip</button>
  </form>
</li>`;
}

export function renderPage(state: State, flash?: string): string {
  const week = weekOf(state.plan, state.today);
  const today = state.sessions.filter((s) => s.date === state.today);
  const weekRows = week
    ? sessionsInWeek(state.sessions, week).map((s) => `<tr class="${state.outcomes.get(s.key)}${s.date === state.today ? ' now' : ''}"><td>${dayName(s.date)}</td><td>${esc(s.title)}</td><td>${s.minutes}</td><td>${esc(STATUS_LABEL[state.outcomes.get(s.key) ?? 'pending'])}</td></tr>`).join('')
    : '';
  const suggestions = state.suggestions.map((g) => `<li class="card ${g.severity}">
  <div><strong>${esc(g.message)}</strong></div>
  <div class="meta"><code>${esc(g.id)}</code>${g.edits.length ? ` &middot; ${g.edits.length} edit(s)` : ''}</div>
  <form method="post" action="/suggest"><input type="hidden" name="id" value="${esc(g.id)}">
    <button name="decision" value="accept">Accept</button><button name="decision" value="reject" class="alt">Reject</button></form>
</li>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Training</title>
<style>
:root{color-scheme:light dark;--bg:#fafafa;--fg:#1c1c1e;--card:#fff;--line:#d8d8dc;--accent:#0a6cff;--warn:#c47a00;--stop:#c0262d}
@media(prefers-color-scheme:dark){:root{--bg:#121214;--fg:#ececf0;--card:#1c1c20;--line:#38383f;--accent:#4d9bff;--warn:#e0a030;--stop:#ff6b6b}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.4 system-ui,sans-serif}
main{max-width:38rem;margin:0 auto;padding:1rem}
h1{font-size:1.3rem;margin:.2rem 0}h2{font-size:1.05rem;margin:1.6rem 0 .5rem}
ul{list-style:none;padding:0;margin:0;display:grid;gap:.6rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:.7rem .8rem}
.card.done{opacity:.65}.card.warn{border-color:var(--warn)}.card.stop{border-color:var(--stop)}
.meta,.tag{font-size:.85rem;opacity:.75}code{font-size:.85rem}
form{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.5rem}
input,button,select{font:inherit;padding:.55rem .7rem;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg);min-height:2.6rem}
input{width:6.5rem}input.wide{width:100%}
button{background:var(--accent);color:#fff;border:0;cursor:pointer}button.alt{background:transparent;color:var(--fg);border:1px solid var(--line)}
table{width:100%;border-collapse:collapse;font-size:.92rem}td{padding:.35rem .3rem;border-bottom:1px solid var(--line)}
tr.now{font-weight:600}tr.done{opacity:.6}tr.missed td:last-child{color:var(--stop)}
.flash{background:var(--card);border:1px solid var(--stop);border-radius:10px;padding:.6rem .8rem;margin:.6rem 0}
</style></head><body><main>
<h1>${dayName(state.today)} ${esc(state.today)}</h1>
<div class="meta">${week ? `Week ${week.n} &middot; ${esc(week.phase)} &middot; ${esc(week.objective)}` : 'Outside the plan'}</div>
${flash ? `<div class="flash" role="alert">${esc(flash)}</div>` : ''}
<h2>Today</h2>
<ul>${today.map((s) => sessionCard(state, s)).join('') || '<li class="meta">No sessions planned.</li>'}</ul>
<h2>Readiness</h2>
<form method="post" action="/readiness" class="card">
  <input name="sleep" type="number" step="0.25" min="0" max="24" placeholder="sleep h" required aria-label="Sleep hours">
  <input name="fatigue" type="number" min="1" max="5" placeholder="fatigue 1-5" required aria-label="Fatigue">
  <input name="pain" type="number" step="0.5" min="0" max="10" placeholder="pain 0-10" required aria-label="Pain">
  <input class="wide" name="where" placeholder="pain location (optional)" aria-label="Pain location">
  <select name="trend" aria-label="Pain trend"><option value="">trend</option><option>stable</option><option>improving</option><option>worsening</option><option>sharp</option></select>
  <button>Save</button>
</form>
<h2>Suggestions</h2>
<ul>${suggestions || '<li class="meta">None open.</li>'}</ul>
<h2>This week</h2>
<table>${weekRows}</table>
</main></body></html>`;
}

async function readForm(req: IncomingMessage): Promise<Record<string, string>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req as AsyncIterable<Buffer>) {
    size += c.length;
    if (size > MAX_BODY) throw new UserError('request too large');
    chunks.push(c);
  }
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
}

const POSTS: Record<string, (cfg: Config, state: State, f: Record<string, string>) => string> = {
  '/log': (cfg, state, f) => logSession(cfg, state, f.key ?? '', f.status === 'skipped' ? 'skipped' : 'done', f),
  '/readiness': (cfg, state, f) => logReadiness(cfg, state, f),
  '/suggest': (cfg, state, f) => decideSuggestion(cfg, state, f.decision === 'reject' ? 'reject' : 'accept', f.id),
};

/** Same-origin check: a browser form from another site carries a foreign Origin. */
const sameOrigin = (req: IncomingMessage): boolean => !req.headers.origin || new URL(req.headers.origin).host === req.headers.host;

export function handler(cfg: Config, todayFlag: string | undefined) {
  const page = (res: ServerResponse, status: number, flash?: string) => {
    const html = renderPage(loadState(cfg, resolveToday(cfg, todayFlag)), flash);
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(html);
  };
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const path = new URL(req.url ?? '/', 'http://x').pathname;
      if (req.method === 'GET' && path === '/') return page(res, 200);
      const action = POSTS[path];
      if (req.method !== 'POST' || !action) return void res.writeHead(404).end('not found');
      if (!sameOrigin(req)) return void res.writeHead(403).end('cross-origin POST refused');
      action(cfg, loadState(cfg, resolveToday(cfg, todayFlag)), await readForm(req));
      res.writeHead(303, { Location: '/' }).end();
    } catch (e) {
      if (e instanceof UserError) return page(res, 400, e.message);
      console.error(e);
      res.writeHead(500).end('server error');
    }
  };
}

/** Starts listening; resolves with a message once the server closes. */
export function serve(cfg: Config, todayFlag: string | undefined, port: number, host: string): Promise<string> {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UserError(`bad --port ${port}`);
  const server = createServer(handler(cfg, todayFlag));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('close', () => resolve('server stopped'));
    server.listen(port, host, () => console.log(`tri serving on http://${host}:${port}/ (data: ${cfg.dataDir})`));
  });
}
