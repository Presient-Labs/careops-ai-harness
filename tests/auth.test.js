import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from './helpers.js';

test('POST without CSRF token is rejected', async (t) => {
  const app = await startTestApp(); t.after(app.close);
  const { call } = await app.login('jordan');
  const r = await call('/api/auth/logout', { method: 'POST', csrf: false });
  assert.equal(r.status, 403);
});

test('unauthenticated API call is 401; client cannot claim a role', async (t) => {
  const app = await startTestApp(); t.after(app.close);
  const r = await fetch(`${app.base}/api/auth/me`, { headers: { 'x-role': 'admin' } });
  assert.equal(r.status, 401);
});

test('health is public and ok', async (t) => {
  const app = await startTestApp(); t.after(app.close);
  const r = await fetch(`${app.base}/health`);
  assert.deepEqual(await r.json(), { status: 'ok' });
});

test('security headers are set', async (t) => {
  const app = await startTestApp(); t.after(app.close);
  const r = await fetch(`${app.base}/health`);
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('malformed JSON body is a 400, not a 500', async (t) => {
  const app = await startTestApp(); t.after(app.close);
  const r = await fetch(`${app.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"username": ' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, 'invalid_request');
});

const demo = (base, body) => fetch(`${base}/api/auth/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
test('persona shortcut creates a real server session for that persona', async (t) => {
  const app = await startTestApp(); t.after(app.close);
  const r = await demo(app.base, { persona: 'marcus' });
  assert.equal(r.status, 200);
  const body = await r.json(); assert.equal(body.user.role, 'billing'); assert.ok(body.csrfToken);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const me = await (await fetch(`${app.base}/api/auth/me`, { headers: { cookie } })).json();
  assert.equal(me.user.username, 'marcus');
  assert.equal(app.db.prepare("SELECT COUNT(*) n FROM audit_events WHERE kind='login_success' AND detail_json LIKE '%persona%'").get().n, 1);
});
test('persona shortcut cannot pick a role or a non-demo account', async (t) => {
  const app = await startTestApp(); t.after(app.close);
  assert.equal((await demo(app.base, { persona: 'jordan', role: 'admin' })).status, 400);
  assert.equal((await demo(app.base, { persona: 'sam' })).status, 400);
  assert.equal((await demo(app.base, { persona: 'admin' })).status, 400);
});

test('parser errors carry a correlation id like every other error', async (t) => {
  const app = await startTestApp(); t.after(app.close);
  const r = await fetch(`${app.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"username": ' });
  const body = await r.json();
  assert.ok(body.error.correlationId); assert.equal(r.headers.get('x-correlation-id'), body.error.correlationId);
});
