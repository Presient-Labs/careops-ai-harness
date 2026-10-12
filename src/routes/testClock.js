import { Router } from 'express';
import { z } from 'zod';
import { parseBody } from '../http/middleware.js';

const Advance = z.object({ ms: z.number().int().min(0).max(48 * 3600_000) }).strict();

export function testClockRoutes({ clock }) {
  const r = Router();
  r.get('/clock', (req, res) => res.json({ now: clock.now().toISOString() }));
  r.post('/clock/advance', (req, res) => { clock.advance(parseBody(Advance, req.body).ms); res.json({ now: clock.now().toISOString() }); });
  return r;
}
