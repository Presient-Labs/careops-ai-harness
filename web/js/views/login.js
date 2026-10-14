import { api } from '../api.js';
import { busy, message } from './shared.js';
import { signInWithPasskey } from '../passkey.js';

const REASONS = {
  session_idle: 'You were signed out after 15 minutes without activity.',
  signin_timed_out: 'Sign-in timed out. Please start again.',
  second_step_required: 'Finish signing in with your second step.',
  unauthenticated: 'Please sign in.',
};
// After the password: straight in, the second step, or (a new login with none yet) its setup.
const next = (r) => location.assign(r.stage === 'full' ? 'app.html' : r.methods.length ? 'verify.html' : 'setup.html');

export function login() {
  const reason = new URLSearchParams(location.search).get('reason');
  if (REASONS[reason]) message(document.querySelector('#signin-reason'), REASONS[reason]);
  form('#signin-form', '#signin-error', 'Signing in…', (f) => api('/auth/login', { method: 'POST', body: { username: f.elements.username.value.trim(), password: f.elements.password.value } }));
  form('#create-form', '#create-error', 'Creating your workplace…', (f) => api('/auth/accounts', { method: 'POST', body: { username: f.elements.username.value.trim(), password: f.elements.password.value, role: f.elements.role.value } }));
  const passkey = document.querySelector('#passkey-signin');
  passkey.addEventListener('click', async () => {
    const error = document.querySelector('#signin-error');
    busy(passkey, true, 'Waiting for your passkey…'); message(error, '');
    const result = await signInWithPasskey(api);
    busy(passkey, false);
    if (result.error) message(error, result.error.message); else location.assign('app.html');
  });
  personas();
}

function form(selector, errorSelector, busyLabel, send) {
  const f = document.querySelector(selector);
  const error = document.querySelector(errorSelector);
  const submit = f.querySelector('[type="submit"]');
  f.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    busy(submit, true, busyLabel); message(error, '');
    const result = await send(f);
    if (result.error) { message(error, result.error.message); busy(submit, false); } else next(result);
  });
}

function personas() {
  const personaError = document.querySelector('#persona-error');
  const rows = [...document.querySelectorAll('[data-persona]')];
  for (const row of rows) {
    row.addEventListener('click', async () => {
      if (row.disabled) return;
      for (const other of rows) other.disabled = true;
      row.classList.add('is-busy'); message(personaError, '');
      const result = await api('/auth/demo', { method: 'POST', body: { persona: row.dataset.persona } });
      if (result.error) { message(personaError, result.error.message); for (const other of rows) other.disabled = false; row.classList.remove('is-busy'); }
      else location.assign('app.html');
    });
  }
}
