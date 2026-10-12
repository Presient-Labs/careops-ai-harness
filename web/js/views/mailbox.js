import { api } from '../api.js';
import { el, message, timestamp } from './shared.js';

// Reading the mailbox is not activity (the server does not count it), so this page can poll.
export function mailbox() {
  const list = document.querySelector('#mailbox-list');
  const error = document.querySelector('#mailbox-error');
  async function load() {
    const r = await api('/auth/mailbox');
    if (r.error) { message(error, r.error.message); return; }
    list.replaceChildren(...(r.messages.length
      ? r.messages.map(m => el('li', { class: 'card mail' }, el('p', { class: 'small muted' }, timestamp(m.at)), el('h2', {}, m.subject), el('p', {}, m.body)))
      : [el('li', { class: 'muted' }, 'No messages yet.')]));
  }
  load();
  setInterval(load, 5000);
}
