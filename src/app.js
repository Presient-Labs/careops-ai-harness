import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';
import { errorHandler, HttpError } from './http/errors.js';
import { correlationId, requireUser, auditDenials } from './http/middleware.js';
import { authRoutes } from './auth/routes.js';
import { accountRoutes } from './auth/accountRoutes.js';
import { healthRoutes } from './routes/health.js';
import { createAudit } from './audit/audit.js';
import { systemClock } from './util/clock.js';
import { createBudget } from './llm/budget.js';
import { createHarness } from './harness/pipeline.js';
import { loadPrompts } from './harness/prompts.js';
import { chatRoutes } from './routes/chat.js';
import { ptoRoutes } from './routes/pto.js';
import { claimRoutes } from './routes/claims.js';
import { adminRoutes } from './routes/admin.js';
import { labRoutes } from './routes/labs.js';

import { openDirectory, migrateFromShared } from './db/directory.js';
import { createWorkplacePool } from './workplaces/pool.js';

const WEB_DIR = fileURLToPath(new URL('../web', import.meta.url));

export function createApp({ db, directory: providedDirectory, kb, provider, clock = systemClock, config, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'],
    connectSrc: ["'self'"], frameAncestors: ["'none'"], objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"] } } }));
  app.use(correlationId); // first, so even body-parser errors carry an id
  app.get(/^\/careops(\/.*)?$/, (req, res) => res.redirect(301, '/')); // the link shared as shawndemos.com/careops
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());
  const directory = providedDirectory ?? openDirectory(':memory:', clock);
  migrateFromShared(directory, db);
  const audit = createAudit(db, clock);
  const pool = createWorkplacePool({ directory, sharedDb: db, sharedAudit: audit, dir: config.workplacesDir, clock });
  const budget = createBudget(directory, clock, config.dailyBudgetUsd);
  app.use(healthRoutes({ directory, pool, kb, config, budget, clock }));
  app.use('/api/auth', authRoutes({ directory, pool, clock, config }));
  app.use('/api/auth', accountRoutes({ directory, pool, clock, config }));
  app.use('/api', requireUser({ directory, pool, clock }));
  const prompts = loadPrompts();
  const harness = createHarness({ db, kb, provider, clock, audit, budget, prompts, config, modelsDb: directory });
  app.use('/api', chatRoutes({ directory, clock, harness, config }));
  app.use('/api', ptoRoutes({ clock }), claimRoutes({ clock }), adminRoutes({ clock, config }));
  app.use('/api', labRoutes({ directory, kb, provider, prompts, harness, budget, config, clock }));
  app.use('/api', (req, res, next) => next(new HttpError(404, 'not_found', 'Not found.')));
  app.use(express.static(WEB_DIR, { extensions: ['html'] }));
  app.use(auditDenials(audit, clock));
  app.use(errorHandler(logger));
  return { app, audit, harness, directory, pool };
}
