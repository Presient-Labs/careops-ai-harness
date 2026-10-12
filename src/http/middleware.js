import { randomUUID } from 'node:crypto';
import { errors } from './errors.js';
import { loadSession, touchSession, destroySession } from '../auth/sessions.js';

// Holds the request's workplace lease until the handler settles, so a client that disconnects mid-await cannot free it.
export const asyncHandler = (fn) => (req, res, next) => {
  const done = req.holdLease?.();
  return Promise.resolve(fn(req, res, next)).catch(next).finally(() => done?.());
};
export function correlationId(req, res, next) { req.correlationId = randomUUID(); res.setHeader('X-Correlation-Id', req.correlationId); next(); }
export function parseBody(schema, body) {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw errors.invalid(r.error.issues.map(i => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  return r.data;
}
// Identity comes only from the server-side session; the client never asserts a role. The session names the workplace,
// and this request reads and writes only that workplace's database (leased, so it cannot be closed mid-request).
// touch = false, or an X-CareOps-Background: 1 header: the request does not count as activity (the Demo mailbox page and
// the audit auto-refresh poll; neither may hold a session open).
export function requireUser({ directory, pool, clock, stage = 'full', touch = true }) {
  return (req, res, next) => {
    const s = loadSession(directory, req.cookies?.careops_sid, clock);
    if (!s) return next(errors.unauth());
    req.audit = pool.get(s.workplaceId)?.audit; // refusals below are recorded in the session's own workplace
    if (s.timedOut) return next(errors.signinTimedOut());
    if (s.idle) {
      pool.get(s.workplaceId)?.audit.event({ actor: { id: s.userId }, kind: 'session_idle_logoff', security: true });
      return next(errors.sessionIdle());
    }
    if (stage === 'full' && s.stage !== 'full') return next(errors.secondStepRequired());
    const lease = pool.acquire(s.workplaceId);
    if (!lease) { destroySession(directory, s.sessionId); return next(errors.unauth()); }
    let holds = 1; // the response itself; an async handler takes another until it settles
    const drop = () => { if (--holds === 0) lease.release(); };
    res.on('close', drop);
    req.holdLease = () => { holds += 1; let done = false; return () => { if (!done) { done = true; drop(); } }; };
    const u = lease.wp.db.prepare('SELECT id, username, display_name, role, manager_id FROM users WHERE id = ?').get(s.userId);
    if (!u) return next(errors.unauth());
    req.user = { id: u.id, username: u.username, displayName: u.display_name, role: u.role, managerId: u.manager_id };
    req.session = s; req.db = lease.wp.db; req.audit = lease.wp.audit; req.workplaceId = s.workplaceId;
    if (req.method !== 'GET' && req.get('x-csrf-token') !== s.csrf) return next(errors.forbidden('Missing or invalid CSRF token.'));
    if (touch && req.get('x-careops-background') !== '1') touchSession(directory, s.sessionId, clock);
    next();
  };
}
export const requireRole = (...roles) => (req, res, next) => (roles.includes(req.user.role) ? next() : next(errors.forbidden()));
// Records refused API requests (401/403, and 404s on owned resources, which hide whether a record exists)
// as sanitized security events: method, route path, actor, status, code, correlation id — never cookies,
// tokens or bodies. Identical probes are recorded at most once a minute so the audit cannot be flooded.
const OWNED = /^\/api\/(actions|traces|claims|pto\/requests)\//;
export function auditDenials(audit, clock, { windowMs = 60_000 } = {}) {
  const seen = new Map();
  return (err, req, res, next) => {
    const status = err?.status;
    const path = req.originalUrl.split('?')[0];
    const relevant = path.startsWith('/api/') && !path.startsWith('/api/auth/')
      && (status === 401 || status === 403 || (status === 404 && req.user && OWNED.test(path)));
    if (relevant) {
      const now = clock.now().getTime();
      const sig = `${req.user?.id ?? req.ip}|${req.method}|${path}|${status}`;
      if (!(now - (seen.get(sig) ?? -Infinity) < windowMs)) {
        if (seen.size > 5000) seen.clear();
        seen.set(sig, now);
        (req.audit ?? audit).event({ actor: req.user ?? null, kind: 'api_access_denied', security: true,
          detail: { method: req.method, path: path.slice(0, 200), status, code: err.code ?? 'error', reason: String(err.message ?? '').slice(0, 120), correlationId: req.correlationId } });
      }
    }
    next(err);
  };
}
