import { test, expect } from '@playwright/test';

// Runs against a local server (BASE_URL), never the shared demo: it creates a billing follow-up.
test.skip(!/127\.0\.0\.1|localhost/.test(process.env.BASE_URL ?? ''), 'creates data — run only against a local server (BASE_URL=http://127.0.0.1:...)');

test('a retry after a dropped connection does not create a duplicate follow-up', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-persona="marcus"]').click(); // Quick look: the shared workplace's billing persona
  await expect(page).toHaveURL(/\/app\.html/);
  await page.getByRole('link', { name: 'Claims', exact: false }).click();
  await page.getByRole('button', { name: 'Open claim CLM-1004', exact: true }).click();
  const keys = [];
  let dropped = false;
  await page.route('**/api/claims/CLM-1004/followups', async (route) => {
    keys.push(route.request().postDataJSON().idempotencyKey);
    if (!dropped) { dropped = true; await route.fetch(); return route.abort('connectionreset'); } // server saved it; the browser never hears back
    return route.continue();
  });
  await page.getByLabel('Note', { exact: true }).fill('Request the missing authorization record.');
  await page.getByRole('button', { name: 'Add follow-up', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Claim details' }).getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Add follow-up', exact: true }).click();
  await expect(page.getByText('Follow-up created.', { exact: true })).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  const tasks = await page.request.get('/api/claims/CLM-1004');
  expect((await tasks.json()).tasks.filter(t => t.note === 'Request the missing authorization record.')).toHaveLength(1);
});
