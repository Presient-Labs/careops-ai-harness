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
