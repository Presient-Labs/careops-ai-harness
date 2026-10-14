# CareOps REST API Contract (v1 — frozen for the Monday demo)

Frontend (`web/`) and backend (`src/`) are built in parallel against this file. Change it only with both sides updated in the same commit.

## Conventions

- All endpoints are same-origin JSON under `/api`. Session cookie `careops_sid` (httpOnly, SameSite=Strict; Path=/, or Path=/careops when served at shawndemos.com/careops/ behind Traefik's StripPrefix, which sends `X-Forwarded-Prefix: /careops`). The front end uses only relative URLs, so it works at either place.
- Every **mutating** request (POST) except `/api/auth/login` must send header `X-CSRF-Token: <csrfToken>` (from login or `/api/auth/me`).
- Errors: HTTP 4xx/5xx with body `{"error": {"code": "string", "message": "user-safe text", "correlationId": "string"}}`.
  Codes used: `unauthenticated` (401), `forbidden` (403), `not_found` (404), `invalid_request` (400), `conflict` (409), `rate_limited` (429), `ai_unavailable` (503), `internal` (500).
- Dates are `YYYY-MM-DD` (America/New_York calendar). Timestamps are ISO-8601 UTC strings. Money is integer cents.
- `idempotencyKey`: client-generated UUID (`crypto.randomUUID()`), one per intended action: the client reuses it when retrying the same action (e.g. after a dropped connection) and makes a new one when the action changes or succeeds. Re-sending the same key returns the original result and never creates a second record.

## Types

```ts
User        = { id: string, username: string, displayName: string, role: "employee"|"manager"|"billing"|"admin" }
PtoRequest  = { id: string, userId: string, employeeName: string, date: string, hours: number,
                status: "PENDING"|"APPROVED"|"DENIED", decidedBy: string|null, decidedAt: string|null, createdAt: string }
Claim       = { id: string, patientName: string, payer: string, amountCents: number, serviceDate: string,
                status: "SUBMITTED"|"PENDING_INFO"|"DENIED"|"APPEALED"|"RESUBMITTED"|"PAID"|"CLOSED",
                denialCode: string|null, denialReason: string|null }
BillingTask = { id: string, claimId: string, kind: "AUTH_DOCUMENTATION"|"CODING_REVIEW"|"PAYER_CALL"|"APPEAL_PREP",
                note: string, status: "OPEN"|"DONE", createdBy: string, createdAt: string }
Citation    = { docId: string, title: string }
ChatTurn    = { turnId: string,
                status: "answered"|"denied"|"clarify"|"ai_unavailable"|"invalid_output",
                answer: string,
                citations: Citation[],
                clarification: null | { question: string, options: { label: string, message: string }[] },
                proposedAction: null | { id: string, tool: string, summary: string },
                safety: string[] /* plain-language notes when the harness stepped in (injection flagged, tool blocked) */,
                model: string|null, costUsd: number, latencyMs: number }
TraceStep   = { name: "identity"|"policy"|"state"|"retrieval"|"reasoning"|"validation"|"execution"|"audit",
                status: "ok"|"denied"|"error"|"skipped", summary: string, detail: object, ms: number }
Trace       = { turnId: string, at: string, user: User, steps: TraceStep[], decision: Decision | null }
Decision    = { actor, role, intent, requiredPermission, authorization: "ALLOWED"|"DENIED", restrictedRetrieval, modelReceivedRestrictedData: "NO",
                sources: string[], model: string|null, requestedAction: string|null, validation, execution: "NONE"|"AWAITING CONFIRMATION"|"SUCCESS"|"REJECTED",
                stateChange: string|null, auditEventId, securityEventId, securityEventIds: string[], executionAuditId }   // event ids look like EVT-000123
AuditEvent  = { id: number, at: string, actorName: string|null, actorRole: string|null, kind: string,
                security: boolean, turnId: string|null, detail: object }
```

## Auth

| Method & path | Body | Response |
|---|---|---|
| `POST /api/auth/login` | `{username, password}` | `200 {stage: 'halfway', csrfToken, username, role, methods}` — password only; finish with a second step (see [Accounts and sign-in](#accounts-and-sign-in)) |
| `POST /api/auth/logout` | – | `204` |
| `GET /api/auth/me` | – | `200 {user: User, csrfToken, session: {idleTimeoutMs, expiresAt, accountSession}}` · `401` |
| `POST /api/auth/ping` | – | `204` — "Stay signed in"; counts as activity for the idle timer · `401` |
| `POST /api/auth/demo` | `{persona: 'jordan'\|'priya'\|'marcus'\|'dana'}` | `200 {user: User, csrfToken}` + cookie — **Quick look**: a full session in the shared workplace, no sign-in |

## Accounts and sign-in

A demo login is an account with a private workplace (its own database file, deleted 24 hours after creation). Sign-in has two stages:

1. **Halfway session** — after the password only. It lasts 5 minutes and can do nothing except finish sign-in (`GET /second-step`, `POST /verify`, `/email/send`, `GET /mailbox`, `POST /logout`) and, **only when the account has no second step yet**, set one up. A halfway session for an account that already has a second step gets `403` from every setup endpoint.
2. **Full session** — after a second step. It ends after 15 idle minutes or 8 hours, whichever comes first.

All endpoints are under `/api/auth` and JSON. "Setup" means a full session, or a halfway session whose account has no second step yet. Calls without a session (`/accounts`, `/login`, `/passkeys/login/*`) need no CSRF token; every other POST needs `X-CSRF-Token`. When setup completes an account's first second step during a halfway session, the session is replaced with a full one and the response carries the new `csrfToken`.

| Endpoint | Session | Body | Returns |
|---|---|---|---|
| `POST /accounts` | none | `{ username, password, role }` | `201 { stage: 'halfway', csrfToken, username, role, methods: [] }` |
| `POST /login` | none | `{ username, password }` | `{ stage: 'halfway', csrfToken, username, role, methods }` |
| `GET /second-step` | halfway or full | — | `{ stage, username, role, methods, canSetup, csrfToken }` |
| `POST /verify` | halfway | `{ method: 'totp'\|'email'\|'recovery', code }` | `{ stage: 'full', csrfToken, ... }` |
| `POST /email/send` | halfway or full | `{ purpose: 'signin'\|'enable' }` | `204` |
| `POST /email/confirm` | setup | `{ code }` | `{ stage, csrfToken?, methods }` |
| `POST /totp/setup` | setup | — | `{ secret, otpauthUrl, qr }` |
| `POST /totp/confirm` | setup | `{ code }` | `{ stage, csrfToken?, methods, recoveryCodes }` |
| `POST /passkeys/register/options` | setup | — | `{ options, challengeId }` |
| `POST /passkeys/register/verify` | setup | `{ challengeId, response }` | `{ stage, csrfToken?, methods }` |
| `POST /passkeys/login/options` | none | — | `{ options, challengeId }` |
| `POST /passkeys/login/verify` | none | `{ challengeId, response }` | `{ stage: 'full', csrfToken, ... }` |
| `GET /mailbox` | halfway or full | — | `{ messages }` — the labelled Demo mailbox |

Limits: usernames are 3–32 characters from `[A-Za-z0-9_]` and matched case-insensitively; passwords are 12–200 characters and not on the bundled common-password list; 5 failed attempts lock an account for 15 minutes; 20 sign-in attempts per address per minute; 3 demo logins per address per hour (IPv6 counted per /64); at most 200 live private workplaces; authenticator and emailed codes are single use.

Error codes added by sign-in (same error body as above):

- `account_locked` (423)
- `second_step_required` (401)
- `session_idle` (401)
- `invalid_credentials` (401)
- `invalid_code` (422)
- `username_taken` (409)
- `creation_limited` (429)
- `demo_full` (503)
- `workplace_failed` (503)

## Assistant (all roles)

| Method & path | Body | Response |
|---|---|---|
| `POST /api/chat` | `{message: string (1–2000 chars), model?: string}` | `200 ChatTurn` (policy denials are `200` with `status:"denied"`) · `429 rate_limited` |
| `POST /api/actions/:id/confirm` | – | `200 {action: {id, tool, status: "EXECUTED"|"REJECTED"|"CANCELLED"|"EXPIRED", result: object, message: string}}` — repeat calls return the same body; proposals expire after 30 minutes |
| `POST /api/actions/:id/dismiss` | – | `200 {action: {id, tool, status: "CANCELLED", message}}`; `409` if already executed, cancelled or expired; `404` if not yours |
| `GET /api/traces/:turnId` | – | `200 Trace` (own turns; admin: any) · `404` |
| `GET /api/models` | – | `200 {default: string, models: {id, label, inPerM, outPerM}[]}` |

`clarification.options[].message` is sent verbatim as the next `POST /api/chat` message when the user clicks the option.

## PTO (employee, manager, billing)

| Method & path | Body | Response |
|---|---|---|
| `GET /api/pto/me` | – | `200 {balance: {hoursAvailable, hoursPending}, requests: PtoRequest[]}` |
| `POST /api/pto/requests` | `{date, hours?: 8, idempotencyKey}` | `201 PtoRequest` · `400 invalid_request` (policy reason in `message`) · `409 conflict` |
| `GET /api/pto/approvals` *(manager)* | – | `200 {requests: PtoRequest[]}` (direct reports, newest first) |
| `POST /api/pto/requests/:id/decision` *(manager)* | `{decision: "APPROVED"|"DENIED", idempotencyKey}` | `200 PtoRequest` · `409 conflict` (already decided) |

## Billing (billing)

| Method & path | Body | Response |
|---|---|---|
| `GET /api/claims` | – | `200 {claims: Claim[]}` (assigned to caller) |
| `GET /api/claims/:id` | – | `200 {claim: Claim, tasks: BillingTask[]}` · `404` if missing **or not assigned** (existence is not revealed) |
| `POST /api/claims/:id/followups` | `{kind, note, idempotencyKey}` | `201 BillingTask` |
| `POST /api/claims/:id/transition` | `{to: Claim.status}` | `200 Claim` · `409 conflict` with allowed transitions in `message` |

## Admin / compliance (admin)

| Method & path | Body | Response |
|---|---|---|
| `GET /api/audit?security=1&limit=100` | – | `200 {events: AuditEvent[]}` newest first |
| `POST /api/admin/reset` | – | `204` — re-seeds all business data; sessions survive |
| `GET /api/labs/attacks` | – | `200 AttackLabResult` (last recorded run) |
| `POST /api/labs/attacks/run` | – | `200 AttackLabResult` · `503 ai_unavailable` if budget exhausted |
| `GET /api/labs/models` | – | `200 ModelLabResult` |
| `POST /api/labs/models/run` | – | `200 ModelLabResult` |

```ts
AttackLabResult = { at: string, model: string, attacks: number,
  summary: { baseline: { promptLeaks: number, boundaryMoves: number }, hardened: { promptLeaks: number, boundaryMoves: number } },
  results: { attack: string, category: "direct"|"indirect", message: string,
             baseline: { leaked: boolean, boundaryMoved: boolean, answer: string, turnId: string },
             hardened: { leaked: boolean, boundaryMoved: boolean, answer: string, turnId: string } }[] }
ModelLabResult = { at: string, items: number, reps: number, defaultModel: string,
  models: { id: string, label: string, passRate: number, passed: number, total: number, errors: number /* provider outages, excluded from passRate */,
            criteria: { json_valid: number, citations_valid: number, no_fabricated_ids: number, expected_action: number, key_fact: number },
            avgCostUsd: number, costPer1k: number, avgLatencyMs: number }[],
  rows: { itemId: string, question: string, model: string, rep: number, pass: boolean, failed: string[], infraError: boolean, costUsd: number, latencyMs: number }[] }
```

## Ops (no auth)

| Method & path | Response |
|---|---|
| `GET /health` | `200 {status: "ok"}` |
| `GET /ready` | `200 {status: "ready"|"degraded", checks: {database, knowledge, config, reasoningProvider}}` each `"ok"|"down"|"unconfigured"` · `503 {status: "not_ready", ...}` if database is down |
