import bcrypt from 'bcryptjs';
import { USERS, PTO_BALANCES, PATIENTS, CLAIMS } from '../../seed/data.js';
import { nyDate } from '../util/clock.js';
import { addBusinessDays } from '../util/dates.js';

// Restores business data to a known state. Users are upserted (never deleted) so sessions survive;
// audit_events, traces, llm_calls and lab_results are never touched.
export function seedDb(db, { clock, demoPassword }) {
  const hash = bcrypt.hashSync(demoPassword, 10);
  const today = nyDate(clock.now());
  db.transaction(() => {
    for (const t of ['pending_actions', 'idempotency_keys', 'billing_tasks', 'claims', 'patients', 'pto_requests', 'pto_balances']) db.prepare(`DELETE FROM ${t}`).run();
    const upsertUser = db.prepare(`INSERT INTO users (id, username, display_name, role, manager_id, password_hash) VALUES (?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET username=excluded.username, display_name=excluded.display_name, role=excluded.role, manager_id=excluded.manager_id, password_hash=excluded.password_hash`);
    for (const u of USERS) upsertUser.run(u.id, u.username, u.displayName, u.role, u.managerId, hash);
    for (const [userId, hours] of Object.entries(PTO_BALANCES)) db.prepare('INSERT INTO pto_balances (user_id, hours_available, hours_pending) VALUES (?,?,0)').run(userId, hours);
    for (const [id, name] of PATIENTS) db.prepare('INSERT INTO patients (id, name) VALUES (?,?)').run(id, name);
    const ins = db.prepare('INSERT INTO claims (id, patient_id, payer, amount_cents, service_date, status, denial_code, denial_reason, assigned_to) VALUES (?,?,?,?,?,?,?,?,?)');
    for (const c of CLAIMS) ins.run(...c);
    // Sam already has one pending request so the manager's queue is never empty.
    const samDate = addBusinessDays(today, 7);
    db.prepare("INSERT INTO pto_requests (id, user_id, date, hours, status, created_at) VALUES ('pto_seed_sam','u-sam',?,8,'PENDING',?)").run(samDate, clock.now().toISOString());
    db.prepare("UPDATE pto_balances SET hours_pending = 8 WHERE user_id = 'u-sam'").run();
  })();
}

// A demo login takes the seat of its role's persona inside its own workplace copy: same id and records, the visitor's name.
export function applySeat(db, { userId, username, displayName }) {
  const r = db.prepare('UPDATE users SET username = ?, display_name = ? WHERE id = ?').run(username, displayName, userId);
  if (r.changes !== 1) throw new Error(`no seat ${userId}`);
}
