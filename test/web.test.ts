import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { d1Store } from '../src/io/d1.ts';
import { fileStore, type Store } from '../src/io/store.ts';
import { createHandler } from '../src/web.ts';
import { fakeD1 } from './fake-d1.ts';
import { plan } from './helpers.ts';

const BACKENDS: Record<string, () => Store> = {
  file: () => fileStore(mkdtempSync(join(tmpdir(), 'tri-web-'))),
  d1: () => d1Store(fakeD1()),
};

const form = (path: string, fields: Record<string, string>, headers: Record<string, string> = {}) =>
  new Request(`https://tri.example${path}`, { method: 'POST', body: new URLSearchParams(fields), headers });

for (const [name, make] of Object.entries(BACKENDS)) {
  test(`web (${name}): log persists across requests, edits go through validateEdit, suggestions batch`, async () => {
    const handle = createHandler(make(), plan, 'America/Toronto', '2026-11-19');
    const get = async (path = '/') => (await handle(new Request(`https://tri.example${path}`))).text();

    assert.match(await get(), /2026-11-19#1/);
    const done = await handle(form('/log', { key: '2026-11-19#1', status: 'done', min: '50' }));
    assert.equal(done.status, 303);
    assert.match(await get(), /<li class="card done">[\s\S]*2026-11-19#1/);

    const refused = await handle(form('/edit', { key: '2026-11-19#1', op: 'move', value: '2026-11-21' }));
    assert.equal(refused.status, 400);
    assert.match(await refused.text(), /role="alert"[^>]*>[^<]*no stacking/);
    const ok = await handle(form('/edit', { key: '2026-11-20#2', op: 'minutes', value: '30', week: '1' }));
    assert.equal(ok.status, 303);
    assert.equal(ok.headers.get('location'), '/?week=1');

    await handle(form('/readiness', { sleep: '5', fatigue: '4', pain: '0' }));
    assert.match(await get(), /amber-readiness:2026-11-19/);
    await handle(form('/suggest', { id: 'amber-readiness:2026-11-19', decision: 'accept' }));
    assert.doesNotMatch(await get(), /amber-readiness:2026-11-19/);
  });
}

test('web: week navigation, cross-origin refusal, unknown paths', async () => {
  const handle = createHandler(fileStore(mkdtempSync(join(tmpdir(), 'tri-web-'))), plan, 'America/Toronto', '2026-11-19');
  const html = await (await handle(new Request('https://tri.example/?week=2'))).text();
  assert.match(html, /Week 2 &middot; 2026-11-23/);
  assert.match(html, /href="\/\?week=1"/);
  assert.equal((await handle(form('/log', { key: '2026-11-19#1' }, { origin: 'https://evil.example' }))).status, 403);
  assert.equal((await handle(new Request('https://tri.example/nope'))).status, 404);
});
