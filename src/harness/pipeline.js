import { newId } from '../util/ids.js';
import { nyDate } from '../util/clock.js';
import { formatDate, resolvePtoDate, requestedHours } from '../util/dates.js';
import { can, INTENT_PERMISSION, ROLE_COLLECTIONS } from '../policy/permissions.js';
import { classifyIntent } from '../policy/intent.js';
import { getBalance, listMyPto, ptoDateProblem } from '../domain/pto.js';
import { getAssignedClaim, listAssignedClaims } from '../domain/claims.js';
import { retrieveForUser, buildQuery, flagInstructionLike } from '../retrieval/retrieve.js';
import { CANARY } from './prompts.js';
import { proposeAction } from '../tools/actions.js';
import { startTrace } from './trace.js';
import { buildModelInput } from './context.js';
import { validateTurn } from './validate.js';
import { chooseDefault } from '../labs/chooseDefault.js';

const DENIAL_TEXT = {
  billing: "I can't help with claims or patient billing information — your role doesn't have access, so no billing data was retrieved. If you need billing help, contact the billing team.",
  pto_request: "Your role can't submit PTO requests in CareOps.",
  default: "Your role doesn't have access to that.",
};
const UNAVAILABLE = 'AI reasoning is temporarily unavailable. No action was taken. Please try again.';
const SKIP = (trace, names, why) => names.forEach(n => trace.add(n, 'skipped', why));

// Minimum necessary, scoped to this user: the only personal data the model will ever see.
const ASKS_ABOUT_CLAIMS = /\b(claims?|denials?|denied|queue|owe[sd]?|balances?|outstanding)\b/i;
const ASKS_ABOUT_PATIENTS = /\b(patients?|who)\b/i;
export function gatherFacts(db, user, intent, claimIds, dateRes, message = '') {
  const facts = {};
  if ((intent === 'pto_question' || intent === 'pto_request') && can(user, 'pto:read:self')) {
    const b = getBalance(db, user.id);
    // labelled as the asker's own, so a manager asking about a report can't have it misattributed
    if (b) facts.yourPtoBalance = { owner: user.displayName, ...b, hoursRequestable: b.hoursAvailable - b.hoursPending };
    // the asker's own recent requests (no record ids), so "was my request approved?" can be answered
    facts.yourPtoRequests = listMyPto(db, user).requests.slice(0, 5).map(r => ({ date: r.date, hours: r.hours, status: r.status }));
  }
  if (intent === 'billing') {
    if (claimIds.length) facts.claims = claimIds.map(id => getAssignedClaim(db, user, id)).filter(Boolean);
    else if (ASKS_ABOUT_CLAIMS.test(message)) {
      // minimum necessary: the denied queue only when the question is about claims, patient names only when asked
      const keepNames = ASKS_ABOUT_PATIENTS.test(message);
      facts.claims = listAssignedClaims(db, user).filter(c => c.status === 'DENIED').map(c => (keepNames ? c : { ...c, patientName: undefined }));
    } else facts.claims = [];
    facts.missingClaimIds = claimIds.filter(id => !facts.claims.some(c => c.id === id));
  }
  if (dateRes?.kind === 'date') facts.ptoDateCandidates = [dateRes.date];
  if (intent === 'pto_request' && requestedHours(message) != null) facts.ptoRequestedHours = requestedHours(message);
  return facts;
}
const describeFacts = (f) => [
  f.yourPtoBalance && `${f.yourPtoBalance.owner}'s PTO balance ${f.yourPtoBalance.hoursAvailable} h (${f.yourPtoBalance.hoursPending} h pending)`,
  f.claims && `${f.claims.length} authorized claim(s)${f.claims.length ? `: ${f.claims.map(c => c.id).join(', ')}` : ''}`,
  f.ptoDateCandidates && `date resolved deterministically to ${f.ptoDateCandidates[0]}`,
].filter(Boolean).join('; ') || 'No personal records needed.';

// Authoritative values shown beside the answer, written by code from the database — never by the model.
const usd = (cents) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
export function recordsFor(f) {
  const out = [];
  if (f.yourPtoBalance) { const b = f.yourPtoBalance; out.push(`PTO: ${b.hoursAvailable} h available · ${b.hoursPending} h pending · ${b.hoursRequestable} h requestable`); }
  for (const c of (f.claims ?? []).slice(0, 5)) out.push(`${c.id}: ${c.status} · ${usd(c.amountCents)} · ${c.payer}${c.denialCode ? ` · ${c.denialCode}` : ''}`);
  return out;
}

