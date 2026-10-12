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
