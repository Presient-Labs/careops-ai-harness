import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { asyncHandler, parseBody, requireUser } from '../http/middleware.js';
import { errors } from '../http/errors.js';
import { ipKey } from '../http/ipKey.js';
import { logSecurity } from '../db/directory.js';
import { usernameProblem, passwordProblem } from './rules.js';
import { createPrivateWorkplace } from '../workplaces/create.js';
import { createSession, destroySession, cookieOptions } from './sessions.js';
import { generateTotpSecret, verifyTotp, otpauthUrl } from './totp.js';
import { encryptSecret, decryptSecret } from './secrets.js';
import { generateRecoveryCodes, hashRecoveryCode } from './recovery.js';
import { qrDataUrl } from './qr.js';
import { createDemoMailbox, issueEmailCode, verifyEmailCode, listMailbox } from './email.js';
import { startRegistration, finishRegistration, startLogin, finishLogin } from './passkeys.js';

export const MAX_FAILURES = 5;
export const LOCK_MS = 15 * 60_000;
const ROLES = ['employee', 'manager', 'billing', 'admin'];
const DUMMY_HASH = bcrypt.hashSync('careops-no-such-account', 10); // unknown usernames cost the same check

const Create = z.object({ username: z.string().max(64), password: z.string().max(400), role: z.enum(ROLES) }).strict();
const Login = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(400) }).strict();
const Code = z.object({ code: z.string().trim().min(1).max(32) }).strict();
const Verify = z.object({ method: z.enum(['totp', 'email', 'recovery']), code: z.string().trim().min(1).max(32) }).strict();
const Purpose = z.object({ purpose: z.enum(['signin', 'enable']) }).strict();
const PasskeyFinish = z.object({ challengeId: z.string().min(1).max(100), response: z.object({ id: z.string().max(1024) }).passthrough() }).strict();

