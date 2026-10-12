import { Router } from 'express';
import { requireRole } from '../http/middleware.js';
import { errors } from '../http/errors.js';
import { runAttackLab } from '../labs/attackLab.js';
import { runModelLab } from '../labs/modelLab.js';
import { getDefaultModel } from '../harness/pipeline.js';

const stored = (directory, lab) => { const r = directory.prepare('SELECT results_json FROM lab_results WHERE lab = ?').get(lab); return r ? JSON.parse(r.results_json) : null; };
export function labRoutes({ directory, kb, provider, prompts, harness, budget, config, clock }) {
  const r = Router();
  r.use('/labs', requireRole('admin'));
  // One lab run at a time: runs take minutes and spend money.
  let running = null;
  const exclusive = (name, fn) => async (req, res, next) => {
    if (running) return next(errors.conflict(`The ${running} lab is already running. Try again when it finishes.`));
    running = name;
    try { await fn(req, res); } catch (e) { next(e); } finally { running = null; }
  };
  r.get('/labs/attacks', (req, res, next) => { const s = stored(directory, 'attacks'); return s ? res.json(s) : next(errors.notFound('No Attack Lab run recorded yet.')); });
  r.post('/labs/attacks/run', exclusive('Attack', async (req, res) => {
    if (budget.remaining() < 0.25) throw errors.aiUnavailable('Daily AI budget too low to run the Attack Lab.');
    const out = await runAttackLab({ db: req.db, resultsDb: directory, harness, model: getDefaultModel(directory, config), audit: req.audit, clock });
    req.audit.event({ actor: req.user, kind: 'lab_run', detail: { lab: 'attacks', summary: out.summary } });
    res.json(out);
  }));
  r.get('/labs/models', (req, res, next) => { const s = stored(directory, 'models'); return s ? res.json({ ...s, defaultModel: getDefaultModel(directory, config) }) : next(errors.notFound('No Model Lab run recorded yet.')); });
  r.post('/labs/models/run', exclusive('Model', async (req, res) => {
    if (budget.remaining() < 1) throw errors.aiUnavailable('Daily AI budget too low to run the Model Lab.');
    const out = await runModelLab({ db: directory, kb, provider, audit: req.audit, budget, prompts, config, reps: 3 });
    req.audit.event({ actor: req.user, kind: 'lab_run', detail: { lab: 'models', defaultModel: out.defaultModel } });
    res.json(out);
  }));
  return r;
}
