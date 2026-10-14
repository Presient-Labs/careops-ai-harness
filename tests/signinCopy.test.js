import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from './helpers.js';

let t;
before(async () => { t = await startTestApp(); });
after(async () => { await t.close(); });

test('the safeguard table scopes login and second-step claims to the private demo login', async () => {
  const html = await (await fetch(`${t.base}/`)).text();
  assert.ok(html.includes('Each private demo login belongs to one visitor. Quick look skips sign-in and shares one workplace.'));
  assert.ok(html.includes('The private demo login requires a second step: authenticator app, emailed code or passkey. Quick look has no second step.'));
  assert.ok(html.includes('Quick look shares a synthetic workplace and shows role behaviour only.'));
  assert.ok(!html.includes('Every visitor has their own login'));
  assert.ok(!html.includes('A required second step'));
  assert.ok(html.includes('shown on synthetic data'));
  assert.ok(html.includes('Demo mailbox'));
});
