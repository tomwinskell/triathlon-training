import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { main } from '../src/cli.ts';
import { weekStats } from '../src/stats.ts';
import { ctxFor, logSession, plan } from './helpers.ts';
import { outcomes } from '../src/plan-state.ts';

const env = (extra: Record<string, string> = {}) => ({ TRI_DATA_DIR: mkdtempSync(join(tmpdir(), 'tri-')), TRI_PLAN: resolve('plan/triathlon_plan_2026-27.json'), ...extra });
const T = ['--today', '2026-11-19'];

test('end to end: readiness -> amber suggestion -> accept -> optional run skipped, suggestion gone', async () => {
  const e = env();
  assert.match(await main(['today', ...T], e), /2026-11-19#2 {2}RN-O-2/);
  assert.match(await main(['status', ...T], e), /No open suggestions/);
  await main(['log', 'readiness', '--sleep', '5', '--fatigue', '4', '--pain', '0', ...T], e);
  assert.match(await main(['status', ...T], e), /amber-readiness:2026-11-19 \[warn\]/);
  await main(['suggest', 'accept', 'amber-readiness:2026-11-19', ...T], e);
  assert.match(await main(['today', ...T], e), /\[-\] {2}2026-11-19#2/);
  assert.match(await main(['status', ...T], e), /No open suggestions/);
});

test('cli: rejecting hides the suggestion and leaves the run pending; bad input is a clear error', async () => {
  const e = env();
  await main(['log', 'readiness', '--sleep', '5', '--fatigue', '5', '--pain', '0', ...T], e);
  await main(['suggest', 'reject', 'amber-readiness:2026-11-19', ...T], e);
  assert.match(await main(['status', ...T], e), /No open suggestions/);
  assert.match(await main(['today', ...T], e), /\[ \] {2}2026-11-19#2/);
  await assert.rejects(main(['log', 'readiness', '--sleep', '5', '--fatigue', '9', '--pain', '0', ...T], e), /fatigue must be an integer from 1 to 5/);
  await assert.rejects(main(['log', '2026-11-19#7', 'done', ...T], e), /no session/);
  await assert.rejects(main(['edit', '2026-11-19#1', 'move', '2026-11-21', ...T], e), /no stacking/);
});

test('cli: log today done marks non-optional sessions and the weekly numbers follow', async () => {
  const e = env();
  await main(['log', '2026-11-18#1', 'done', '--min', '40', ...T], e);
  await main(['log', 'today', 'done', ...T], e);
  const wk = await main(['week', ...T], e);
  assert.match(wk, /\[x\] {2}2026-11-18#1/);
  assert.match(wk, /\[x\] {2}2026-11-19#1/);
  assert.match(wk, /\[ \] {2}2026-11-19#2/); // optional run left alone
  assert.match(await main(['notify', 'weekly', ...T], e), /Not Sunday/);
});

test('weekStats: completion and minutes from the log; optional sessions count only when done', () => {
  const log = [logSession('2026-11-17#1', 'done', 30), logSession('2026-11-18#1', 'done'), logSession('2026-11-17#2', 'skipped')];
  const ctx = ctxFor('2026-11-19', log);
  const s = weekStats(plan.weeks[0]!, ctx.sessions, outcomes(ctx.sessions, log, ctx.today), log);
  assert.equal(s.sessions, 10); // 11 planned minus the optional Thursday run
  assert.equal(s.done, 2);
  assert.equal(s.doneMinutes, 30 + 45); // logged 30; unlogged-minutes falls back to the planned 45
  assert.equal(s.completion, 0.2);
});

test('notify: ntfy receives the tomorrow text and a Click link; weekly is skipped off-Sunday and sent with --force', async () => {
  const got: { url?: string; title?: string; auth?: string; click?: string; body: string }[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { got.push({ url: req.url, title: String(req.headers.title), auth: req.headers.authorization, click: String(req.headers.click), body }); res.end('ok'); });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const e = env({ NTFY_TOPIC: 'my-topic', NTFY_TOKEN: 'tk', APP_URL: 'https://tri.example/', NTFY_SERVER: `http://127.0.0.1:${(server.address() as { port: number }).port}` });
    assert.match(await main(['notify', 'tomorrow', ...T], e), /sent to ntfy/);
    assert.equal(got.length, 1);
    assert.equal(got[0]!.url, '/my-topic');
    assert.equal(got[0]!.auth, 'Bearer tk');
    assert.equal(got[0]!.click, 'https://tri.example/');
    assert.match(got[0]!.body, /Tomorrow Fri 2026-11-20[\s\S]*Endurance 1, 50 min[\s\S]*Strength B/);
    assert.match(await main(['notify', 'weekly', ...T], e), /Not Sunday/);
    assert.equal(got.length, 1);
    await main(['notify', 'weekly', '--force', ...T], e);
    assert.equal(got.length, 2);
    await assert.rejects(main(['notify', 'tomorrow', ...T], env()), /NTFY_TOPIC is not set/);
    assert.match(await main(['notify', 'tomorrow', '--dry-run', ...T], env()), /\[dry-run\] ntfy: off[\s\S]*Tomorrow Fri/);
  } finally {
    server.close();
  }
});

test('without --today the header shows the current date', async () => {
  assert.match(await main(['today'], env()), /^\w{3} \d{4}-\d{2}-\d{2}/);
});
