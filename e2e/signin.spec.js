import { test, expect } from '@playwright/test';
import { totpAt } from '../src/auth/totp.js';

const PW = 'correct horse battery';
let n = 0;
const uniq = (p) => `${p}_${Date.now().toString(36)}${n++}`;
const serverNow = async (request) => Date.parse((await (await request.get('/api/test/clock')).json()).now);
const advance = (request, ms) => request.post('/api/test/clock/advance', { data: { ms } });

async function createLogin(page, username, role = 'employee') {
  await page.goto('/');
  await page.fill('#create-username', username);
  await page.fill('#create-password', PW);
  await page.selectOption('#create-role', role);
  await page.click('#create-form [type=submit]');
  await expect(page).toHaveURL(/\/setup(\.html)?$/);
}
async function setUpAuthenticator(page) {
  await page.click('#totp-start');
  await expect(page.locator('#totp-secret')).not.toBeEmpty();
  const secret = (await page.textContent('#totp-secret')).trim();
  await page.fill('#totp-code', totpAt(secret, await serverNow(page.request)));
  await page.click('#totp-form [type=submit]');
  await expect(page.locator('#recovery')).toBeVisible();
  const codes = await page.locator('#recovery-codes code').allTextContents();
  await page.click('#recovery-done');
  await expect(page).toHaveURL(/\/app\.html/);
  return { secret, codes };
}
async function signOut(page) {
  await page.click('#logout');
  await expect(page.locator('#signin-form')).toBeVisible();
}
async function passwordStep(page, username, password = PW) {
  await page.goto('/');
  await page.fill('#signin-username', username);
  await page.fill('#signin-password', password);
  await page.click('#signin-form [type=submit]');
}

test('create a login, set up an authenticator, then sign back in with a code and with a recovery code', async ({ page }) => {
  const username = uniq('ava');
  await createLogin(page, username);
  const { secret, codes } = await setUpAuthenticator(page);
  await expect(page.locator('#user-name')).toHaveText(username);
  await signOut(page);
  await advance(page.request, 30_000); // the setup code's time step is spent; use the next one
  await passwordStep(page, username);
  await expect(page).toHaveURL(/\/verify(\.html)?$/);
  await page.fill('#verify-totp-code', totpAt(secret, await serverNow(page.request)));
  await page.click('#verify-totp-form [type=submit]');
  await expect(page).toHaveURL(/\/app\.html/);
  await signOut(page);
  await passwordStep(page, username);
  await expect(page).toHaveURL(/\/verify(\.html)?$/);
  await page.click('#verify-recovery summary');
  await page.fill('#verify-recovery-code', codes[0]);
  await page.click('#verify-recovery-form [type=submit]');
  await expect(page).toHaveURL(/\/app\.html/);
});

test('five wrong passwords lock the account and say until when', async ({ page }) => {
  const username = uniq('lee');
  await createLogin(page, username);
  await setUpAuthenticator(page);
  await signOut(page);
  for (let i = 0; i < 5; i += 1) {
    await passwordStep(page, username, 'wrong password!!');
    await expect(page.locator('#signin-error')).toBeVisible();
  }
  await expect(page.locator('#signin-error')).toContainText('Account locked; try again at');
});

test('the page warns at 13 idle minutes, and 15 idle minutes sign the visitor out', async ({ page }) => {
  await page.clock.install();
  const username = uniq('ida');
  await createLogin(page, username);
  await setUpAuthenticator(page);
  await expect(page.locator('#session-left')).toContainText('Auto sign-out'); // the page's timer is running
  await page.clock.fastForward('13:05');
  await expect(page.locator('#idle-dialog')).toBeVisible();
  await advance(page.request, 16 * 60_000); // the server has now seen 16 idle minutes
  await page.click('#stay-signed-in');      // too late: the server ends the session
  await expect(page).toHaveURL(/reason=session_idle/);
  await expect(page.locator('#signin-reason')).toContainText('15 minutes without activity');
});

test('add a passkey at sign-up, then sign in with the passkey alone', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  const username = uniq('pia');
  await createLogin(page, username, 'billing');
  await page.click('#passkey-add');
  await expect(page).toHaveURL(/\/app\.html/);
  await signOut(page);
  await page.click('#passkey-signin');
  await expect(page).toHaveURL(/\/app\.html/);
  await expect(page.locator('#user-name')).toHaveText(username);
});
