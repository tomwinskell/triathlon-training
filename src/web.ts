// One server-rendered page over the same state and actions as the CLI. Forms POST, the server redirects back.
// The core is a standard fetch handler: `tri serve` wraps it in node:http, the Worker calls it directly.
import { createServer } from 'node:http';
import { UserError, decideSuggestion, editSession, loadState, logReadiness, logSession, resolveToday, type State } from './app.ts';
import { dayName, weekOf } from './dates.ts';
import type { Store } from './io/store.ts';
import { sessionsInWeek } from './plan-state.ts';
import type { EffectiveSession, Plan, Week } from './types.ts';

const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const MAX_BODY = 16_384;

const STATUS_LABEL = { done: 'done', skipped: 'skipped', missed: 'missed', pending: '' } as const;

/** The week being shown: `?week=N` when it is a plan week, else the one containing today. */
const shownWeek = (state: State, n: number): Week | undefined => state.plan.weeks.find((w) => w.n === n) ?? weekOf(state.plan, state.today);

/** A POST form that remembers which week is on screen, so the redirect lands back on it. */
const postForm = (action: string, week: Week | undefined, inner: string, cls = ''): string =>
  `<form method="post" action="${action}"${cls ? ` class="${cls}"` : ''}>${week ? `<input type="hidden" name="week" value="${week.n}">` : ''}${inner}</form>`;

/** Skip, move and shorten for one session, folded away so the card stays small. */
function editForms(s: EffectiveSession, week: Week | undefined): string {
  const edit = (op: string, input: string, button: string) =>
    postForm('/edit', week, `<input type="hidden" name="key" value="${esc(s.key)}"><input type="hidden" name="op" value="${op}">${input}<button class="alt">${button}</button>`);
  return `<details><summary>Edit</summary>
  ${edit('skip', '', 'Skip (plan edit)')}
  ${edit('move', '<input name="value" type="date" required aria-label="New date">', 'Move to date')}
  ${edit('minutes', `<input name="value" type="number" inputmode="numeric" min="1" max="1440" placeholder="${s.minutes}" required aria-label="Minutes">`, 'Set minutes')}
</details>`;
}

function sessionCard(state: State, s: EffectiveSession, week: Week | undefined): string {
  const out = state.outcomes.get(s.key) ?? 'pending';
  const rpe = s.rpe.max ? ` &middot; RPE ${s.rpe.min === s.rpe.max ? s.rpe.max : `${s.rpe.min}-${s.rpe.max}`}` : '';
  return `<li class="card ${out}">
  <div><strong>${esc(s.title)}</strong> <span class="tag">${esc(STATUS_LABEL[out])}</span></div>
  <div class="meta">${dayName(s.date)} &middot; ${esc(s.planId || 'RACE')} &middot; ${s.minutes} min${rpe} &middot; <code>${esc(s.key)}</code></div>
  ${postForm('/log', week, `<input type="hidden" name="key" value="${esc(s.key)}">
    <input name="min" type="number" inputmode="numeric" min="1" placeholder="min (${s.minutes})" aria-label="Actual minutes">
    <input name="rpe" type="number" inputmode="decimal" min="1" max="10" step="0.5" placeholder="RPE" aria-label="RPE">
    <button name="status" value="done">Done</button>
    <button name="status" value="skipped" class="alt">Skip</button>`)}
  ${editForms(s, week)}
</li>`;
}

/** `← Week 4 · Week 5 · Week 6 →`, with the ends of the plan left blank. */
function weekNav(state: State, week: Week): string {
  const link = (n: number, label: string) => (state.plan.weeks.some((w) => w.n === n) ? `<a href="/?week=${n}">${label}</a>` : '<span></span>');
  return `<nav>${link(week.n - 1, '&larr; Week ' + (week.n - 1))}<span>${weekOf(state.plan, state.today) === week ? 'This week' : `Week ${week.n}`} &middot; ${esc(week.start)}</span>${link(week.n + 1, `Week ${week.n + 1} &rarr;`)}</nav>`;
}