// Recomputed from the stored Model Lab results each time, so the selection rule (not a stale stored field) decides.
export function getDefaultModel(db, config) {
  const row = db.prepare("SELECT results_json FROM lab_results WHERE lab = 'models'").get();
  const models = row ? JSON.parse(row.results_json).models : null;
  return (models?.length && chooseDefault(models)) || config.defaultModel;
}

export function createHarness({ db, kb, provider, clock, audit, budget, prompts, config, modelsDb = db }) {
  function finish(trace, turn, ev, turnAudit) {
    const eventId = ev({ actor: trace.user, kind: 'chat_turn', turnId: turn.turnId, detail: { status: turn.status, model: turn.model } });
    trace.decision.auditEventId = eventId;
    trace.add('audit', 'ok', `Recorded as ${eventId} (turn ${turn.turnId}).`, { status: turn.status, auditEventId: eventId });
    turnAudit.saveTrace(trace.toJSON());
    return turn;
  }

  async function runTurn({ db: turnDb = db, audit: turnAudit = audit, user, message, model = getDefaultModel(modelsDb, config), promptVariant = 'hardened', purpose = 'chat' }) {
    const turnId = newId('turn');
    const trace = startTrace(turnId, user, clock);
    // lab turns are tagged so they are never mistaken for a real person's activity in the audit log
    const ev = (e) => turnAudit.event(purpose === 'chat' ? e : { ...e, detail: { ...(e.detail ?? {}), purpose } });
    const reply = (f) => finish(trace, { turnId, status: 'answered', answer: '', citations: [], clarification: null, proposedAction: null, model: null, costUsd: 0, latencyMs: 0, safety, ...f }, ev, turnAudit);
    // Plain-English decision record shown at the top of "Why did this happen?"
    const decision = trace.decision = { actor: user.displayName, role: user.role, intent: null, requiredPermission: null, authorization: null,
      restrictedRetrieval: 'NOT EXECUTED', modelReceivedRestrictedData: 'NO', sources: [], model: null, requestedAction: null,
      validation: 'NOT RUN', execution: 'NONE', stateChange: null, auditEventId: null, securityEventId: null, securityEventIds: [], executionAuditId: null };
    const safety = []; // plain-language notes shown on the answer when the harness stepped in
    const sec = (e) => { const id = ev({ ...e, security: true }); decision.securityEventIds.push(id); decision.securityEventId ??= id; return id; };
    trace.add('identity', 'ok', `Signed in as ${user.displayName} (${user.role}). Identity comes from the server session, not the browser.`, { userId: user.id, role: user.role });

    // 1. POLICY — before any data is touched
    const { intent, claimIds } = classifyIntent(message);
    const permission = INTENT_PERMISSION[intent];
    Object.assign(decision, { intent, requiredPermission: permission, authorization: can(user, permission) ? 'ALLOWED' : 'DENIED' });
    if (!can(user, permission)) {
      trace.add('policy', 'denied', `Classified as "${intent}", which requires "${permission}". The ${user.role} role does not have it, so nothing was retrieved.`, { intent, permission });
      SKIP(trace, ['state', 'retrieval', 'reasoning', 'validation', 'execution'], 'Stopped by policy.');
      sec({ actor: user, kind: 'access_denied', turnId, detail: { intent, permission, message: message.slice(0, 200) } });
      return reply({ status: 'denied', answer: DENIAL_TEXT[intent] ?? DENIAL_TEXT.default });
    }
    trace.add('policy', 'ok', `Allowed: "${intent}" requires "${permission}".`, { intent, permission });

    // 2. STATE — authoritative facts from the database
    const dateRes = intent === 'pto_request' ? resolvePtoDate(message, clock.now()) : null;
    const facts = gatherFacts(turnDb, user, intent, claimIds, dateRes, message);
    trace.add('state', 'ok', describeFacts(facts), { facts });

    if (facts.missingClaimIds?.length) {
      const ids = facts.missingClaimIds.join(', ');
      SKIP(trace, ['retrieval', 'reasoning'], 'No authorized record — the model was not asked to guess.');
      trace.add('validation', 'ok', `Resource check: no authorized claim with ID ${ids}.`, { missing: facts.missingClaimIds });
      decision.validation = `PASSED — no authorized claim with ID ${ids}; nothing was guessed`;
      trace.add('execution', 'skipped', 'Nothing to execute.');
      ev({ actor: user, kind: 'resource_not_found', turnId, detail: { claimIds: facts.missingClaimIds } });
      return reply({ answer: `No authorized claim with ID ${ids} was found in your queue. I won't guess at a status, patient, payer, or denial reason. Check the claim number, or ask a billing supervisor whether it is assigned to someone else.` });
    }
    if (dateRes && dateRes.kind !== 'date') {
      SKIP(trace, ['retrieval', 'reasoning'], 'The date must be settled before any action is proposed.');
      let clarification = { question: 'Which date would you like off? Say a weekday (for example "this Friday") or a date like 2026-10-16.', options: [] };
      if (dateRes.kind === 'ambiguous') {
        // only offer dates that pass the PTO rules; explain any that don't
        const today = nyDate(clock.now());
        const [a, b] = dateRes.candidates;
        const bookable = dateRes.candidates.filter(d => !ptoDateProblem(today, d));
        const blocked = dateRes.candidates.filter(d => ptoDateProblem(today, d));
        const why = blocked.map(d => `${formatDate(d)} isn't available: ${ptoDateProblem(today, d)}`).join(' ');
        const question = bookable.length === 2 ? `"${dateRes.phrase}" could mean ${formatDate(a)} or ${formatDate(b)}. Which one did you mean?`
          : bookable.length === 1 ? `"${dateRes.phrase}" could mean ${formatDate(a)} or ${formatDate(b)}. ${why} Did you mean ${formatDate(bookable[0])}?`
          : `"${dateRes.phrase}" could mean ${formatDate(a)} or ${formatDate(b)}, but neither can be booked. ${why}`;
        const hours = requestedHours(message); // carried into the follow-up so choosing a date cannot change the hours
        clarification = { question, options: bookable.map(d => ({ label: formatDate(d), message: hours != null ? `Take ${d} off for ${hours} hours.` : `Take ${d} off.` })) };
      }
      trace.add('validation', 'ok', dateRes.kind === 'ambiguous' ? `Ambiguous date (${dateRes.candidates.join(' or ')}) — asking instead of assuming.` : 'No date given — asking.', { dateResolution: dateRes });
      trace.add('execution', 'skipped', 'Nothing changes until the date is confirmed.');
      return reply({ status: 'clarify', answer: clarification.question, clarification });
    }

    // 3. RETRIEVAL — role-scoped before the model sees anything
    let docs = [];
    let kbUnavailable = false;
    try {
      const r = await retrieveForUser({ kb, user, query: buildQuery(intent, message, facts, claimIds) });
      docs = r.docs;
      decision.restrictedRetrieval = `NONE — queried only ${ROLE_COLLECTIONS[user.role].join(', ')} (allowed for ${user.role}); ${docs.length} document(s) retrieved`;
      decision.sources = docs.map(d => d.title);
      const flaggedDocs = flagInstructionLike(docs);
      const flagNote = flaggedDocs.length ? ` Instruction-like text found in ${flaggedDocs.map(d => `"${d.title}"`).join(', ')} — passed to the model as untrusted data, never as instructions; it cannot grant tools or permissions.` : '';
      trace.add('retrieval', 'ok', `${docs.length} document(s) from ${ROLE_COLLECTIONS[user.role].join(', ')}; other collections were never queried.${flagNote}`, { docs: docs.map(d => ({ id: d.id, title: d.title, collection: d.collection })), filteredOut: r.filteredOut, flaggedDocs });
      if (flaggedDocs.length) {
        sec({ actor: user, kind: 'injection_detected', turnId, detail: { docs: flaggedDocs } });
        safety.push(`Instruction-like text in ${flaggedDocs.map(d => `"${d.title}"`).join(', ')} was treated as data, not instructions.`);
      }
    } catch (err) {
      kbUnavailable = true;
      decision.restrictedRetrieval = 'NONE — knowledge service unavailable';
      safety.push('Policy documents were unavailable, so this answer uses only your records.');
      trace.add('retrieval', 'error', 'Knowledge service unavailable — continuing with database facts only.', { error: String(err.message) });
    }

    // 4. REASONING
    if (budget.remaining() <= 0) {
      trace.add('reasoning', 'skipped', 'Daily AI budget reached — no model call made.', { dailyBudgetUsd: config.dailyBudgetUsd });
      SKIP(trace, ['validation', 'execution'], 'No state was changed.');
      ev({ actor: user, kind: 'budget_exhausted', turnId });
      return reply({ status: 'ai_unavailable', answer: UNAVAILABLE });
    }
    const input = buildModelInput({ systemPrompt: prompts[promptVariant], user, intent, facts, docs, message, today: nyDate(clock.now()), kbUnavailable });
    // Derived from what is actually in the model input, not a default: every document's collection must be one the role may read.
    const outOfRole = docs.filter(d => !ROLE_COLLECTIONS[user.role].includes(d.collection));
    decision.modelReceivedRestrictedData = outOfRole.length ? `YES — ${outOfRole.map(d => d.title).join(', ')}`
      : `NO — checked: ${docs.length} document(s), all from ${ROLE_COLLECTIONS[user.role].join(', ')}; facts: ${Object.keys(facts).join(', ') || 'none'}`;
    if (outOfRole.length) {
      sec({ actor: user, kind: 'restricted_context_blocked', turnId, detail: { docs: outOfRole.map(d => d.id) } });
      trace.add('reasoning', 'denied', 'Out-of-role content reached the model input — the model was not called.', { docs: outOfRole.map(d => d.id) });
      SKIP(trace, ['validation', 'execution'], 'No state was changed.');
      return reply({ status: 'ai_unavailable', answer: UNAVAILABLE });
    }
    let out;
    try {
      decision.model = model;
      out = await provider.complete({ model, ...input });
      budget.record({ model, purpose, usage: out.usage, latencyMs: out.latencyMs, ok: true });
      trace.add('reasoning', 'ok', `${model} answered in ${out.latencyMs} ms for $${out.usage.costUsd.toFixed(5)}.`, { model, promptVariant, usage: out.usage, latencyMs: out.latencyMs });
    } catch (err) {
      budget.record({ model, purpose, usage: null, latencyMs: 0, ok: false });
      trace.add('reasoning', 'error', 'The AI provider failed or timed out.', { model, error: String(err.message) });
      SKIP(trace, ['validation', 'execution'], 'No state was changed.');
      ev({ actor: user, kind: 'provider_failure', turnId, detail: { model, error: String(err.message) } });
      return reply({ status: 'ai_unavailable', answer: UNAVAILABLE, model });
    }

    // 5. VALIDATION — the model's output is a proposal, never authority
    const meta = { model, costUsd: out.usage.costUsd, latencyMs: out.latencyMs, _raw: out.text };
    const v = validateTurn({ text: out.text, docs, facts, user, intent, message, today: nyDate(clock.now()) });
    if (!v.ok) {
      const raw = out.text.includes(CANARY) ? '[redacted: output contained protected system-prompt text]' : out.text.slice(0, 2000);
      trace.add('validation', 'error', `Withheld: ${v.reason}.`, { reason: v.reason, raw });
      trace.add('execution', 'skipped', 'Nothing executed.');
      sec({ actor: user, kind: 'output_rejected', turnId, detail: { reason: v.reason, model } });
      decision.validation = `FAILED — answer withheld: ${v.reason}`;
      return reply({ status: 'invalid_output', answer: "The AI's answer failed a safety check and was withheld.", reason: v.reason, ...meta });
    }
    decision.requestedAction = v.data.proposed_action?.tool ?? null;
    decision.sources = v.citations.length ? v.citations.map(c => c.title) : decision.sources;
    decision.validation = v.actionRejection ? `PASSED with tool request REJECTED: ${v.actionRejection}` : v.notOffered ? `PASSED — ${v.notOffered}` : 'PASSED';
    if (v.actionRejection) {
      sec({ actor: user, kind: 'tool_rejected', turnId, detail: { proposal: v.data.proposed_action, reason: v.actionRejection } });
      safety.push(`The model asked for "${v.data.proposed_action.tool}", which is not an allowed action here — it was blocked and nothing changed.`);
    }
    trace.add('validation', v.actionRejection ? 'denied' : 'ok', v.summary, { actionRejection: v.actionRejection });

    // 6. EXECUTION — deterministic, only after the user confirms
    const proposedAction = v.action ? proposeAction(turnDb, { user, turnId, action: v.action, clock }) : null;
    decision.execution = proposedAction ? 'AWAITING CONFIRMATION' : 'NONE';
    trace.add('execution', proposedAction ? 'ok' : 'skipped', proposedAction ? `Proposed "${proposedAction.summary}". Waiting for the user to confirm — the model cannot execute it.` : 'No action proposed.', { proposedAction });
    const clarification = v.data.needs_clarification ? { question: v.data.needs_clarification, options: [] } : null;
    const records = recordsFor(facts);
    return reply({ status: clarification ? 'clarify' : 'answered', answer: v.data.answer, citations: v.citations, proposedAction, clarification, ...(records.length ? { records } : {}), ...meta });
  }
  return { runTurn };
}
