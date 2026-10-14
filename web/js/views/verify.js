import { api } from '../api.js';
import { message } from './shared.js';
import { signInWithPasskey } from '../passkey.js';

export async function verify() {
  const error = document.querySelector('#verify-error');
  const state = await api('/auth/second-step');
  if (state.error) { message(error, state.error.message); return; }
  if (state.stage === 'full') { location.replace('app.html'); return; }
  if (!state.methods.length) { location.replace('setup.html'); return; }
  document.querySelector('#verify-user').textContent = state.username;
  for (const m of state.methods) { const node = document.querySelector(`#verify-${m}`); if (node) node.hidden = false; }
  const submit = (method, input) => async (e) => {
    e.preventDefault(); message(error, '');
    const r = await api('/auth/verify', { method: 'POST', body: { method, code: input.value } });
    if (r.error) { message(error, r.error.message); input.select(); } else location.assign('app.html');
  };
  document.querySelector('#verify-totp-form').addEventListener('submit', submit('totp', document.querySelector('#verify-totp-code')));
  document.querySelector('#verify-email-form').addEventListener('submit', submit('email', document.querySelector('#verify-email-code')));
  document.querySelector('#verify-recovery-form').addEventListener('submit', submit('recovery', document.querySelector('#verify-recovery-code')));
  document.querySelector('#verify-email-send').addEventListener('click', async () => {
    const r = await api('/auth/email/send', { method: 'POST', body: { purpose: 'signin' } });
    message(error, r.error ? r.error.message : '');
  });
  document.querySelector('#verify-passkey-button').addEventListener('click', async () => {
    message(error, '');
    const r = await signInWithPasskey(api);
    if (r.error) message(error, r.error.message); else location.assign('app.html');
  });
}
