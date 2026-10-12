import { api } from '../api.js';
import { el, heading, table, cell, pill, timestamp, notice, message, loading, empty, button, details, roles, labelize } from './shared.js';

export function audit(root, ctx) {
  const feedback = notice();
  const content = el('section', { class: 'card' }, loading());
  const filter = el('input', { type: 'checkbox', id: 'security-only' });
  const refresh = button('Refresh now', load);
  const automatic = button('Auto-refresh: off', () => {
    enabled = !enabled;
    automatic.textContent = `Auto-refresh: ${enabled ? 'on' : 'off'}`;
    automatic.setAttribute('aria-pressed', String(enabled));
    if (enabled) { load(); timer = setInterval(() => load({ background: true }), 15000); }
    else clearInterval(timer);
  });
  automatic.setAttribute('aria-pressed', 'false');
  let enabled = false;
  let timer;
  let ticket = 0;
  root.append(heading('Audit Log', 'See who did what, and inspect the checks behind each assistant turn. Reset lives in Demo Controls.'), feedback,
    el('div', { class: 'toolbar' }, el('label', { class: 'checkbox-label', for: 'security-only' }, filter, 'Security events only'), el('div', { class: 'button-row' }, refresh, automatic)),
    el('p', { class: 'small muted' }, 'Showing up to 100 events, newest first. Auto-refresh checks every 15 seconds.'), content);
  async function load(options) { // the auto-refresh timer passes { background: true }; every other caller is a person acting
    const current = ++ticket;
    refresh.disabled = true;
    const result = await api(`/audit?${filter.checked ? 'security=1&' : ''}limit=100`, { background: options?.background === true });
    if (!ctx.active() || current !== ticket) return;
    refresh.disabled = false;
    if (result.error) { message(feedback, result.error.message); if (!content.querySelector('table')) content.replaceChildren(empty('Audit records could not be loaded.')); return; }
    if (feedback.classList.contains('error')) message(feedback, '');
    if (!result.events.length) { content.replaceChildren(empty(filter.checked ? 'No security events match this filter.' : 'No audit events recorded yet.')); return; }
    const grid = table(['When', 'Who', 'Event', 'Details', 'Decision record'], 'Audit events, newest first');
    const events = [...result.events].sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id);
    for (const event of events) grid.body.append(el('tr', {}, cell(timestamp(event.at)), cell(el('strong', {}, event.actorName ?? 'System'), el('p', { class: 'small muted' }, roles[event.actorRole] ?? 'System')),
      cell(el('span', {}, labelize(event.kind)), event.security ? pill('denied', 'Security') : null), cell(details('Recorded details', event.detail)),
      cell(event.turnId ? button('View trace', () => ctx.openTrace(event.turnId), 'text-button') : el('span', { class: 'muted' }, 'No assistant turn'))));
    content.replaceChildren(grid.node);
  }
  filter.addEventListener('change', load);
  ctx.cleanup(() => clearInterval(timer));
  ctx.on(window, 'careops:data-changed', load);
  load();
}