export function accountRoutes({ directory, pool, clock, config }) {
  const r = Router();
  const cookie = cookieOptions(config);
  const mailbox = createDemoMailbox(directory, clock);
  const throttle = rateLimit({ windowMs: 60_000, limit: 20, keyGenerator: (req) => ipKey(req.ip), validate: false, handler: (req, res, next) => next(errors.rateLimited()) });
  const signedIn = requireUser({ directory, pool, clock, stage: 'any' });
  const now = () => clock.now().getTime();
  const accountById = (id) => directory.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  const actorOf = (a) => ({ id: a.user_id, role: a.role });
  const auditFor = (a) => pool.get(a.workplace_id)?.audit;
  const locked = (a) => Boolean(a.locked_until && a.locked_until > now());
  const lockedError = (a) => errors.accountLocked(new Date(a.locked_until));

  function methodsOf(a) {
    const m = [];
    if (directory.prepare('SELECT 1 FROM totp_credentials WHERE account_id = ? AND confirmed_at IS NOT NULL').get(a.id)) m.push('totp');
    if (a.email_enabled_at) m.push('email');
    if (directory.prepare('SELECT 1 FROM passkeys WHERE account_id = ?').get(a.id)) m.push('passkey');
    if (m.length && directory.prepare('SELECT 1 FROM recovery_codes WHERE account_id = ? AND used_at IS NULL').get(a.id)) m.push('recovery');
    return m;
  }
  // The account behind this session; Quick look sessions have none.
  function accountOf(req) {
    const a = req.session.accountId && accountById(req.session.accountId);
    if (!a) throw errors.forbidden('Quick look sessions have no sign-in settings.');
    return a;
  }
  // Adding a second step needs a full session, or a halfway session for an account that has none yet (first sign-up).
  // A password alone must never add a step to an account that already has one.
  const canSetup = (req, a) => req.session.stage === 'full' || methodsOf(a).length === 0;
  function setupAccount(req) {
    const a = accountOf(req);
    if (!canSetup(req, a)) throw errors.forbidden('Finish signing in before changing sign-in settings.');
    return a;
  }
  function issue(req, res, a, stage) {
    destroySession(directory, req.cookies?.careops_sid);
    const s = createSession(directory, { workplaceId: a.workplace_id, userId: a.user_id, accountId: a.id, stage }, clock);
    res.cookie('careops_sid', s.id, cookie);
    return { stage, csrfToken: s.csrf, username: a.username, role: a.role, methods: methodsOf(a) };
  }
  // After a step is added: a halfway session that now has a step becomes full.
  function afterSetup(req, res, a) {
    const fresh = accountById(a.id);
    return req.session.stage === 'halfway' ? issue(req, res, fresh, 'full') : { stage: 'full', methods: methodsOf(fresh) };
  }
  // A failed password or code counts toward the lockout; the fifth locks the account.
  function fail(a, kind) {
    const count = a.failed_count + 1;
    const lockedUntil = count >= MAX_FAILURES ? now() + LOCK_MS : null;
    directory.prepare('UPDATE accounts SET failed_count = ?, locked_until = ? WHERE id = ?').run(lockedUntil ? 0 : count, lockedUntil, a.id);
    auditFor(a)?.event({ actor: actorOf(a), kind, security: true });
    if (lockedUntil) auditFor(a)?.event({ actor: actorOf(a), kind: 'account_locked', security: true, detail: { until: new Date(lockedUntil).toISOString() } });
    return lockedUntil ? accountById(a.id) : null;
  }
  const succeed = (a) => directory.prepare('UPDATE accounts SET failed_count = 0, locked_until = NULL WHERE id = ?').run(a.id);

  r.post('/accounts', throttle, (req, res) => {
    const b = parseBody(Create, req.body);
    const username = b.username.toLowerCase();
    const problem = usernameProblem(username) ?? passwordProblem(b.password);
    if (problem) throw errors.invalid(problem);
    if (directory.prepare('SELECT 1 FROM accounts WHERE username = ?').get(username)) throw errors.usernameTaken();
    const key = ipKey(req.ip);
    if (directory.prepare('SELECT COUNT(*) n FROM creation_log WHERE ip_key = ? AND created_at > ?').get(key, now() - 3600_000).n >= config.creationsPerHour)
      throw errors.creationLimited(config.creationsPerHour);
    const w = createPrivateWorkplace({ directory, pool, dir: config.workplacesDir, clock, cap: config.privateWorkplaceCap, role: b.role, username });
    const id = randomBytes(16).toString('hex');
    directory.prepare('INSERT INTO accounts (id, username, workplace_id, user_id, role, password_hash, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, username, w.workplaceId, w.userId, b.role, bcrypt.hashSync(b.password, 10), now());
    directory.prepare('INSERT INTO creation_log (ip_key, created_at) VALUES (?,?)').run(key, now());
    const a = accountById(id);
    auditFor(a)?.event({ actor: actorOf(a), kind: 'account_created', detail: { role: a.role } });
    res.status(201).json(issue(req, res, a, 'halfway'));
  });

  r.post('/login', throttle, (req, res) => {
    const { username, password } = parseBody(Login, req.body);
    const a = directory.prepare('SELECT * FROM accounts WHERE username = ?').get(username.toLowerCase());
    if (a && locked(a)) throw lockedError(a); // tells a locked user why; reveals the name exists (accepted, spec 4.6)
    const ok = bcrypt.compareSync(password, a?.password_hash ?? DUMMY_HASH) && Boolean(a);
    if (!a) { logSecurity(directory, clock, 'login_failed_unknown_user', { username: username.slice(0, 64) }); throw errors.invalidCredentials(); }
    if (!ok) { const l = fail(a, 'login_failed'); throw l ? lockedError(l) : errors.invalidCredentials(); }
    auditFor(a)?.event({ actor: actorOf(a), kind: 'login_password_ok' });
    res.json(issue(req, res, a, 'halfway'));
  });

  r.get('/second-step', signedIn, (req, res) => {
    const a = accountOf(req);
    res.json({ stage: req.session.stage, username: a.username, role: a.role, methods: methodsOf(a), canSetup: canSetup(req, a), csrfToken: req.session.csrf });
  });

  r.post('/verify', throttle, signedIn, (req, res) => {
    const a = accountOf(req);
    if (req.session.stage === 'full') return res.json({ stage: 'full', methods: methodsOf(a) });
    if (locked(a)) throw lockedError(a);
    const { method, code } = parseBody(Verify, req.body);
    const ok = method === 'totp' ? useTotp(a, code)
      : method === 'email' ? verifyEmailCode({ directory, clock, accountId: a.id, purpose: 'signin', code })
      : useRecovery(a, code);
    if (!ok) {
      const l = fail(a, 'second_step_failed');
      if (l) { destroySession(directory, req.session.sessionId); throw lockedError(l); }
      throw errors.invalidCode();
    }
    succeed(a);
    auditFor(a)?.event({ actor: actorOf(a), kind: 'second_step_ok', detail: { method } });
    res.json(issue(req, res, accountById(a.id), 'full'));
  });
  function useTotp(a, code) {
    const t = directory.prepare('SELECT * FROM totp_credentials WHERE account_id = ? AND confirmed_at IS NOT NULL').get(a.id);
    if (!t) return false;
    const step = verifyTotp(decryptSecret(t.secret_enc, config.totpKey), code, now(), t.last_used_step);
    if (step === null) return false;
    directory.prepare('UPDATE totp_credentials SET last_used_step = ? WHERE account_id = ?').run(step, a.id);
    return true;
  }
  const useRecovery = (a, code) => directory.prepare('UPDATE recovery_codes SET used_at = ? WHERE account_id = ? AND code_hash = ? AND used_at IS NULL')
    .run(now(), a.id, hashRecoveryCode(code)).changes === 1;

  r.post('/email/send', throttle, signedIn, (req, res) => {
    const { purpose } = parseBody(Purpose, req.body);
    const a = purpose === 'enable' ? setupAccount(req) : accountOf(req);
    if (purpose === 'signin' && !a.email_enabled_at) throw errors.conflict('Emailed codes are not set up for this account.');
    if (purpose === 'enable' && a.email_enabled_at) throw errors.conflict('Emailed codes are already set up.');
    issueEmailCode({ directory, sender: mailbox, clock, accountId: a.id, purpose });
    res.status(204).end();
  });
  r.post('/email/confirm', signedIn, (req, res) => {
    const a = setupAccount(req);
    const { code } = parseBody(Code, req.body);
    if (!verifyEmailCode({ directory, clock, accountId: a.id, purpose: 'enable', code })) throw errors.invalidCode();
    directory.prepare('UPDATE accounts SET email_enabled_at = ? WHERE id = ?').run(now(), a.id);
    auditFor(a)?.event({ actor: actorOf(a), kind: 'second_step_added', detail: { method: 'email' } });
    res.json(afterSetup(req, res, a));
  });

  r.post('/totp/setup', signedIn, (req, res) => {
    const a = setupAccount(req);
    if (directory.prepare('SELECT 1 FROM totp_credentials WHERE account_id = ? AND confirmed_at IS NOT NULL').get(a.id)) throw errors.conflict('An authenticator app is already set up.');
    const secret = generateTotpSecret();
    directory.prepare(`INSERT INTO totp_credentials (account_id, secret_enc, last_used_step, created_at) VALUES (?,?,0,?)
      ON CONFLICT(account_id) DO UPDATE SET secret_enc = excluded.secret_enc, last_used_step = 0, created_at = excluded.created_at`).run(a.id, encryptSecret(secret, config.totpKey), now());
    const url = otpauthUrl({ secret, account: a.username });
    res.json({ secret, otpauthUrl: url, qr: qrDataUrl(url) });
  });
  r.post('/totp/confirm', signedIn, (req, res) => {
    const a = setupAccount(req);
    const t = directory.prepare('SELECT * FROM totp_credentials WHERE account_id = ? AND confirmed_at IS NULL').get(a.id);
    if (!t) throw errors.conflict('Start authenticator setup first.');
    const { code } = parseBody(Code, req.body);
    const step = verifyTotp(decryptSecret(t.secret_enc, config.totpKey), code, now(), t.last_used_step);
    if (step === null) throw errors.invalidCode();
    directory.prepare('UPDATE totp_credentials SET confirmed_at = ?, last_used_step = ? WHERE account_id = ?').run(now(), step, a.id);
    const recoveryCodes = generateRecoveryCodes(10);
    directory.prepare('DELETE FROM recovery_codes WHERE account_id = ?').run(a.id);
    const ins = directory.prepare('INSERT INTO recovery_codes (account_id, code_hash) VALUES (?,?)');
    for (const c of recoveryCodes) ins.run(a.id, hashRecoveryCode(c));
    auditFor(a)?.event({ actor: actorOf(a), kind: 'second_step_added', detail: { method: 'totp' } });
    res.json({ ...afterSetup(req, res, a), recoveryCodes });
  });

  r.post('/passkeys/register/options', signedIn, asyncHandler(async (req, res) => {
    const a = setupAccount(req);
    res.json(await startRegistration({ directory, config, clock, account: a }));
  }));
  r.post('/passkeys/register/verify', signedIn, asyncHandler(async (req, res) => {
    const a = setupAccount(req);
    const b = parseBody(PasskeyFinish, req.body);
    if (!(await finishRegistration({ directory, config, clock, account: a, challengeId: b.challengeId, response: b.response }))) throw errors.invalid('The passkey could not be verified. Try again.');
    auditFor(a)?.event({ actor: actorOf(a), kind: 'second_step_added', detail: { method: 'passkey' } });
    res.json(afterSetup(req, res, a));
  }));
  r.post('/passkeys/login/options', throttle, asyncHandler(async (req, res) => res.json(await startLogin({ directory, config, clock }))));
  r.post('/passkeys/login/verify', throttle, asyncHandler(async (req, res) => {
    const b = parseBody(PasskeyFinish, req.body);
    const accountId = await finishLogin({ directory, config, clock, challengeId: b.challengeId, response: b.response });
    const a = accountId && accountById(accountId);
    if (!a) { logSecurity(directory, clock, 'passkey_signin_failed', {}); throw errors.invalidCredentials(); }
    if (locked(a)) throw lockedError(a);
    succeed(a);
    auditFor(a)?.event({ actor: actorOf(a), kind: 'passkey_signin' });
    res.json(issue(req, res, a, 'full'));
  }));

  // The mailbox page polls every few seconds; reading it is not activity, so an open tab never holds a session open.
  const peek = requireUser({ directory, pool, clock, stage: 'any', touch: false });
  r.get('/mailbox', peek, (req, res) => res.json({ messages: listMailbox(directory, accountOf(req).id) }));
  return r;
}
