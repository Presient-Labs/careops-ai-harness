import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDirectory, SHARED } from '../src/db/directory.js';
import { openDb } from '../src/db/index.js';
import { seedDb } from '../src/db/seed.js';
import { createWorkplacePool, workplaceFile } from '../src/workplaces/pool.js';
import { createPrivateWorkplace, SEATS, WORKPLACE_TTL_MS } from '../src/workplaces/create.js';
import { cleanupExpired } from '../src/workplaces/cleanup.js';

function setup({ cap = 200, max = 50 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'careops-wp-'));
  const t = { ms: Date.parse('2026-10-06T14:00:00Z') };
  const clock = { now: () => new Date(t.ms) };
  const directory = openDirectory(':memory:', clock);
  const sharedDb = openDb(':memory:'); seedDb(sharedDb, { clock, demoPassword: 'pw' });
  const pool = createWorkplacePool({ directory, sharedDb, dir, clock, max });
  const make = (role = 'employee', username = 'alice') => createPrivateWorkplace({ directory, pool, dir, clock, cap, role, username });
  return { dir, t, clock, directory, sharedDb, pool, make, done: () => { pool.closeAll(); rmSync(dir, { recursive: true, force: true }); } };
}

test('creating a workplace seeds a fresh copy and seats the visitor in the persona of their role', (t) => {
  const s = setup(); t.after(s.done);
  for (const [role, seat] of Object.entries(SEATS)) {
    const w = s.make(role, `v_${role}`);
    assert.equal(w.userId, seat);
    assert.equal(w.expiresAt, s.t.ms + WORKPLACE_TTL_MS);
    const { db } = s.pool.get(w.workplaceId);
    assert.deepEqual(db.prepare('SELECT username, display_name, role FROM users WHERE id = ?').get(seat), { username: `v_${role}`, display_name: `v_${role}`, role });
    assert.equal(db.prepare('SELECT COUNT(*) n FROM claims').get().n, 8);
    assert.ok(existsSync(workplaceFile(s.dir, w.workplaceId)));
  }
  assert.equal(s.sharedDb.prepare("SELECT username FROM users WHERE id = 'u-jordan'").get().username, 'jordan');
});

test('the shared workplace comes from the pool without a file; bad ids are refused', (t) => {
  const s = setup(); t.after(s.done);
  assert.equal(s.pool.get(SHARED).db, s.sharedDb);
  assert.equal(s.pool.get('not-an-id'), null);
  assert.equal(s.pool.get('../../etc/passwd'), null);
});

test('at the cap, creation is refused as demo_full and nothing is left behind', (t) => {
  const s = setup({ cap: 1 }); t.after(s.done);
  s.make('employee', 'alice');
  assert.throws(() => s.make('billing', 'bob'), (e) => e.code === 'demo_full');
  assert.equal(s.directory.prepare("SELECT COUNT(*) n FROM workplaces WHERE kind = 'private'").get().n, 1);
  assert.equal(readdirSync(s.dir).filter(f => f.endsWith('.db')).length, 1);
});

test('an expired workplace is no longer served, and cleanup deletes its rows and file', (t) => {
  const s = setup(); t.after(s.done);
  const w = s.make();
  s.directory.prepare("INSERT INTO accounts (id, username, workplace_id, user_id, role, password_hash, created_at) VALUES ('a1', 'alice', ?, 'u-jordan', 'employee', 'h', 1)").run(w.workplaceId);
  s.t.ms += WORKPLACE_TTL_MS;
  assert.equal(s.pool.get(w.workplaceId), null);
  assert.equal(cleanupExpired({ directory: s.directory, pool: s.pool, dir: s.dir, clock: s.clock }), 1);
  assert.equal(s.directory.prepare('SELECT COUNT(*) n FROM accounts').get().n, 0);
  assert.equal(existsSync(workplaceFile(s.dir, w.workplaceId)), false);
  assert.equal(s.directory.prepare('SELECT kind FROM security_log').get().kind, 'workplace_deleted');
});

test('cleanup removes an orphan workplace file that has no directory row', (t) => {
  const s = setup(); t.after(s.done);
  const orphan = join(s.dir, `${'a'.repeat(32)}.db`);
  writeFileSync(orphan, '');
  cleanupExpired({ directory: s.directory, pool: s.pool, dir: s.dir, clock: s.clock });
  assert.equal(existsSync(orphan), false);
});

test('a leased workplace is not closed by eviction or cleanup until released', (t) => {
  const s = setup({ max: 1 }); t.after(s.done);
  const a = s.make('employee', 'alice');
  const lease = s.pool.acquire(a.workplaceId);
  s.make('billing', 'bob'); // over max: evicts only unleased entries
  assert.equal(lease.wp.db.prepare('SELECT COUNT(*) n FROM users').get().n, 5);
  s.t.ms += WORKPLACE_TTL_MS;
  assert.equal(s.pool.close(a.workplaceId), false);
  cleanupExpired({ directory: s.directory, pool: s.pool, dir: s.dir, clock: s.clock });
  assert.equal(lease.wp.db.prepare('SELECT COUNT(*) n FROM users').get().n, 5);
  lease.release(); lease.release(); // releasing twice counts once
  cleanupExpired({ directory: s.directory, pool: s.pool, dir: s.dir, clock: s.clock });
  assert.equal(existsSync(workplaceFile(s.dir, a.workplaceId)), false);
});

test('a new pool on the same directory reopens an existing workplace', (t) => {
  const s = setup(); t.after(s.done);
  const w = s.make();
  s.pool.closeAll();
  const fresh = createWorkplacePool({ directory: s.directory, sharedDb: s.sharedDb, dir: s.dir, clock: s.clock });
  assert.equal(fresh.get(w.workplaceId).db.prepare("SELECT username FROM users WHERE id = 'u-jordan'").get().username, 'alice');
  fresh.closeAll();
});
