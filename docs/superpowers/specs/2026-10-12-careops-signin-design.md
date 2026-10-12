# CareOps Real Sign-In and Private Workplaces — Design Spec

**Date:** 2026-10-12 · **Status:** Draft for operator review
**Part 2 of 3** of the CareOps redesign (1: public assistant, 2: real sign-in, 3: admin console). Parts 1 and 3 get their own specs.
**Decisions this rests on (operator, 2026-10-12):** sign-in comes first; second steps are an authenticator app, an emailed code and a passkey, with no SMS; emailed codes go to a labelled Demo mailbox; each visitor creates their own demo login, deleted after 24 hours; each demo login gets a private copy of the workplace; the six design sections were approved.

## 1. Purpose

CareOps today signs visitors in through four persona buttons that skip authentication. A healthcare buyer evaluating a developer wants to see the safeguards a real product needs working, not described:
- unique logins;
- multi-factor sign-in;
- lockout;
- automatic logoff;
- one client's data never reaching another.

This part makes those real and lets any visitor try every one of them in about a minute, on synthetic data.

Wording rule (unchanged): **"HIPAA-style safeguards on synthetic data"**. Never "HIPAA compliant".

## 2. Success criteria

1. A visitor can create a demo login and choose a role (employee, manager, billing, admin). They set a password, set up at least one second step, sign out, and sign back in with each second step they set up.
2. Each demo login works in a private workplace. No request made with one login can read or change another login's workplace data. A test suite proves this for every API route.
3. 5 wrong passwords or 5 wrong codes lock the account for 15 minutes. The lockout is recorded as a security event.
4. After 15 minutes without activity the session ends. The page warns at 13 minutes and offers "stay signed in". Every session also ends after 8 hours.
5. Demo logins and their workplaces are deleted 24 hours after creation.
6. The four persona Quick look buttons still open the shared workplace exactly as today.
7. The live demo keeps working throughout. The change ships as one merge after review.

## 3. Scope

**In:**
- private workplaces;
- demo-login creation;
- password plus second-step sign-in (authenticator, emailed code, recovery code, passkey);
- passkey-only sign-in;
- lockout;
- idle and absolute logoff;
- the Demo mailbox;
- cleanup and abuse limits;
- the HIPAA-style safeguards panel and README section;
- tests.

**Out:**
- the public assistant (part 1);
- the admin console's user management, analytics and unlock button (part 3);
- real email sending;
- SMS;
- password reset by email;
- a visitor changing their role after creation.

Until part 3 ships, a locked account simply waits out its 15 minutes.

## 4. Architecture

### 4.1 One database per workplace (change from the approved section 1 — flagged)

The approved section 1 said "every record carries its workplace". Reading the code showed that every seeded record has a fixed id (`u-sam`, `CLM-1007`, `pto_seed_sam`). A second copy of the workplace in the same tables would collide on those ids. Avoiding that would mean changing the key of every table, and any query that forgets a workplace filter would leak.

**This spec instead gives each private workplace its own SQLite file**, created from the same schema and seed:
- isolation is physical: code in a request can only reach the one file its session points to;
- deleting a workplace is deleting a file;
- the existing queries, ids and tests stay as they are.

The outcome the operator approved is unchanged: private copies, nothing crossing over, tests that prove it.

