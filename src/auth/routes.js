import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { parseBody, requireUser } from '../http/middleware.js';
import { errors } from '../http/errors.js';
import { SHARED } from '../db/directory.js';
import { createSession, destroySession, cookieOptions, cookiePath, IDLE_MS } from './sessions.js';

const DEMO_PERSONAS = ['jordan', 'priya', 'marcus', 'dana'];
const Persona = z.object({ persona: z.enum(DEMO_PERSONAS) }).strict();
const publicUser = (u) => ({ id: u.id, username: u.username, displayName: u.display_name ?? u.displayName, role: u.role });

export function authRoutes({ directory, pool, clock, config }) {
  const r = Router();
  // Quick look for the shared demo workplace: the server picks the account and creates a normal, full session.
  // The browser can only name one of four demo personas, never a role. Demo logins use /accounts and /login instead.
  r.post('/demo', rateLimit({ windowMs: 60_000, limit: 30, handler: (req, res, next) => next(errors.rateLimited()) }), (req, res) => {
    const { persona } = parseBody(Persona, req.body);
    const u = pool.shared.db.prepare('SELECT * FROM users WHERE username = ?').get(persona);
    if (!u) throw errors.notFound('Demo persona not found.');
    destroySession(directory, req.cookies?.careops_sid);
    const s = createSession(directory, { workplaceId: SHARED, userId: u.id }, clock);
    pool.shared.audit.event({ actor: { id: u.id, role: u.role }, kind: 'login_success', detail: { via: 'persona' } });
    res.cookie('careops_sid', s.id, cookieOptions(config, req)).json({ user: publicUser(u), csrfToken: s.csrf });
  });
  const full = requireUser({ directory, pool, clock });
  const any = requireUser({ directory, pool, clock, stage: 'any' });
  r.get('/me', full, (req, res) => {
    // Served under /careops, a session cookie left on Path=/ by the old root deployment would also reach the other apps
    // on the domain. Every app page asks /me first, so move it here: clear Path=/ and set the same id on /careops.
    if (cookiePath(req) !== '/') res.clearCookie('careops_sid', { path: '/' }).cookie('careops_sid', req.cookies.careops_sid, cookieOptions(config, req));
    res.json({ user: publicUser(req.user), csrfToken: req.session.csrf,
    session: { idleTimeoutMs: IDLE_MS, expiresAt: new Date(req.session.expiresAt).toISOString(), accountSession: Boolean(req.session.accountId) } });
  });
  r.post('/ping', full, (req, res) => res.status(204).end()); // "Stay signed in": any authenticated request counts as activity
  r.post('/logout', any, (req, res) => { destroySession(directory, req.session.sessionId); res.clearCookie('careops_sid', { path: cookiePath(req) }).status(204).end(); });
  return r;
}
