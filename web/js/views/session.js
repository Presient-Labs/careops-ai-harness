import { api } from '../api.js';

// Automatic logoff in the page: warns 2 minutes before the server's 15-minute idle limit, and shows the time left.
// Any successful API call is activity (api.js fires careops:activity); "Stay signed in" pings the server.
export function startSessionTimer(session) {
  const idleMs = session.idleTimeoutMs;
  const warnMs = idleMs - 2 * 60_000;
  const dialog = document.querySelector('#idle-dialog');
  const left = document.querySelector('#idle-left');
  const label = document.querySelector('#session-left');
  let last = Date.now();
  window.addEventListener('careops:activity', () => { last = Date.now(); if (dialog.open) dialog.close(); });
  document.querySelector('#stay-signed-in').addEventListener('click', () => api('/auth/ping', { method: 'POST' }));
  const tick = () => {
    const idleFor = Date.now() - last;
    const remaining = Math.max(0, idleMs - idleFor);
    label.textContent = `Auto sign-out in ${Math.ceil(remaining / 60_000)} min`;
    if (idleFor >= warnMs && !dialog.open) dialog.showModal();
    if (dialog.open) left.textContent = `${Math.ceil(remaining / 1000)} seconds`;
    if (remaining === 0) location.replace('/?reason=session_idle');
  };
  tick();
  setInterval(tick, 1000);
}
