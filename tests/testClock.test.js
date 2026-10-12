import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from './helpers.js';
import { adjustableClock } from '../src/util/clock.js';

test('adjustableClock moves forward by the amount asked', () => {
  const c = adjustableClock();
  const before = c.now().getTime();
  c.advance(60_000);
  assert.ok(c.now().getTime() - before >= 60_000);
});

test('the test clock routes exist only when testClock is on', async (t) => {
  const off = await startTestApp(); t.after(off.close);
  assert.notEqual((await fetch(`${off.base}/api/test/clock`)).status, 200);
  const on = await startTestApp({ clock: adjustableClock(), config: { testClock: true } }); t.after(on.close);
  const before = Date.parse((await (await fetch(`${on.base}/api/test/clock`)).json()).now);
  const r = await fetch(`${on.base}/api/test/clock/advance`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ms: 3_600_000 }) });
  assert.ok(Date.parse((await r.json()).now) - before >= 3_600_000);
});
