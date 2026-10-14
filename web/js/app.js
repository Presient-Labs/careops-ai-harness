import { api } from './api.js';
import { el, roles, message } from './views/shared.js';
import { login } from './views/login.js';
import { createTraceDrawer } from './views/trace.js';
import { createAssistant } from './views/assistant.js';
import { pto } from './views/pto.js';
import { approvals } from './views/approvals.js';
import { claims } from './views/claims.js';
import { audit } from './views/audit.js';
import { attackLab, modelLab } from './views/labs.js';
import { howItWorks } from './views/how-it-works.js';
import { demoControls } from './views/demo-controls.js';
import { setup } from './views/setup.js';
import { verify } from './views/verify.js';
import { mailbox } from './views/mailbox.js';
import { startSessionTimer } from './views/session.js';

const routes = [
  { id: 'assistant', name: 'Assistant', icon: '✦', roles: ['employee', 'manager', 'billing', 'admin'] },
  { id: 'pto', name: 'My PTO', icon: '◷', roles: ['employee', 'manager', 'billing'], render: pto },
  { id: 'approvals', name: 'Approvals', icon: '✓', roles: ['manager'], render: approvals },
  { id: 'claims', name: 'Claims', icon: '▤', roles: ['billing'], render: claims },
  { id: 'audit', name: 'Audit Log', icon: '≡', roles: ['admin'], render: audit },
  { id: 'attacks', name: 'Attack Lab', icon: '◇', roles: ['admin'], render: attackLab },
  { id: 'models', name: 'Model Lab', icon: '▥', roles: ['admin'], render: modelLab },
  { id: 'demo', name: 'Demo Controls', icon: '↺', roles: ['admin'], render: demoControls },
  { id: 'how-it-works', name: 'How It Works', icon: '?', roles: ['employee', 'manager', 'billing', 'admin'], render: howItWorks },
];

async function workspace() {
  const main = document.querySelector('#main');
  const result = await api('/auth/me');
  if (result.error) {
    main.replaceChildren(el('h1', {}, 'Workspace unavailable'), el('p', { class: 'notice error', role: 'alert' }, result.error.message), el('a', { href: './', class: 'button secondary' }, 'Return to sign in'));
    return;
  }
  const { user } = result;
  if (!roles[user.role]) { main.replaceChildren(el('p', { class: 'notice error' }, 'This account does not have a supported workspace role.')); return; }
  document.querySelector('#user-name').textContent = user.displayName;
  document.querySelector('#user-role').textContent = roles[user.role];
  document.querySelector('#identity').hidden = false;
  if (result.session?.accountSession) document.querySelector('#account-security').hidden = false;
  if (result.session) startSessionTimer(result.session);
  const allowed = routes.filter(route => route.roles.includes(user.role));
  const navigation = document.querySelector('#navigation');
  navigation.replaceChildren(...allowed.map(route => el('a', { href: `#${route.id}`, class: 'nav-link' }, el('span', { class: 'nav-icon', 'aria-hidden': 'true' }, route.icon), route.name)));
  const openTrace = createTraceDrawer();
  const assistant = createAssistant({ user, openTrace });
  let dispose = () => {};
  let firstRoute = true;
  function route() {
    // Hashes only select presentation. Every permission is enforced by the API.
    if (location.hash === '#main') { main.focus(); return; }
    const id = location.hash.slice(1) || 'assistant';
    const selected = allowed.find(item => item.id === id) ?? allowed[0];
    if (id !== selected.id) history.replaceState(null, '', `#${selected.id}`);
    dispose();
    const abort = new AbortController();
    const cleanups = [];
    const ctx = { user, openTrace, active: () => !abort.signal.aborted, cleanup: fn => cleanups.push(fn), on: (target, event, handler) => target.addEventListener(event, handler, { signal: abort.signal }) };
    dispose = () => { abort.abort(); cleanups.forEach(fn => fn()); };
    for (const link of navigation.querySelectorAll('a')) {
      if (link.hash === `#${selected.id}`) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    main.replaceChildren();
    if (selected.id === 'assistant') main.append(assistant);
    else selected.render(main, ctx);
    document.title = `${selected.name} · CareOps`;
    if (!firstRoute) main.focus({ preventScroll: true });
    firstRoute = false;
  }
  window.addEventListener('hashchange', route);
  document.querySelector('#logout').addEventListener('click', async event => {
    const control = event.currentTarget;
    control.disabled = true;
    const response = await api('/auth/logout', { method: 'POST' });
    if (response.error) { message(document.querySelector('#global-error'), response.error.message); control.disabled = false; }
    else { dispose(); location.replace('./'); }
  });
  // Recheck identity after a history-cache restore; never reuse another session's screen.
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  route();
}

const pages = { login, setup, verify, mailbox };
(pages[document.body.dataset.page] ?? workspace)();
