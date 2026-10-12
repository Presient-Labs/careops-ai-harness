import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDirectory, migrateFromShared, logSecurity, SHARED } from '../src/db/directory.js';
import { openDb } from '../src/db/index.js';
import { loadConfig } from '../src/config.js';
import { errors } from '../src/http/errors.js';
import { fixedClock } from '../src/util/clock.js';

const clock = fixedClock('2026-10-06T14:00:00Z');

test('a new directory has the shared workplace, and reopening the same file keeps one row', () => {
  const dir = mkdtempSync(join(tmpdir(), 'careops-dir-'));
  try {
    const path = join(dir, 'directory.db');
    openDirectory(path, clock).close();
    const d = openDirectory(path, clock);
    assert.deepEqual(d.prepare('SELECT id, kind FROM workplaces').all(), [{ id: SHARED, kind: 'shared' }]);
    d.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('deleting a workplace deletes its accounts, credentials, mailbox and sessions', () => {
  const d = openDirectory(':memory:', clock);
  d.prepare("INSERT INTO workplaces (id, kind, created_at, expires_at) VALUES ('w1', 'private', 1, 2)").run();
  d.prepare("INSERT INTO accounts (id, username, workplace_id, user_id, role, password_hash, created_at) VALUES ('a1', 'alice', 'w1', 'u-jordan', 'employee', 'h', 1)").run();
  d.prepare("INSERT INTO totp_credentials (account_id, secret_enc, created_at) VALUES ('a1', 's', 1)").run();
  d.prepare("INSERT INTO recovery_codes (account_id, code_hash) VALUES ('a1', 'c')").run();
  d.prepare("INSERT INTO mailbox (account_id, subject, body, created_at) VALUES ('a1', 's', 'b', 1)").run();
  d.prepare("INSERT INTO sessions (id, account_id, workplace_id, user_id, csrf, stage, created_at, last_seen_at, expires_at) VALUES ('s1', 'a1', 'w1', 'u-jordan', 'c', 'full', 1, 1, 9)").run();
  d.prepare("DELETE FROM workplaces WHERE id = 'w1'").run();
  for (const t of ['accounts', 'totp_credentials', 'recovery_codes', 'mailbox', 'sessions']) assert.equal(d.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n, 0, t);
});

test('migrateFromShared copies model spend and lab results once', () => {
  const shared = openDb(':memory:');
  shared.prepare("INSERT INTO llm_calls (at, day, model, purpose, cost_usd, tokens_in, tokens_out, latency_ms, ok) VALUES ('t', '2026-10-06', 'm', 'chat', 0.5, 1, 1, 1, 1)").run();
  shared.prepare("INSERT INTO lab_results (lab, at, results_json) VALUES ('models', 't', '{\"models\":[]}')").run();
  const d = openDirectory(':memory:', clock);
  assert.equal(migrateFromShared(d, shared), true);
  assert.equal(migrateFromShared(d, shared), false);
  assert.equal(d.prepare('SELECT COUNT(*) n FROM llm_calls').get().n, 1);
  assert.equal(d.prepare("SELECT results_json FROM lab_results WHERE lab = 'models'").get().results_json, '{"models":[]}');
});

test('logSecurity records a kind and detail', () => {
  const d = openDirectory(':memory:', clock);
  logSecurity(d, clock, 'login_failed_unknown_user', { username: 'zed' });
  assert.deepEqual(d.prepare('SELECT at, kind, detail_json FROM security_log').get(), { at: '2026-10-06T14:00:00.000Z', kind: 'login_failed_unknown_user', detail_json: '{"username":"zed"}' });
});

test('config: directory and workplaces sit beside the database; test clock never in production', () => {
  const c = loadConfig({ DB_PATH: '/data/careops.db' });
  assert.equal(c.directoryPath, '/data/directory.db');
  assert.equal(c.workplacesDir, '/data/workplaces');
  assert.equal(c.privateWorkplaceCap, 200);
  assert.equal(c.creationsPerHour, 3);
  assert.equal(c.publicHost, 'localhost');
  assert.equal(c.publicOrigin, 'http://localhost:3000');
  assert.equal(loadConfig({ NODE_ENV: 'production', PUBLIC_HOST: 'careops.shawndemos.com' }).publicOrigin, 'https://careops.shawndemos.com');
  assert.equal(loadConfig({ CAREOPS_TEST_CLOCK: '1' }).testClock, true);
  assert.equal(loadConfig({ CAREOPS_TEST_CLOCK: '1', NODE_ENV: 'production' }).testClock, false);
});

test('new error codes', () => {
  const locked = errors.accountLocked(new Date('2026-10-06T14:15:00Z'));
  assert.deepEqual([locked.status, locked.code, locked.message], [423, 'account_locked', 'Account locked; try again at 14:15 UTC.']);
  assert.deepEqual([errors.secondStepRequired().status, errors.secondStepRequired().code], [401, 'second_step_required']);
  assert.deepEqual([errors.sessionIdle().status, errors.sessionIdle().code], [401, 'session_idle']);
  assert.deepEqual([errors.demoFull().status, errors.demoFull().code], [503, 'demo_full']);
  assert.match(errors.creationLimited(3).message, /3 demo logins in the last hour/);
  assert.equal(errors.creationLimited(3).status, 429);
  assert.deepEqual([errors.workplaceFailed().status, errors.workplaceFailed().message], [503, "Couldn't create your workplace; try again."]);
  assert.deepEqual([errors.invalidCredentials().status, errors.invalidCredentials().message], [401, 'Username or password is incorrect.']);
  assert.deepEqual([errors.invalidCode().status, errors.invalidCode().code], [422, 'invalid_code']);
  assert.deepEqual([errors.usernameTaken().status, errors.usernameTaken().code], [409, 'username_taken']);
  assert.deepEqual([errors.signinTimedOut().status, errors.signinTimedOut().code], [401, 'signin_timed_out']);
});
