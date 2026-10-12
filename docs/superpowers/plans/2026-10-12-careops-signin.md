# CareOps Real Sign-In and Private Workplaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this project the tasks are also loaded into beads (`br`); claim a task with `br update <id> --status in_progress`, close it with `br close <id>` after its commit.

**Goal:** Any visitor can create a demo login with a private copy of the CareOps workplace and sign in with a password plus an authenticator code, an emailed code, a recovery code or a passkey. Lockout, automatic logoff and 24-hour deletion all work.

**Architecture:**
- **Directory database.** A new SQLite database (`directory.db`) holds the deployment-wide data:
  - accounts, credentials and sessions;
  - the Demo mailbox;
  - the shared model-spend ledger and lab results.
- **Workplace databases.**
  - Today's `careops.db` becomes the shared workplace used by Quick look.
  - Each demo login gets its own seeded workplace file under `workplaces/`.
- **Per-request routing.** The session middleware resolves the request's workplace and hands routers `req.db` and `req.audit`. Routers no longer close over one database.

**Tech Stack:** Node 22 (ESM JavaScript), Express 4, better-sqlite3, zod, bcryptjs, `node:test`, Playwright. New dependencies: `@simplewebauthn/server` (passkeys) and `qrcode-generator` (QR codes for authenticator setup).

**Spec:** `docs/superpowers/specs/2026-10-12-careops-signin-design.md`

## Global Constraints

- Node ≥ 22, ESM modules (`import`), no TypeScript, no build step.
- Tests use `node:test` and `node:assert/strict`.
  - Run one file with `node --test --test-force-exit tests/<file>.test.js`.
  - Run all with `npm test`.
- New runtime dependencies are only `@simplewebauthn/server` and `qrcode-generator`. Nothing else is added.
- Wording: "HIPAA-style safeguards on synthetic data". Never "HIPAA compliant".
- Parameters:

| Setting | Value |
|---|---|
| Lockout | 5 failures, then 15 minutes |
| Idle logoff | 15 minutes |
| Idle warning | at 13 minutes |
| Absolute session limit | 8 hours |
| Halfway session | 5 minutes |
| Authenticator codes | SHA-1, 6 digits, 30-second step, ±1 step, single use |
| Emailed codes | 6 digits, 10 minutes, single use, at most 3 per account per 10 minutes |
| Recovery codes | 10 codes, 10 characters each, single use |
| Demo logins | deleted 24 hours after creation |
| Creation limit | 3 per address per hour (IPv6 counted per /64) |
| Private workplaces | at most 200 live |
| Sign-in throttle | 20 attempts per address per minute |
| Usernames | 3–32 characters from `[A-Za-z0-9_]`, stored lower-case |
| Passwords | 12–200 characters, not on the bundled common-password list |

- Never change `src/llm/*`, `src/retrieval/*`, `src/policy/*`, `prompts/*`, `seed/*` or `e2e/demo.spec.js`.
- Never read or print `.env`. The live deployment on `main` is never touched by this plan.
- Commit only the files your task owns: `git add <those paths>`, then `git commit`.
  - If `.git/index.lock` exists because another agent is committing, wait 5 seconds and retry.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A halfway session must never add a second step to an account that already has one.**
   - A halfway session is password-only.
   - If it could add a step, someone with only the password could add their own authenticator and get a full session.
   - Setup endpoints must refuse with 403. Owner: Task 8, test "a password-only session cannot add a second step to an account that has one".
2. **A workplace file must never be closed while a request is using it.**
   - Pool eviction or cleanup can run during an `await` in a chat turn.
   - Owner: Task 4, test "a leased workplace is not closed by eviction or cleanup until released".
3. **A restart keeps every live demo login working.**
   - The directory and workplace files are on disk, so a new pool reopens a workplace lazily.
   - Owner: Task 4, test "a new pool on the same directory reopens an existing workplace".
4. **Usernames are matched case-insensitively.**
   - "Alice" creates `alice`, and signing in as "ALICE" works.
   - Owner: Task 8, test "usernames are case-insensitive".
5. **An authenticator code typed with a space is accepted.**
   - Apps display codes as "123 456", so "123 456" verifies.
   - Owner: Task 2, test "a code typed with spaces verifies".

## Task graph (for beads)

| Task | Depends on | Owns (creates or modifies) |
|---|---|---|
| T1 Directory database, config, errors | — | `src/db/directory.sql`, `src/db/directory.js`, `src/config.js`, `src/http/errors.js`, `tests/directory.test.js` |
| T2 Authenticator codes, secret encryption, recovery codes, QR | — | `src/auth/totp.js`, `src/auth/secrets.js`, `src/auth/recovery.js`, `src/auth/qr.js`, `package.json`, `package-lock.json`, `tests/totp.test.js` |
| T3 Username and password rules, address keys | — | `src/auth/rules.js`, `src/auth/common-passwords.txt`, `src/http/ipKey.js`, `tests/rules.test.js` |
| T4 Workplace pool, creation, cleanup | T1 | `src/workplaces/pool.js`, `src/workplaces/create.js`, `src/workplaces/cleanup.js`, `src/db/seed.js`, `tests/workplaces.test.js` |
| T5 Emailed codes and Demo mailbox | T1, T2 | `src/auth/email.js`, `tests/email.test.js` |
| T6 Passkeys | T1, T2 | `src/auth/passkeys.js`, `tests/fixtures/softAuthenticator.js`, `package.json`, `package-lock.json`, `tests/passkeys.test.js` |
| T7 Per-request workplaces | T1, T4 | `src/auth/sessions.js`, `src/auth/routes.js`, `src/http/middleware.js`, `src/app.js`, `src/main.js`, `src/routes/{chat,pto,claims,admin,labs,health}.js`, `src/harness/pipeline.js`, `src/labs/attackLab.js`, `tests/helpers.js`, `tests/auth.test.js`, `tests/sessions.test.js`, plus mechanical fixes in existing tests |
| T8 Account API | T2, T3, T5, T6, T7 | `src/auth/accountRoutes.js`, `src/app.js`, `tests/accounts.test.js` |
| T9 Isolation suite | T7 | `tests/isolation.test.js` |
| T10 Web pages | T8 | `web/index.html`, `web/setup.html`, `web/verify.html`, `web/mailbox.html`, `web/app.html`, `web/js/api.js`, `web/js/app.js`, `web/js/passkey.js`, `web/js/views/login.js`, `web/js/views/setup.js`, `web/js/views/verify.js`, `web/js/views/mailbox.js`, `web/js/views/session.js`, `web/css/app.css` |
| T11 Real-browser test | T10 | `src/util/clock.js`, `src/routes/testClock.js`, `src/app.js`, `src/main.js`, `playwright.signin.config.js`, `e2e/signin.spec.js`, `package.json` |
| T12 Docs | T8 | `README.md`, `docs/API.md`, `.env.example`, `DEMO_ACCOUNTS.md` |

Waves that can run in parallel:
1. {T1, T2, T3}
2. {T4, T5, T6}
3. {T7}
4. {T8, T9}
5. {T10, T12}
6. {T11}

---

### Task 1: Directory database, config and error codes

**Files:**
- Create: `src/db/directory.sql`, `src/db/directory.js`, `tests/directory.test.js`
- Modify: `src/config.js`, `src/http/errors.js`

**Interfaces:**
- Produces:
  - `openDirectory(path = ':memory:', clock = systemClock) → Database`. It always contains workplace row `shared`.
  - `SHARED = 'shared'`.
  - `migrateFromShared(directory, sharedDb) → boolean` (true when it copied this time).
  - `logSecurity(directory, clock, kind, detail = {})`.
  - `loadConfig` gains `directoryPath`, `workplacesDir`, `totpKey`, `publicHost`, `publicOrigin`, `privateWorkplaceCap`, `creationsPerHour`, `testClock`.
  - `errors` gains:
    - `accountLocked(untilDate)` (423);
    - `secondStepRequired()` (401);
    - `sessionIdle()` (401);
    - `demoFull()` (503);
    - `creationLimited(n)` (429);
    - `workplaceFailed()` (503);
    - `invalidCredentials()` (401);
    - `invalidCode()` (422);
    - `usernameTaken()` (409);
    - `signinTimedOut()` (401).

- [ ] **Step 1: Write the failing tests**

`tests/directory.test.js`:
```js
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
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `node --test --test-force-exit tests/directory.test.js`
Expected: FAIL with `Cannot find module '.../src/db/directory.js'`.

- [ ] **Step 3: Write the directory schema**

`src/db/directory.sql`:
```sql
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workplaces (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('shared','private')),
  created_at INTEGER NOT NULL, expires_at INTEGER);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
  workplace_id TEXT NOT NULL REFERENCES workplaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('employee','manager','billing','admin')),
  password_hash TEXT NOT NULL, failed_count INTEGER NOT NULL DEFAULT 0, locked_until INTEGER,
  email_enabled_at INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS totp_credentials (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, secret_enc TEXT NOT NULL,
  last_used_step INTEGER NOT NULL DEFAULT 0, confirmed_at INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS recovery_codes (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, code_hash TEXT NOT NULL, used_at INTEGER,
  PRIMARY KEY (account_id, code_hash));
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0, transports TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS email_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL, purpose TEXT NOT NULL CHECK (purpose IN ('signin','enable')),
  expires_at INTEGER NOT NULL, used_at INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS mailbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  subject TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  workplace_id TEXT NOT NULL REFERENCES workplaces(id) ON DELETE CASCADE, user_id TEXT NOT NULL,
  csrf TEXT NOT NULL, stage TEXT NOT NULL CHECK (stage IN ('halfway','full')),
  created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id TEXT PRIMARY KEY, challenge TEXT NOT NULL, account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('register','login')), expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS creation_log (ip_key TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS security_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, detail_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS llm_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, day TEXT NOT NULL, model TEXT NOT NULL, purpose TEXT NOT NULL,
  cost_usd REAL NOT NULL, tokens_in INTEGER, tokens_out INTEGER, latency_ms INTEGER, ok INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS lab_results (lab TEXT PRIMARY KEY, at TEXT NOT NULL, results_json TEXT NOT NULL);
```

- [ ] **Step 4: Write the directory module**

`src/db/directory.js`:
```js
import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { systemClock } from '../util/clock.js';

const SCHEMA = readFileSync(new URL('./directory.sql', import.meta.url), 'utf8');
export const SHARED = 'shared';

// The deployment-wide database: workplaces, demo accounts and their credentials, sessions, the Demo mailbox,
// and the shared model-spend ledger and lab results. Business data lives in the workplace databases.
export function openDirectory(path = ':memory:', clock = systemClock) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  db.prepare("INSERT OR IGNORE INTO workplaces (id, kind, created_at, expires_at) VALUES (?, 'shared', ?, NULL)").run(SHARED, clock.now().getTime());
  return db;
}

// Once per directory: model spend and lab results move here from the shared workplace (they belong to the deployment).
export function migrateFromShared(directory, sharedDb) {
  if (directory.prepare("SELECT 1 FROM meta WHERE key = 'migrated_from_shared'").get()) return false;
  directory.transaction(() => {
    const ins = directory.prepare('INSERT INTO llm_calls (at, day, model, purpose, cost_usd, tokens_in, tokens_out, latency_ms, ok) VALUES (?,?,?,?,?,?,?,?,?)');
    for (const c of sharedDb.prepare('SELECT at, day, model, purpose, cost_usd, tokens_in, tokens_out, latency_ms, ok FROM llm_calls ORDER BY id').all())
      ins.run(c.at, c.day, c.model, c.purpose, c.cost_usd, c.tokens_in, c.tokens_out, c.latency_ms, c.ok);
    const lab = directory.prepare('INSERT OR REPLACE INTO lab_results (lab, at, results_json) VALUES (?,?,?)');
    for (const r of sharedDb.prepare('SELECT lab, at, results_json FROM lab_results').all()) lab.run(r.lab, r.at, r.results_json);
    directory.prepare("INSERT INTO meta (key, value) VALUES ('migrated_from_shared', ?)").run(new Date().toISOString());
  })();
  return true;
}

// Security events that happen before a workplace is known (unknown username, workplace deletion).
export function logSecurity(directory, clock, kind, detail = {}) {
  directory.prepare('INSERT INTO security_log (at, kind, detail_json) VALUES (?,?,?)').run(clock.now().toISOString(), kind, JSON.stringify(detail));
}
```

- [ ] **Step 5: Extend the config**

Replace `src/config.js` with:
```js
import { dirname, join } from 'node:path';

export function loadConfig(env = process.env) {
  const dbPath = env.DB_PATH ?? './data/careops.db';
  const production = env.NODE_ENV === 'production';
  const publicHost = env.PUBLIC_HOST ?? 'localhost';
  return {
    port: Number(env.PORT ?? 3000),
    dbPath,
    directoryPath: env.DIRECTORY_PATH ?? join(dirname(dbPath), 'directory.db'),
    workplacesDir: env.WORKPLACES_DIR ?? join(dirname(dbPath), 'workplaces'),
    kbUrl: env.KB_URL ?? 'http://careops-kb:3838',
    kbApiKey: env.KB_API_KEY ?? '',
    openrouterKey: env.OPENROUTER_API_KEY ?? '',
    defaultModel: env.DEFAULT_MODEL ?? 'openai/gpt-5.4-mini',
    dailyBudgetUsd: Number(env.DAILY_BUDGET_USD ?? 3),
    chatIpLimit: Number(env.CHAT_IP_LIMIT ?? 60), // assistant turns per IP per 10 min (the demo password is public)
    demoPassword: env.DEMO_PASSWORD ?? 'careops-demo',
    secureCookies: production,
    totpKey: env.TOTP_KEY ?? '', // 32 random bytes, base64; encrypts authenticator secrets at rest
    publicHost, // the passkey relying-party id; never taken from a request's Host header
    publicOrigin: env.PUBLIC_ORIGIN ?? (production ? `https://${publicHost}` : 'http://localhost:3000'),
    privateWorkplaceCap: Number(env.PRIVATE_WORKPLACE_CAP ?? 200),
    creationsPerHour: Number(env.CREATIONS_PER_HOUR ?? 3),
    testClock: env.CAREOPS_TEST_CLOCK === '1' && !production, // the real-browser test's adjustable clock; never in production
  };
}
```

- [ ] **Step 6: Add the error codes**

In `src/http/errors.js`, add these entries to the `errors` object after `aiUnavailable`:
```js
  accountLocked: (until) => new HttpError(423, 'account_locked', `Account locked; try again at ${until.toISOString().slice(11, 16)} UTC.`),
  secondStepRequired: () => new HttpError(401, 'second_step_required', 'Finish signing in with your second step.'),
  sessionIdle: () => new HttpError(401, 'session_idle', 'You were signed out after 15 minutes without activity.'),
  demoFull: () => new HttpError(503, 'demo_full', 'The demo is full right now. Use Quick look, or come back later.'),
  creationLimited: (n) => new HttpError(429, 'creation_limited', `This address has made ${n} demo logins in the last hour. Use Quick look, or come back later.`),
  workplaceFailed: () => new HttpError(503, 'workplace_failed', "Couldn't create your workplace; try again."),
  invalidCredentials: () => new HttpError(401, 'invalid_credentials', 'Username or password is incorrect.'),
  invalidCode: () => new HttpError(422, 'invalid_code', 'That code is not correct, or it has expired.'),
  usernameTaken: () => new HttpError(409, 'username_taken', 'That username is taken. Pick another.'),
  signinTimedOut: () => new HttpError(401, 'signin_timed_out', 'Sign-in timed out. Please start again.'),
```

- [ ] **Step 7: Run the tests and see them pass**

Run: `node --test --test-force-exit tests/directory.test.js`, then `npm test`.
Expected: the new file passes, and the full suite passes. Nothing uses the directory yet.

- [ ] **Step 8: Commit**

```bash
git add src/db/directory.sql src/db/directory.js src/config.js src/http/errors.js tests/directory.test.js
git commit -m "feat(signin): directory database, config and error codes"
```

---

### Task 2: Authenticator codes, secret encryption, recovery codes and QR

**Files:**
- Create: `src/auth/totp.js`, `src/auth/secrets.js`, `src/auth/recovery.js`, `src/auth/qr.js`, `tests/totp.test.js`
- Modify: `package.json`, `package-lock.json` (add `qrcode-generator`)

**Interfaces:**
- Produces:
  - `base32Encode(buf) → string`, `base32Decode(str) → Buffer`.
  - `hotp(keyBuf, counter, digits = 6) → string`.
  - `stepAt(ms) → number`.
  - `totpAt(secretB32, ms, digits = 6) → string`.
  - `verifyTotp(secretB32, code, ms, lastUsedStep = 0) → number | null`. Returns the matched step.
  - `generateTotpSecret() → string` (base32 of 20 random bytes).
  - `otpauthUrl({ secret, account, issuer = 'CareOps Demo' }) → string`.
  - `encryptSecret(plain, keyB64) → string`, `decryptSecret(enc, keyB64) → string`.
  - `sha256Hex(s) → string`.
  - `generateRecoveryCodes(n = 10) → string[]`.
  - `normalizeCode(s) → string`.
  - `hashRecoveryCode(code) → string`.
  - `qrDataUrl(text) → string` (a `data:image/svg+xml;base64,` URL).

- [ ] **Step 1: Install the QR dependency**

Run: `npm install qrcode-generator@^1.4.4`
Expected: `package.json` lists `"qrcode-generator"` under `dependencies`.

- [ ] **Step 2: Write the failing tests**

`tests/totp.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { base32Encode, base32Decode, hotp, stepAt, totpAt, verifyTotp, generateTotpSecret, otpauthUrl } from '../src/auth/totp.js';
import { encryptSecret, decryptSecret, sha256Hex } from '../src/auth/secrets.js';
import { generateRecoveryCodes, normalizeCode, hashRecoveryCode } from '../src/auth/recovery.js';
import { qrDataUrl } from '../src/auth/qr.js';

const RFC_KEY = Buffer.from('12345678901234567890');
const KEY = Buffer.alloc(32, 7).toString('base64');

test('RFC 6238 Appendix B, SHA-1, 8 digits', () => {
  const vectors = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];
  for (const [t, code] of vectors) assert.equal(hotp(RFC_KEY, Math.floor(t / 30), 8), code, `T=${t}`);
});

test('base32 round trip and the RFC 4648 example', () => {
  assert.equal(base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI');
  assert.deepEqual(base32Decode('mzxw6ytboi'), Buffer.from('foobar'));
  const secret = generateTotpSecret();
  assert.equal(secret.length, 32);
  assert.equal(base32Decode(secret).length, 20);
});

test('verifyTotp accepts the current step and one either side, and returns the step', () => {
  const secret = base32Encode(RFC_KEY);
  const t = 1_111_111_111_000;
  assert.equal(verifyTotp(secret, totpAt(secret, t), t), stepAt(t));
  assert.equal(verifyTotp(secret, totpAt(secret, t - 30_000), t), stepAt(t) - 1);
  assert.equal(verifyTotp(secret, totpAt(secret, t + 30_000), t), stepAt(t) + 1);
  assert.equal(verifyTotp(secret, totpAt(secret, t - 60_000), t), null);
});

test('a code at or before the last used step is refused (each code works once)', () => {
  const secret = base32Encode(RFC_KEY);
  const t = 1_111_111_111_000;
  assert.equal(verifyTotp(secret, totpAt(secret, t), t, stepAt(t)), null);
  assert.equal(verifyTotp(secret, totpAt(secret, t + 30_000), t, stepAt(t)), stepAt(t) + 1);
});

test('a code typed with spaces verifies', () => {
  const secret = base32Encode(RFC_KEY);
  const t = 1_111_111_111_000;
  const code = totpAt(secret, t);
  assert.equal(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, t), stepAt(t));
});

test('malformed codes are refused without throwing', () => {
  const secret = base32Encode(RFC_KEY);
  for (const bad of ['', '12345', '1234567', 'abcdef', null, undefined]) assert.equal(verifyTotp(secret, bad, 0), null);
});

