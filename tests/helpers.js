import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../src/db/index.js';
import { seedDb } from '../src/db/seed.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { fixedClock } from '../src/util/clock.js';
import { FakeProvider } from '../src/llm/fake.js';
import { createSession } from '../src/auth/sessions.js';
import { fakeKb } from './fixtures/kb.js';

export const DEMO_NOW = '2026-10-06T14:00:00Z';
export const TEST_TOTP_KEY = Buffer.alloc(32, 7).toString('base64');
const silent = { error() {}, info() {}, log() {} };

// A clock tests can move forward.
export function mutableClock(iso) {
  let ms = Date.parse(iso);
  return { now: () => new Date(ms), advance: (d) => { ms += d; } };
}

export async function startTestApp(overrides = {}) {
  const db = openDb(':memory:');
  const clock = overrides.clock ?? fixedClock(DEMO_NOW);
  seedDb(db, { clock, demoPassword: 'pw' });
  const kb = overrides.kb ?? fakeKb();
  const provider = overrides.provider ?? new FakeProvider([]);
  const workplacesDir = mkdtempSync(join(tmpdir(), 'careops-wp-'));
  const config = { ...loadConfig({}), demoPassword: 'pw', openrouterKey: 'test', kbApiKey: 'test', workplacesDir, totpKey: TEST_TOTP_KEY,
    publicHost: 'localhost', publicOrigin: 'http://localhost', ...overrides.config };
  const { app, directory, pool } = createApp({ db, kb, provider, clock, config, logger: silent });
  const server = app.listen(0); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const close = async () => { await new Promise(r => server.close(r)); pool.closeAll(); rmSync(workplacesDir, { recursive: true, force: true }); };
  return { app, db, directory, pool, kb, provider, base, clock, config, close, login: (username) => sessionFor({ base, directory, db, clock, username }) };
}

// A signed-in client for any user of a workplace, made in-process (there is no password door for workplace users).
export function sessionFor({ base, directory, db, clock, username, workplaceId = 'shared', accountId = null }) {
  const u = db.prepare('SELECT id, username, display_name, role FROM users WHERE username = ?').get(username);
  if (!u) throw new Error(`no user ${username}`);
  const s = createSession(directory, { workplaceId, userId: u.id, accountId }, clock);
  return client(base, `careops_sid=${s.id}`, s.csrf, { id: u.id, username: u.username, displayName: u.display_name, role: u.role });
}

export function client(base, cookie, csrfToken, user) {
  const call = async (path, { method = 'GET', body, csrf = true } = {}) => {
    const headers = { cookie, 'content-type': 'application/json' };
    if (csrf) headers['x-csrf-token'] = csrfToken;
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  return { user, call, cookie, csrfToken };
}
