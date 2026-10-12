import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, sessionFor, mutableClock } from './helpers.js';
import { createSession, IDLE_MS, ABSOLUTE_MS } from '../src/auth/sessions.js';
import { createPrivateWorkplace } from '../src/workplaces/create.js';

async function personaCookie(base, persona) {
  const r = await fetch(`${base}/api/auth/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ persona }) });
  assert.equal(r.status, 200);
  const { csrfToken } = await r.json();
  return { cookie: r.headers.get('set-cookie').split(';')[0], csrfToken };
}
const get = (base, path, cookie) => fetch(base + path, { headers: { cookie } }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));

test('a persona Quick look creates a full session in the shared workplace; me reports the idle limit', async (t) => {
  const app = await startTestApp(); t.after(app.close);
  const { cookie } = await personaCookie(app.base, 'jordan');
  const me = await get(app.base, '/api/auth/me', cookie);
  assert.equal(me.status, 200);
  assert.equal(me.body.user.username, 'jordan');
  assert.equal(me.body.session.idleTimeoutMs, IDLE_MS);
  assert.equal(me.body.session.accountSession, false);
  assert.equal((await get(app.base, '/api/pto/me', cookie)).status, 200);
  assert.equal(app.directory.prepare("SELECT workplace_id FROM sessions").get().workplace_id, 'shared');
});

test('the persona username-and-password door is gone', async (t) => {
  const app = await startTestApp(); t.after(app.close);
  const r = await fetch(`${app.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'jordan', password: 'pw' }) });
  assert.notEqual(r.status, 200);
});

test('15 minutes without activity ends the session as session_idle and records it', async (t) => {
  const clock = mutableClock('2026-10-06T14:00:00Z');
  const app = await startTestApp({ clock }); t.after(app.close);
  const jordan = sessionFor({ ...app, username: 'jordan' });
  clock.advance(IDLE_MS - 1000);
  assert.equal((await jordan.call('/api/pto/me')).status, 200);
  clock.advance(IDLE_MS - 1000);
  assert.equal((await jordan.call('/api/pto/me')).status, 200); // activity keeps it alive
  clock.advance(IDLE_MS + 1);
  const r = await jordan.call('/api/pto/me');
  assert.deepEqual([r.status, r.body.error.code], [401, 'session_idle']);
  assert.equal(app.db.prepare("SELECT COUNT(*) n FROM audit_events WHERE kind = 'session_idle_logoff'").get().n, 1);
  assert.equal((await jordan.call('/api/pto/me')).body.error.code, 'unauthenticated');
});

test('every session ends after 8 hours, however active', async (t) => {
  const clock = mutableClock('2026-10-06T14:00:00Z');
  const app = await startTestApp({ clock }); t.after(app.close);
  const jordan = sessionFor({ ...app, username: 'jordan' });
  for (let spent = 0; spent + 10 * 60_000 < ABSOLUTE_MS; spent += 10 * 60_000) { clock.advance(10 * 60_000); assert.equal((await jordan.call('/api/auth/ping', { method: 'POST' })).status, 204); }
  clock.advance(10 * 60_000);
  assert.equal((await jordan.call('/api/pto/me')).status, 401);
});

test('a halfway session reaches nothing in the app', async (t) => {
  const app = await startTestApp(); t.after(app.close);
  const s = createSession(app.directory, { workplaceId: 'shared', userId: 'u-jordan', stage: 'halfway' }, app.clock);
  const r = await get(app.base, '/api/pto/me', `careops_sid=${s.id}`);
  assert.deepEqual([r.status, r.body.error.code], [401, 'second_step_required']);
});

test('a private workplace session sees its own copy; its writes never reach the shared workplace', async (t) => {
  const app = await startTestApp(); t.after(app.close);
  const w = createPrivateWorkplace({ directory: app.directory, pool: app.pool, dir: app.config.workplacesDir, clock: app.clock, cap: 200, role: 'employee', username: 'alice' });
  const alice = sessionFor({ ...app, db: app.pool.get(w.workplaceId).db, username: 'alice', workplaceId: w.workplaceId });
  assert.equal((await alice.call('/api/auth/me')).body.user.displayName, 'alice');
  const made = await alice.call('/api/pto/requests', { method: 'POST', body: { date: '2026-10-16', hours: 8, idempotencyKey: 'k1' } });
  assert.equal(made.status, 201);
  assert.equal(app.pool.get(w.workplaceId).db.prepare("SELECT COUNT(*) n FROM pto_requests WHERE user_id = 'u-jordan'").get().n, 1);
  assert.equal(app.db.prepare("SELECT COUNT(*) n FROM pto_requests WHERE user_id = 'u-jordan'").get().n, 0);
});

test('an admin reset in a private workplace keeps the visitor in their seat', async (t) => {
  const app = await startTestApp(); t.after(app.close);
  const w = createPrivateWorkplace({ directory: app.directory, pool: app.pool, dir: app.config.workplacesDir, clock: app.clock, cap: 200, role: 'admin', username: 'ada' });
  app.directory.prepare("INSERT INTO accounts (id, username, workplace_id, user_id, role, password_hash, created_at) VALUES ('acc', 'ada', ?, 'u-dana', 'admin', 'h', 1)").run(w.workplaceId);
  const ada = sessionFor({ ...app, db: app.pool.get(w.workplaceId).db, username: 'ada', workplaceId: w.workplaceId, accountId: 'acc' });
  assert.equal((await ada.call('/api/admin/reset', { method: 'POST' })).status, 204);
  assert.equal((await ada.call('/api/auth/me')).body.user.displayName, 'ada');
});

test('model spend and lab results are read from the directory', async (t) => {
  const app = await startTestApp(); t.after(app.close);
  app.directory.prepare("INSERT INTO lab_results (lab, at, results_json) VALUES ('attacks', 't', '{\"attacks\":3}')").run();
  const dana = sessionFor({ ...app, username: 'dana' });
  assert.equal((await dana.call('/api/labs/attacks')).body.attacks, 3);
});