test('otpauth URL names the issuer and account', () => {
  assert.equal(otpauthUrl({ secret: 'ABC', account: 'alice' }), 'otpauth://totp/CareOps%20Demo:alice?secret=ABC&issuer=CareOps%20Demo&algorithm=SHA1&digits=6&period=30');
});

test('secrets round trip under AES-256-GCM; a wrong key or tampering fails', () => {
  const enc = encryptSecret('JBSWY3DPEHPK3PXP', KEY);
  assert.match(enc, /^v1:/);
  assert.notEqual(encryptSecret('JBSWY3DPEHPK3PXP', KEY), enc);
  assert.equal(decryptSecret(enc, KEY), 'JBSWY3DPEHPK3PXP');
  assert.throws(() => decryptSecret(enc, Buffer.alloc(32, 8).toString('base64')));
  const raw = Buffer.from(enc.slice(3), 'base64'); raw[raw.length - 1] ^= 1;
  assert.throws(() => decryptSecret(`v1:${raw.toString('base64')}`, KEY));
  assert.throws(() => encryptSecret('x', 'short'), /32 bytes/);
});

test('recovery codes: 10 distinct 10-character codes; hashing ignores case, spaces and dashes', () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const c of codes) assert.match(c, /^[abcdefghjkmnpqrstuvwxyz23456789]{10}$/);
  assert.equal(normalizeCode('AbCdE-fGhJk '), 'abcdefghjk');
  assert.equal(hashRecoveryCode('abcde-fghjk'), sha256Hex('abcdefghjk'));
});

test('qrDataUrl returns an SVG data URL', () => {
  const url = qrDataUrl('otpauth://totp/x?secret=ABC');
  assert.match(url, /^data:image\/svg\+xml;base64,/);
  assert.match(Buffer.from(url.split(',')[1], 'base64').toString('utf8'), /<svg/);
});
```

- [ ] **Step 3: Run the tests and see them fail**

Run: `node --test --test-force-exit tests/totp.test.js`
Expected: FAIL with `Cannot find module '.../src/auth/totp.js'`.

- [ ] **Step 4: Implement the modules**

`src/auth/totp.js`:
```js
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// RFC 6238 authenticator codes: SHA-1, 6 digits, 30-second steps (what Google and Microsoft Authenticator use).
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_S = 30;

export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = ((value << 8) | byte) & 0xffff; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('invalid base32');
    value = ((value << 5) | i) & 0xffff; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function hotp(key, counter, digits = 6) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const stepAt = (ms) => Math.floor(ms / 1000 / STEP_S);
export const totpAt = (secretB32, ms, digits = 6) => hotp(base32Decode(secretB32), stepAt(ms), digits);

// The matched step, or null. Accepts the current step and one either side; a step at or before lastUsedStep is refused.
export function verifyTotp(secretB32, code, ms, lastUsedStep = 0) {
  const typed = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(typed)) return null;
  const key = base32Decode(secretB32); const now = stepAt(ms);
  for (const s of [now - 1, now, now + 1]) {
    if (s > lastUsedStep && timingSafeEqual(Buffer.from(hotp(key, s)), Buffer.from(typed))) return s;
  }
  return null;
}