export function renderPage(state: State, weekN: number, flash?: string): string {
  const current = weekOf(state.plan, state.today);
  const week = shownWeek(state, weekN);
  const today = state.sessions.filter((s) => s.date === state.today);
  const rest = week ? sessionsInWeek(state.sessions, week).filter((s) => s.date !== state.today) : [];
  const suggestions = state.suggestions.map((g) => `<li class="card ${g.severity}">
  <div><strong>${esc(g.message)}</strong></div>
  <div class="meta"><code>${esc(g.id)}</code>${g.edits.length ? ` &middot; ${g.edits.length} edit(s)` : ''}</div>
  ${postForm('/suggest', week, `<input type="hidden" name="id" value="${esc(g.id)}">
    <button name="decision" value="accept">Accept</button><button name="decision" value="reject" class="alt">Reject</button>`)}
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
details{margin-top:.5rem}summary{cursor:pointer;font-size:.9rem;opacity:.8}
nav{display:flex;justify-content:space-between;gap:.5rem;margin:.2rem 0 .6rem;font-size:.92rem}a{color:var(--accent)}
.card.missed .tag{color:var(--stop)}
.flash{background:var(--card);border:1px solid var(--stop);border-radius:10px;padding:.6rem .8rem;margin:.6rem 0}
</style>
</head><body><main>
<h1>${dayName(state.today)} ${esc(state.today)}</h1>
<div class="meta">${current ? `Week ${current.n} &middot; ${esc(current.phase)} &middot; ${esc(current.objective)}` : 'Outside the plan'}</div>
${flash ? `<div class="flash" role="alert">${esc(flash)}</div>` : ''}
<h2>Today</h2>
<ul>${today.map((s) => sessionCard(state, s, week)).join('') || '<li class="meta">No sessions planned.</li>'}</ul>
<h2>Readiness</h2>
${postForm('/readiness', week, `
  <input name="sleep" type="number" step="0.25" min="0" max="24" placeholder="sleep h" required aria-label="Sleep hours">
  <input name="fatigue" type="number" min="1" max="5" placeholder="fatigue 1-5" required aria-label="Fatigue">
  <input name="pain" type="number" step="0.5" min="0" max="10" placeholder="pain 0-10" required aria-label="Pain">
  <input class="wide" name="where" placeholder="pain location (optional)" aria-label="Pain location">
  <select name="trend" aria-label="Pain trend"><option value="">trend</option><option>stable</option><option>improving</option><option>worsening</option><option>sharp</option></select>
  <button>Save</button>`, 'card')}
<h2>Suggestions</h2>
<ul>${suggestions || '<li class="meta">None open.</li>'}</ul>
<h2>Week</h2>
${week ? weekNav(state, week) : ''}
<ul>${rest.map((s) => sessionCard(state, s, week)).join('') || '<li class="meta">Nothing else this week.</li>'}</ul>
</main></body></html>`;
}

const POSTS: Record<string, (store: Store, state: State, f: Record<string, string>) => Promise<string>> = {
  '/log': (store, state, f) => logSession(store, state, f.key ?? '', f.status === 'skipped' ? 'skipped' : 'done', f),
  '/readiness': (store, state, f) => logReadiness(store, state, f),
  '/suggest': (store, state, f) => decideSuggestion(store, state, f.decision === 'reject' ? 'reject' : 'accept', f.id),
  '/edit': (store, state, f) => editSession(store, state, f.key ?? '', f.op ?? '', f.value),
};

async function readForm(req: Request): Promise<Record<string, string>> {
  const body = await req.text();
  if (body.length > MAX_BODY) throw new UserError('request too large');
  return Object.fromEntries(new URLSearchParams(body));
}

/** Same-origin check: a browser form from another site carries a foreign Origin. */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try { return new URL(origin).host === new URL(req.url).host; } catch { return false; }
}

const weekParam = (raw: string | null | undefined): number => (raw && /^\d{1,3}$/.test(raw) ? Number(raw) : 0);

/** The whole app as `Request -> Response`. `todayOverride` pretends it is that day (`tri serve --today`). */
export function createHandler(store: Store, plan: Plan, tz: string, todayOverride?: string): (req: Request) => Promise<Response> {
  const today = () => resolveToday(tz, todayOverride);
  today(); // a bad --today fails here, not on every request
  const page = async (weekN: number, status: number, flash?: string) =>
    new Response(renderPage(await loadState(store, plan, today()), weekN, flash), { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  return async (req) => {
    let weekN = 0;
    try {
      const url = new URL(req.url);
      weekN = weekParam(url.searchParams.get('week'));
      if (req.method === 'GET' && url.pathname === '/') return await page(weekN, 200);
      const action = POSTS[url.pathname];
      if (req.method !== 'POST' || !action) return new Response('not found', { status: 404 });
      if (!sameOrigin(req)) return new Response('cross-origin POST refused', { status: 403 });
      const form = await readForm(req);
      weekN = weekParam(form.week);
      await action(store, await loadState(store, plan, today()), form);
      return new Response(null, { status: 303, headers: { Location: weekN ? `/?week=${weekN}` : '/' } });
    } catch (e) {
      if (e instanceof UserError) return page(weekN, 400, e.message);
      console.error(e);
      return new Response('server error', { status: 500 });
    }
  };
}

/** Wraps a fetch handler in node:http. Starts listening; resolves with a message once the server closes. */
export function serve(handle: (req: Request) => Promise<Response>, port: number, host: string, where: string): Promise<string> {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UserError(`bad --port ${port}`);
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    if (req.method !== 'GET' && req.method !== 'HEAD') for await (const c of req as AsyncIterable<Buffer>) if ((size += c.length) <= MAX_BODY + 1) chunks.push(c);
    const headers = Object.entries(req.headers).flatMap(([k, v]) => (v === undefined ? [] : [[k, [v].flat().join(', ')] as [string, string]]));
    const resp = await handle(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }));
    res.writeHead(resp.status, Object.fromEntries(resp.headers)).end(Buffer.from(await resp.arrayBuffer()));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('close', () => resolve('server stopped'));
    server.listen(port, host, () => console.log(`tri serving on http://${host}:${port}/ (data: ${where})`));
  });
}
