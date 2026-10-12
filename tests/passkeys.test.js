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
