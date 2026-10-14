import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { chromium } from '@playwright/test';
import { startTestApp } from './helpers.js';

// CareOps is to be served at shawndemos.com/careops/ as well as at its own subdomain. Traefik's StripPrefix removes
// /careops before the request reaches the app and tells it the prefix in X-Forwarded-Prefix; this proxy does the same.
const PREFIX = '/careops';
let t, proxy, proxyBase, browser;

before(async () => {
  t = await startTestApp();
  const upstream = new URL(t.base);
  proxy = createServer((req, res) => {
    if (req.url !== PREFIX && !req.url.startsWith(`${PREFIX}/`)) { res.writeHead(404).end(); return; }
    const path = req.url.slice(PREFIX.length) || '/';
    const up = request({ host: upstream.hostname, port: upstream.port, path, method: req.method,
      headers: { ...req.headers, 'x-forwarded-prefix': PREFIX } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => res.writeHead(502).end());
    req.pipe(up);
  });
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
  proxyBase = `http://127.0.0.1:${proxy.address().port}`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await new Promise(r => proxy.close(r)); await t.close(); });

const cookiePath = (setCookie) => /;\s*Path=([^;]*)/i.exec(setCookie ?? '')?.[1];
const demoSignIn = (base, headers = {}) => fetch(`${base}/api/auth/demo`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ persona: 'jordan' }) });

test('under /careops/ a Quick look sign-in and sign-out never leave the prefix', async () => {
  const page = await browser.newPage();
  const outside = [];
  page.on('request', (r) => { const p = new URL(r.url()).pathname; if (p !== PREFIX && !p.startsWith(`${PREFIX}/`)) outside.push(p); });
  page.on('response', (r) => { if (r.status() === 404) outside.push(`404 ${new URL(r.url()).pathname}`); });
  await page.goto(`${proxyBase}${PREFIX}/`);
  await page.click('[data-persona="jordan"]');
  await page.waitForURL(`${proxyBase}${PREFIX}/app.html`);
  await page.locator('#user-name').filter({ hasText: /\S/ }).waitFor();
  const [sid] = (await page.context().cookies()).filter(c => c.name === 'careops_sid');
  assert.equal(sid?.path, PREFIX);
  await page.click('#logout');
  await page.waitForURL((u) => u.pathname === `${PREFIX}/`);
  assert.deepEqual(outside, []);
  await page.close();
});

test('at the subdomain root the same sign-in and sign-out still work, with the cookie on /', async () => {
  const page = await browser.newPage();
  const missing = [];
  page.on('response', (r) => { if (r.status() === 404) missing.push(new URL(r.url()).pathname); });
  await page.goto(`${t.base}/`);
  await page.click('[data-persona="jordan"]');
  await page.waitForURL(`${t.base}/app.html`);
  await page.locator('#user-name').filter({ hasText: /\S/ }).waitFor();
  const [sid] = (await page.context().cookies()).filter(c => c.name === 'careops_sid');
  assert.equal(sid?.path, '/');
  await page.click('#logout');
  await page.waitForURL((u) => u.pathname === '/');
  assert.deepEqual(missing, []);
  await page.close();
});

test('under /careops/ a page opened without a session sends the visitor to the /careops/ sign-in page', async () => {
  const page = await browser.newPage();
  await page.goto(`${proxyBase}${PREFIX}/app.html`);
  await page.waitForURL((u) => u.pathname === `${PREFIX}/` && u.searchParams.has('reason'));
  await page.close();
});

test('the session cookie is scoped to /careops behind the proxy and to / at the subdomain', async () => {
  assert.equal(cookiePath((await demoSignIn(`${proxyBase}${PREFIX}`)).headers.get('set-cookie')), PREFIX);
  assert.equal(cookiePath((await demoSignIn(t.base)).headers.get('set-cookie')), '/');
});

test('a forwarded prefix other than /careops is ignored, so a client cannot choose its own cookie path', async () => {
  for (const prefix of ['/evil', '/careops/x', '/careops;', '']) {
    assert.equal(cookiePath((await demoSignIn(t.base, { 'x-forwarded-prefix': prefix })).headers.get('set-cookie')), '/', prefix);
  }
});

test('under /careops/ a site-wide session cookie from the old root deployment is moved onto /careops', async () => {
  const signIn = await demoSignIn(t.base); // the old deployment: Path=/
  const sid = /careops_sid=[^;]+/.exec(signIn.headers.get('set-cookie'))[0];
  const me = await fetch(`${proxyBase}${PREFIX}/api/auth/me`, { headers: { cookie: sid } });
  assert.equal(me.status, 200);
  const set = me.headers.getSetCookie();
  assert.ok(set.some(c => /^careops_sid=;/.test(c) && /Path=\/(;|$)/.test(c) && /Expires=Thu, 01 Jan 1970/.test(c)), `clears Path=/: ${set}`);
  assert.ok(set.some(c => c.startsWith(`${sid};`) && /Path=\/careops/.test(c)), `re-sets on /careops: ${set}`);
  // At the subdomain the cookie is left alone.
  assert.deepEqual((await fetch(`${t.base}/api/auth/me`, { headers: { cookie: sid } })).headers.getSetCookie(), []);
});

test('in a browser, the old site-wide cookie ends up only on /careops after one page load', async () => {
  const ctx = await browser.newContext();
  const signIn = await demoSignIn(t.base);
  const value = /careops_sid=([^;]+)/.exec(signIn.headers.get('set-cookie'))[1];
  await ctx.addCookies([{ name: 'careops_sid', value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }]);
  const page = await ctx.newPage();
  await page.goto(`${proxyBase}${PREFIX}/app.html`);
  await page.locator('#user-name').filter({ hasText: /\S/ }).waitFor();
  const sids = (await ctx.cookies()).filter(c => c.name === 'careops_sid');
  assert.deepEqual(sids.map(c => c.path), [PREFIX]);
  await ctx.close();
});

test('under /careops/ "Return to sign in" after a server error stays inside /careops/', async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route('**/careops/api/auth/me', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"internal","message":"Something went wrong."}}' }));
  await page.goto(`${proxyBase}${PREFIX}/app.html`);
  const link = page.getByRole('link', { name: 'Return to sign in' });
  await link.waitFor();
  assert.equal(new URL(await link.evaluate(a => a.href)).pathname, `${PREFIX}/`);
  await ctx.close();
});

test('sign-out clears the cookie on the same path it was set on', async () => {
  const signIn = await demoSignIn(`${proxyBase}${PREFIX}`);
  const { csrfToken } = await signIn.json();
  const sid = /careops_sid=[^;]+/.exec(signIn.headers.get('set-cookie'))[0];
  const out = await fetch(`${proxyBase}${PREFIX}/api/auth/logout`, { method: 'POST', headers: { cookie: sid, 'x-csrf-token': csrfToken } });
  assert.equal(out.status, 204);
  assert.equal(cookiePath(out.headers.get('set-cookie')), PREFIX);
});
