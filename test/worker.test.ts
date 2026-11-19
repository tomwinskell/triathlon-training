import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/worker.ts';
import { fakeD1 } from './fake-d1.ts';

test('worker: fetch serves the page from D1; scheduled does nothing without NTFY_TOPIC', async () => {
  const env = { DB: fakeD1(), TZ_NAME: 'America/Toronto' };
  const logged = await worker.fetch(new Request('https://tri.example/readiness', { method: 'POST', body: new URLSearchParams({ sleep: '8', fatigue: '2', pain: '0' }) }), env);
  assert.equal(logged.status, 303);
  assert.equal(env.DB.rows.length, 1);
  assert.match(await (await worker.fetch(new Request('https://tri.example/'), env)).text(), /<title>Training<\/title>/);
  await worker.scheduled({}, env);
});