export const generateTotpSecret = () => base32Encode(randomBytes(20));
export const otpauthUrl = ({ secret, account, issuer = 'CareOps Demo' }) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
```

`src/auth/secrets.js`:
```js
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Authenticator secrets are stored encrypted (AES-256-GCM) under TOTP_KEY, so a copied database file alone cannot mint codes.
function keyOf(b64) {
  const k = Buffer.from(String(b64 ?? ''), 'base64');
  if (k.length !== 32) throw new Error('TOTP_KEY must be 32 bytes, base64-encoded');
  return k;
}
export function encryptSecret(plain, keyB64) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyOf(keyB64), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `v1:${Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')}`;
}
export function decryptSecret(enc, keyB64) {
  const [v, data] = String(enc).split(':');
  if (v !== 'v1' || !data) throw new Error('unknown secret format');
  const raw = Buffer.from(data, 'base64');
  const d = createDecipheriv('aes-256-gcm', keyOf(keyB64), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}
export const sha256Hex = (s) => createHash('sha256').update(String(s)).digest('hex');
```

`src/auth/recovery.js`:
```js
import { randomInt } from 'node:crypto';
import { sha256Hex } from './secrets.js';

// No 0/o, 1/l/i: recovery codes are read off a screen and typed back.
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
export const normalizeCode = (c) => String(c ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function generateRecoveryCodes(n = 10) {
  const codes = new Set();
  while (codes.size < n) codes.add(Array.from({ length: 10 }, () => ALPHA[randomInt(ALPHA.length)]).join(''));
  return [...codes];
}
export const hashRecoveryCode = (c) => sha256Hex(normalizeCode(c));
```

`src/auth/qr.js`:
```js
import qrcode from 'qrcode-generator';

// Server-side QR for the otpauth URL, returned as an image data URL (the page's CSP allows data: images, not inline markup).
export function qrDataUrl(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
```

- [ ] **Step 5: Run the tests and see them pass**

Run: `node --test --test-force-exit tests/totp.test.js`, then `npm test`.
Expected: PASS, and the full suite passes.

- [ ] **Step 6: Commit**

```bash
git add src/auth/totp.js src/auth/secrets.js src/auth/recovery.js src/auth/qr.js tests/totp.test.js package.json package-lock.json
git commit -m "feat(signin): authenticator codes, secret encryption, recovery codes, QR"
```

---

### Task 3: Username and password rules, and address keys

**Files:**
- Create: `src/auth/rules.js`, `src/auth/common-passwords.txt`, `src/http/ipKey.js`, `tests/rules.test.js`

**Interfaces:**
- Produces:
  - `usernameProblem(u) → string | null`. Expects the lower-cased username.
  - `passwordProblem(p) → string | null`.
  - `RESERVED_USERNAMES: Set<string>`.
  - `ipKey(ip) → string`. An IPv4 address is returned as is. An IPv4-mapped IPv6 address becomes its IPv4. Other IPv6 becomes its `/64` prefix, written `a:b:c:d::/64`.

- [ ] **Step 1: Bundle the common-password list**

Run:
```bash
curl -fsSL -o src/auth/common-passwords.txt https://raw.githubusercontent.com/danielmiessler/SecLists/master/Passwords/Common-Credentials/10k-most-common.txt
wc -l src/auth/common-passwords.txt
```
Expected: about 10000 lines. The list is from SecLists, MIT licence. Add the line `Common-password list: SecLists 10k-most-common (MIT).` under the README's credits section in Task 12.

- [ ] **Step 2: Write the failing tests**

`tests/rules.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { usernameProblem, passwordProblem, RESERVED_USERNAMES } from '../src/auth/rules.js';
import { ipKey } from '../src/http/ipKey.js';

test('usernames: 3 to 32 letters, digits or underscores; persona names reserved', () => {
  assert.equal(usernameProblem('alice_1'), null);
  for (const bad of ['ab', 'a'.repeat(33), 'alice smith', 'alice@example.com', 'ålice', '', null]) assert.match(usernameProblem(bad), /3 to 32 letters, numbers or underscores/, String(bad));
  for (const r of ['priya', 'jordan', 'sam', 'marcus', 'dana', 'admin']) { assert.ok(RESERVED_USERNAMES.has(r)); assert.match(usernameProblem(r), /reserved/); }
});

test('passwords: at least 12 characters, at most 200, not on the common list', () => {
  assert.equal(passwordProblem('correct horse battery'), null);
  assert.match(passwordProblem('short'), /at least 12/);
  assert.match(passwordProblem('x'.repeat(201)), /at most 200/);
  const common = readFileSync(new URL('../src/auth/common-passwords.txt', import.meta.url), 'utf8').split(/\r?\n/).find(p => p.trim().length >= 12);
  assert.ok(common, 'the list has an entry of 12+ characters');
  assert.match(passwordProblem(common), /too common/);
  assert.match(passwordProblem(common.toUpperCase()), /too common/);
});

test('ipKey: IPv4 as is, mapped IPv4 unwrapped, IPv6 by /64', () => {
  assert.equal(ipKey('203.0.113.9'), '203.0.113.9');
  assert.equal(ipKey('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(ipKey('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64');
  assert.equal(ipKey('2001:db8:1:2::9'), '2001:db8:1:2::/64');
  assert.equal(ipKey('2001:DB8:0001:0002:ffff::1'), '2001:db8:1:2::/64');
  assert.equal(ipKey('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(ipKey('fe80::1%eth0'), 'fe80:0:0:0::/64');
  assert.equal(ipKey('::1'), '0:0:0:0::/64');
  assert.equal(ipKey('2001:db8:1:2::9'), ipKey('2001:db8:1:2:aaaa::1'));
  assert.notEqual(ipKey('2001:db8:1:2::9'), ipKey('2001:db8:1:3::9'));
});
```

- [ ] **Step 3: Run the tests and see them fail**

Run: `node --test --test-force-exit tests/rules.test.js`
Expected: FAIL with `Cannot find module '.../src/auth/rules.js'`.

- [ ] **Step 4: Implement**

`src/auth/rules.js`:
```js
import { readFileSync } from 'node:fs';

const COMMON = new Set(readFileSync(new URL('./common-passwords.txt', import.meta.url), 'utf8')
  .split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(Boolean));
// Persona usernames exist inside every workplace copy, so a visitor cannot take one.
export const RESERVED_USERNAMES = new Set(['priya', 'jordan', 'sam', 'marcus', 'dana', 'admin', 'root', 'system']);

export function usernameProblem(u) {
  if (typeof u !== 'string' || !/^[A-Za-z0-9_]{3,32}$/.test(u)) return 'Usernames are 3 to 32 letters, numbers or underscores.';
  if (RESERVED_USERNAMES.has(u.toLowerCase())) return 'That username is reserved. Pick another.';
  return null;
}

export function passwordProblem(p) {
  if (typeof p !== 'string' || p.length < 12) return 'Use at least 12 characters.';
  if (p.length > 200) return 'Use at most 200 characters.';
  if (COMMON.has(p.toLowerCase())) return 'That password is too common. Pick another.';
  return null;
}
```

`src/http/ipKey.js`:
```js
import { isIPv4, isIPv6 } from 'node:net';

// The key a per-address limit counts by. One IPv6 customer usually holds a whole /64, so it counts as one address.
export function ipKey(ip) {
  const a = String(ip ?? '').replace(/%.*$/, '');
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return mapped[1];
  if (isIPv4(a) || !isIPv6(a)) return a;
  const [head, tail = ''] = a.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = a.includes('::') ? [...h, ...Array(Math.max(8 - h.length - t.length, 0)).fill('0'), ...t] : h;
  return `${groups.slice(0, 4).map(g => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
}
```

- [ ] **Step 5: Run the tests and see them pass**

Run: `node --test --test-force-exit tests/rules.test.js`, then `npm test`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/auth/rules.js src/auth/common-passwords.txt src/http/ipKey.js tests/rules.test.js
git commit -m "feat(signin): username and password rules, per-address keys"
```

---
### Task 4: Workplace pool, creation and cleanup

**Files:**
- Create: `src/workplaces/pool.js`, `src/workplaces/create.js`, `src/workplaces/cleanup.js`, `tests/workplaces.test.js`
- Modify: `src/db/seed.js` (add `applySeat`)

**Interfaces:**
- Consumes: `openDirectory`, `SHARED`, `logSecurity` (Task 1); `errors.demoFull`, `errors.workplaceFailed` (Task 1); `openDb`, `seedDb`, `createAudit` (existing).
- Produces:
  - `applySeat(db, { userId, username, displayName })`.
  - `createWorkplacePool({ directory, sharedDb, sharedAudit, dir, clock, max = 50 })`. It returns:
    - `shared: { db, audit }`;
    - `get(id) → { db, audit } | null`;
    - `acquire(id) → { wp, release() } | null`;
    - `openNew(id) → { db, audit }`;
    - `close(id) → boolean` (false while leased);
    - `closeAll()`;
    - `size() → number`.
  - `workplaceFile(dir, id)`, `removeWorkplaceFiles(dir, id)`, `WORKPLACE_ID` (regex `/^[a-f0-9]{32}$/`).
  - `SEATS` (`{ employee: 'u-jordan', manager: 'u-priya', billing: 'u-marcus', admin: 'u-dana' }`) and `WORKPLACE_TTL_MS`.
  - `createPrivateWorkplace({ directory, pool, dir, clock, cap, role, username }) → { workplaceId, userId, expiresAt }`.
  - `livePrivateCount(directory, nowMs)`.
  - `cleanupExpired({ directory, pool, dir, clock }) → number` (workplaces removed).
  - `startCleanup({ directory, pool, dir, clock, logger }, intervalMs = 600000) → stop()`.

- [ ] **Step 1: Write the failing tests**

`tests/workplaces.test.js`:
```js
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
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `node --test --test-force-exit tests/workplaces.test.js`
Expected: FAIL with `Cannot find module '.../src/workplaces/pool.js'`.

- [ ] **Step 3: Add `applySeat` to the seed module**

Append to `src/db/seed.js`:
```js
// A demo login takes the seat of its role's persona inside its own workplace copy: same id and records, the visitor's name.
export function applySeat(db, { userId, username, displayName }) {
  const r = db.prepare('UPDATE users SET username = ?, display_name = ? WHERE id = ?').run(username, displayName, userId);
  if (r.changes !== 1) throw new Error(`no seat ${userId}`);
}
```

- [ ] **Step 4: Implement the pool**

`src/workplaces/pool.js`:
```js
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from '../db/index.js';
import { createAudit } from '../audit/audit.js';
import { SHARED } from '../db/directory.js';

export const WORKPLACE_ID = /^[a-f0-9]{32}$/;
export function workplaceFile(dir, id) {
  if (!WORKPLACE_ID.test(String(id))) throw new Error('bad workplace id');
  return join(dir, `${id}.db`);
}
export function removeWorkplaceFiles(dir, id) {
  const f = workplaceFile(dir, id);
  for (const p of [f, `${f}-wal`, `${f}-shm`]) rmSync(p, { force: true });
}

// Open workplace databases, at most `max` at once (least recently used closed first). A request leases its workplace,
// and a leased workplace is never closed: a chat turn awaits the model with the database still in use.
export function createWorkplacePool({ directory, sharedDb, sharedAudit, dir, clock, max = 50 }) {
  const shared = { db: sharedDb, audit: sharedAudit ?? createAudit(sharedDb, clock), leases: 0 };
  const open = new Map(); // id → { db, audit, leases }; Map order is recency
  function evict(keep) { // never the entry just opened: its caller is about to use it
    for (const [id, wp] of open) {
      if (open.size <= max) return;
      if (id !== keep && wp.leases === 0) { open.delete(id); wp.db.close(); }
    }
  }
  const add = (id, db) => { const wp = { db, audit: createAudit(db, clock), leases: 0 }; open.set(id, wp); evict(id); return wp; };
  const pool = {
    shared,
    get(id) {
      if (id === SHARED) return shared;
      if (!WORKPLACE_ID.test(String(id))) return null;
      const row = directory.prepare("SELECT expires_at FROM workplaces WHERE id = ? AND kind = 'private'").get(id);
      if (!row || row.expires_at <= clock.now().getTime()) return null;
      const cached = open.get(id);
      if (cached) { open.delete(id); open.set(id, cached); return cached; }
      const file = workplaceFile(dir, id);
      return existsSync(file) ? add(id, openDb(file)) : null;
    },
    acquire(id) {
      const wp = pool.get(id);
      if (!wp) return null;
      wp.leases += 1;
      let released = false;
      return { wp, release: () => { if (!released) { released = true; wp.leases -= 1; } } };
    },
    openNew(id) { return add(id, openDb(workplaceFile(dir, id))); },
    close(id) {
      const wp = open.get(id);
      if (!wp) return true;
      if (wp.leases > 0) return false;
      open.delete(id); wp.db.close();
      return true;
    },
    closeAll() { for (const [id, wp] of [...open]) { open.delete(id); wp.db.close(); } },
    size: () => open.size,
  };
  return pool;
}
```

- [ ] **Step 5: Implement creation**

`src/workplaces/create.js`:
```js
import { randomBytes } from 'node:crypto';
import { errors } from '../http/errors.js';
import { seedDb, applySeat } from '../db/seed.js';
import { removeWorkplaceFiles } from './pool.js';

export const SEATS = { employee: 'u-jordan', manager: 'u-priya', billing: 'u-marcus', admin: 'u-dana' };
export const WORKPLACE_TTL_MS = 24 * 3600_000;
export const livePrivateCount = (directory, now) =>
  directory.prepare("SELECT COUNT(*) n FROM workplaces WHERE kind = 'private' AND expires_at > ?").get(now).n;

// A private copy of the fictional workplace for one demo login, deleted 24 hours after creation.
export function createPrivateWorkplace({ directory, pool, dir, clock, cap, role, username }) {
  const userId = SEATS[role];
  if (!userId) throw errors.invalid('Unknown role.');
  const now = clock.now().getTime();
  if (livePrivateCount(directory, now) >= cap) throw errors.demoFull();
  const id = randomBytes(16).toString('hex');
  directory.prepare("INSERT INTO workplaces (id, kind, created_at, expires_at) VALUES (?, 'private', ?, ?)").run(id, now, now + WORKPLACE_TTL_MS);
  try {
    const { db } = pool.openNew(id);
    seedDb(db, { clock, demoPassword: randomBytes(24).toString('base64url') }); // nobody signs in with a workplace password
    applySeat(db, { userId, username, displayName: username });
    return { workplaceId: id, userId, expiresAt: now + WORKPLACE_TTL_MS };
  } catch {
    pool.close(id);
    removeWorkplaceFiles(dir, id);
    directory.prepare('DELETE FROM workplaces WHERE id = ?').run(id);
    throw errors.workplaceFailed();
  }
}
```

- [ ] **Step 6: Implement cleanup**

`src/workplaces/cleanup.js`:
```js
import { readdirSync, existsSync } from 'node:fs';
import { logSecurity } from '../db/directory.js';
import { WORKPLACE_ID, removeWorkplaceFiles } from './pool.js';

// Every 10 minutes: expired sessions, challenges and creation records go; expired workplaces are closed, their
// directory rows deleted (cascading to accounts, credentials, mailbox and sessions) and their files removed.
export function cleanupExpired({ directory, pool, dir, clock }) {
  const now = clock.now().getTime();
  directory.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  directory.prepare('DELETE FROM webauthn_challenges WHERE expires_at <= ?').run(now);
  directory.prepare('DELETE FROM creation_log WHERE created_at <= ?').run(now - 3600_000);
  let removed = 0;
  for (const w of directory.prepare("SELECT id, created_at FROM workplaces WHERE kind = 'private' AND expires_at <= ?").all(now)) {
    if (!pool.close(w.id)) continue; // a request is using it; next round
    directory.prepare('DELETE FROM workplaces WHERE id = ?').run(w.id);
    removeWorkplaceFiles(dir, w.id);
    logSecurity(directory, clock, 'workplace_deleted', { workplaceId: w.id, createdAt: new Date(w.created_at).toISOString() });
    removed += 1;
  }
  // A crash between creating a file and recording it leaves an orphan file; it is removed here.
  if (existsSync(dir)) {
    const known = new Set(directory.prepare('SELECT id FROM workplaces').all().map(r => r.id));
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.db')) continue;
      const id = f.slice(0, -3);
      if (WORKPLACE_ID.test(id) && !known.has(id)) removeWorkplaceFiles(dir, id);
    }
  }
  return removed;
}

export function startCleanup(opts, intervalMs = 10 * 60_000) {
  const run = () => {
    try { cleanupExpired(opts); }
    catch (e) { (opts.logger ?? console).error(JSON.stringify({ msg: 'workplace cleanup failed', error: String(e?.message ?? e) })); }
  };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
```

- [ ] **Step 7: Run the tests and see them pass**

Run: `node --test --test-force-exit tests/workplaces.test.js`, then `npm test`.
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/workplaces/pool.js src/workplaces/create.js src/workplaces/cleanup.js src/db/seed.js tests/workplaces.test.js
git commit -m "feat(signin): private workplaces — pool with leases, creation, 24-hour cleanup"
```

---

### Task 5: Emailed codes and the Demo mailbox

**Files:**
- Create: `src/auth/email.js`, `tests/email.test.js`

**Interfaces:**
- Consumes: `openDirectory` (Task 1); `sha256Hex` (Task 2); `errors.rateLimited` (existing).
- Produces:
  - `createDemoMailbox(directory, clock) → { send({ accountId, subject, body }) }` (the `EmailSender` interface).
  - `issueEmailCode({ directory, sender, clock, accountId, purpose })`, where `purpose` is `'signin' | 'enable'`.
  - `verifyEmailCode({ directory, clock, accountId, purpose, code }) → boolean`.
  - `listMailbox(directory, accountId) → [{ id, subject, body, at }]`.
  - `EMAIL_CODE_TTL_MS`.

- [ ] **Step 1: Write the failing tests**

`tests/email.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDirectory } from '../src/db/directory.js';
import { createDemoMailbox, issueEmailCode, verifyEmailCode, listMailbox, EMAIL_CODE_TTL_MS } from '../src/auth/email.js';

function setup() {
  const t = { ms: Date.parse('2026-10-06T14:00:00Z') };
  const clock = { now: () => new Date(t.ms) };
  const directory = openDirectory(':memory:', clock);
  directory.prepare("INSERT INTO workplaces (id, kind, created_at, expires_at) VALUES ('w', 'private', 1, 9e15)").run();
  for (const id of ['a1', 'a2']) directory.prepare("INSERT INTO accounts (id, username, workplace_id, user_id, role, password_hash, created_at) VALUES (?, ?, 'w', 'u-jordan', 'employee', 'h', 1)").run(id, id);
  return { t, clock, directory, sender: createDemoMailbox(directory, clock) };
}
const codeIn = (directory, accountId) => listMailbox(directory, accountId)[0].body.match(/\b(\d{6})\b/)[1];

test("an issued code lands in that account's Demo mailbox and verifies once", () => {
  const s = setup();
  issueEmailCode({ ...s, accountId: 'a1', purpose: 'signin' });
  const [msg] = listMailbox(s.directory, 'a1');
  assert.equal(msg.subject, 'Your CareOps sign-in code');
  assert.equal(listMailbox(s.directory, 'a2').length, 0);
  const code = codeIn(s.directory, 'a1');
  assert.equal(verifyEmailCode({ ...s, accountId: 'a1', purpose: 'signin', code }), true);
  assert.equal(verifyEmailCode({ ...s, accountId: 'a1', purpose: 'signin', code }), false);
});

test('a code expires after 10 minutes, is bound to its account and purpose, and rejects junk', () => {
  const s = setup();
  issueEmailCode({ ...s, accountId: 'a1', purpose: 'signin' });
  const code = codeIn(s.directory, 'a1');
  assert.equal(verifyEmailCode({ ...s, accountId: 'a2', purpose: 'signin', code }), false);
  assert.equal(verifyEmailCode({ ...s, accountId: 'a1', purpose: 'enable', code }), false);
  for (const bad of ['', '12345', 'abcdef', null]) assert.equal(verifyEmailCode({ ...s, accountId: 'a1', purpose: 'signin', code: bad }), false);
  s.t.ms += EMAIL_CODE_TTL_MS;
  assert.equal(verifyEmailCode({ ...s, accountId: 'a1', purpose: 'signin', code }), false);
});

test('at most 3 codes per account per 10 minutes', () => {
  const s = setup();
  for (let i = 0; i < 3; i += 1) issueEmailCode({ ...s, accountId: 'a1', purpose: 'signin' });
  assert.throws(() => issueEmailCode({ ...s, accountId: 'a1', purpose: 'signin' }), (e) => e.code === 'rate_limited');
  issueEmailCode({ ...s, accountId: 'a2', purpose: 'signin' });
  s.t.ms += EMAIL_CODE_TTL_MS + 1;
  issueEmailCode({ ...s, accountId: 'a1', purpose: 'signin' });
});

test('codes are stored hashed, never in plain text', () => {
  const s = setup();
  issueEmailCode({ ...s, accountId: 'a1', purpose: 'signin' });
  assert.notEqual(s.directory.prepare('SELECT code_hash FROM email_codes').get().code_hash, codeIn(s.directory, 'a1'));
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `node --test --test-force-exit tests/email.test.js`
Expected: FAIL with `Cannot find module '.../src/auth/email.js'`.

- [ ] **Step 3: Implement**

`src/auth/email.js`:
```js
import { randomInt } from 'node:crypto';
import { sha256Hex } from './secrets.js';
import { errors } from '../http/errors.js';

export const EMAIL_CODE_TTL_MS = 10 * 60_000;
export const EMAIL_CODES_PER_WINDOW = 3;

// The EmailSender for the demo: messages land in the account's Demo mailbox page instead of being sent.
// A real provider (Amazon SES, Postmark) is another object with the same send() method.
export function createDemoMailbox(directory, clock) {
  return {
    send({ accountId, subject, body }) {
      directory.prepare('INSERT INTO mailbox (account_id, subject, body, created_at) VALUES (?,?,?,?)').run(accountId, subject, body, clock.now().getTime());
    },
  };
}

export function issueEmailCode({ directory, sender, clock, accountId, purpose }) {
  const now = clock.now().getTime();
  const recent = directory.prepare('SELECT COUNT(*) n FROM email_codes WHERE account_id = ? AND created_at > ?').get(accountId, now - EMAIL_CODE_TTL_MS).n;
  if (recent >= EMAIL_CODES_PER_WINDOW) throw errors.rateLimited();
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  directory.prepare('INSERT INTO email_codes (account_id, code_hash, purpose, expires_at, created_at) VALUES (?,?,?,?,?)')
    .run(accountId, sha256Hex(code), purpose, now + EMAIL_CODE_TTL_MS, now);
  sender.send({ accountId, subject: 'Your CareOps sign-in code',
    body: `Your CareOps code is ${code}. It expires in 10 minutes. If you did not ask for it, ignore this message.` });
}

export function verifyEmailCode({ directory, clock, accountId, purpose, code }) {
  const typed = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(typed)) return false;
  const now = clock.now().getTime();
  const row = directory.prepare('SELECT id FROM email_codes WHERE account_id = ? AND purpose = ? AND code_hash = ? AND used_at IS NULL AND expires_at > ?')
    .get(accountId, purpose, sha256Hex(typed), now);
  if (!row) return false;
  directory.prepare('UPDATE email_codes SET used_at = ? WHERE id = ?').run(now, row.id);
  return true;
}

export const listMailbox = (directory, accountId) => directory
  .prepare('SELECT id, subject, body, created_at FROM mailbox WHERE account_id = ? ORDER BY id DESC LIMIT 20').all(accountId)
  .map(r => ({ id: r.id, subject: r.subject, body: r.body, at: new Date(r.created_at).toISOString() }));
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `node --test --test-force-exit tests/email.test.js`, then `npm test`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth/email.js tests/email.test.js
git commit -m "feat(signin): emailed codes and the Demo mailbox"
```

---

### Task 6: Passkeys

**Files:**
- Create: `src/auth/passkeys.js`, `tests/fixtures/softAuthenticator.js`, `tests/passkeys.test.js`
- Modify: `package.json`, `package-lock.json` (add `@simplewebauthn/server`)

**Interfaces:**
- Consumes: `openDirectory` (Task 1); `config.publicHost`, `config.publicOrigin` (Task 1).
- Produces:
  - `startRegistration({ directory, config, clock, account }) → { options, challengeId }`. `account` is a directory `accounts` row.
  - `finishRegistration({ directory, config, clock, account, challengeId, response }) → boolean`.
  - `startLogin({ directory, config, clock }) → { options, challengeId }`.
  - `finishLogin({ directory, config, clock, challengeId, response }) → accountId | null`.
  - `CHALLENGE_TTL_MS`.
  - Test fixture: `createSoftAuthenticator({ origin, rpID }) → { register(options), authenticate(options) }`.

- [ ] **Step 1: Install the library and check its API**

Run: `npm install @simplewebauthn/server@^13`
Then run:
```bash
node -e "import('@simplewebauthn/server').then(m => console.log(['generateRegistrationOptions','verifyRegistrationResponse','generateAuthenticationOptions','verifyAuthenticationResponse'].every(k => typeof m[k] === 'function')))"
node -e "import('@simplewebauthn/server/helpers').then(m => console.log(typeof m.isoCBOR.encode))"
```
Expected: `true`, then `function`.

- [ ] **Step 2: Write the software authenticator fixture**

`tests/fixtures/softAuthenticator.js`:
```js
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';

// A software passkey for tests: a real P-256 key, "none" attestation, user presence and verification flags set.
const b64u = (b) => Buffer.from(b).toString('base64url');
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };

export function createSoftAuthenticator({ origin, rpID }) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credId = randomBytes(16);
  const rpIdHash = createHash('sha256').update(rpID).digest();
  const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
  let counter = 0; let userHandle = null;
  const authData = (flags, attested) => Buffer.concat([rpIdHash, Buffer.from([flags]), u32(counter),
    ...(attested ? [Buffer.alloc(16), u16(credId.length), credId, Buffer.from(isoCBOR.encode(cose))] : [])]);
  const clientData = (type, challenge) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  return {
    register(options) {
      userHandle = options.user.id;
      const attestationObject = isoCBOR.encode(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData(0x45, true)]])); // UP|UV|AT
      return { id: b64u(credId), rawId: b64u(credId), type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64u(clientData('webauthn.create', options.challenge)), attestationObject: b64u(attestationObject), transports: ['internal'] } };
    },
    authenticate(options) {
      counter += 1;
      const cd = clientData('webauthn.get', options.challenge);
      const ad = authData(0x05, false); // UP|UV
      const signature = sign('sha256', Buffer.concat([ad, createHash('sha256').update(cd).digest()]), privateKey);
      return { id: b64u(credId), rawId: b64u(credId), type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64u(cd), authenticatorData: b64u(ad), signature: b64u(signature), userHandle } };
    },
  };
}
```

- [ ] **Step 3: Write the failing tests**

`tests/passkeys.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDirectory } from '../src/db/directory.js';
import { startRegistration, finishRegistration, startLogin, finishLogin, CHALLENGE_TTL_MS } from '../src/auth/passkeys.js';
import { createSoftAuthenticator } from './fixtures/softAuthenticator.js';

const config = { publicHost: 'localhost', publicOrigin: 'http://localhost' };
function setup() {
  const t = { ms: Date.parse('2026-10-06T14:00:00Z') };
  const clock = { now: () => new Date(t.ms) };
  const directory = openDirectory(':memory:', clock);
  directory.prepare("INSERT INTO workplaces (id, kind, created_at, expires_at) VALUES ('w', 'private', 1, 9e15)").run();
  directory.prepare("INSERT INTO accounts (id, username, workplace_id, user_id, role, password_hash, created_at) VALUES ('a1', 'alice', 'w', 'u-jordan', 'employee', 'h', 1)").run();
  const account = directory.prepare("SELECT * FROM accounts WHERE id = 'a1'").get();
  return { t, clock, directory, account, auth: createSoftAuthenticator({ origin: config.publicOrigin, rpID: config.publicHost }) };
}
async function register(s) {
  const { options, challengeId } = await startRegistration({ ...s, config });
  return finishRegistration({ ...s, config, challengeId, response: s.auth.register(options) });
}

test('register a passkey, then sign in with it; the counter is stored', async () => {
  const s = setup();
  assert.equal(await register(s), true);
  const { options, challengeId } = await startLogin({ ...s, config });
  assert.equal(options.userVerification, 'required');
  assert.equal(await finishLogin({ ...s, config, challengeId, response: s.auth.authenticate(options) }), 'a1');
  assert.equal(s.directory.prepare('SELECT counter FROM passkeys').get().counter, 1);
});

test('a challenge works once, and expires after 5 minutes', async () => {
  const s = setup();
  await register(s);
  const first = await startLogin({ ...s, config });
  const response = s.auth.authenticate(first.options);
  assert.equal(await finishLogin({ ...s, config, challengeId: first.challengeId, response }), 'a1');
  assert.equal(await finishLogin({ ...s, config, challengeId: first.challengeId, response }), null);
  const second = await startLogin({ ...s, config });
  s.t.ms += CHALLENGE_TTL_MS;
  assert.equal(await finishLogin({ ...s, config, challengeId: second.challengeId, response: s.auth.authenticate(second.options) }), null);
});

test('a response for another origin or an unknown credential is refused without throwing', async () => {
  const s = setup();
  await register(s);
  const { options, challengeId } = await startLogin({ ...s, config });
  const evil = createSoftAuthenticator({ origin: 'https://evil.example', rpID: 'localhost' });
  assert.equal(await finishLogin({ ...s, config, challengeId, response: evil.authenticate(options) }), null);
  const again = await startLogin({ ...s, config });
  assert.equal(await finishLogin({ ...s, config, challengeId: again.challengeId, response: { id: 'nope', response: {} } }), null);
});

test('a registration challenge belongs to its account', async () => {
  const s = setup();
  s.directory.prepare("INSERT INTO accounts (id, username, workplace_id, user_id, role, password_hash, created_at) VALUES ('a2', 'bob', 'w', 'u-marcus', 'billing', 'h', 1)").run();
  const bob = s.directory.prepare("SELECT * FROM accounts WHERE id = 'a2'").get();
  const { options, challengeId } = await startRegistration({ ...s, config });
  assert.equal(await finishRegistration({ ...s, config, account: bob, challengeId, response: s.auth.register(options) }), false);
});
```

- [ ] **Step 4: Run the tests and see them fail**

Run: `node --test --test-force-exit tests/passkeys.test.js`
Expected: FAIL with `Cannot find module '.../src/auth/passkeys.js'`.

- [ ] **Step 5: Implement**

`src/auth/passkeys.js`:
```js
import { randomBytes } from 'node:crypto';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';

// Passkeys (WebAuthn). User verification is required, so a passkey proves both the device and the person.
// The relying party id and origin come from configuration, never from the request.
export const CHALLENGE_TTL_MS = 5 * 60_000;

function saveChallenge(directory, { challenge, accountId = null, purpose, now }) {
  const id = randomBytes(24).toString('base64url');
  directory.prepare('INSERT INTO webauthn_challenges (id, challenge, account_id, purpose, expires_at) VALUES (?,?,?,?,?)').run(id, challenge, accountId, purpose, now + CHALLENGE_TTL_MS);
  return id;
}
function takeChallenge(directory, id, purpose, now) {
  const r = directory.prepare('SELECT * FROM webauthn_challenges WHERE id = ? AND purpose = ?').get(String(id ?? ''), purpose);
  if (!r) return null;
  directory.prepare('DELETE FROM webauthn_challenges WHERE id = ?').run(r.id);
  return r.expires_at > now ? r : null;
}

export async function startRegistration({ directory, config, clock, account }) {
  const existing = directory.prepare('SELECT id, transports FROM passkeys WHERE account_id = ?').all(account.id);
  const options = await generateRegistrationOptions({
    rpName: 'CareOps Demo', rpID: config.publicHost, userName: account.username, userID: Buffer.from(account.id), attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    excludeCredentials: existing.map(p => ({ id: p.id, transports: JSON.parse(p.transports) })),
  });
  return { options, challengeId: saveChallenge(directory, { challenge: options.challenge, accountId: account.id, purpose: 'register', now: clock.now().getTime() }) };
}

export async function finishRegistration({ directory, config, clock, account, challengeId, response }) {
  const ch = takeChallenge(directory, challengeId, 'register', clock.now().getTime());
  if (!ch || ch.account_id !== account.id) return false;
  let v;
  try { v = await verifyRegistrationResponse({ response, expectedChallenge: ch.challenge, expectedOrigin: config.publicOrigin, expectedRPID: config.publicHost, requireUserVerification: true }); }
  catch { return false; }
  if (!v.verified || !v.registrationInfo) return false;
  const { credential } = v.registrationInfo;
  directory.prepare('INSERT INTO passkeys (id, account_id, public_key, counter, transports, created_at) VALUES (?,?,?,?,?,?)')
    .run(credential.id, account.id, Buffer.from(credential.publicKey).toString('base64url'), credential.counter, JSON.stringify(credential.transports ?? []), clock.now().getTime());
  return true;
}

export async function startLogin({ directory, config, clock }) {
  const options = await generateAuthenticationOptions({ rpID: config.publicHost, userVerification: 'required', allowCredentials: [] });
  return { options, challengeId: saveChallenge(directory, { challenge: options.challenge, purpose: 'login', now: clock.now().getTime() }) };
}

export async function finishLogin({ directory, config, clock, challengeId, response }) {
  const ch = takeChallenge(directory, challengeId, 'login', clock.now().getTime());
  if (!ch) return null;
  const pk = directory.prepare('SELECT * FROM passkeys WHERE id = ?').get(String(response?.id ?? ''));
  if (!pk) return null;
  let v;
  try {
    v = await verifyAuthenticationResponse({ response, expectedChallenge: ch.challenge, expectedOrigin: config.publicOrigin, expectedRPID: config.publicHost, requireUserVerification: true,
      credential: { id: pk.id, publicKey: Buffer.from(pk.public_key, 'base64url'), counter: pk.counter, transports: JSON.parse(pk.transports) } });
  } catch { return null; }
  if (!v.verified) return null;
  directory.prepare('UPDATE passkeys SET counter = ? WHERE id = ?').run(v.authenticationInfo.newCounter, pk.id);
  return pk.account_id;
}
```

- [ ] **Step 6: Run the tests and see them pass**

Run: `node --test --test-force-exit tests/passkeys.test.js`, then `npm test`.
Expected: PASS.
- If `verifyRegistrationResponse` rejects the fixture, print the caught error once while debugging. The usual causes are the flags byte, the 16-byte AAGUID and the COSE map keys. Fix the fixture, not the module.

- [ ] **Step 7: Commit**

```bash
git add src/auth/passkeys.js tests/fixtures/softAuthenticator.js tests/passkeys.test.js package.json package-lock.json
git commit -m "feat(signin): passkeys with a software authenticator for tests"
```

---

### Task 7: Per-request workplaces

Sessions move to the directory, and the middleware resolves each request's workplace. Every router, the harness and the labs then use that workplace.

**Files:**
- Modify:
  - `src/auth/sessions.js`, `src/auth/routes.js`, `src/http/middleware.js`, `src/app.js`, `src/main.js`;
  - `src/routes/chat.js`, `src/routes/pto.js`, `src/routes/claims.js`, `src/routes/admin.js`, `src/routes/labs.js`, `src/routes/health.js`;
  - `src/harness/pipeline.js`, `src/labs/attackLab.js`;
  - `tests/helpers.js`, `tests/auth.test.js`.
- Create: `tests/sessions.test.js`
- Mechanical updates: any existing test that writes `llm_calls` or `lab_results` through the shared `db` and then reads them through the app. Switch it to the `directory` that `startTestApp` now returns.

**Interfaces:**
- Consumes:
  - Task 1: `openDirectory`, `migrateFromShared`, `SHARED`, the new `errors`, and the new config keys.
  - Task 4: `createWorkplacePool`, `startCleanup`, `applySeat`, `createPrivateWorkplace`.
- Produces:
  - Session constants `IDLE_MS`, `ABSOLUTE_MS`, `HALFWAY_MS`.
  - Session functions:
    - `createSession(directory, { workplaceId, userId, accountId = null, stage = 'full' }, clock) → { id, csrf, expiresAt }`;
    - `loadSession(directory, id, clock) → null | { sessionId, csrf, stage, workplaceId, userId, accountId, username, expiresAt, lastSeenAt, idle? }`;
    - `touchSession`, `destroySession`, `cookieOptions(config)`.
  - `requireUser({ directory, pool, clock, stage = 'full', touch = true })` (stage `'any'` also admits halfway sessions; `touch: false` means the request does not count as activity). On a request it sets:
    - `req.user`, `req.session`;
    - `req.db` and `req.audit` (the request's workplace);
    - `req.workplaceId`.
  - `createApp(...)` returns `{ app, audit, harness, directory, pool }`. It accepts an optional `directory`; without one it opens an in-memory directory.
  - Harness: `runTurn({ db, audit, ... })`. These are per-call overrides; the defaults are the shared workplace's.
  - `createHarness({ ..., modelsDb })` reads lab results from `modelsDb`.
  - `runAttackLab({ db, resultsDb = db, ... })`.
  - Test helpers:
    - `startTestApp(...)` returns `{ ..., directory, pool, clock, config }`, and `login(username)` works for any shared-workplace user;
    - `sessionFor({ base, directory, db, clock, username, workplaceId })`;
    - `client(base, cookie, csrfToken, user)`;
    - `TEST_TOTP_KEY`, `mutableClock(iso)`.

**Rulings carried by this task:**
- The persona username-and-password door (`POST /api/auth/login` against workplace users) is removed (spec 4.7). The five tests in `tests/auth.test.js` about it are deleted:
  - "login, me, logout; wrong password is 401 and audited";
  - "successful logins are not rate limited";
  - "repeated failed logins are rate limited";
  - "a wrong password gets a clear message";
  - "an unknown username costs the same password check".
  Task 8 adds their account-login equivalents. All other existing tests must pass unchanged, apart from the mechanical `directory` switch above.
- Tests sign in through `sessionFor`, which writes a directory session in-process. No HTTP password door exists for workplace users.

- [ ] **Step 1: Write the failing tests**

`tests/sessions.test.js`:
```js
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
```

- [ ] **Step 2: Rewrite the test helpers**

Replace `tests/helpers.js` with:
```js
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../src/db/index.js';
import { seedDb } from '../src/db/seed.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { fixedClock } from '../src/util/clock.js';
import { FakeProvider } from '../src/llm/fake.js';
import { createSession } from '../src/auth/sessions.js';
import { fakeKb } from './fixtures/kb.js';

export const DEMO_NOW = '2026-10-06T14:00:00Z';
export const TEST_TOTP_KEY = Buffer.alloc(32, 7).toString('base64');
const silent = { error() {}, info() {}, log() {} };

// A clock tests can move forward.
export function mutableClock(iso) {
  let ms = Date.parse(iso);
  return { now: () => new Date(ms), advance: (d) => { ms += d; } };
}

export async function startTestApp(overrides = {}) {
  const db = openDb(':memory:');
  const clock = overrides.clock ?? fixedClock(DEMO_NOW);
  seedDb(db, { clock, demoPassword: 'pw' });
  const kb = overrides.kb ?? fakeKb();
  const provider = overrides.provider ?? new FakeProvider([]);
  const workplacesDir = mkdtempSync(join(tmpdir(), 'careops-wp-'));
  const config = { ...loadConfig({}), demoPassword: 'pw', openrouterKey: 'test', kbApiKey: 'test', workplacesDir, totpKey: TEST_TOTP_KEY,
    publicHost: 'localhost', publicOrigin: 'http://localhost', ...overrides.config };
  const { app, directory, pool } = createApp({ db, kb, provider, clock, config, logger: silent });
  const server = app.listen(0); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const close = async () => { await new Promise(r => server.close(r)); pool.closeAll(); rmSync(workplacesDir, { recursive: true, force: true }); };
  return { app, db, directory, pool, kb, provider, base, clock, config, close, login: (username) => sessionFor({ base, directory, db, clock, username }) };
}

// A signed-in client for any user of a workplace, made in-process (there is no password door for workplace users).
export function sessionFor({ base, directory, db, clock, username, workplaceId = 'shared', accountId = null }) {
  const u = db.prepare('SELECT id, username, display_name, role FROM users WHERE username = ?').get(username);
  if (!u) throw new Error(`no user ${username}`);
  const s = createSession(directory, { workplaceId, userId: u.id, accountId }, clock);
  return client(base, `careops_sid=${s.id}`, s.csrf, { id: u.id, username: u.username, displayName: u.display_name, role: u.role });
}

export function client(base, cookie, csrfToken, user) {
  const call = async (path, { method = 'GET', body, csrf = true } = {}) => {
    const headers = { cookie, 'content-type': 'application/json' };
    if (csrf) headers['x-csrf-token'] = csrfToken;
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  return { user, call, cookie, csrfToken };
}
```

- [ ] **Step 3: Run the tests and see them fail**

Run: `node --test --test-force-exit tests/sessions.test.js`
Expected: FAIL. `createApp` does not return `directory` yet, and `src/auth/sessions.js` has no `IDLE_MS`.

- [ ] **Step 4: Move sessions to the directory**

Replace `src/auth/sessions.js` with:
```js
import { randomBytes } from 'node:crypto';

export const IDLE_MS = 15 * 60_000;
export const ABSOLUTE_MS = 8 * 3600_000;
export const HALFWAY_MS = 5 * 60_000;

// The browser cookie carries only a random id; the server holds the session. No maxAge: the server enforces expiry.
export const cookieOptions = (config) => ({ httpOnly: true, sameSite: 'strict', secure: config.secureCookies, path: '/' });

export function createSession(directory, { workplaceId, userId, accountId = null, stage = 'full' }, clock) {
  const now = clock.now().getTime();
  const id = randomBytes(32).toString('base64url'); const csrf = randomBytes(24).toString('base64url');
  const expiresAt = now + (stage === 'full' ? ABSOLUTE_MS : HALFWAY_MS);
  directory.prepare('INSERT INTO sessions (id, account_id, workplace_id, user_id, csrf, stage, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, accountId, workplaceId, userId, csrf, stage, now, now, expiresAt);
  return { id, csrf, expiresAt };
}

// null: no live session. { timedOut: true }: a halfway pass that expired. { ..., idle: true }: a full session that just
// ended for inactivity. Expired and idle rows are deleted.
export function loadSession(directory, id, clock) {
  if (!id) return null;
  const r = directory.prepare('SELECT s.*, a.username FROM sessions s LEFT JOIN accounts a ON a.id = s.account_id WHERE s.id = ?').get(String(id));
  if (!r) return null;
  const now = clock.now().getTime();
  if (r.expires_at <= now) { destroySession(directory, r.id); return r.stage === 'halfway' ? { timedOut: true } : null; }
  const s = { sessionId: r.id, csrf: r.csrf, stage: r.stage, workplaceId: r.workplace_id, userId: r.user_id, accountId: r.account_id,
    username: r.username ?? null, expiresAt: r.expires_at, lastSeenAt: r.last_seen_at };
  if (r.stage === 'full' && now - r.last_seen_at > IDLE_MS) { destroySession(directory, r.id); return { ...s, idle: true }; }
  return s;
}

export const touchSession = (directory, id, clock) => directory.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(clock.now().getTime(), id);
export const destroySession = (directory, id) => directory.prepare('DELETE FROM sessions WHERE id = ?').run(String(id ?? ''));
```

- [ ] **Step 5: Resolve the workplace in the middleware**

In `src/http/middleware.js`, change the import line to:
```js
import { loadSession, touchSession, destroySession } from '../auth/sessions.js';
```
Replace `requireUser` with:
```js
// Identity comes only from the server-side session; the client never asserts a role. The session names the workplace,
// and this request reads and writes only that workplace's database (leased, so it cannot be closed mid-request).
// touch = false: the request does not count as activity (the Demo mailbox page polls; it must not hold a session open).
export function requireUser({ directory, pool, clock, stage = 'full', touch = true }) {
  return (req, res, next) => {
    const s = loadSession(directory, req.cookies?.careops_sid, clock);
    if (!s) return next(errors.unauth());
    if (s.timedOut) return next(errors.signinTimedOut());
    if (s.idle) {
      pool.get(s.workplaceId)?.audit.event({ actor: { id: s.userId }, kind: 'session_idle_logoff', security: true });
      return next(errors.sessionIdle());
    }
    if (stage === 'full' && s.stage !== 'full') return next(errors.secondStepRequired());
    const lease = pool.acquire(s.workplaceId);
    if (!lease) { destroySession(directory, s.sessionId); return next(errors.unauth()); }
    res.on('close', lease.release);
    const u = lease.wp.db.prepare('SELECT id, username, display_name, role, manager_id FROM users WHERE id = ?').get(s.userId);
    if (!u) return next(errors.unauth());
    req.user = { id: u.id, username: u.username, displayName: u.display_name, role: u.role, managerId: u.manager_id };
    req.session = s; req.db = lease.wp.db; req.audit = lease.wp.audit; req.workplaceId = s.workplaceId;
    if (req.method !== 'GET' && req.get('x-csrf-token') !== s.csrf) return next(errors.forbidden('Missing or invalid CSRF token.'));
    if (touch) touchSession(directory, s.sessionId, clock);
    next();
  };
}
```
In `auditDenials`, change `audit.event({` to `(req.audit ?? audit).event({`. A refused request is then recorded in its own workplace when it has one, and in the shared workplace otherwise.

- [ ] **Step 6: Rewrite the auth routes (persona, me, ping, logout)**

Replace `src/auth/routes.js` with:
```js
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { parseBody, requireUser } from '../http/middleware.js';
import { errors } from '../http/errors.js';
import { SHARED } from '../db/directory.js';
import { createSession, destroySession, cookieOptions, IDLE_MS } from './sessions.js';

const DEMO_PERSONAS = ['jordan', 'priya', 'marcus', 'dana'];
const Persona = z.object({ persona: z.enum(DEMO_PERSONAS) }).strict();
const publicUser = (u) => ({ id: u.id, username: u.username, displayName: u.display_name ?? u.displayName, role: u.role });

export function authRoutes({ directory, pool, clock, config }) {
  const r = Router();
  const cookie = cookieOptions(config);
  // Quick look for the shared demo workplace: the server picks the account and creates a normal, full session.
  // The browser can only name one of four demo personas, never a role. Demo logins use /accounts and /login instead.
  r.post('/demo', rateLimit({ windowMs: 60_000, limit: 30, handler: (req, res, next) => next(errors.rateLimited()) }), (req, res) => {
    const { persona } = parseBody(Persona, req.body);
    const u = pool.shared.db.prepare('SELECT * FROM users WHERE username = ?').get(persona);
    if (!u) throw errors.notFound('Demo persona not found.');
    destroySession(directory, req.cookies?.careops_sid);
    const s = createSession(directory, { workplaceId: SHARED, userId: u.id }, clock);
    pool.shared.audit.event({ actor: { id: u.id, role: u.role }, kind: 'login_success', detail: { via: 'persona' } });
    res.cookie('careops_sid', s.id, cookie).json({ user: publicUser(u), csrfToken: s.csrf });
  });
  const full = requireUser({ directory, pool, clock });
  const any = requireUser({ directory, pool, clock, stage: 'any' });
  r.get('/me', full, (req, res) => res.json({ user: publicUser(req.user), csrfToken: req.session.csrf,
    session: { idleTimeoutMs: IDLE_MS, expiresAt: new Date(req.session.expiresAt).toISOString(), accountSession: Boolean(req.session.accountId) } }));
  r.post('/ping', full, (req, res) => res.status(204).end()); // "Stay signed in": any authenticated request counts as activity
  r.post('/logout', any, (req, res) => { destroySession(directory, req.session.sessionId); res.clearCookie('careops_sid', { path: '/' }).status(204).end(); });
  return r;
}
```

- [ ] **Step 7: Let a chat turn run against the request's workplace**

In `src/harness/pipeline.js`:
1. Change the `createHarness` signature line to:
```js
export function createHarness({ db, kb, provider, clock, audit, budget, prompts, config, modelsDb = db }) {
```
2. Change `function finish(trace, turn, ev) {` to `function finish(trace, turn, ev, turnAudit) {`. In its body, change `audit.saveTrace(trace.toJSON());` to `turnAudit.saveTrace(trace.toJSON());`.
3. Change the `runTurn` signature to:
```js
  async function runTurn({ db: turnDb = db, audit: turnAudit = audit, user, message, model = getDefaultModel(modelsDb, config), promptVariant = 'hardened', purpose = 'chat' }) {
```
4. Inside `runTurn`, make these replacements:
   - `audit.event(` → `turnAudit.event(` (in the `ev` helper);
   - `gatherFacts(db,` → `gatherFacts(turnDb,`;
   - `proposeAction(db,` → `proposeAction(turnDb,`;
   - the `reply` helper's `finish(trace, {...}, ev)` → `finish(trace, {...}, ev, turnAudit)`.
5. Run `grep -nE '\bdb\b|audit\.' src/harness/pipeline.js`. Every hit between the `runTurn` line and the end of `createHarness` must now be `turnDb` or `turnAudit`. `gatherFacts` and `getDefaultModel` take their database as a parameter, so they are unchanged.

In `src/labs/attackLab.js`:
1. Change the signature to `export async function runAttackLab({ db, resultsDb = db, harness, model, audit, clock = systemClock }) {`.
2. Change the `harness.runTurn({ user, message: a.message, ...` call to `harness.runTurn({ db, audit, user, message: a.message, ...`, keeping the remaining arguments.
3. Change the final `db.prepare("INSERT OR REPLACE INTO lab_results ...` to `resultsDb.prepare("INSERT OR REPLACE INTO lab_results ...`.

- [ ] **Step 8: Routers read the request's workplace**

Replace the router factories as follows. Imports stay as they are unless shown.

`src/routes/chat.js`, the `chatRoutes` function:
```js
export function chatRoutes({ directory, clock, harness, config }) {
  const r = Router();
  const limiter = rateLimit({ windowMs: 10 * 60_000, limit: 20, keyGenerator: (req) => req.session.sessionId, validate: false, handler: (req, res, next) => next(errors.rateLimited()) });
  const ipLimiter = rateLimit({ windowMs: 10 * 60_000, limit: config.chatIpLimit, keyGenerator: (req) => req.ip, validate: false, handler: (req, res, next) => next(errors.rateLimited()) });
  r.post('/chat', ipLimiter, limiter, asyncHandler(async (req, res) => {
    const { message, model } = parseBody(ChatBody, req.body);
    if (model && !isKnownModel(model)) throw errors.invalid('Unknown model.');
    res.json(publicTurn(await harness.runTurn({ db: req.db, audit: req.audit, user: req.user, message, model: model ?? getDefaultModel(directory, config) })));
  }));
  r.post('/actions/:id/confirm', (req, res) => res.json({ action: confirmAction(req.db, { user: req.user, actionId: req.params.id, clock, audit: req.audit }) }));
  r.post('/actions/:id/dismiss', (req, res) => res.json({ action: dismissAction(req.db, { user: req.user, actionId: req.params.id, audit: req.audit }) }));
  r.get('/traces/:turnId', (req, res, next) => {
    const t = req.audit.getTrace(req.params.turnId);
    if (!t || (t.user.id !== req.user.id && req.user.role !== 'admin')) return next(errors.notFound('Trace not found.'));
    res.json(forViewer(t, req.user));
  });
  r.get('/models', (req, res) => res.json({ default: getDefaultModel(directory, config), models: MODELS }));
  return r;
}
```

`src/routes/pto.js`:
- Change the factory to `export function ptoRoutes({ clock }) {`.
- In its body, replace every `db` argument with `req.db` and every `audit.event(` with `req.audit.event(`. That is six `db` uses: `listMyPto`, `withIdempotency` ×2, `createPtoRequest`, `listApprovals` and `decidePtoRequest`.

`src/routes/claims.js`:
- Change the factory to `export function claimRoutes({ clock }) {`.
- In its body, replace every `db` argument with `req.db` and every `audit.event(` with `req.audit.event(`.

`src/routes/admin.js`, replaced with:
```js
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { requireRole } from '../http/middleware.js';
import { seedDb, applySeat } from '../db/seed.js';
import { SHARED } from '../db/directory.js';

export function adminRoutes({ clock, config }) {
  const r = Router();
  r.get('/audit', requireRole('admin'), (req, res) => res.json({ events: req.audit.list({ securityOnly: req.query.security === '1', limit: Number(req.query.limit ?? 100) }) }));
  r.post('/admin/reset', requireRole('admin'), (req, res) => {
    seedDb(req.db, { clock, demoPassword: req.workplaceId === SHARED ? config.demoPassword : randomBytes(24).toString('base64url') });
    // A private workplace's admin is a visitor in Dana's seat; the reset restores the data, not Dana's name.
    if (req.session.accountId) applySeat(req.db, { userId: req.user.id, username: req.session.username, displayName: req.session.username });
    req.audit.event({ actor: req.user, kind: 'demo_reset' });
    res.status(204).end();
  });
  return r;
}
```

`src/routes/labs.js`:
- Change `stored` to `const stored = (directory, lab) => { const r = directory.prepare('SELECT results_json FROM lab_results WHERE lab = ?').get(lab); return r ? JSON.parse(r.results_json) : null; };`.
- Change the factory to `export function labRoutes({ directory, kb, provider, prompts, harness, budget, config, clock }) {`.
- In the body:
  - `stored(db, ...)` → `stored(directory, ...)`;
  - `getDefaultModel(db, config)` → `getDefaultModel(directory, config)`;
  - `audit.event(` → `req.audit.event(`;
  - the attack run becomes `runAttackLab({ db: req.db, resultsDb: directory, harness, model: getDefaultModel(directory, config), audit: req.audit, clock })`;
  - the model run becomes `runModelLab({ db: directory, kb, provider, audit: req.audit, budget, prompts, config, reps: 3 })`. The model lab uses `db` only to store its results.

`src/routes/health.js`:
- Change the factory to `export function healthRoutes({ directory, pool, kb, config, budget, clock }) {`.
- In `/ready`:
  - the database check runs `pool.shared.db.prepare('SELECT 1').get(); directory.prepare('SELECT 1').get();`;
  - the users count uses `pool.shared.db`;
  - the `llm_calls` query uses `directory`.

- [ ] **Step 9: Wire the app**

In `src/app.js`, add the imports:
```js
import { openDirectory, migrateFromShared } from './db/directory.js';
import { createWorkplacePool } from './workplaces/pool.js';
```
Replace the body of `createApp` from `const audit = createAudit(db, clock);` down to `return { app, audit, harness };` with:
```js
  const directory = providedDirectory ?? openDirectory(':memory:', clock);
  migrateFromShared(directory, db);
  const audit = createAudit(db, clock);
  const pool = createWorkplacePool({ directory, sharedDb: db, sharedAudit: audit, dir: config.workplacesDir, clock });
  const budget = createBudget(directory, clock, config.dailyBudgetUsd);
  app.use(healthRoutes({ directory, pool, kb, config, budget, clock }));
  app.use('/api/auth', authRoutes({ directory, pool, clock, config }));
  app.use('/api', requireUser({ directory, pool, clock }));
  const prompts = loadPrompts();
  const harness = createHarness({ db, kb, provider, clock, audit, budget, prompts, config, modelsDb: directory });
  app.use('/api', chatRoutes({ directory, clock, harness, config }));
  app.use('/api', ptoRoutes({ clock }), claimRoutes({ clock }), adminRoutes({ clock, config }));
  app.use('/api', labRoutes({ directory, kb, provider, prompts, harness, budget, config, clock }));
  app.use('/api', (req, res, next) => next(new HttpError(404, 'not_found', 'Not found.')));
  app.use(express.static(WEB_DIR, { extensions: ['html'] }));
  app.use(auditDenials(audit, clock));
  app.use(errorHandler(logger));
  return { app, audit, harness, directory, pool };
```
Change the signature to `export function createApp({ db, directory: providedDirectory, kb, provider, clock = systemClock, config, logger = console }) {`.

In `src/main.js`:
1. Add `import { openDirectory } from './db/directory.js';` and `import { startCleanup } from './workplaces/cleanup.js';`.
2. After `const config = loadConfig();` add:
```js
if (process.env.NODE_ENV === 'production' && Buffer.from(config.totpKey, 'base64').length !== 32) {
  console.error(JSON.stringify({ msg: 'TOTP_KEY must be 32 random bytes, base64-encoded (openssl rand -base64 32)' }));
  process.exit(1);
}
```
3. After the seeding line add `const directory = openDirectory(config.directoryPath, systemClock);`.
4. Change the `createApp` call to `const { app, pool } = createApp({ db, directory, kb, provider, clock: systemClock, config });`.
5. Add `startCleanup({ directory, pool, dir: config.workplacesDir, clock: systemClock });` before `app.listen`.

- [ ] **Step 10: Remove the persona-password tests**

In `tests/auth.test.js`, delete the five tests named in the rulings above. Change the remaining tests that used `startTestApp().login(...)`; they keep working through `sessionFor`.

The persona-shortcut tests stay as they are:
- "persona shortcut creates a real server session for that persona";
- "persona shortcut cannot pick a role or a non-demo account".

- [ ] **Step 11: Run everything**

Run: `node --test --test-force-exit tests/sessions.test.js`
Expected: PASS.

Run: `npm test`
Expected: PASS. If a test fails because it wrote `llm_calls` or `lab_results` into `db`, change it to write into `app.directory`. That is the only allowed change to existing tests.

Run: `grep -rnE "routes\(\{[^}]*\bdb\b" src/app.js`
Expected: no output. No router receives the shared `db`.

- [ ] **Step 12: Commit**

```bash
git add src/auth/sessions.js src/auth/routes.js src/http/middleware.js src/app.js src/main.js src/routes src/harness/pipeline.js src/labs/attackLab.js tests
git commit -m "feat(signin): sessions in the directory; every request uses its own workplace"
```

---

### Task 8: Account API

This task covers:
- creating a demo login;
- password sign-in to a halfway session;
- each second step: authenticator, emailed code, recovery code and passkey;
- lockout and the throttle;
- the Demo mailbox.

**Files:**
- Create: `src/auth/accountRoutes.js`, `tests/accounts.test.js`
- Modify: `src/app.js` (mount the routes)

**Interfaces:**
- Consumes:
  - Task 2: `generateTotpSecret`, `verifyTotp`, `otpauthUrl`, `totpAt` (tests), `encryptSecret`, `decryptSecret`, `generateRecoveryCodes`, `hashRecoveryCode`, `qrDataUrl`.
  - Task 3: `usernameProblem`, `passwordProblem`, `ipKey`.
  - Task 4: `createPrivateWorkplace`.
  - Task 5: `createDemoMailbox`, `issueEmailCode`, `verifyEmailCode`, `listMailbox`.
  - Task 6: `startRegistration`, `finishRegistration`, `startLogin`, `finishLogin`, and the soft authenticator (tests).
  - Task 7: `requireUser`, `createSession`, `destroySession`, `cookieOptions`, and the test helpers.
- Produces:
  - `accountRoutes({ directory, pool, clock, config })`, mounted at `/api/auth`.
  - Constants `MAX_FAILURES = 5` and `LOCK_MS = 900000`.
  - Endpoints, all JSON:

| Endpoint | Session | Body | Returns |
|---|---|---|---|
| `POST /accounts` | none | `{ username, password, role }` | 201 `{ stage: 'halfway', csrfToken, username, role, methods: [] }` |
| `POST /login` | none | `{ username, password }` | `{ stage: 'halfway', csrfToken, username, role, methods }` |
| `GET /second-step` | halfway or full | — | `{ stage, username, role, methods, canSetup, csrfToken }` |
| `POST /verify` | halfway | `{ method: 'totp'\|'email'\|'recovery', code }` | `{ stage: 'full', csrfToken, ... }` |
| `POST /email/send` | halfway or full | `{ purpose: 'signin'\|'enable' }` | 204 |
| `POST /email/confirm` | setup | `{ code }` | `{ stage, csrfToken?, methods }` |
| `POST /totp/setup` | setup | — | `{ secret, otpauthUrl, qr }` |
| `POST /totp/confirm` | setup | `{ code }` | `{ stage, csrfToken?, methods, recoveryCodes }` |
| `POST /passkeys/register/options` | setup | — | `{ options, challengeId }` |
| `POST /passkeys/register/verify` | setup | `{ challengeId, response }` | `{ stage, csrfToken?, methods }` |
| `POST /passkeys/login/options` | none | — | `{ options, challengeId }` |
| `POST /passkeys/login/verify` | none | `{ challengeId, response }` | `{ stage: 'full', csrfToken, ... }` |
| `GET /mailbox` | halfway or full | — | `{ messages }` |

  - "Setup" means a full session, or a halfway session whose account has no second step yet. A halfway session for an account that already has one gets 403 (Review Focus 1).
  - When setup completes an account's first second step during a halfway session, the session is replaced with a full one, and the response carries the new `csrfToken`.

- [ ] **Step 1: Write the failing tests**

`tests/accounts.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, mutableClock, sessionFor } from './helpers.js';
import { totpAt } from '../src/auth/totp.js';
import { createSoftAuthenticator } from './fixtures/softAuthenticator.js';
import { LOCK_MS } from '../src/auth/accountRoutes.js';

// A browser stand-in: keeps the session cookie and the latest CSRF token, can pretend to come from an address.
function agent(base, ip) {
  let cookie = '', csrf = '';
  return {
    async call(path, { method = 'GET', body } = {}) {
      const headers = { 'content-type': 'application/json' };
      if (cookie) headers.cookie = cookie;
      if (csrf) headers['x-csrf-token'] = csrf;
      if (ip) headers['x-forwarded-for'] = ip;
      const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const set = r.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const text = await r.text(); const data = text ? JSON.parse(text) : null;
      if (data?.csrfToken) csrf = data.csrfToken;
      return { status: r.status, body: data };
    },
  };
}
const PW = 'correct horse battery';
async function signUp(app, username = 'alice', role = 'employee', ip) {
  const a = agent(app.base, ip);
  const r = await a.call('/api/auth/accounts', { method: 'POST', body: { username, password: PW, role } });
  return { a, r };
}
async function withTotp(app, username = 'alice', role = 'employee') {
  const { a } = await signUp(app, username, role);
  const setup = await a.call('/api/auth/totp/setup', { method: 'POST' });
  const confirm = await a.call('/api/auth/totp/confirm', { method: 'POST', body: { code: totpAt(setup.body.secret, app.clock.now().getTime()) } });
  return { a, secret: setup.body.secret, recoveryCodes: confirm.body.recoveryCodes, confirm };
}
const signIn = (app, username = 'alice', password = PW) => { const a = agent(app.base); return a.call('/api/auth/login', { method: 'POST', body: { username, password } }).then(r => ({ a, r })); };

test('creating a login gives a halfway session that reaches nothing until a second step exists', async (t) => {
  const app = await startTestApp({ clock: mutableClock('2026-10-06T14:00:00Z') }); t.after(app.close);
  const { a, r } = await signUp(app);
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.stage, r.body.username, r.body.role, r.body.methods], ['halfway', 'alice', 'employee', []]);
  assert.equal((await a.call('/api/pto/me')).body.error.code, 'second_step_required');
  assert.equal((await a.call('/api/auth/second-step')).body.canSetup, true);
});

test('authenticator setup gives a full session, 10 recovery codes, and the private workplace', async (t) => {
  const app = await startTestApp({ clock: mutableClock('2026-10-06T14:00:00Z') }); t.after(app.close);
  const { a, recoveryCodes, confirm } = await withTotp(app);
  assert.equal(confirm.body.stage, 'full');
  assert.equal(recoveryCodes.length, 10);
  const me = await a.call('/api/auth/me');
  assert.deepEqual([me.body.user.displayName, me.body.user.role, me.body.session.accountSession], ['alice', 'employee', true]);
  assert.equal((await a.call('/api/pto/me')).status, 200);
  const qr = (await a.call('/api/auth/totp/setup', { method: 'POST' })).body;
  assert.equal(qr.error.code, 'conflict'); // already set up
});

test('sign in: password then an authenticator code; the same code never works twice', async (t) => {
  const clock = mutableClock('2026-10-06T14:00:00Z');
  const app = await startTestApp({ clock }); t.after(app.close);
  const { secret } = await withTotp(app);
  clock.advance(30_000);
  const { a, r } = await signIn(app);
  assert.deepEqual([r.body.stage, r.body.methods], ['halfway', ['totp', 'recovery']]);
  const code = totpAt(secret, clock.now().getTime());
  assert.equal((await a.call('/api/auth/verify', { method: 'POST', body: { method: 'totp', code } })).body.stage, 'full');
  const { a: b } = await signIn(app);
  assert.equal((await b.call('/api/auth/verify', { method: 'POST', body: { method: 'totp', code } })).body.error.code, 'invalid_code');
});

test('a recovery code works once', async (t) => {
  const app = await startTestApp({ clock: mutableClock('2026-10-06T14:00:00Z') }); t.after(app.close);
  const { recoveryCodes } = await withTotp(app);
  const { a } = await signIn(app);
  assert.equal((await a.call('/api/auth/verify', { method: 'POST', body: { method: 'recovery', code: recoveryCodes[0].toUpperCase() } })).body.stage, 'full');
  const { a: b } = await signIn(app);
  assert.equal((await b.call('/api/auth/verify', { method: 'POST', body: { method: 'recovery', code: recoveryCodes[0] } })).body.error.code, 'invalid_code');
});

test('emailed codes: enable through the Demo mailbox, then sign in with one', async (t) => {
  const app = await startTestApp({ clock: mutableClock('2026-10-06T14:00:00Z') }); t.after(app.close);
  const { a } = await signUp(app);
  assert.equal((await a.call('/api/auth/email/send', { method: 'POST', body: { purpose: 'enable' } })).status, 204);
  const code = (await a.call('/api/auth/mailbox')).body.messages[0].body.match(/\d{6}/)[0];
  assert.equal((await a.call('/api/auth/email/confirm', { method: 'POST', body: { code } })).body.stage, 'full');
  const { a: b, r } = await signIn(app);
  assert.deepEqual(r.body.methods, ['email']);
  await b.call('/api/auth/email/send', { method: 'POST', body: { purpose: 'signin' } });
  const signinCode = (await b.call('/api/auth/mailbox')).body.messages[0].body.match(/\d{6}/)[0];
  assert.equal((await b.call('/api/auth/verify', { method: 'POST', body: { method: 'email', code: signinCode } })).body.stage, 'full');
});

test('a password-only session cannot add a second step to an account that has one', async (t) => {
  const app = await startTestApp({ clock: mutableClock('2026-10-06T14:00:00Z') }); t.after(app.close);
  await withTotp(app);
  const { a } = await signIn(app);
  assert.equal((await a.call('/api/auth/second-step')).body.canSetup, false);
  for (const path of ['/api/auth/totp/setup', '/api/auth/passkeys/register/options']) assert.equal((await a.call(path, { method: 'POST' })).status, 403, path);
  assert.equal((await a.call('/api/auth/email/send', { method: 'POST', body: { purpose: 'enable' } })).status, 403);
  assert.equal((await a.call('/api/auth/email/confirm', { method: 'POST', body: { code: '123456' } })).status, 403);
});

test('5 wrong passwords lock the account for 15 minutes, recorded as a security event', async (t) => {
  const clock = mutableClock('2026-10-06T14:00:00Z');
  const app = await startTestApp({ clock }); t.after(app.close);
  await withTotp(app);
  for (let i = 0; i < 4; i += 1) assert.equal((await signIn(app, 'alice', 'wrong password!!')).r.body.error.code, 'invalid_credentials');
  const fifth = (await signIn(app, 'alice', 'wrong password!!')).r;
  assert.deepEqual([fifth.status, fifth.body.error.message], [423, 'Account locked; try again at 14:15 UTC.']);
  assert.equal((await signIn(app)).r.status, 423); // even the right password, while locked
  const wid = app.directory.prepare("SELECT workplace_id FROM accounts WHERE username = 'alice'").get().workplace_id;
  assert.equal(app.pool.get(wid).db.prepare("SELECT COUNT(*) n FROM audit_events WHERE kind = 'account_locked' AND security = 1").get().n, 1);
  clock.advance(LOCK_MS);
  assert.equal((await signIn(app)).r.body.stage, 'halfway');
});

test('5 wrong second-step codes lock the account and end the halfway session', async (t) => {
  const app = await startTestApp({ clock: mutableClock('2026-10-06T14:00:00Z') }); t.after(app.close);
  await withTotp(app);
  const { a } = await signIn(app);
  for (let i = 0; i < 4; i += 1) assert.equal((await a.call('/api/auth/verify', { method: 'POST', body: { method: 'totp', code: '000000' } })).status, 422);
  assert.equal((await a.call('/api/auth/verify', { method: 'POST', body: { method: 'totp', code: '000000' } })).status, 423);
  assert.equal((await a.call('/api/auth/second-step')).status, 401);
});

test('the halfway pass expires after 5 minutes', async (t) => {
  const clock = mutableClock('2026-10-06T14:00:00Z');
  const app = await startTestApp({ clock }); t.after(app.close);
  const { secret } = await withTotp(app);
  const { a } = await signIn(app);
  clock.advance(5 * 60_000);
  const r = await a.call('/api/auth/verify', { method: 'POST', body: { method: 'totp', code: totpAt(secret, clock.now().getTime()) } });
  assert.deepEqual([r.status, r.body.error.code], [401, 'signin_timed_out']);
});

test('unknown usernames get the same answer as wrong passwords and are logged in the directory', async (t) => {
  const app = await startTestApp(); t.after(app.close);
  await signUp(app);
  const unknown = (await signIn(app, 'nobody_here')).r;
  const wrong = (await signIn(app, 'alice', 'wrong password!!')).r;
  assert.deepEqual([unknown.status, unknown.body.error.message], [wrong.status, wrong.body.error.message]);
  assert.equal(app.directory.prepare("SELECT kind FROM security_log WHERE kind = 'login_failed_unknown_user'").get().kind, 'login_failed_unknown_user');
});

test('usernames are case-insensitive', async (t) => {
  const app = await startTestApp(); t.after(app.close);
  const { r } = await signUp(app, 'Alice');
  assert.equal(r.body.username, 'alice');
  assert.equal((await signUp(app, 'ALICE')).r.body.error.code, 'username_taken');
  assert.equal((await signIn(app, 'ALICE')).r.body.stage, 'halfway');
});

test('bad usernames and passwords are refused with a reason', async (t) => {
  const app = await startTestApp(); t.after(app.close);
  assert.match((await signUp(app, 'dana')).r.body.error.message, /reserved/);
  const a = agent(app.base);
  assert.match((await a.call('/api/auth/accounts', { method: 'POST', body: { username: 'bob_1', password: 'short', role: 'billing' } })).body.error.message, /at least 12/);
  assert.equal((await a.call('/api/auth/accounts', { method: 'POST', body: { username: 'bob_2', password: PW, role: 'owner' } })).status, 400);
});

test('at most 3 new logins per address per hour; IPv6 counts per /64', async (t) => {
  const app = await startTestApp({ config: { creationsPerHour: 3 } }); t.after(app.close);
  // Express trusts one proxy hop (app.set('trust proxy', 1)), so X-Forwarded-For sets req.ip in this test.
  for (let i = 0; i < 3; i += 1) assert.equal((await signUp(app, `user_${i}`, 'employee', '2001:db8:1:2::1')).r.status, 201);
  const fourth = (await signUp(app, 'user_x', 'employee', '2001:db8:1:2::99')).r;
  assert.deepEqual([fourth.status, fourth.body.error.code], [429, 'creation_limited']);
  assert.equal((await signUp(app, 'user_y', 'employee', '203.0.113.9')).r.status, 201);
});

test('when the demo is full, creation says so', async (t) => {
  const app = await startTestApp({ config: { privateWorkplaceCap: 1 } }); t.after(app.close);
  assert.equal((await signUp(app, 'user_a')).r.status, 201);
  assert.equal((await signUp(app, 'user_b')).r.body.error.code, 'demo_full');
});

test('passkey: add one during sign-up, then sign in with it alone', async (t) => {
  const app = await startTestApp({ clock: mutableClock('2026-10-06T14:00:00Z') }); t.after(app.close);
  const device = createSoftAuthenticator({ origin: 'http://localhost', rpID: 'localhost' });
  const { a } = await signUp(app);
  const reg = (await a.call('/api/auth/passkeys/register/options', { method: 'POST' })).body;
  const done = await a.call('/api/auth/passkeys/register/verify', { method: 'POST', body: { challengeId: reg.challengeId, response: device.register(reg.options) } });
  assert.deepEqual([done.body.stage, done.body.methods], ['full', ['passkey']]);
  const b = agent(app.base);
  const opts = (await b.call('/api/auth/passkeys/login/options', { method: 'POST' })).body;
  const signedIn = await b.call('/api/auth/passkeys/login/verify', { method: 'POST', body: { challengeId: opts.challengeId, response: device.authenticate(opts.options) } });
  assert.equal(signedIn.body.stage, 'full');
  assert.equal((await b.call('/api/pto/me')).status, 200);
  const wid = app.directory.prepare("SELECT workplace_id FROM accounts WHERE username = 'alice'").get().workplace_id;
  assert.equal(app.pool.get(wid).db.prepare("SELECT COUNT(*) n FROM audit_events WHERE kind = 'passkey_signin'").get().n, 1);
});

test('a forged passkey assertion is refused', async (t) => {
  const app = await startTestApp(); t.after(app.close);
  const b = agent(app.base);
  const opts = (await b.call('/api/auth/passkeys/login/options', { method: 'POST' })).body;
  const stranger = createSoftAuthenticator({ origin: 'http://localhost', rpID: 'localhost' });
  assert.equal((await b.call('/api/auth/passkeys/login/verify', { method: 'POST', body: { challengeId: opts.challengeId, response: stranger.authenticate(opts.options) } })).body.error.code, 'invalid_credentials');
});

test('the mailbox shows only the signed-in account\'s messages; Quick look sessions have no sign-in settings', async (t) => {
  const app = await startTestApp(); t.after(app.close);
  const { a } = await signUp(app, 'alice');
  const { a: b } = await signUp(app, 'bob_b', 'billing');
  await a.call('/api/auth/email/send', { method: 'POST', body: { purpose: 'enable' } });
  assert.equal((await a.call('/api/auth/mailbox')).body.messages.length, 1);
  assert.equal((await b.call('/api/auth/mailbox')).body.messages.length, 0);
  const jordan = sessionFor({ ...app, username: 'jordan' });
  assert.equal((await jordan.call('/api/auth/second-step')).status, 403);
  assert.equal((await jordan.call('/api/auth/mailbox')).status, 403);
});

test('reading the Demo mailbox does not count as activity', async (t) => {
  const clock = mutableClock('2026-10-06T14:00:00Z');
  const app = await startTestApp({ clock }); t.after(app.close);
  const { a } = await withTotp(app);
  clock.advance(14 * 60_000);
  assert.equal((await a.call('/api/auth/mailbox')).status, 200);
  clock.advance(2 * 60_000);
  assert.equal((await a.call('/api/pto/me')).body.error.code, 'session_idle');
});

test('sign-in attempts are throttled at 20 a minute per address', async (t) => {
  const app = await startTestApp(); t.after(app.close);
  const a = agent(app.base, '198.51.100.7');
  for (let i = 0; i < 20; i += 1) await a.call('/api/auth/login', { method: 'POST', body: { username: `nobody${i}`, password: 'x'.repeat(12) } });
  assert.equal((await a.call('/api/auth/login', { method: 'POST', body: { username: 'nobody', password: 'x'.repeat(12) } })).status, 429);
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `node --test --test-force-exit tests/accounts.test.js`
Expected: FAIL with `Cannot find module '.../src/auth/accountRoutes.js'`.

- [ ] **Step 3: Implement the routes**

`src/auth/accountRoutes.js`:
```js
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { asyncHandler, parseBody, requireUser } from '../http/middleware.js';
import { errors } from '../http/errors.js';
import { ipKey } from '../http/ipKey.js';
import { logSecurity } from '../db/directory.js';
import { usernameProblem, passwordProblem } from './rules.js';
import { createPrivateWorkplace } from '../workplaces/create.js';
import { createSession, destroySession, cookieOptions } from './sessions.js';
import { generateTotpSecret, verifyTotp, otpauthUrl } from './totp.js';
import { encryptSecret, decryptSecret } from './secrets.js';
import { generateRecoveryCodes, hashRecoveryCode } from './recovery.js';
import { qrDataUrl } from './qr.js';
import { createDemoMailbox, issueEmailCode, verifyEmailCode, listMailbox } from './email.js';
import { startRegistration, finishRegistration, startLogin, finishLogin } from './passkeys.js';

export const MAX_FAILURES = 5;
export const LOCK_MS = 15 * 60_000;
const ROLES = ['employee', 'manager', 'billing', 'admin'];
const DUMMY_HASH = bcrypt.hashSync('careops-no-such-account', 10); // unknown usernames cost the same check

const Create = z.object({ username: z.string().max(64), password: z.string().max(400), role: z.enum(ROLES) }).strict();
const Login = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(400) }).strict();
const Code = z.object({ code: z.string().trim().min(1).max(32) }).strict();
const Verify = z.object({ method: z.enum(['totp', 'email', 'recovery']), code: z.string().trim().min(1).max(32) }).strict();
const Purpose = z.object({ purpose: z.enum(['signin', 'enable']) }).strict();
const PasskeyFinish = z.object({ challengeId: z.string().min(1).max(100), response: z.object({ id: z.string().max(1024) }).passthrough() }).strict();

export function accountRoutes({ directory, pool, clock, config }) {
  const r = Router();
  const cookie = cookieOptions(config);
  const mailbox = createDemoMailbox(directory, clock);
  const throttle = rateLimit({ windowMs: 60_000, limit: 20, keyGenerator: (req) => ipKey(req.ip), validate: false, handler: (req, res, next) => next(errors.rateLimited()) });
  const signedIn = requireUser({ directory, pool, clock, stage: 'any' });
  const now = () => clock.now().getTime();
  const accountById = (id) => directory.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  const actorOf = (a) => ({ id: a.user_id, role: a.role });
  const auditFor = (a) => pool.get(a.workplace_id)?.audit;
  const locked = (a) => Boolean(a.locked_until && a.locked_until > now());
  const lockedError = (a) => errors.accountLocked(new Date(a.locked_until));

  function methodsOf(a) {
    const m = [];
    if (directory.prepare('SELECT 1 FROM totp_credentials WHERE account_id = ? AND confirmed_at IS NOT NULL').get(a.id)) m.push('totp');
    if (a.email_enabled_at) m.push('email');
    if (directory.prepare('SELECT 1 FROM passkeys WHERE account_id = ?').get(a.id)) m.push('passkey');
    if (m.length && directory.prepare('SELECT 1 FROM recovery_codes WHERE account_id = ? AND used_at IS NULL').get(a.id)) m.push('recovery');
    return m;
  }
  // The account behind this session; Quick look sessions have none.
  function accountOf(req) {
    const a = req.session.accountId && accountById(req.session.accountId);
    if (!a) throw errors.forbidden('Quick look sessions have no sign-in settings.');
    return a;
  }
  // Adding a second step needs a full session, or a halfway session for an account that has none yet (first sign-up).
  // A password alone must never add a step to an account that already has one.
  const canSetup = (req, a) => req.session.stage === 'full' || methodsOf(a).length === 0;
  function setupAccount(req) {
    const a = accountOf(req);
    if (!canSetup(req, a)) throw errors.forbidden('Finish signing in before changing sign-in settings.');
    return a;
  }
  function issue(req, res, a, stage) {
    destroySession(directory, req.cookies?.careops_sid);
    const s = createSession(directory, { workplaceId: a.workplace_id, userId: a.user_id, accountId: a.id, stage }, clock);
    res.cookie('careops_sid', s.id, cookie);
    return { stage, csrfToken: s.csrf, username: a.username, role: a.role, methods: methodsOf(a) };
  }
  // After a step is added: a halfway session that now has a step becomes full.
  function afterSetup(req, res, a) {
    const fresh = accountById(a.id);
    return req.session.stage === 'halfway' ? issue(req, res, fresh, 'full') : { stage: 'full', methods: methodsOf(fresh) };
  }
  // A failed password or code counts toward the lockout; the fifth locks the account.
  function fail(a, kind) {
    const count = a.failed_count + 1;
    const lockedUntil = count >= MAX_FAILURES ? now() + LOCK_MS : null;
    directory.prepare('UPDATE accounts SET failed_count = ?, locked_until = ? WHERE id = ?').run(lockedUntil ? 0 : count, lockedUntil, a.id);
    auditFor(a)?.event({ actor: actorOf(a), kind, security: true });
    if (lockedUntil) auditFor(a)?.event({ actor: actorOf(a), kind: 'account_locked', security: true, detail: { until: new Date(lockedUntil).toISOString() } });
    return lockedUntil ? accountById(a.id) : null;
  }
  const succeed = (a) => directory.prepare('UPDATE accounts SET failed_count = 0, locked_until = NULL WHERE id = ?').run(a.id);

  r.post('/accounts', throttle, (req, res) => {
    const b = parseBody(Create, req.body);
    const username = b.username.toLowerCase();
    const problem = usernameProblem(username) ?? passwordProblem(b.password);
    if (problem) throw errors.invalid(problem);
    if (directory.prepare('SELECT 1 FROM accounts WHERE username = ?').get(username)) throw errors.usernameTaken();
    const key = ipKey(req.ip);
    if (directory.prepare('SELECT COUNT(*) n FROM creation_log WHERE ip_key = ? AND created_at > ?').get(key, now() - 3600_000).n >= config.creationsPerHour)
      throw errors.creationLimited(config.creationsPerHour);
    const w = createPrivateWorkplace({ directory, pool, dir: config.workplacesDir, clock, cap: config.privateWorkplaceCap, role: b.role, username });
    const id = randomBytes(16).toString('hex');
    directory.prepare('INSERT INTO accounts (id, username, workplace_id, user_id, role, password_hash, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, username, w.workplaceId, w.userId, b.role, bcrypt.hashSync(b.password, 10), now());
    directory.prepare('INSERT INTO creation_log (ip_key, created_at) VALUES (?,?)').run(key, now());
    const a = accountById(id);
    auditFor(a)?.event({ actor: actorOf(a), kind: 'account_created', detail: { role: a.role } });
    res.status(201).json(issue(req, res, a, 'halfway'));
  });

  r.post('/login', throttle, (req, res) => {
    const { username, password } = parseBody(Login, req.body);
    const a = directory.prepare('SELECT * FROM accounts WHERE username = ?').get(username.toLowerCase());
    if (a && locked(a)) throw lockedError(a); // tells a locked user why; reveals the name exists (accepted, spec 4.6)
    const ok = bcrypt.compareSync(password, a?.password_hash ?? DUMMY_HASH) && Boolean(a);
    if (!a) { logSecurity(directory, clock, 'login_failed_unknown_user', { username: username.slice(0, 64) }); throw errors.invalidCredentials(); }
    if (!ok) { const l = fail(a, 'login_failed'); throw l ? lockedError(l) : errors.invalidCredentials(); }
    auditFor(a)?.event({ actor: actorOf(a), kind: 'login_password_ok' });
    res.json(issue(req, res, a, 'halfway'));
  });

  r.get('/second-step', signedIn, (req, res) => {
    const a = accountOf(req);
    res.json({ stage: req.session.stage, username: a.username, role: a.role, methods: methodsOf(a), canSetup: canSetup(req, a), csrfToken: req.session.csrf });
  });

  r.post('/verify', throttle, signedIn, (req, res) => {
    const a = accountOf(req);
    if (req.session.stage === 'full') return res.json({ stage: 'full', methods: methodsOf(a) });
    if (locked(a)) throw lockedError(a);
    const { method, code } = parseBody(Verify, req.body);
    const ok = method === 'totp' ? useTotp(a, code)
      : method === 'email' ? verifyEmailCode({ directory, clock, accountId: a.id, purpose: 'signin', code })
      : useRecovery(a, code);
    if (!ok) {
      const l = fail(a, 'second_step_failed');
      if (l) { destroySession(directory, req.session.sessionId); throw lockedError(l); }
      throw errors.invalidCode();
    }
    succeed(a);
    auditFor(a)?.event({ actor: actorOf(a), kind: 'second_step_ok', detail: { method } });
    res.json(issue(req, res, accountById(a.id), 'full'));
  });
  function useTotp(a, code) {
    const t = directory.prepare('SELECT * FROM totp_credentials WHERE account_id = ? AND confirmed_at IS NOT NULL').get(a.id);
    if (!t) return false;
    const step = verifyTotp(decryptSecret(t.secret_enc, config.totpKey), code, now(), t.last_used_step);
    if (step === null) return false;
    directory.prepare('UPDATE totp_credentials SET last_used_step = ? WHERE account_id = ?').run(step, a.id);
    return true;
  }
  const useRecovery = (a, code) => directory.prepare('UPDATE recovery_codes SET used_at = ? WHERE account_id = ? AND code_hash = ? AND used_at IS NULL')
    .run(now(), a.id, hashRecoveryCode(code)).changes === 1;

  r.post('/email/send', throttle, signedIn, (req, res) => {
    const { purpose } = parseBody(Purpose, req.body);
    const a = purpose === 'enable' ? setupAccount(req) : accountOf(req);
    if (purpose === 'signin' && !a.email_enabled_at) throw errors.conflict('Emailed codes are not set up for this account.');
    if (purpose === 'enable' && a.email_enabled_at) throw errors.conflict('Emailed codes are already set up.');
    issueEmailCode({ directory, sender: mailbox, clock, accountId: a.id, purpose });
    res.status(204).end();
  });
  r.post('/email/confirm', signedIn, (req, res) => {
    const a = setupAccount(req);
    const { code } = parseBody(Code, req.body);
    if (!verifyEmailCode({ directory, clock, accountId: a.id, purpose: 'enable', code })) throw errors.invalidCode();
    directory.prepare('UPDATE accounts SET email_enabled_at = ? WHERE id = ?').run(now(), a.id);
    auditFor(a)?.event({ actor: actorOf(a), kind: 'second_step_added', detail: { method: 'email' } });
    res.json(afterSetup(req, res, a));
  });

  r.post('/totp/setup', signedIn, (req, res) => {
    const a = setupAccount(req);
    if (directory.prepare('SELECT 1 FROM totp_credentials WHERE account_id = ? AND confirmed_at IS NOT NULL').get(a.id)) throw errors.conflict('An authenticator app is already set up.');
    const secret = generateTotpSecret();
    directory.prepare(`INSERT INTO totp_credentials (account_id, secret_enc, last_used_step, created_at) VALUES (?,?,0,?)
      ON CONFLICT(account_id) DO UPDATE SET secret_enc = excluded.secret_enc, last_used_step = 0, created_at = excluded.created_at`).run(a.id, encryptSecret(secret, config.totpKey), now());
    const url = otpauthUrl({ secret, account: a.username });
    res.json({ secret, otpauthUrl: url, qr: qrDataUrl(url) });
  });
  r.post('/totp/confirm', signedIn, (req, res) => {
    const a = setupAccount(req);
    const t = directory.prepare('SELECT * FROM totp_credentials WHERE account_id = ? AND confirmed_at IS NULL').get(a.id);
    if (!t) throw errors.conflict('Start authenticator setup first.');
    const { code } = parseBody(Code, req.body);
    const step = verifyTotp(decryptSecret(t.secret_enc, config.totpKey), code, now(), t.last_used_step);
    if (step === null) throw errors.invalidCode();
    directory.prepare('UPDATE totp_credentials SET confirmed_at = ?, last_used_step = ? WHERE account_id = ?').run(now(), step, a.id);
    const recoveryCodes = generateRecoveryCodes(10);
    directory.prepare('DELETE FROM recovery_codes WHERE account_id = ?').run(a.id);
    const ins = directory.prepare('INSERT INTO recovery_codes (account_id, code_hash) VALUES (?,?)');
    for (const c of recoveryCodes) ins.run(a.id, hashRecoveryCode(c));
    auditFor(a)?.event({ actor: actorOf(a), kind: 'second_step_added', detail: { method: 'totp' } });
    res.json({ ...afterSetup(req, res, a), recoveryCodes });
  });

  r.post('/passkeys/register/options', signedIn, asyncHandler(async (req, res) => {
    const a = setupAccount(req);
    res.json(await startRegistration({ directory, config, clock, account: a }));
  }));
  r.post('/passkeys/register/verify', signedIn, asyncHandler(async (req, res) => {
    const a = setupAccount(req);
    const b = parseBody(PasskeyFinish, req.body);
    if (!(await finishRegistration({ directory, config, clock, account: a, challengeId: b.challengeId, response: b.response }))) throw errors.invalid('The passkey could not be verified. Try again.');
    auditFor(a)?.event({ actor: actorOf(a), kind: 'second_step_added', detail: { method: 'passkey' } });
    res.json(afterSetup(req, res, a));
  }));
  r.post('/passkeys/login/options', throttle, asyncHandler(async (req, res) => res.json(await startLogin({ directory, config, clock }))));
  r.post('/passkeys/login/verify', throttle, asyncHandler(async (req, res) => {
    const b = parseBody(PasskeyFinish, req.body);
    const accountId = await finishLogin({ directory, config, clock, challengeId: b.challengeId, response: b.response });
    const a = accountId && accountById(accountId);
    if (!a) { logSecurity(directory, clock, 'passkey_signin_failed', {}); throw errors.invalidCredentials(); }
    if (locked(a)) throw lockedError(a);
    succeed(a);
    auditFor(a)?.event({ actor: actorOf(a), kind: 'passkey_signin' });
    res.json(issue(req, res, a, 'full'));
  }));

  // The mailbox page polls every few seconds; reading it is not activity, so an open tab never holds a session open.
  const peek = requireUser({ directory, pool, clock, stage: 'any', touch: false });
  r.get('/mailbox', peek, (req, res) => res.json({ messages: listMailbox(directory, accountOf(req).id) }));
  return r;
}
```

- [ ] **Step 4: Mount the routes**

In `src/app.js`, add `import { accountRoutes } from './auth/accountRoutes.js';`. Add the line
```js
  app.use('/api/auth', accountRoutes({ directory, pool, clock, config }));
```
directly after the `authRoutes` line. It must stay before `app.use('/api', requireUser(...))`.

- [ ] **Step 5: Run the tests and see them pass**

Run: `node --test --test-force-exit tests/accounts.test.js`, then `npm test`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/auth/accountRoutes.js src/app.js tests/accounts.test.js
git commit -m "feat(signin): demo logins, second steps, lockout and the Demo mailbox API"
```

---

### Task 9: Isolation suite

This task proves that no request made in one workplace can read or change another, for every API route. A new route without a probe fails the suite.

**Files:**
- Create: `tests/isolation.test.js`

**Interfaces:**
- Consumes:
  - Task 7: `startTestApp` (returns `app`, `pool`, `directory`, `config`, `clock`), `sessionFor`.
  - Task 4: `createPrivateWorkplace`, `SEATS`.

- [ ] **Step 1: Write the suite**

`tests/isolation.test.js`:
```js
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

// Requests made as workplace A against identifiers that exist only in workplace B. The ids never contain the marker
// word (A's own audit log echoes the URLs A requested); only B's record contents do.
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
  db.prepare("INSERT INTO billing_tasks (id, claim_id, kind, note, created_by, created_at) VALUES ('bt_markerb', 'CLM-1001', 'PAYER_CALL', 'markerb note', 'u-marcus', '2026-10-06T14:00:00Z')").run();
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
```

- [ ] **Step 2: Run the suite**

Run: `node --test --test-force-exit tests/isolation.test.js`
Expected: PASS once Task 7 is in.
- An "unclassified route" failure means a route exists that the plan did not list. Add a probe for it, or justify a classification in a comment.
- A "returned another workplace's data" failure or a fingerprint failure is a real isolation bug. Report it; do not weaken the test.

- [ ] **Step 3: Commit**

```bash
git add tests/isolation.test.js
git commit -m "test(signin): isolation suite across private and shared workplaces"
```

---

### Task 10: Web pages

This task covers:
- the sign-in page (Sign in, Create a demo login, Quick look, and the safeguards panel);
- the second-step setup page;
- the verify page;
- the Demo mailbox;
- the app's account menu and idle warning.

**Files:**
- Modify: `web/index.html`, `web/app.html`, `web/js/api.js`, `web/js/app.js`, `web/js/views/login.js`, `web/css/app.css`
- Create: `web/setup.html`, `web/verify.html`, `web/mailbox.html`, `web/js/passkey.js`, `web/js/views/setup.js`, `web/js/views/verify.js`, `web/js/views/mailbox.js`, `web/js/views/session.js`

**Interfaces:**
- Consumes: Task 8's endpoints and their response shapes; Task 7's `/api/auth/me` `session` object.
- Produces: the element ids that Task 11 drives.

| Page | Element ids |
|---|---|
| sign-in (`/`) | `#signin-form`, `#signin-username`, `#signin-password`, `#signin-error`, `#signin-reason`, `#passkey-signin`, `#create-form`, `#create-username`, `#create-password`, `#create-role`, `#create-error` |
| setup | `#totp-start`, `#totp-secret`, `#totp-qr`, `#totp-code`, `#totp-form`, `#email-start`, `#email-form`, `#email-code`, `#passkey-add`, `#recovery`, `#recovery-codes`, `#recovery-done`, `#setup-error` |
| verify | `#verify-totp-form`, `#verify-totp-code`, `#verify-email-send`, `#verify-email-form`, `#verify-email-code`, `#verify-passkey-button`, `#verify-recovery` (a `<details>`), `#verify-recovery-form`, `#verify-recovery-code`, `#verify-error` |
| app | `#account-security`, `#session-left`, `#idle-dialog`, `#idle-left`, `#stay-signed-in` |

- [ ] **Step 1: Update the API client**

Replace `web/js/api.js` with:
```js
let csrfToken = null;

export async function api(path, { method = 'GET', body } = {}) {
  const verb = method.toUpperCase();
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (verb === 'POST' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  try {
    const response = await fetch(`/api${path}`, {
      method: verb, headers, credentials: 'same-origin', cache: 'no-store',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = response.status === 204 ? {} : await response.json().catch(() => null);
    if (response.status === 401) {
      csrfToken = null;
      // Signed out (idle, expired, or the halfway pass ran out): back to sign-in, saying why.
      if (location.pathname !== '/' && location.pathname !== '/index.html') location.replace(`/?reason=${encodeURIComponent(data?.error?.code ?? 'unauthenticated')}`);
    }
    if (!response.ok) {
      return { error: data?.error ?? { code: 'request_failed', message: 'The request could not be completed. Please try again.' } };
    }
    if (data === null) {
      return { error: { code: 'invalid_response', message: 'The server returned an unreadable response. Refresh this page to check the latest data.' } };
    }
    if (typeof data.csrfToken === 'string') csrfToken = data.csrfToken; // every sign-in step issues a new session and token
    if (path === '/auth/logout') csrfToken = null;
    window.dispatchEvent(new CustomEvent('careops:activity'));
    return data;
  } catch {
    return { error: { code: 'network_error', message: verb === 'POST'
      ? 'The connection was interrupted. The request may have reached the server. Check the latest data before trying again.'
      : 'Cannot reach CareOps right now. Check your connection and try again.' } };
  }
}

export const newKey = () => crypto.randomUUID();
```

- [ ] **Step 2: Add the passkey helper**

`web/js/passkey.js`:
```js
// Passkeys through the browser's own WebAuthn JSON helpers (no library on the page).
const unsupported = () => new Error('This browser cannot use passkeys here. Use an authenticator app or emailed codes instead.');

export async function createPasskey(options) {
  if (!window.PublicKeyCredential?.parseCreationOptionsFromJSON) throw unsupported();
  const credential = await navigator.credentials.create({ publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options) });
  return credential.toJSON();
}

export async function getPasskey(options) {
  if (!window.PublicKeyCredential?.parseRequestOptionsFromJSON) throw unsupported();
  const credential = await navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options) });
  return credential.toJSON();
}

export const passkeyError = (e) => (e?.name === 'NotAllowedError'
  ? 'The passkey request was cancelled or timed out.'
  : e?.message ?? 'The passkey did not work. Try another method.');

// The whole passkey sign-in: options, the device prompt, verification. Returns the API result or { error }.
export async function signInWithPasskey(api) {
  const start = await api('/auth/passkeys/login/options', { method: 'POST' });
  if (start.error) return start;
  let response;
  try { response = await getPasskey(start.options); } catch (e) { return { error: { message: passkeyError(e) } }; }
  return api('/auth/passkeys/login/verify', { method: 'POST', body: { challengeId: start.challengeId, response } });
}
```

- [ ] **Step 3: Rewrite the sign-in page**

Replace `web/index.html` with:
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Sign in · CareOps</title>
  <link rel="stylesheet" href="/css/app.css">
  <script type="module" src="/js/app.js"></script>
</head>
<body data-page="login">
  <div class="demo-banner">SYNTHETIC DEMO DATA — no real patients, employees, or PHI.</div>
  <header class="site-header"><a class="wordmark" href="/">Care<span>Ops</span></a><span class="header-note">A guided operations workspace</span></header>
  <main class="signin-layout" id="main">
    <section class="login-intro" aria-labelledby="welcome-title">
      <p class="eyebrow">CARE, WITH CLEAR BOUNDARIES</p>
      <h1 id="welcome-title">Everyday work.<br>Accountable AI.</h1>
      <p class="lead">Create your own demo login to try real sign-in: a second step, lockout after failed tries, and automatic logoff. Or take a quick look as one of four demo people.</p>
      <p id="signin-reason" class="notice" role="status" hidden></p>
    </section>
    <div class="signin-grid">
      <section class="card" aria-labelledby="signin-title">
        <h2 id="signin-title">Sign in</h2>
        <form id="signin-form" class="stack">
          <div><label for="signin-username">Username</label><input id="signin-username" name="username" autocomplete="username" required></div>
          <div><label for="signin-password">Password</label><input id="signin-password" name="password" type="password" autocomplete="current-password" required></div>
          <p id="signin-error" class="notice error" role="alert" hidden></p>
          <button class="button" type="submit">Sign in</button>
        </form>
        <button id="passkey-signin" class="button secondary passkey-button" type="button">Sign in with a passkey</button>
      </section>
      <section class="card" aria-labelledby="create-title">
        <h2 id="create-title">Create a demo login</h2>
        <p class="small muted">You get a private copy of the fictional workplace for 24 hours. Don't use your real name or a password you use elsewhere.</p>
        <form id="create-form" class="stack">
          <div><label for="create-username">Username</label><input id="create-username" name="username" autocomplete="username" minlength="3" maxlength="32" pattern="[A-Za-z0-9_]{3,32}" required><span class="small muted">3 to 32 letters, numbers or underscores.</span></div>
          <div><label for="create-password">Password</label><input id="create-password" name="password" type="password" autocomplete="new-password" minlength="12" maxlength="200" required><span class="small muted">At least 12 characters.</span></div>
          <div><label for="create-role">Role</label><select id="create-role" name="role"><option value="employee">Employee</option><option value="manager">Manager</option><option value="billing">Billing Specialist</option><option value="admin">Compliance Admin</option></select></div>
          <p id="create-error" class="notice error" role="alert" hidden></p>
          <button class="button" type="submit">Create login</button>
        </form>
      </section>
      <section class="card persona-card" aria-labelledby="persona-title">
        <p class="eyebrow">QUICK LOOK — SKIPS SIGN-IN</p>
        <h2 id="persona-title">The shared demo workplace</h2>
        <div class="account-list">
          <button class="account-row persona-row" type="button" data-persona="jordan"><span><strong>Enter as Jordan</strong><span class="pill">Employee</span></span><span>Benefits • PTO • Employee policies</span></button>
          <button class="account-row persona-row" type="button" data-persona="priya"><span><strong>Enter as Priya</strong><span class="pill">Manager</span></span><span>Team PTO • Staffing • Approvals</span></button>
          <button class="account-row persona-row" type="button" data-persona="marcus"><span><strong>Enter as Marcus</strong><span class="pill">Billing Specialist</span></span><span>Claims • Denials • Payer rules • Follow-up</span></button>
          <button class="account-row persona-row" type="button" data-persona="dana"><span><strong>Enter as Dana</strong><span class="pill">Compliance Admin</span></span><span>Audit • Security events • Policy outcomes</span></button>
        </div>
        <p id="persona-error" class="notice error" role="alert" hidden></p>
        <p class="small muted">Quick look skips sign-in and shares one workplace with every visitor. Identity and permissions are still enforced by the server.</p>
      </section>
    </div>
    <section class="card hipaa-panel" aria-labelledby="hipaa-title">
      <h2 id="hipaa-title">HIPAA-style safeguards in this demo</h2>
      <div class="table-scroll"><table>
        <thead><tr><th>Safeguard (45 CFR 164.312)</th><th>In this demo</th></tr></thead>
        <tbody>
          <tr><td>Unique user identification</td><td>Every visitor has their own login.</td></tr>
          <tr><td>Automatic logoff</td><td>Signed out after 15 idle minutes, with a warning first.</td></tr>
          <tr><td>Person or entity authentication</td><td>A required second step: authenticator app, emailed code or passkey.</td></tr>
          <tr><td>Audit controls</td><td>Sign-ins, failures, lockouts and logoffs are recorded.</td></tr>
          <tr><td>Access control</td><td>Role permissions, and a private workplace per login.</td></tr>
        </tbody>
      </table></div>
      <p class="small muted">These are HIPAA-style safeguards shown on synthetic data. A real deployment also needs a signed BAA with every vendor that touches PHI, a risk analysis, policies and training. Software alone is never "HIPAA compliant".</p>
    </section>
  </main>
  <noscript><p class="notice">Enable JavaScript to sign in and use CareOps.</p></noscript>
</body>
</html>
```

Replace `web/js/views/login.js` with:
```js
import { api } from '../api.js';
import { busy, message } from './shared.js';
import { signInWithPasskey } from '../passkey.js';

const REASONS = {
  session_idle: 'You were signed out after 15 minutes without activity.',
  signin_timed_out: 'Sign-in timed out. Please start again.',
  second_step_required: 'Finish signing in with your second step.',
  unauthenticated: 'Please sign in.',
};
// After the password: straight in, the second step, or (a new login with none yet) its setup.
const next = (r) => location.assign(r.stage === 'full' ? '/app.html' : r.methods.length ? '/verify.html' : '/setup.html');

export function login() {
  const reason = new URLSearchParams(location.search).get('reason');
  if (REASONS[reason]) message(document.querySelector('#signin-reason'), REASONS[reason]);
  form('#signin-form', '#signin-error', 'Signing in…', (f) => api('/auth/login', { method: 'POST', body: { username: f.elements.username.value.trim(), password: f.elements.password.value } }));
  form('#create-form', '#create-error', 'Creating your workplace…', (f) => api('/auth/accounts', { method: 'POST', body: { username: f.elements.username.value.trim(), password: f.elements.password.value, role: f.elements.role.value } }));
  const passkey = document.querySelector('#passkey-signin');
  passkey.addEventListener('click', async () => {
    const error = document.querySelector('#signin-error');
    busy(passkey, true, 'Waiting for your passkey…'); message(error, '');
    const result = await signInWithPasskey(api);
    busy(passkey, false);
    if (result.error) message(error, result.error.message); else location.assign('/app.html');
  });
  personas();
}

function form(selector, errorSelector, busyLabel, send) {
  const f = document.querySelector(selector);
  const error = document.querySelector(errorSelector);
  const submit = f.querySelector('[type="submit"]');
  f.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    busy(submit, true, busyLabel); message(error, '');
    const result = await send(f);
    if (result.error) { message(error, result.error.message); busy(submit, false); } else next(result);
  });
}

function personas() {
  const personaError = document.querySelector('#persona-error');
  const rows = [...document.querySelectorAll('[data-persona]')];
  for (const row of rows) {
    row.addEventListener('click', async () => {
      if (row.disabled) return;
      for (const other of rows) other.disabled = true;
      row.classList.add('is-busy'); message(personaError, '');
      const result = await api('/auth/demo', { method: 'POST', body: { persona: row.dataset.persona } });
      if (result.error) { message(personaError, result.error.message); for (const other of rows) other.disabled = false; row.classList.remove('is-busy'); }
      else location.assign('/app.html');
    });
  }
}
```

- [ ] **Step 4: Add the setup, verify and mailbox pages**

The three pages share one head and banner.

`web/setup.html`:
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Second step · CareOps</title>
  <link rel="stylesheet" href="/css/app.css">
  <script type="module" src="/js/app.js"></script>
</head>
<body data-page="setup">
  <div class="demo-banner">SYNTHETIC DEMO DATA — no real patients, employees, or PHI.</div>
  <header class="site-header"><a class="wordmark" href="/">Care<span>Ops</span></a><span class="header-note">Sign-in settings</span></header>
  <main class="setup-layout" id="main">
    <h1>Set up your second step</h1>
    <p class="lead">Signing in needs your password and one of these. Set up at least one.</p>
    <p id="setup-error" class="notice error" role="alert" hidden></p>
    <p id="setup-done" class="notice" role="status" hidden></p>
    <div class="method-grid">
      <section class="card method-card" id="method-totp" aria-labelledby="totp-title">
        <h2 id="totp-title">Authenticator app</h2>
        <p>Google Authenticator, Microsoft Authenticator, 1Password and others.</p>
        <button id="totp-start" class="button" type="button">Set up an authenticator app</button>
        <div id="totp-panel" class="stack" hidden>
          <img id="totp-qr" alt="QR code to scan with your authenticator app" width="200" height="200">
          <p class="small">Or type this key: <code id="totp-secret"></code></p>
          <form id="totp-form" class="stack"><label for="totp-code">The 6-digit code your app shows</label><input id="totp-code" inputmode="numeric" autocomplete="one-time-code" required><button class="button" type="submit">Confirm</button></form>
        </div>
      </section>
      <section class="card method-card" id="method-email" aria-labelledby="email-title">
        <h2 id="email-title">Emailed codes</h2>
        <p>A code at each sign-in. In this demo, emails land in your <a href="/mailbox.html" target="_blank" rel="noopener">Demo mailbox</a>.</p>
        <button id="email-start" class="button" type="button">Send a code to my Demo mailbox</button>
        <form id="email-form" class="stack" hidden><label for="email-code">The 6-digit code from the Demo mailbox</label><input id="email-code" inputmode="numeric" autocomplete="one-time-code" required><button class="button" type="submit">Confirm</button></form>
      </section>
      <section class="card method-card" id="method-passkey" aria-labelledby="passkey-title">
        <h2 id="passkey-title">Passkey</h2>
        <p>Face ID, Touch ID, Windows Hello or your phone's screen lock. Nothing to install.</p>
        <button id="passkey-add" class="button" type="button">Add a passkey</button>
      </section>
    </div>
    <section id="recovery" class="card" aria-labelledby="recovery-title" hidden>
      <h2 id="recovery-title">Your recovery codes</h2>
      <p>Each code signs you in once if you lose your authenticator app. They are shown only now: copy them somewhere safe.</p>
      <ol id="recovery-codes" class="recovery-list"></ol>
      <a class="button" href="/app.html" id="recovery-done">I've saved these — continue</a>
    </section>
    <p><a href="/app.html">Back to your workspace</a></p>
  </main>
</body>
</html>
```

`web/verify.html`:
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Finish signing in · CareOps</title>
  <link rel="stylesheet" href="/css/app.css">
  <script type="module" src="/js/app.js"></script>
</head>
<body data-page="verify">
  <div class="demo-banner">SYNTHETIC DEMO DATA — no real patients, employees, or PHI.</div>
  <header class="site-header"><a class="wordmark" href="/">Care<span>Ops</span></a><span class="header-note">Sign in</span></header>
  <main class="setup-layout" id="main">
    <h1>Finish signing in</h1>
    <p class="lead">Password accepted for <strong id="verify-user"></strong>. One more step.</p>
    <p id="verify-error" class="notice error" role="alert" hidden></p>
    <div class="method-grid">
      <section class="card method-card" id="verify-totp" aria-labelledby="vt-title" hidden>
        <h2 id="vt-title">Authenticator app</h2>
        <form id="verify-totp-form" class="stack"><label for="verify-totp-code">The 6-digit code your app shows</label><input id="verify-totp-code" inputmode="numeric" autocomplete="one-time-code" required><button class="button" type="submit">Verify</button></form>
      </section>
      <section class="card method-card" id="verify-email" aria-labelledby="ve-title" hidden>
        <h2 id="ve-title">Emailed code</h2>
        <button id="verify-email-send" class="button secondary" type="button">Send a code to my Demo mailbox</button>
        <p class="small"><a href="/mailbox.html" target="_blank" rel="noopener">Open the Demo mailbox</a></p>
        <form id="verify-email-form" class="stack"><label for="verify-email-code">The 6-digit code</label><input id="verify-email-code" inputmode="numeric" autocomplete="one-time-code" required><button class="button" type="submit">Verify</button></form>
      </section>
      <section class="card method-card" id="verify-passkey" aria-labelledby="vp-title" hidden>
        <h2 id="vp-title">Passkey</h2>
        <button id="verify-passkey-button" class="button" type="button">Use my passkey</button>
      </section>
    </div>
    <details id="verify-recovery" class="card" hidden>
      <summary>Use a recovery code</summary>
      <form id="verify-recovery-form" class="stack"><label for="verify-recovery-code">Recovery code</label><input id="verify-recovery-code" autocomplete="off" required><button class="button secondary" type="submit">Verify</button></form>
    </details>
    <p><a href="/">Start again</a></p>
  </main>
</body>
</html>
```

`web/mailbox.html`:
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Demo mailbox · CareOps</title>
  <link rel="stylesheet" href="/css/app.css">
  <script type="module" src="/js/app.js"></script>
</head>
<body data-page="mailbox">
  <div class="demo-banner">SYNTHETIC DEMO DATA — no real patients, employees, or PHI.</div>
  <header class="site-header"><a class="wordmark" href="/">Care<span>Ops</span></a><span class="header-note">Demo mailbox</span></header>
  <main class="setup-layout" id="main">
    <p class="eyebrow">DEMO MAILBOX</p>
    <h1>Your Demo mailbox</h1>
    <p class="notice">In a real deployment, this is your email inbox. This demo sends no real email.</p>
    <p id="mailbox-error" class="notice error" role="alert" hidden></p>
    <ol id="mailbox-list" class="mailbox-list" aria-live="polite"></ol>
  </main>
</body>
</html>
```

`web/js/views/setup.js`:
```js
import { api } from '../api.js';
import { el, message } from './shared.js';
import { createPasskey, passkeyError } from '../passkey.js';

export async function setup() {
  const error = document.querySelector('#setup-error');
  const state = await api('/auth/second-step');
  if (state.error) { message(error, state.error.message); return; }
  if (!state.canSetup) { location.replace('/verify.html'); return; }
  let stage = state.stage;
  const mark = (id) => {
    const card = document.querySelector(`#method-${id}`);
    if (!card || card.classList.contains('is-done')) return;
    card.classList.add('is-done');
    card.querySelectorAll('button, form, #totp-panel').forEach(n => { n.hidden = true; });
    card.append(el('p', { class: 'notice' }, 'Set up.'));
  };
  state.methods.forEach(mark);
  const finished = (result, method) => {
    mark(method);
    const wasHalfway = stage === 'halfway';
    stage = result.stage;
    if (result.recoveryCodes) {
      document.querySelector('#recovery-codes').replaceChildren(...result.recoveryCodes.map(c => el('li', {}, el('code', {}, `${c.slice(0, 5)}-${c.slice(5)}`))));
      document.querySelector('#recovery').hidden = false;
      document.querySelector('#recovery-done').focus();
    } else if (wasHalfway) location.assign('/app.html');
    else message(document.querySelector('#setup-done'), 'Added. You can add another, or go back to your workspace.');
  };
  const run = async (fn) => { message(error, ''); const r = await fn(); if (r?.error) message(error, r.error.message); return r; };

  document.querySelector('#totp-start').addEventListener('click', () => run(async () => {
    const r = await api('/auth/totp/setup', { method: 'POST' });
    if (r.error) return r;
    document.querySelector('#totp-qr').src = r.qr;
    document.querySelector('#totp-secret').textContent = r.secret;
    document.querySelector('#totp-panel').hidden = false;
    document.querySelector('#totp-start').hidden = true;
    document.querySelector('#totp-code').focus();
    return r;
  }));
  document.querySelector('#totp-form').addEventListener('submit', (e) => { e.preventDefault(); run(async () => {
    const r = await api('/auth/totp/confirm', { method: 'POST', body: { code: document.querySelector('#totp-code').value } });
    if (!r.error) finished(r, 'totp');
    return r;
  }); });
  document.querySelector('#email-start').addEventListener('click', () => run(async () => {
    const r = await api('/auth/email/send', { method: 'POST', body: { purpose: 'enable' } });
    if (!r.error) { document.querySelector('#email-form').hidden = false; document.querySelector('#email-code').focus(); }
    return r;
  }));
  document.querySelector('#email-form').addEventListener('submit', (e) => { e.preventDefault(); run(async () => {
    const r = await api('/auth/email/confirm', { method: 'POST', body: { code: document.querySelector('#email-code').value } });
    if (!r.error) finished(r, 'email');
    return r;
  }); });
  document.querySelector('#passkey-add').addEventListener('click', () => run(async () => {
    const start = await api('/auth/passkeys/register/options', { method: 'POST' });
    if (start.error) return start;
    let response;
    try { response = await createPasskey(start.options); } catch (e) { return { error: { message: passkeyError(e) } }; }
    const r = await api('/auth/passkeys/register/verify', { method: 'POST', body: { challengeId: start.challengeId, response } });
    if (!r.error) finished(r, 'passkey');
    return r;
  }));
}
```

`web/js/views/verify.js`:
```js
import { api } from '../api.js';
import { message } from './shared.js';
import { signInWithPasskey } from '../passkey.js';

export async function verify() {
  const error = document.querySelector('#verify-error');
  const state = await api('/auth/second-step');
  if (state.error) { message(error, state.error.message); return; }
  if (state.stage === 'full') { location.replace('/app.html'); return; }
  if (!state.methods.length) { location.replace('/setup.html'); return; }
  document.querySelector('#verify-user').textContent = state.username;
  for (const m of state.methods) { const node = document.querySelector(`#verify-${m}`); if (node) node.hidden = false; }
  const submit = (method, input) => async (e) => {
    e.preventDefault(); message(error, '');
    const r = await api('/auth/verify', { method: 'POST', body: { method, code: input.value } });
    if (r.error) { message(error, r.error.message); input.select(); } else location.assign('/app.html');
  };
  document.querySelector('#verify-totp-form').addEventListener('submit', submit('totp', document.querySelector('#verify-totp-code')));
  document.querySelector('#verify-email-form').addEventListener('submit', submit('email', document.querySelector('#verify-email-code')));
  document.querySelector('#verify-recovery-form').addEventListener('submit', submit('recovery', document.querySelector('#verify-recovery-code')));
  document.querySelector('#verify-email-send').addEventListener('click', async () => {
    const r = await api('/auth/email/send', { method: 'POST', body: { purpose: 'signin' } });
    message(error, r.error ? r.error.message : '');
  });
  document.querySelector('#verify-passkey-button').addEventListener('click', async () => {
    message(error, '');
    const r = await signInWithPasskey(api);
    if (r.error) message(error, r.error.message); else location.assign('/app.html');
  });
}
```

`web/js/views/mailbox.js`:
```js
import { api } from '../api.js';
import { el, message, timestamp } from './shared.js';

// Reading the mailbox is not activity (the server does not count it), so this page can poll.
export function mailbox() {
  const list = document.querySelector('#mailbox-list');
  const error = document.querySelector('#mailbox-error');
  async function load() {
    const r = await api('/auth/mailbox');
    if (r.error) { message(error, r.error.message); return; }
    list.replaceChildren(...(r.messages.length
      ? r.messages.map(m => el('li', { class: 'card mail' }, el('p', { class: 'small muted' }, timestamp(m.at)), el('h2', {}, m.subject), el('p', {}, m.body)))
      : [el('li', { class: 'muted' }, 'No messages yet.')]));
  }
  load();
  setInterval(load, 5000);
}
```

- [ ] **Step 5: Account menu and idle warning in the app**

In `web/app.html`, replace the `<div class="identity" ...>` line with:
```html
    <div class="identity" id="identity" hidden><span id="user-name"></span><span class="pill role-badge" id="user-role"></span><span id="session-left" class="small muted"></span><a id="account-security" class="button quiet" href="/setup.html" hidden>Sign-in settings</a><button class="button quiet" id="logout" type="button">Sign out</button></div>
```
Before `<noscript>`, add:
```html
  <dialog id="idle-dialog" class="idle-dialog" aria-labelledby="idle-title">
    <h2 id="idle-title">Still there?</h2>
    <p>For safety, you'll be signed out in <strong id="idle-left"></strong> without activity.</p>
    <button id="stay-signed-in" class="button" type="button">Stay signed in</button>
  </dialog>
```
The logout button keeps its `#logout` id. The text changes from "Logout" to "Sign out". Before making that change, check `e2e/demo.spec.js` for a `'Logout'` text selector. If it uses one, keep the text "Logout".

`web/js/views/session.js`:
```js
import { api } from '../api.js';

// Automatic logoff in the page: warns 2 minutes before the server's 15-minute idle limit, and shows the time left.
// Any successful API call is activity (api.js fires careops:activity); "Stay signed in" pings the server.
export function startSessionTimer(session) {
  const idleMs = session.idleTimeoutMs;
  const warnMs = idleMs - 2 * 60_000;
  const dialog = document.querySelector('#idle-dialog');
  const left = document.querySelector('#idle-left');
  const label = document.querySelector('#session-left');
  let last = Date.now();
  window.addEventListener('careops:activity', () => { last = Date.now(); if (dialog.open) dialog.close(); });
  document.querySelector('#stay-signed-in').addEventListener('click', () => api('/auth/ping', { method: 'POST' }));
  const tick = () => {
    const idleFor = Date.now() - last;
    const remaining = Math.max(0, idleMs - idleFor);
    label.textContent = `Auto sign-out in ${Math.ceil(remaining / 60_000)} min`;
    if (idleFor >= warnMs && !dialog.open) dialog.showModal();
    if (dialog.open) left.textContent = `${Math.ceil(remaining / 1000)} seconds`;
    if (remaining === 0) location.replace('/?reason=session_idle');
  };
  tick();
  setInterval(tick, 1000);
}
```

In `web/js/app.js`:
1. Add the imports:
```js
import { setup } from './views/setup.js';
import { verify } from './views/verify.js';
import { mailbox } from './views/mailbox.js';
import { startSessionTimer } from './views/session.js';
```
2. In `workspace()`, after `document.querySelector('#identity').hidden = false;`, add:
```js
  if (result.session?.accountSession) document.querySelector('#account-security').hidden = false;
  if (result.session) startSessionTimer(result.session);
```
3. Replace the last two lines of the file with:
```js
const pages = { login, setup, verify, mailbox };
(pages[document.body.dataset.page] ?? workspace)();
```

- [ ] **Step 6: Styles**

Append to `web/css/app.css`:
```css
/* Sign-in redesign: three panels, setup and verify cards, recovery codes, the Demo mailbox, the idle warning. */
.signin-layout { max-width: 1180px; margin: 0 auto; padding: 32px 16px 56px; display: grid; gap: 24px; }
.signin-grid { display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); align-items: start; }
.passkey-button { margin-top: 12px; width: 100%; }
.hipaa-panel table { width: 100%; border-collapse: collapse; }
.hipaa-panel th, .hipaa-panel td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line, #d9dee3); vertical-align: top; }
.table-scroll { overflow-x: auto; }
.setup-layout { max-width: 1000px; margin: 0 auto; padding: 32px 16px 56px; display: grid; gap: 20px; }
.method-grid { display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); align-items: start; }
.method-card.is-done { opacity: .75; }
.method-card img { display: block; max-width: 200px; height: auto; background: #fff; }
.recovery-list { columns: 2; padding-left: 20px; font-size: 1.05rem; }
.recovery-list code { letter-spacing: .04em; }
.mailbox-list { list-style: none; padding: 0; display: grid; gap: 12px; }
.mailbox-list .mail h2 { font-size: 1.05rem; margin: 4px 0; }
.idle-dialog { max-width: 420px; border: 0; border-radius: 12px; padding: 24px; }
.idle-dialog::backdrop { background: rgb(0 0 0 / .45); }
@media (max-width: 560px) { .recovery-list { columns: 1; } }
```
Check the variable names in `web/css/app.css` first. If the file defines its line colour under another custom property, use that name instead of `--line`.

- [ ] **Step 7: Check in a browser**

Run: `npm test` (expected: PASS; the server tests are unaffected).

Then start the server locally:
```bash
DB_PATH=/tmp/careops-ui/careops.db TOTP_KEY=$(node -e "console.log(Buffer.alloc(32,9).toString('base64'))") PUBLIC_ORIGIN=http://localhost:3000 KB_URL=http://127.0.0.1:9 node src/main.js
```
Open http://localhost:3000. Then:
1. Create a login.
2. Set up an authenticator, using any authenticator app, or compute the code with `node -e "import('./src/auth/totp.js').then(m=>console.log(m.totpAt('<secret>', Date.now())))"`.
3. Sign out, and sign back in.
4. Open the Demo mailbox after choosing emailed codes.
5. Check that the page has no horizontal scroll at 375 px width.

Stop the server and delete `/tmp/careops-ui` afterwards.

- [ ] **Step 8: Commit**

```bash
git add web
git commit -m "feat(signin): sign-in, setup, verify and Demo mailbox pages; idle warning"
```

---

### Task 11: Real-browser test

**Files:**
- Create: `src/routes/testClock.js`, `playwright.signin.config.js`, `e2e/signin.spec.js`, `tests/testClock.test.js`
- Modify: `src/util/clock.js`, `src/app.js`, `src/main.js`, `package.json` (script only)

**Interfaces:**
- Consumes: Task 10's element ids; Task 1's `config.testClock`.
- Produces:
  - `adjustableClock() → { now(), advance(ms) }`.
  - `GET /api/test/clock` and `POST /api/test/clock/advance { ms }`. These are mounted only when `config.testClock` is true and the clock can advance, which never happens in production.
  - The npm script `e2e:signin`.

- [ ] **Step 1: Write the failing unit test**

`tests/testClock.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from './helpers.js';
import { adjustableClock } from '../src/util/clock.js';

test('adjustableClock moves forward by the amount asked', () => {
  const c = adjustableClock();
  const before = c.now().getTime();
  c.advance(60_000);
  assert.ok(c.now().getTime() - before >= 60_000);
});

test('the test clock routes exist only when testClock is on', async (t) => {
  const off = await startTestApp(); t.after(off.close);
  assert.notEqual((await fetch(`${off.base}/api/test/clock`)).status, 200);
  const on = await startTestApp({ clock: adjustableClock(), config: { testClock: true } }); t.after(on.close);
  const before = Date.parse((await (await fetch(`${on.base}/api/test/clock`)).json()).now);
  const r = await fetch(`${on.base}/api/test/clock/advance`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ms: 3_600_000 }) });
  assert.ok(Date.parse((await r.json()).now) - before >= 3_600_000);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test --test-force-exit tests/testClock.test.js`
Expected: FAIL. `adjustableClock` is not exported yet.

- [ ] **Step 3: Implement the clock and its routes**

Append to `src/util/clock.js`:
```js
// The real-browser test's clock: real time plus an offset the test moves forward (CAREOPS_TEST_CLOCK=1, never production).
export function adjustableClock() {
  let offset = 0;
  return { now: () => new Date(Date.now() + offset), advance: (ms) => { offset += ms; } };
}
```

`src/routes/testClock.js`:
```js
import { Router } from 'express';
import { z } from 'zod';
import { parseBody } from '../http/middleware.js';

const Advance = z.object({ ms: z.number().int().min(0).max(48 * 3600_000) }).strict();

export function testClockRoutes({ clock }) {
  const r = Router();
  r.get('/clock', (req, res) => res.json({ now: clock.now().toISOString() }));
  r.post('/clock/advance', (req, res) => { clock.advance(parseBody(Advance, req.body).ms); res.json({ now: clock.now().toISOString() }); });
  return r;
}
```

In `src/app.js`:
1. Add `import { testClockRoutes } from './routes/testClock.js';`.
2. Directly after the `accountRoutes` line, add:
```js
  if (config.testClock && typeof clock.advance === 'function') app.use('/api/test', testClockRoutes({ clock }));
```

In `src/main.js`:
1. Import `adjustableClock` alongside `systemClock`.
2. After the TOTP key check, add `const clock = config.testClock ? adjustableClock() : systemClock;`.
3. Use `clock` in place of `systemClock` in the seed, `openDirectory`, `createApp` and `startCleanup` calls.

- [ ] **Step 4: Run the unit test and see it pass**

Run: `node --test --test-force-exit tests/testClock.test.js`, then `npm test`.
Expected: PASS.

- [ ] **Step 5: Write the browser config and spec**

`playwright.signin.config.js`:
```js
import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// A throwaway local server with the adjustable clock; never the shared demo.
const data = mkdtempSync(join(tmpdir(), 'careops-e2e-'));
const PORT = 3107;
export default defineConfig({
  testDir: './e2e',
  testMatch: 'signin.spec.js',
  timeout: 90_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, viewport: { width: 1280, height: 860 }, trace: 'retain-on-failure' },
  webServer: {
    command: 'node src/main.js',
    url: `http://localhost:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { PORT: String(PORT), DB_PATH: join(data, 'careops.db'), CAREOPS_TEST_CLOCK: '1', TOTP_KEY: Buffer.alloc(32, 9).toString('base64'),
      PUBLIC_HOST: 'localhost', PUBLIC_ORIGIN: `http://localhost:${PORT}`, OPENROUTER_API_KEY: '', KB_URL: 'http://127.0.0.1:9', KB_API_KEY: 'e2e', CREATIONS_PER_HOUR: '50' },
  },
});
```

`e2e/signin.spec.js`:
```js
import { test, expect } from '@playwright/test';
import { totpAt } from '../src/auth/totp.js';

const PW = 'correct horse battery';
let n = 0;
const uniq = (p) => `${p}_${Date.now().toString(36)}${n++}`;
const serverNow = async (request) => Date.parse((await (await request.get('/api/test/clock')).json()).now);
const advance = (request, ms) => request.post('/api/test/clock/advance', { data: { ms } });

async function createLogin(page, username, role = 'employee') {
  await page.goto('/');
  await page.fill('#create-username', username);
  await page.fill('#create-password', PW);
  await page.selectOption('#create-role', role);
  await page.click('#create-form [type=submit]');
  await expect(page).toHaveURL(/\/setup(\.html)?$/);
}
async function setUpAuthenticator(page) {
  await page.click('#totp-start');
  const secret = (await page.textContent('#totp-secret')).trim();
  await page.fill('#totp-code', totpAt(secret, await serverNow(page.request)));
  await page.click('#totp-form [type=submit]');
  await expect(page.locator('#recovery')).toBeVisible();
  const codes = await page.locator('#recovery-codes code').allTextContents();
  await page.click('#recovery-done');
  await expect(page).toHaveURL(/\/app\.html/);
  return { secret, codes };
}
async function signOut(page) {
  await page.click('#logout');
  await expect(page.locator('#signin-form')).toBeVisible();
}
async function passwordStep(page, username, password = PW) {
  await page.goto('/');
  await page.fill('#signin-username', username);
  await page.fill('#signin-password', password);
  await page.click('#signin-form [type=submit]');
}

test('create a login, set up an authenticator, then sign back in with a code and with a recovery code', async ({ page }) => {
  const username = uniq('ava');
  await createLogin(page, username);
  const { secret, codes } = await setUpAuthenticator(page);
  await expect(page.locator('#user-name')).toHaveText(username);
  await signOut(page);
  await advance(page.request, 30_000); // the setup code's time step is spent; use the next one
  await passwordStep(page, username);
  await expect(page).toHaveURL(/\/verify(\.html)?$/);
  await page.fill('#verify-totp-code', totpAt(secret, await serverNow(page.request)));
  await page.click('#verify-totp-form [type=submit]');
  await expect(page).toHaveURL(/\/app\.html/);
  await signOut(page);
  await passwordStep(page, username);
  await expect(page).toHaveURL(/\/verify(\.html)?$/);
  await page.click('#verify-recovery summary');
  await page.fill('#verify-recovery-code', codes[0]);
  await page.click('#verify-recovery-form [type=submit]');
  await expect(page).toHaveURL(/\/app\.html/);
});

test('five wrong passwords lock the account and say until when', async ({ page }) => {
  const username = uniq('lee');
  await createLogin(page, username);
  await setUpAuthenticator(page);
  await signOut(page);
  for (let i = 0; i < 5; i += 1) {
    await passwordStep(page, username, 'wrong password!!');
    await expect(page.locator('#signin-error')).toBeVisible();
  }
  await expect(page.locator('#signin-error')).toContainText('Account locked; try again at');
});

test('the page warns at 13 idle minutes, and 15 idle minutes sign the visitor out', async ({ page }) => {
  await page.clock.install();
  const username = uniq('ida');
  await createLogin(page, username);
  await setUpAuthenticator(page);
  await page.clock.fastForward('13:05');
  await expect(page.locator('#idle-dialog')).toBeVisible();
  await advance(page.request, 16 * 60_000); // the server has now seen 16 idle minutes
  await page.click('#stay-signed-in');      // too late: the server ends the session
  await expect(page).toHaveURL(/reason=session_idle/);
  await expect(page.locator('#signin-reason')).toContainText('15 minutes without activity');
});

test('add a passkey at sign-up, then sign in with the passkey alone', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  const username = uniq('pia');
  await createLogin(page, username, 'billing');
  await page.click('#passkey-add');
  await expect(page).toHaveURL(/\/app\.html/);
  await signOut(page);
  await page.click('#passkey-signin');
  await expect(page).toHaveURL(/\/app\.html/);
  await expect(page.locator('#user-name')).toHaveText(username);
});
```

Workplace isolation is proven route by route in Task 9's suite, not here.

- [ ] **Step 6: Add the script and run the browser tests**

In `package.json` `scripts`, add `"e2e:signin": "playwright test -c playwright.signin.config.js"`.

Run: `npx playwright install chromium` (once), then `npm run e2e:signin`.
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/util/clock.js src/routes/testClock.js src/app.js src/main.js playwright.signin.config.js e2e/signin.spec.js tests/testClock.test.js package.json
git commit -m "test(signin): real-browser sign-in tests with an adjustable clock"
```

