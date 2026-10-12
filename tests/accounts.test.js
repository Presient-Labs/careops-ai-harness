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