| Database | File | Holds |
|---|---|---|
| **Directory** (new) | `data/directory.db` | workplaces, demo accounts and their second-step credentials, sessions, the Demo mailbox, sign-in attempt counters, the shared model-spending ledger (`llm_calls`), lab results, and a security log for events that happen before a workplace is known |
| **Shared workplace** | `data/careops.db` (today's file) | today's tables and data, used by Quick look |
| **Private workplace** | `data/workplaces/<id>.db` | the same schema as today, seeded fresh on creation |

### 4.2 Per-request database

- Today `createApp` receives one `db` and every router closes over it. After this change the session middleware resolves the request's workplace database and sets `req.db`. Routers, domain functions and the harness pipeline take the database from the request instead of the closure.
- Workplace files are opened lazily and kept in a small cache: at most 50 open, least recently used closed first. Expired workplaces are closed before their file is deleted.
- `llm_calls` (the shared daily spending cap) and `lab_results` (the model price guide the pipeline reads) move to the directory, because they belong to the deployment, not to a workplace. The existing budget and model-choice code read them from there.
- The audit trail and traces stay per workplace, so a private admin sees only their own workplace's events.
- The knowledge service (policy documents) is shared. It holds fictional public policy only.

### 4.3 Directory tables

```sql
workplaces (id TEXT PK, kind TEXT CHECK (kind IN ('shared','private')), created_at, expires_at)
accounts (id TEXT PK, username TEXT UNIQUE, workplace_id → workplaces, user_id TEXT, role TEXT,
          password_hash, failed_count INT, locked_until INT, created_at)
totp_credentials (account_id PK → accounts, secret_enc, last_used_step INT, created_at)
recovery_codes (account_id → accounts, code_hash, used_at)
passkeys (id TEXT PK /* credential id */, account_id → accounts, public_key, counter INT, transports, created_at)
email_codes (id PK, account_id, code_hash, expires_at, used_at)
mailbox (id PK, account_id → accounts, subject, body, created_at)
sessions (id PK, account_id NULL, workplace_id, user_id, csrf, stage CHECK (stage IN ('halfway','full')),
          created_at, last_seen_at, expires_at)
creation_log (ip_key, created_at)        -- the per-address limit for new logins
security_log (id PK, at, kind, detail_json)  -- e.g. failed sign-in for an unknown username
llm_calls, lab_results                    -- moved from the workplace schema, unchanged columns
```

- Every row that belongs to an account is deleted with it (`ON DELETE CASCADE`).
- The TOTP secret is encrypted at rest with AES-256-GCM under `TOTP_KEY` from `.env`.
- Recovery and email codes are stored as SHA-256 hashes. They are short-lived or single-use and random, so bcrypt adds nothing.

### 4.4 Creating a demo login

1. **Form.** Fields are username (3 to 32 characters, letters, digits and `_` only), password, and role.
   - The password must be at least 12 characters and not on a bundled list of 10,000 common passwords.
   - The page says: "Don't use your real name or a password you use elsewhere."
2. **Limits.** Creation is refused when either limit is hit, with a clear message pointing to Quick look:
   - the visitor's address has created 3 logins in the past hour (IPv6 is counted per /64);
   - 200 private workplaces are live.
3. **Creation.** A new workplace file is created from the schema and seed.
   - The visitor takes the seat of that role's persona:
     - employee → Jordan;
     - manager → Priya;
     - billing → Marcus;
     - admin → Dana.
   - The persona's user row is renamed to the visitor's username and display name. The persona's records become theirs: Jordan's PTO, Priya's team, Marcus's claims queue, Dana's audit view.
   - The account row is written to the directory, with `expires_at = created_at + 24 h`.
4. **Second step required.** The visitor gets a `halfway` session that can only reach second-step setup, and must set up one second step before entering the app.

### 4.5 Second steps

**Authenticator app (TOTP, RFC 6238)**
- Uses SHA-1, 6 digits and a 30-second step, accepting the current step and one step either side.
- A code at or before `last_used_step` is refused, so each code works once.
- Setup shows a QR code (generated server-side as an SVG, no external service) and the secret as text. It is confirmed by entering one code.
- After confirmation, 10 recovery codes (10 characters each) are shown once.
- Built with `node:crypto`. No dependency.

**Emailed code**
- 6 random digits, valid 10 minutes, single use. At most 3 codes can be requested per account per 10 minutes.
- "Sending" calls an `EmailSender` interface. The demo implementation writes to `mailbox`. A real provider (Amazon SES, Postmark) is a second implementation selected by configuration.

**Passkey (WebAuthn)**
- Uses `@simplewebauthn/server` and `@simplewebauthn/browser`, the only new dependencies, justified because WebAuthn verification is too intricate to hand-write safely.
- The relying-party id is the site's host (`careops.shawndemos.com`; `localhost` in tests).
- User verification is required, so the passkey proves both the device and the person.
- The signature counter is checked when the authenticator reports one.

**Recovery code**
- Accepted in place of any second step. Each works once.

### 4.6 Signing in

1. **Username and password.**
   - An unknown username is compared against a dummy hash, as today, so timing reveals nothing. It is recorded in `security_log`.
   - A wrong password increments `failed_count`.
   - On success, the session is replaced with a new `halfway` session that expires in 5 minutes. It can reach only the second-step endpoints and the visitor's own mailbox.
2. **Second step.** Any method the account has set up.
   - A wrong code increments `failed_count`.
   - On success, the session is replaced with a new `full` session, and `failed_count` is reset.
3. **Passkey sign-in.** "Sign in with a passkey" uses a discoverable credential. A successful assertion yields a `full` session directly.
4. **Lockout.** At 5 failures, `locked_until = now + 15 min`.
   - While locked, every sign-in attempt is refused with "Account locked; try again at HH:MM", and the attempt is not counted. This message does reveal that the username exists. That is accepted, because demo usernames are throwaway and expire in 24 hours, and telling a real user why they cannot sign in matters more.
   - Lockouts are written to the workplace audit as security events.
5. **Activity and logoff.**
   - A `full` session's `last_seen_at` updates on each API request. A request more than 15 minutes after `last_seen_at` ends the session (401 `session_idle`).
   - The page shows a warning at 13 minutes. "Stay signed in" calls a cheap ping.
   - `expires_at` caps every session at 8 hours.
6. **Session ids.** New ids are issued at each stage change. The session cookie keeps today's settings (httpOnly, SameSite=Strict, Secure in production).
7. **Sign-in throttle.** On top of the account lockout, sign-in endpoints allow 20 attempts per address per minute.

**Audit kinds** (in the workplace audit; unknown-username events go to `security_log`):
- login_password_ok
- login_failed
- second_step_ok
- second_step_failed
- account_locked
- session_idle_logoff
- second_step_added
- passkey_signin

### 4.7 Quick look (shared workplace)

- The four persona buttons stay. They are labelled "Quick look — skips sign-in, shared demo workplace".
- Their sessions point to the shared workplace. They are `full` from the start and still follow the idle and 8-hour rules.
- The old "sign in with a username" form for personas is removed, because it would be a password-only door. The persona `password_hash` values stay in the shared database, unused.

### 4.8 Cleanup

Every 10 minutes, a timer in the app process finds expired private workplaces. For each one it:
1. closes the cached handle;
2. deletes the directory rows (cascades to accounts, credentials, mailbox and sessions);
3. deletes the file.

The cleanup also runs at startup. A deletion is logged to `security_log` with the workplace id and creation time only.

### 4.9 Pages

| Page | Contents |
|---|---|
| `/` (sign-in) | Three panels. **Sign in**: username, password, "Sign in with a passkey". **Create a demo login**: the form from 4.4. **Quick look**: the four persona buttons. Plus a short "HIPAA-style safeguards in this demo" panel (section 6). |
| `/setup` | Choose and set up a second step; shows the QR code or passkey prompt, then the recovery codes. Reachable only with a `halfway` session or from the app's account menu. |
| `/verify` | The second step during sign-in: the methods this account has, plus "use a recovery code". |
| `/mailbox` | The Demo mailbox for the account part-way through sign-in, labelled "In a real deployment, this is your email inbox." |
| App account menu | "Add another second step", "Sign out", and the time left before automatic logoff. |

## 5. Error handling

- Every refusal uses the existing `HttpError` shape and codes. New codes:
  - account_locked
  - second_step_required
  - session_idle
  - demo_full
  - creation_limited
- Sign-in error messages never say whether a username exists.
- A failure to create a workplace file deletes any half-made file and directory rows, and shows "Couldn't create your workplace; try again".
- Expired `halfway` sessions return to the sign-in page with "Sign-in timed out".

## 6. The HIPAA-style safeguards story

The sign-in page panel and a README section map features to the Security Rule's technical safeguards (45 CFR 164.312):

| Safeguard | In this demo |
|---|---|
| Unique user identification (164.312(a)(2)(i)) | every visitor has their own login |
| Automatic logoff (164.312(a)(2)(iii)) | signed out after 15 idle minutes |
| Person or entity authentication (164.312(d)) | a required second step for every account |
| Audit controls (164.312(b)) | sign-ins, failures, lockouts and logoffs recorded |
| Access control (164.312(a)(1)) | roles as today, plus private workplaces |

Below it: "These are HIPAA-style safeguards shown on synthetic data. A real deployment also needs a signed BAA with every vendor that touches PHI, risk analysis, policies and training. Software alone is never 'HIPAA compliant'."

## 7. Testing

**Unit tests**
- TOTP against the RFC 6238 Appendix B vectors (SHA-1), plus window and replay tests.
- Recovery-code single use.
- Email-code expiry and reuse.
- Lockout counts and expiry, idle and absolute logoff, and halfway-session expiry, all with the existing fake clock.
- Username and password rules.
- Creation limits (per address, and global).
- Cleanup removes rows and files.
- The `EmailSender` interface.

**Isolation suite**
- Create two private workplaces with the same role and one with every other role.
- For every API route, make the request as each login and assert that no record id, patient name or claim id from another workplace appears.
- Assert that writes land only in the caller's file.
- The test enumerates the Express router, so a new route without coverage fails the suite.

**Passkeys**
- Server tests use recorded registration and assertion fixtures.

**Real-browser (Playwright, local server)**
- Create a login.
- Set up an authenticator: the test reads the secret from the setup page and computes codes.
- Sign out, then sign in with a code and then with a recovery code.
- Fail 5 times and see the lock.
- Advance time to see idle logoff (fake clock behind a test-only flag, never in production).
- Passkey setup and sign-in in Chrome's virtual authenticator (CDP `WebAuthn.addVirtualAuthenticator`).

**Existing suite**
- All 229 existing tests keep passing against the shared workplace.

## 8. Rollout

- Work happens on branch `careops-signin`. The live site keeps running from `main` until the operator says merge.
- New `.env` values: `TOTP_KEY` (32 random bytes, base64). Optional: `PRIVATE_WORKPLACE_CAP` (default 200), `CREATIONS_PER_HOUR` (default 3).
- On first start after deploy:
  - the directory is created;
  - the shared workplace is registered;
  - `llm_calls` and `lab_results` rows are copied from `careops.db` into the directory, once, guarded by a migration marker.
- The Docker volume `/data` already holds `careops.db`. The `workplaces/` folder is created beside it.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Disk use from 200 workplace files | Each seeded file is about 100 KB, so about 20 MB at the cap. Cleanup runs every 10 minutes. |
| The per-request database refactor misses a closure that still uses the shared `db` | The isolation suite catches any route that reads the shared file from a private session. The shared `db` is no longer passed to routers at all. |
| Passkey rp-id mismatch behind Traefik | The rp id comes from configuration (`PUBLIC_HOST`), not the request's Host header. It is checked in the deploy smoke test. |
| A visitor types real personal data into the username | Only letters, digits and `_`, at most 32. The 24-hour deletion. A warning on the form. |
