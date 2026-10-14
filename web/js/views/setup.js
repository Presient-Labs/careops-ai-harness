import { api } from '../api.js';
import { el, message } from './shared.js';
import { createPasskey, passkeyError } from '../passkey.js';

export async function setup() {
  const error = document.querySelector('#setup-error');
  const state = await api('/auth/second-step');
  if (state.error) { message(error, state.error.message); return; }
  if (!state.canSetup) { location.replace('verify.html'); return; }
  let stage = state.stage;
  const mark = (id) => {
    const card = document.querySelector(`#method-${id}`);
    if (!card || card.classList.contains('is-done')) return;
    card.classList.add('is-done');
    card.querySelectorAll('button, form, #totp-panel').forEach(n => { n.hidden = true; });
    card.append(el('p', { class: 'notice' }, 'Set up.'));
  };
  state.methods.forEach(mark);
  const finished = (result, method) => {
    mark(method);
    const wasHalfway = stage === 'halfway';
    stage = result.stage;
    if (result.recoveryCodes) {
      document.querySelector('#recovery-codes').replaceChildren(...result.recoveryCodes.map(c => el('li', {}, el('code', {}, `${c.slice(0, 5)}-${c.slice(5)}`))));
      document.querySelector('#recovery').hidden = false;
      document.querySelector('#recovery-done').focus();
    } else if (wasHalfway) location.assign('app.html');
    else message(document.querySelector('#setup-done'), 'Added. You can add another, or go back to your workspace.');
  };
  const run = async (fn) => { message(error, ''); const r = await fn(); if (r?.error) message(error, r.error.message); return r; };

  document.querySelector('#totp-start').addEventListener('click', () => run(async () => {
    const r = await api('/auth/totp/setup', { method: 'POST' });
    if (r.error) return r;
    document.querySelector('#totp-qr').src = r.qr;
    document.querySelector('#totp-secret').textContent = r.secret;
    document.querySelector('#totp-panel').hidden = false;
    document.querySelector('#totp-start').hidden = true;
    document.querySelector('#totp-code').focus();
    return r;
  }));
  document.querySelector('#totp-form').addEventListener('submit', (e) => { e.preventDefault(); run(async () => {
    const r = await api('/auth/totp/confirm', { method: 'POST', body: { code: document.querySelector('#totp-code').value } });
    if (!r.error) finished(r, 'totp');
    return r;
  }); });
  document.querySelector('#email-start').addEventListener('click', () => run(async () => {
    const r = await api('/auth/email/send', { method: 'POST', body: { purpose: 'enable' } });
    if (!r.error) { document.querySelector('#email-form').hidden = false; document.querySelector('#email-code').focus(); }
    return r;
  }));
  document.querySelector('#email-form').addEventListener('submit', (e) => { e.preventDefault(); run(async () => {
    const r = await api('/auth/email/confirm', { method: 'POST', body: { code: document.querySelector('#email-code').value } });
    if (!r.error) finished(r, 'email');
    return r;
  }); });
  document.querySelector('#passkey-add').addEventListener('click', () => run(async () => {
    const start = await api('/auth/passkeys/register/options', { method: 'POST' });
    if (start.error) return start;
    let response;
    try { response = await createPasskey(start.options); } catch (e) { return { error: { message: passkeyError(e) } }; }
    const r = await api('/auth/passkeys/register/verify', { method: 'POST', body: { challengeId: start.challengeId, response } });
    if (!r.error) finished(r, 'passkey');
    return r;
  }));
}
