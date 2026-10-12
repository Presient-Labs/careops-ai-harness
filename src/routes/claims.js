import { Router } from 'express';
import { z } from 'zod';
import { parseBody, requireRole } from '../http/middleware.js';
import { errors } from '../http/errors.js';
import { listAssignedClaims, getAssignedClaim, listTasks, createFollowup, transitionClaim, TASK_KINDS, CLAIM_TRANSITIONS } from '../domain/claims.js';
import { withIdempotency } from '../domain/idempotency.js';

const Followup = z.object({ kind: z.enum(TASK_KINDS), note: z.string().trim().min(1).max(500), idempotencyKey: z.string().min(1).max(100) });
const Transition = z.object({ to: z.enum(Object.keys(CLAIM_TRANSITIONS)), idempotencyKey: z.string().min(1).max(100).optional() });

export function claimRoutes({ clock }) {
  const r = Router();
  r.use('/claims', requireRole('billing'));
  r.get('/claims', (req, res) => res.json({ claims: listAssignedClaims(req.db, req.user) }));
  r.get('/claims/:id', (req, res) => {
    const claim = getAssignedClaim(req.db, req.user, req.params.id);
    if (!claim) throw errors.notFound('Claim not found.');
    res.json({ claim, tasks: listTasks(req.db, claim.id) });
  });
  r.post('/claims/:id/followups', (req, res) => {
    const b = parseBody(Followup, req.body);
    if (!getAssignedClaim(req.db, req.user, req.params.id)) throw errors.notFound('Claim not found.'); // checked before any replay
    res.status(201).json(withIdempotency(req.db, { key: b.idempotencyKey, userId: req.user.id, scope: `claims:followup:${req.params.id}`, body: b }, () => {
      const t = createFollowup(req.db, { user: req.user, claimId: req.params.id, kind: b.kind, note: b.note, clock });
      req.audit.event({ actor: req.user, kind: 'followup_created', detail: { claimId: t.claimId, kind: t.kind, via: 'form' } });
      return t;
    }));
  });
  r.post('/claims/:id/transition', (req, res) => {
    const { to, idempotencyKey } = parseBody(Transition, req.body);
    const run = () => { const c = transitionClaim(req.db, { user: req.user, claimId: req.params.id, to }); req.audit.event({ actor: req.user, kind: 'claim_transition', detail: { claimId: c.id, to } }); return c; };
    try {
      res.json(idempotencyKey ? withIdempotency(req.db, { key: idempotencyKey, userId: req.user.id, scope: `claims:transition:${req.params.id}`, body: { to } }, run) : run());
    } catch (err) {
      if (err.status === 409) req.audit.event({ actor: req.user, kind: 'claim_transition_rejected', security: true, detail: { claimId: req.params.id, to, reason: err.message } });
      throw err;
    }
  });
  return r;
}
