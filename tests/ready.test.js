import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from './helpers.js';
import { fakeKb } from './fixtures/kb.js';

test('ready when everything is up', async (t) => {
  const app = await startTestApp(); t.after(app.close);
  const r = await (await fetch(`${app.base}/ready`)).json();
  assert.equal(r.status, 'ready');
});
test('degraded (not down) when KB or provider config is missing', async (t) => {
  const app = await startTestApp({ kb: fakeKb(undefined, { down: true }), config: { openrouterKey: '' } }); t.after(app.close);
  const res = await fetch(`${app.base}/ready`); const r = await res.json();
  assert.equal(res.status, 200); assert.equal(r.status, 'degraded');
  assert.deepEqual(r.checks, { database: 'ok', knowledge: 'down', authentication: 'ok', config: 'ok', reasoningProvider: 'unconfigured' });
});
test('degraded when the daily AI budget is used up', async (t) => {
  const app = await startTestApp({ config: { dailyBudgetUsd: 0 } }); t.after(app.close);
  const r = await (await fetch(`${app.base}/ready`)).json();
  assert.equal(r.status, 'degraded'); assert.equal(r.checks.reasoningProvider, 'down');
});
test('degraded when the last provider calls all failed', async (t) => {
  const app = await startTestApp(); t.after(app.close);
  const now = new Date('2026-10-06T14:00:00Z').toISOString();
  for (let i = 0; i < 3; i++) app.directory.prepare("INSERT INTO llm_calls (at, day, model, purpose, cost_usd, ok) VALUES (?, '2026-10-06', 'm', 'chat', 0, 0)").run(now);
  const r = await (await fetch(`${app.base}/ready`)).json();
  assert.equal(r.status, 'degraded'); assert.equal(r.checks.reasoningProvider, 'down');
});
