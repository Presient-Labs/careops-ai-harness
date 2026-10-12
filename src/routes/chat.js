import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler, parseBody } from '../http/middleware.js';
import { errors } from '../http/errors.js';
import { confirmAction, dismissAction } from '../tools/actions.js';
import { MODELS, isKnownModel } from '../llm/models.js';
import { getDefaultModel } from '../harness/pipeline.js';

const ChatBody = z.object({ message: z.string().trim().min(1).max(2000), model: z.string().max(100).optional() });
const publicTurn = ({ _raw, reason, ...turn }) => turn; // raw model text and rejection reason are not sent with the turn
// Withheld model output is visible only to compliance (admin); the turn's owner sees why, not what.
const forViewer = (trace, user) => (user.role === 'admin' ? trace : { ...trace, steps: trace.steps.map(({ detail, ...s }) => { const { raw, ...rest } = detail ?? {}; return { ...s, detail: rest }; }) });

export function chatRoutes({ directory, clock, harness, config }) {
  const r = Router();
  const limiter = rateLimit({ windowMs: 10 * 60_000, limit: 20, keyGenerator: (req) => req.session.sessionId, validate: false, handler: (req, res, next) => next(errors.rateLimited()) });
  const ipLimiter = rateLimit({ windowMs: 10 * 60_000, limit: config.chatIpLimit, keyGenerator: (req) => req.ip, validate: false, handler: (req, res, next) => next(errors.rateLimited()) });
  r.post('/chat', ipLimiter, limiter, asyncHandler(async (req, res) => {
    const { message, model } = parseBody(ChatBody, req.body);
    if (model && !isKnownModel(model)) throw errors.invalid('Unknown model.');
    res.json(publicTurn(await harness.runTurn({ db: req.db, audit: req.audit, user: req.user, message, model: model ?? getDefaultModel(directory, config) })));
  }));
  r.post('/actions/:id/confirm', (req, res) => res.json({ action: confirmAction(req.db, { user: req.user, actionId: req.params.id, clock, audit: req.audit }) }));
  r.post('/actions/:id/dismiss', (req, res) => res.json({ action: dismissAction(req.db, { user: req.user, actionId: req.params.id, audit: req.audit }) }));
  r.get('/traces/:turnId', (req, res, next) => {
    const t = req.audit.getTrace(req.params.turnId);
    if (!t || (t.user.id !== req.user.id && req.user.role !== 'admin')) return next(errors.notFound('Trace not found.'));
    res.json(forViewer(t, req.user));
  });
  r.get('/models', (req, res) => res.json({ default: getDefaultModel(directory, config), models: MODELS }));
  return r;
}
