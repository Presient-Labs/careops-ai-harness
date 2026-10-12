import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVAL_ITEMS } from '../src/labs/evalSet.js';
import { scoreTurn, chooseDefault } from '../src/labs/modelLab.js';
import { startTestApp } from './helpers.js';
import { FakeProvider } from '../src/llm/fake.js';

test('14 eval items, including the dental-filing and escalation-threshold grounding checks', () => {
  assert.equal(EVAL_ITEMS.length, 14);
  assert.ok(EVAL_ITEMS.find(i => i.id === 'clm-1004-escalation'));
  assert.ok(EVAL_ITEMS.find(i => i.id === 'dental-filing').expect.mustNotSay.length > 0);
});
test('an answer that adds an unsupported procedure fails key_fact (mustNotSay)', () => {
  const item = { id: 'd', expect: { tool: null, keyFacts: [], mustCite: false, mustNotSay: ['submit the claim', 'directly to the insurer'] } };
  const turn = (answer) => ({ status: 'answered', answer, citations: [], proposedAction: null, _raw: JSON.stringify({ answer }) });
  assert.ok(scoreTurn(item, turn('Your dental office will submit the claim directly to the insurer.')).failed.includes('key_fact'));
  const real = EVAL_ITEMS.find(i => i.id === 'dental-filing');
  assert.ok(scoreTurn(real, turn('To file a claim, submit the invoice from your dental provider to the people team for reimbursement.')).failed.includes('key_fact'), 'half-invented steps must fail too');
  assert.equal(scoreTurn(real, turn("Cleanings are covered at 100%. The guide doesn't describe how claims are submitted, so ask the people team.")).pass, true, 'a grounded answer that mentions submission must still pass');
  assert.equal(scoreTurn(item, turn('The Benefits Guide does not describe how to file a claim; ask the people team.')).pass, true);
});
const item = { id: 'x', expect: { tool: 'create_billing_followup', keyFacts: [['authorization']], mustCite: true } };
test('all five binary criteria pass', () => {
  const s = scoreTurn(item, { status: 'answered', answer: 'Authorization was missing.', citations: [{ docId: '3' }], proposedAction: { tool: 'create_billing_followup' }, _raw: '{"answer":"Authorization was missing."}' });
  assert.equal(s.pass, true); assert.deepEqual(s.failed, []);
});
test('withheld output fails json/citations/key_fact; wrong tool fails expected_action', () => {
  assert.deepEqual(scoreTurn(item, { status: 'invalid_output', answer: '', citations: [], proposedAction: null, _raw: 'nope' }).failed.sort(), ['citations_valid', 'expected_action', 'json_valid', 'key_fact']);
});
test('a fabricated record id fails no_fabricated_ids', () => {
  const s = scoreTurn(item, { status: 'invalid_output', reason: 'referenced records not in the authorized context (CLM-5555)', answer: '', citations: [], proposedAction: null, _raw: '{"answer":"x"}' });
  assert.ok(s.failed.includes('no_fabricated_ids'));
});
test('provider outages are infrastructure errors, not model failures', () => {
  const s = scoreTurn(item, { status: 'ai_unavailable', answer: 'unavailable', citations: [], proposedAction: null, _raw: '' });
  assert.equal(s.infraError, true);
});
test('pass rate excludes infrastructure errors and reports them separately', async () => {
  const { summarizeModel } = await import('../src/labs/modelLab.js');
  const rows = [
    { model: 'm', pass: true, infraError: false, criteria: { json_valid: true }, costUsd: 0.002, latencyMs: 100 },
    { model: 'm', pass: false, infraError: true, criteria: { json_valid: false }, costUsd: 0, latencyMs: 0 },
  ];
  const s = summarizeModel({ id: 'm', label: 'M' }, rows);
  assert.equal(s.total, 1); assert.equal(s.passRate, 1); assert.equal(s.errors, 1); assert.equal(s.avgCostUsd, 0.002);
});
test('default = cheapest model at ≥90%, else best pass rate', () => {
  assert.equal(chooseDefault([{ id: 'a', passRate: 0.95, avgCostUsd: 0.01 }, { id: 'b', passRate: 0.91, avgCostUsd: 0.001 }, { id: 'c', passRate: 0.5, avgCostUsd: 0.0001 }]), 'b');
  assert.equal(chooseDefault([{ id: 'a', passRate: 0.8, avgCostUsd: 0.01 }, { id: 'b', passRate: 0.6, avgCostUsd: 0.001 }]), 'a');
});
test('model lab run persists results and sets the chat default; never mutates business data', async (t) => {
  const provider = new FakeProvider(() => ({ answer: 'ok' }));
  const app = await startTestApp({ provider }); t.after(app.close);
  const { call } = await app.login('dana');
  const r = (await call('/api/labs/models/run', { method: 'POST' })).body;
  assert.equal(r.items, EVAL_ITEMS.length); assert.equal(r.models.length, 4); assert.equal(r.rows.length, EVAL_ITEMS.length * 4 * r.reps);
  assert.equal((await call('/api/models')).body.default, r.defaultModel);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM pto_requests').get().n, 1); // only the seeded one
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM billing_tasks').get().n, 0);
});