---

### Task 12: Docs

**Files:**
- Modify: `README.md`, `docs/API.md`, `.env.example`, `DEMO_ACCOUNTS.md`

- [ ] **Step 1: `.env.example`**

Add these lines, keeping the existing ones:
```
# 32 random bytes, base64: openssl rand -base64 32 (required in production; encrypts authenticator secrets)
TOTP_KEY=
# passkeys: the site's host and origin (PUBLIC_HOST is already set above)
PUBLIC_ORIGIN=https://careops.shawndemos.com
# demo logins
PRIVATE_WORKPLACE_CAP=200
CREATIONS_PER_HOUR=3
```

- [ ] **Step 2: README section**

Add a section `## Real sign-in and HIPAA-style safeguards` after the README's feature overview. It contains:
1. The table from the sign-in page's safeguards panel (Task 10, Step 3), word for word.
2. The paragraph: "These are HIPAA-style safeguards shown on synthetic data. A real deployment also needs a signed BAA with every vendor that touches PHI, a risk analysis, policies and training. Software alone is never 'HIPAA compliant'."
3. A short list:
   - "Each demo login gets a private copy of the workplace in its own database file, deleted after 24 hours.";
   - "Second steps: authenticator app (RFC 6238), emailed code (to a labelled Demo mailbox in this demo), recovery codes, passkeys (WebAuthn).";
   - "5 failures lock an account for 15 minutes; 15 idle minutes sign you out; every session ends after 8 hours.";
   - "An isolation test calls every API route from one workplace against another's records."
