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
