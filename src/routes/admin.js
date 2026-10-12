import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { requireRole } from '../http/middleware.js';
import { seedDb, applySeat } from '../db/seed.js';
import { SHARED } from '../db/directory.js';

export function adminRoutes({ clock, config }) {
  const r = Router();
  r.get('/audit', requireRole('admin'), (req, res) => res.json({ events: req.audit.list({ securityOnly: req.query.security === '1', limit: Number(req.query.limit ?? 100) }) }));
  r.post('/admin/reset', requireRole('admin'), (req, res) => {
    seedDb(req.db, { clock, demoPassword: req.workplaceId === SHARED ? config.demoPassword : randomBytes(24).toString('base64url') });
    // A private workplace's admin is a visitor in Dana's seat; the reset restores the data, not Dana's name.
    if (req.session.accountId) applySeat(req.db, { userId: req.user.id, username: req.session.username, displayName: req.session.username });
    req.audit.event({ actor: req.user, kind: 'demo_reset' });
    res.status(204).end();
  });
  return r;
}
