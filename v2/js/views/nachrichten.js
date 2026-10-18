import { esc, badge, relative, formatTime, formatDayLabel, formatWhen, dayKey, toast, empty,
  KIND_LABELS, RESULT_META, QUEUE_META, CONV_META } from '../ui.js';

const TABS = [['chats', 'Chats'], ['geplant', 'Geplant'], ['gesendet', 'Gesendet']];

export async function render(ctx) {
  const tab = ctx.params[0] || 'chats';
  const seg = `<div class="segmented">${TABS.map(([id, label]) =>
    `<a class="seg ${tab === id ? 'active' : ''}" href="#/nachrichten/${id}">${label}${id === 'geplant' && ctx.pendingCount ? ` <span class="seg-count">${ctx.pendingCount}</span>` : ''}</a>`).join('')}</div>`;
  if (tab === 'geplant') return seg + await queue(ctx);
  if (tab === 'gesendet') return seg + await sent(ctx);
  return seg + await chats(ctx);
}

async function chats(ctx) {
  const convs = await ctx.api.listConversations(ctx.salonId);
  if (!convs.length) return empty('Noch keine Chats');
  const open = convs.filter(c => c.status === 'handoff');
  const card = c => `
    <div class="card ${c.status === 'handoff' ? 'alert' : ''}" data-href="#/chat/${c.client.id}">
      <div class="card-info">
        <div class="card-name">${esc(c.client.name)}${c.client.others ? ` <span class="card-more">+${c.client.others}</span>` : ''}</div>
        <div class="card-sub ellipsis">${c.last.direction === 'out' ? 'Gili: ' : ''}${esc(c.last.body.split('\n')[0])}</div>
        <div class="card-tag muted">${relative(c.last.at)}</div>
      </div>
      <div class="card-right">${badge(...CONV_META[c.status])}</div>
    </div>`;
  return (open.length ? `<div class="section-label">Braucht deine Antwort</div>${open.map(card).join('')}` : '') +
    `<div class="section-label">Letzte Chats</div>${convs.filter(c => c.status !== 'handoff').map(card).join('')}`;
}

async function queue(ctx) {
  const [items, settings] = await Promise.all([ctx.api.listQueue(ctx.salonId, { days: 7 }), ctx.api.getSettings(ctx.salonId)]);
  const canQueue = ctx.can('manage_queue');
  const pending = items.filter(i => i.status === 'pending');
  const info = settings.approval_mode === 'manual'
    ? `<div class="info">Nachrichten werden erst nach deiner Freigabe gesendet.${canQueue && pending.length ? ` <button class="btn small" data-approve-all>Alle ${pending.length} freigeben</button>` : ''}</div>`
    : `<div class="info">Nachrichten werden automatisch gesendet. Du kannst einzelne überspringen.</div>`;
  if (!items.length) return info + empty('In den nächsten 7 Tagen ist nichts geplant');

  const byDay = {};
  items.forEach(i => (byDay[dayKey(i.at)] ||= []).push(i));
  return info + Object.values(byDay).map(list => `
    <div class="section-label">${formatDayLabel(list[0].at)}</div>
    ${list.map(i => `
      <div class="card ${i.status === 'skipped' ? 'faded' : ''}" data-href="#/kundin/${i.client.id}">
        <div class="card-time-col">${formatTime(i.at)}</div>
        <div class="card-info">
          <div class="card-name">${esc(i.client.name)}</div>
          <div class="card-sub">${KIND_LABELS[i.kind]} · ${esc(i.reason)}</div>
          ${canQueue ? `<div class="row-actions">
            ${i.status === 'skipped'
              ? `<button class="btn-ghost small" data-queue="reset" data-key="${i.key}">Rückgängig</button>`
              : `<button class="btn-ghost small" data-queue="skip" data-key="${i.key}">Überspringen</button>
                 ${i.status === 'pending' ? `<button class="btn small" data-queue="approve" data-key="${i.key}">Freigeben</button>` : ''}`}
          </div>` : ''}
        </div>
        <div class="card-right">${badge(...QUEUE_META[i.status])}</div>
      </div>`).join('')}`).join('');
}

async function sent(ctx) {
  const msgs = await ctx.api.listSent(ctx.salonId, { days: 30 });
  if (!msgs.length) return empty('In den letzten 30 Tagen wurde nichts gesendet');
  return `<div class="section-label">Letzte 30 Tage · ${msgs.length} Nachrichten</div>` + msgs.map(m => `
    <div class="card" data-href="#/chat/${m.client.id}">
      <div class="card-info">
        <div class="card-name">${esc(m.client.name)}</div>
        <div class="card-sub">${KIND_LABELS[m.kind]} · ${formatWhen(m.at)}</div>
      </div>
      <div class="card-right">${m.result ? badge(...RESULT_META[m.result]) : badge('Gesendet', 'muted')}</div>
    </div>`).join('');
}

export function mount(el, ctx) {
  el.addEventListener('click', async e => {
    const q = e.target.closest('[data-queue]');
    if (q) {
      e.stopPropagation();
      await ctx.api.setQueueStatus(ctx.salonId, [q.dataset.key], q.dataset.queue);
      toast({ approve: 'Freigegeben', skip: 'Übersprungen', reset: 'Wiederhergestellt' }[q.dataset.queue]);
      return ctx.refresh();
    }
    if (e.target.closest('[data-approve-all]')) {
      const items = await ctx.api.listQueue(ctx.salonId, { days: 7 });
      const keys = items.filter(i => i.status === 'pending').map(i => i.key);
      await ctx.api.setQueueStatus(ctx.salonId, keys, 'approve');
      toast(`${keys.length} Nachrichten freigegeben`);
      ctx.refresh();
    }
  });
}
