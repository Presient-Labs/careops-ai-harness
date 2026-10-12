import { Router } from 'express';
import { z } from 'zod';
import { parseBody, requireRole } from '../http/middleware.js';
import { createPtoRequest, decidePtoRequest, listApprovals, listMyPto } from '../domain/pto.js';
import { withIdempotency } from '../domain/idempotency.js';

const NewReq = z.object({ date: z.string(), hours: z.number().optional(), idempotencyKey: z.string().min(1).max(100) });
const Decision = z.object({ decision: z.enum(['APPROVED', 'DENIED']), idempotencyKey: z.string().min(1).max(100) });

export function ptoRoutes({ clock }) {
  const r = Router();
  const ptoUsers = requireRole('employee', 'manager', 'billing');
  r.get('/pto/me', ptoUsers, (req, res) => res.json(listMyPto(req.db, req.user)));
  r.post('/pto/requests', ptoUsers, (req, res) => {
    const b = parseBody(NewReq, req.body);
    const out = withIdempotency(req.db, { key: b.idempotencyKey, userId: req.user.id, scope: 'pto:create', body: { date: b.date, hours: b.hours ?? 8 } }, () => {
      const created = createPtoRequest(req.db, { user: req.user, date: b.date, hours: b.hours ?? 8, clock });
      req.audit.event({ actor: req.user, kind: 'pto_requested', detail: { requestId: created.id, date: created.date, via: 'form' } });
      return created;
    });
    res.status(201).json(out);
  });
  r.get('/pto/approvals', requireRole('manager'), (req, res) => res.json({ requests: listApprovals(req.db, req.user) }));
  r.post('/pto/requests/:id/decision', requireRole('manager'), (req, res) => {
    const b = parseBody(Decision, req.body);
    res.json(withIdempotency(req.db, { key: b.idempotencyKey, userId: req.user.id, scope: `pto:decide:${req.params.id}`, body: { decision: b.decision } }, () => {
      const d = decidePtoRequest(req.db, { manager: req.user, requestId: req.params.id, decision: b.decision, clock });
      req.audit.event({ actor: req.user, kind: 'pto_decided', detail: { requestId: d.id, decision: d.status, employee: d.employeeName } });
      return d;
    }));
  });
  return r;
}