test('model lab runs on its own seeded data, independent of live state', async (t) => {
  // echo the PTO balance the model is shown; the lab must see the seeded 40 even after live data changed
  const provider = new FakeProvider((req) => {
    const m = req.user.match(/"hoursAvailable":(\d+)/);
    return { answer: m ? `You have ${m[1]} hours.` : 'ok' };
  });
  const app = await startTestApp({ provider }); t.after(app.close);
  app.db.prepare("UPDATE pto_balances SET hours_available = 32 WHERE user_id = 'u-jordan'").run();
  const auditBefore = app.db.prepare('SELECT COUNT(*) n FROM audit_events').get().n;
  const { call } = await app.login('dana');
  const r = (await call('/api/labs/models/run', { method: 'POST' })).body;
  const balanceRows = r.rows.filter(x => x.itemId === 'pto-balance');
  assert.ok(balanceRows.length > 0 && balanceRows.every(x => !x.failed.includes('key_fact')), 'lab saw live balance instead of seeded 40');
  assert.equal(app.db.prepare("SELECT hours_available h FROM pto_balances WHERE user_id = 'u-jordan'").get().h, 32); // live data untouched
  const labAudit = app.db.prepare("SELECT COUNT(*) n FROM audit_events WHERE kind = 'chat_turn'").get().n;
  assert.equal(labAudit, 0, 'lab turns must not flood the live audit log');
  assert.ok(app.db.prepare('SELECT COUNT(*) n FROM audit_events').get().n >= auditBefore);
});

test('choosing the default counts provider errors as misses (a demo needs answers, not timeouts)', () => {
  const models = [
    { id: 'flaky-cheap', passRate: 31 / 34, passed: 31, total: 34, errors: 2, avgCostUsd: 0.0001 },
    { id: 'steady', passRate: 1, passed: 36, total: 36, errors: 0, avgCostUsd: 0.0003 },
  ];
  assert.equal(chooseDefault(models), 'steady');
});

test('the chat default is recomputed from stored results with the current rule', async (t) => {
  const app = await startTestApp(); t.after(app.close);
  const stored = { at: 'x', items: 12, reps: 3, defaultModel: 'openai/gpt-oss-120b', rows: [], models: [
    { id: 'openai/gpt-oss-120b', passed: 31, total: 34, errors: 2, passRate: 31 / 34, avgCostUsd: 0.000134 },
    { id: 'qwen/qwen3-235b-a22b-2507', passed: 36, total: 36, errors: 0, passRate: 1, avgCostUsd: 0.000252 },
  ] };
  app.directory.prepare("INSERT INTO lab_results (lab, at, results_json) VALUES ('models', 'x', ?)").run(JSON.stringify(stored));
  const { call } = await app.login('jordan');
  assert.equal((await call('/api/models')).body.default, 'qwen/qwen3-235b-a22b-2507');
  const dana = await app.login('dana');
  assert.equal((await dana.call('/api/labs/models')).body.defaultModel, 'qwen/qwen3-235b-a22b-2507');
});
test('each scored answer is kept with its evidence so a reviewer can check the score', async (t) => {
  const provider = new FakeProvider(() => ({ answer: 'A full day of PTO is 8 hours.', citations: ['1'] }));
  const app = await startTestApp({ provider }); t.after(app.close);
  const { call } = await app.login('dana');
  await call('/api/labs/models/run', { method: 'POST' });
  const stored = (await call('/api/labs/models')).body;
  assert.equal(stored.scoringVersion, 2);
  const row = stored.rows[0];
  assert.equal(row.answer, 'A full day of PTO is 8 hours.');
  assert.ok(Array.isArray(row.sources)); assert.equal(typeof row.status, 'string');
  assert.equal(typeof row.validation, 'string'); assert.ok('proposedAction' in row);
  assert.ok(row.criteria && typeof row.criteria.key_fact === 'boolean', 'per-criterion results are kept');
});
test('key facts match through Unicode spacing and hyphen variants (found by reading stored answers)', () => {
  const item = EVAL_ITEMS.find(i => i.id === 'pto-notice');
  const answer = 'You need to give at least 2 business days notice (PTO Policy §2).';
  const r = scoreTurn(item, { status: 'answered', answer, citations: [{ docId: '1' }], proposedAction: null, _raw: JSON.stringify({ answer, citations: ['1'] }) });
  assert.equal(r.criteria.key_fact, true);
});
test('dental-filing: deferring to the people team is grounded, even when it says "submit your claim"', () => {
  const item = EVAL_ITEMS.find(i => i.id === 'dental-filing');
  const turn = (answer) => ({ status: 'answered', answer, citations: [{ docId: '2' }], proposedAction: null, _raw: JSON.stringify({ answer, citations: ['2'] }) });
  const ok = "Dental cleanings are covered at 100% (Employee Benefits Guide 2026 §2). The guide does not describe the process for filing a claim, so you'll need to check with the people team for the specific steps to submit your dental cleaning claim.";
  assert.equal(scoreTurn(item, turn(ok)).criteria.key_fact, true);
  assert.equal(scoreTurn(item, turn('Cleanings are covered at 100%. Your dental office will submit the claim for you.')).criteria.key_fact, false);
});
test('each row keeps the exact facts and document IDs the model was given, for replay', async (t) => {
  const provider = new FakeProvider(() => ({ answer: 'A full day of PTO is 8 hours.', citations: ['1'] }));
  const app = await startTestApp({ provider }); t.after(app.close);
  const { call } = await app.login('dana');
  await call('/api/labs/models/run', { method: 'POST' });
  const row = (await call('/api/labs/models')).body.rows.find(r => r.itemId === 'pto-balance');
  assert.equal(row.context.facts.yourPtoBalance.hoursAvailable, 40);
  assert.ok(Array.isArray(row.context.docIds));
});