4. Under credits: `Common-password list: SecLists 10k-most-common (MIT).`

- [ ] **Step 3: API reference**

In `docs/API.md`, add an "Accounts and sign-in" section. It lists every endpoint in the table in Task 8's Interfaces, plus `GET /api/auth/me` (now with `session`), `POST /api/auth/ping` and `POST /api/auth/demo` (Quick look). It also lists the error codes:
- `account_locked` (423);
- `second_step_required` (401);
- `session_idle` (401);
- `invalid_credentials` (401);
- `invalid_code` (422);
- `username_taken` (409);
- `creation_limited` (429);
- `demo_full` (503);
- `workplace_failed` (503).

- [ ] **Step 4: Demo accounts**

In `DEMO_ACCOUNTS.md`, replace any mention of signing in to the personas with a username and password. Say:
- Quick look opens the shared workplace as Jordan, Priya, Marcus or Dana, and skips sign-in.
- "Create a demo login" gives a private workplace for 24 hours, with real sign-in.

- [ ] **Step 5: Check**

Run: `grep -rn "HIPAA compliant" README.md docs DEMO_ACCOUNTS.md web | grep -v "never \"HIPAA compliant\"" | grep -v "never 'HIPAA compliant'"`
Expected: no output. The phrase only appears inside the "never" sentence.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/API.md .env.example DEMO_ACCOUNTS.md
git commit -m "docs(signin): safeguards, API, environment and demo accounts"
```

---

## Execution with beads and ntm (the trial)

1. **Load the tasks into beads.**
   - Run `br init` in the worktree.
   - Create one bead per task, titled `T<n> <name>`. The description is the task's heading line plus "Read docs/superpowers/plans/2026-10-12-careops-signin.md, section Task <n>, and the spec it names."
   - Add `--deps` from the task graph table.
   - Polish the beads three times before any agent starts. Each pass re-reads every bead against the plan and the spec, and fixes missing dependencies, owned files and exact test names.
2. **Agents.**
   - Run 2 or 3 Sonnet Claude Code agents through `ntm`, all working in this worktree.
   - Each agent loops:
     1. `br ready`;
     2. claim one task (`br update <id> --status in_progress`);
     3. do the task's steps exactly;
     4. commit only the task's owned files;
     5. `br close <id>`.
   - An agent never edits a file owned by another task.
   - If the full suite fails only in another in-progress task's files, the agent notes it on its own bead and does not fix it.
3. **Controller (this session).**
   - At each wave boundary, run `npm test` on the worktree and review the wave's diff against the spec and this plan.
   - Rule on any conflict and record the ruling in `.superpowers/sdd/2026-10-12-careops-signin/progress.md`.
   - After Task 12, run a whole-branch review on the most capable model, then `npm run e2e:signin`.
4. **Ship.**
   - Merge to `main` only on the operator's "merge".
   - Deploy with these steps:
     1. Add `TOTP_KEY` to the server's `.env` without printing it: `printf 'TOTP_KEY=%s\n' "$(openssl rand -base64 32)" >> .env`.
     2. `docker compose up -d --build`.
     3. Smoke-test sign-in on careops.shawndemos.com.
