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
