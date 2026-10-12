import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { startTestApp, sessionFor } from './helpers.js';
import { createPrivateWorkplace, SEATS } from '../src/workplaces/create.js';

// Every route the Express app serves, as "METHOD /path" (Express 4 router internals).
function listRoutes(app) {
  const out = new Set();
  const prefixOf = (layer) => (layer.regexp.fast_slash ? '' : layer.regexp.source.replace(/^\^/, '').replace(/\\\/\?\(\?=\\\/\|\$\)$/, '').replace(/\\\//g, '/'));
  const walk = (stack, prefix) => {
    for (const layer of stack) {
      if (layer.route) for (const m of Object.keys(layer.route.methods)) out.add(`${m.toUpperCase()} ${prefix}${layer.route.path}`);
      else if (layer.name === 'router' && layer.handle?.stack) walk(layer.handle.stack, prefix + prefixOf(layer));
    }
  };
  walk(app._router.stack, '');
  return [...out];
}

// Requests made as workplace A against identifiers that exist only in workplace B.
// IDs omit the content marker: denied probe URLs appear in A's own audit log.
const PROBES = {
  'POST /api/chat': { body: { message: 'What is my PTO balance?' } },
  'POST /api/actions/:id/confirm': { params: { id: 'act_bonly' } },
  'POST /api/actions/:id/dismiss': { params: { id: 'act_bonly' } },
  'GET /api/traces/:turnId': { params: { turnId: 'turn_bonly' } },
  'GET /api/models': {},
  'GET /api/pto/me': {},
  'POST /api/pto/requests': { body: { date: '2026-10-20', hours: 8, idempotencyKey: 'iso-pto' } },
  'GET /api/pto/approvals': {},
  'POST /api/pto/requests/:id/decision': { params: { id: 'pto_bonly' }, body: { decision: 'APPROVED', idempotencyKey: 'iso-decide' } },
  'GET /api/claims': {},
  'GET /api/claims/:id': { params: { id: 'CLM-1001' } },
  'POST /api/claims/:id/followups': { params: { id: 'CLM-1001' }, body: { kind: 'PAYER_CALL', note: 'iso check', idempotencyKey: 'iso-followup' } },
  'POST /api/claims/:id/transition': { params: { id: 'CLM-1005' }, body: { to: 'RESUBMITTED' } },
  'GET /api/audit': {},
  'POST /api/admin/reset': {},
  'GET /api/labs/attacks': {},
  'GET /api/labs/models': {},
};
const SKIPPED = {
  'POST /api/labs/attacks/run': 'spends the model budget; it runs on req.db (Task 7 passes db: req.db)',
  'POST /api/labs/models/run': 'runs on its own in-memory copy, never a workplace',
};
// Account endpoints act on the directory account behind the session, never on workplace data; accounts.test.js covers them.
const ACCOUNT_SCOPED = new Set([
  'POST /api/auth/demo', 'GET /api/auth/me', 'POST /api/auth/ping', 'POST /api/auth/logout', 'POST /api/auth/accounts', 'POST /api/auth/login',
  'GET /api/auth/second-step', 'POST /api/auth/verify', 'POST /api/auth/email/send', 'POST /api/auth/email/confirm', 'POST /api/auth/totp/setup',
  'POST /api/auth/totp/confirm', 'POST /api/auth/passkeys/register/options', 'POST /api/auth/passkeys/register/verify',
  'POST /api/auth/passkeys/login/options', 'POST /api/auth/passkeys/login/verify', 'GET /api/auth/mailbox',
]);

const TABLES = ['users', 'pto_balances', 'pto_requests', 'patients', 'claims', 'billing_tasks', 'pending_actions', 'idempotency_keys', 'audit_events', 'traces'];
const fingerprint = (db) => createHash('sha256').update(JSON.stringify(TABLES.map(t => db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()))).digest('hex');

function plantMarkers(db, seat) {
  db.prepare("UPDATE patients SET name = 'Zed Markerb' WHERE id = 'P-01'").run();
  db.prepare("INSERT INTO pto_requests (id, user_id, date, hours, status, created_at) VALUES ('pto_bonly', 'u-sam', '2099-01-02', 8, 'PENDING', '2026-10-06T14:00:00Z')").run();
  db.prepare("INSERT INTO billing_tasks (id, claim_id, kind, note, created_by, created_at) VALUES ('bt_bonly', 'CLM-1001', 'PAYER_CALL', 'markerb note', 'u-marcus', '2026-10-06T14:00:00Z')").run();
  db.prepare("INSERT INTO pending_actions (id, user_id, turn_id, tool, args_json, summary, created_at) VALUES ('act_bonly', ?, 'turn_bonly', 'create_followup', '{}', 'markerb action', '2026-10-06T14:00:00Z')").run(seat);
  db.prepare("INSERT INTO traces (turn_id, user_id, at, steps_json) VALUES ('turn_bonly', ?, '2026-10-06T14:00:00Z', '[]')").run(seat);
  db.prepare("INSERT INTO audit_events (at, kind, detail_json) VALUES ('2026-10-06T14:00:00Z', 'markerb_event', '{\"markerb\":true}')").run();
}

async function world(t) {
  const app = await startTestApp(); t.after(app.close);
  const make = (role, username) => createPrivateWorkplace({ directory: app.directory, pool: app.pool, dir: app.config.workplacesDir, clock: app.clock, cap: 200, role, username });
  const B = Object.fromEntries(Object.entries(SEATS).map(([role, seat]) => {
    const w = make(role, `b_${role}`);
    plantMarkers(app.pool.get(w.workplaceId).db, seat);
    return [role, w];
  }));
  const A = Object.fromEntries(Object.keys(SEATS).map(role => [role, make(role, `a_${role}`)]));
  const asA = (role) => sessionFor({ ...app, db: app.pool.get(A[role].workplaceId).db, username: `a_${role}`, workplaceId: A[role].workplaceId });
  return { app, A, B, asA };
}
const fill = (route, params = {}) => route.replace(/:(\w+)/g, (_, k) => { if (!(k in params)) throw new Error(`add a sample for :${k} in ${route}`); return params[k]; });

test('every API route is classified for isolation', async (t) => {
  const { app } = await world(t);
  for (const r of listRoutes(app.app).filter(r => r.split(' ')[1].startsWith('/api/')))
    assert.ok(PROBES[r] || SKIPPED[r] || ACCOUNT_SCOPED.has(r), `unclassified route ${r}: add an isolation probe (or classify it)`);
});

test('no request in one private workplace reads or changes another, or the shared workplace', async (t) => {
  const { app, A, B, asA } = await world(t);
  const bDbs = Object.values(B).map(w => app.pool.get(w.workplaceId).db);
  const before = { b: bDbs.map(fingerprint), shared: fingerprint(app.db) };
  for (const role of Object.keys(SEATS)) {
    const a = asA(role);
    for (const [route, probe] of Object.entries(PROBES)) {
      if (route === 'POST /api/admin/reset') continue; // run last, below: it reseeds A
      const [method, path] = route.split(' ');
      const r = await a.call(fill(path, probe.params), { method, body: probe.body });
      assert.doesNotMatch(JSON.stringify(r.body ?? ''), /markerb/i, `${role} ${route} returned another workplace's data`);
    }
    if (role === 'admin') assert.equal((await a.call('/api/admin/reset', { method: 'POST' })).status, 204);
  }
  assert.deepEqual(bDbs.map(fingerprint), before.b, 'a B workplace changed');
  assert.equal(fingerprint(app.db), before.shared, 'the shared workplace changed');
  // The probes really wrote: proof the check above is not vacuous.
  assert.equal(app.pool.get(A.employee.workplaceId).db.prepare("SELECT COUNT(*) n FROM pto_requests WHERE date = '2026-10-20'").get().n, 1);
  assert.equal(app.pool.get(A.billing.workplaceId).db.prepare("SELECT COUNT(*) n FROM billing_tasks WHERE note = 'iso check'").get().n, 1);
});

test('a session for one workplace cannot be pointed at another', async (t) => {
  const { app, A, B } = await world(t);
  // A's user id in B's workplace is the same seat id; the session's workplace decides, not the user id.
  const s = sessionFor({ ...app, db: app.pool.get(A.billing.workplaceId).db, username: 'a_billing', workplaceId: A.billing.workplaceId });
  const claims = await s.call('/api/claims/CLM-1001');
  assert.doesNotMatch(JSON.stringify(claims.body), /markerb/i);
  assert.equal(app.pool.get(B.billing.workplaceId).db.prepare("SELECT name FROM patients WHERE id = 'P-01'").get().name, 'Zed Markerb');
});
