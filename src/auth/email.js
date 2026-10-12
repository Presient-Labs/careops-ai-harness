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
