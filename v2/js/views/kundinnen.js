import { esc, relative, formatWhen, stateBadge, KIND_LABELS, empty } from '../ui.js';

const FILTERS = [
  ['all', 'Alle', () => true],
  ['due', 'Fällig', c => c.state === 'due'],
  ['upcoming', 'Termin geplant', c => c.state === 'upcoming'],
  ['invited', 'Eingeladen', c => c.state === 'invited'],
  ['quiet', 'Keine Nachrichten', c => ['blocked', 'paused', 'excluded', 'no_consent', 'handoff', 'off'].includes(c.state)],
];
const view = { filter: 'all', q: '' };

export async function render(ctx) {
  const clients = await ctx.api.listClients(ctx.salonId);
  ctx.cache.clients = clients;
  return `
    <div class="search-wrap">
      <input class="search" type="search" placeholder="Name oder Telefonnummer" value="${esc(view.q)}" data-search>
    </div>
    <div class="chips">
      ${FILTERS.map(([id, label, fn]) =>
        `<button class="chip ${view.filter === id ? 'active' : ''}" data-filter="${id}">${label} <span class="chip-count">${clients.filter(fn).length}</span></button>`).join('')}
    </div>
    <div data-list>${list(clients)}</div>`;
}

function list(clients) {
  const fn = FILTERS.find(f => f[0] === view.filter)[2];
  const q = view.q.trim().toLowerCase();
  const qDigits = q.replace(/\D/g, '');
  const shown = clients
    .filter(fn)
    .filter(c => !q || c.name.toLowerCase().includes(q) || (qDigits && c.phone.replace(/\D/g, '').includes(qDigits)))
    .sort((a, b) => view.filter === 'due'
      ? (a.next_item?.at || '').localeCompare(b.next_item?.at || '')
      : (b.last_visit_at || '').localeCompare(a.last_visit_at || ''));
  if (!shown.length) return empty('Keine Kundinnen gefunden');
  return `<div class="section-label">${shown.length} Kundinnen</div>` + shown.map(c => `
    <div class="card" data-href="#/kundin/${c.id}">
      <div class="avatar">${esc(initials(c.name))}</div>
      <div class="card-info">
        <div class="card-name">${esc(c.name)}</div>
        <div class="card-sub">${c.last_visit_at ? `Zuletzt ${relative(c.last_visit_at)} · ${esc(c.last_service)}` : 'Noch kein Besuch'}</div>
        ${c.next_item && c.next_item.status !== 'skipped'
          ? `<div class="card-tag">${KIND_LABELS[c.next_item.kind]} ${formatWhen(c.next_item.at)}</div>`
          : c.next_appointment_at ? `<div class="card-tag green">Termin ${formatWhen(c.next_appointment_at)}</div>` : ''}
      </div>
      <div class="card-right">${stateBadge(c.state)}</div>
    </div>`).join('');
}

export const initials = name => name.split(' ').map(p => p[0]).slice(0, 2).join('');

export function mount(el, ctx) {
  el.addEventListener('click', e => {
    const chip = e.target.closest('[data-filter]');
    if (chip) { view.filter = chip.dataset.filter; ctx.refresh(); }
  });
  el.querySelector('[data-search]').addEventListener('input', e => {
    view.q = e.target.value;
    el.querySelector('[data-list]').innerHTML = list(ctx.cache.clients);
  });
}
