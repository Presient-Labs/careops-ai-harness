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
