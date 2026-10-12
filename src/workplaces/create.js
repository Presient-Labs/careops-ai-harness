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
