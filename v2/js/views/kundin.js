import { esc, badge, euro, icon, relative, formatDate, formatWhen, formatTime, overlayHeader, contactButtons,
  stateBadge, toggle, toast, KIND_LABELS, RESULT_META, QUEUE_META, CONV_META, dayKey } from '../ui.js';

export async function render(ctx) {
  const { client, summary: s, pending, timeline, conversation } = await ctx.api.getClient(ctx.salonId, ctx.params[0]);
  const canEdit = ctx.can('edit_client');
  const canQueue = ctx.can('manage_queue');
  ctx.cache.client = client;

  const stats = `<div class="stat-grid">
      <div class="stat"><div class="stat-label">Letzter Besuch</div><div class="stat-value">${s.last_visit_at ? relative(s.last_visit_at) : '—'}</div></div>
      <div class="stat"><div class="stat-label">Nächster Termin</div><div class="stat-value">${s.next_appointment_at ? formatDate(s.next_appointment_at) : '—'}</div></div>
      <div class="stat"><div class="stat-label">Besuche</div><div class="stat-value">${s.visits}</div></div>
      <div class="stat"><div class="stat-label">Umsatz</div><div class="stat-value">${euro(s.revenue)}</div></div>
    </div>`;

  const status = `<div class="panel">
      <div class="panel-row"><div><div class="panel-title">Status</div><div class="panel-sub">${esc(s.state_reason)}</div></div>${stateBadge(s.state)}</div>
    </div>`;

  const next = pending.length ? `<div class="section-label">Geplante Nachrichten</div>` + pending.map(p => `
      <div class="panel ${p.status === 'skipped' ? 'faded' : ''}">
        <div class="panel-row">
          <div><div class="panel-title">${KIND_LABELS[p.kind]} · ${formatWhen(p.at)}</div><div class="panel-sub">${esc(p.reason)}</div></div>
          ${badge(...QUEUE_META[p.status])}
        </div>
        <div class="bubble-preview">${esc(p.preview)}</div>
        ${canQueue ? `<div class="panel-actions">
          ${p.status === 'skipped'
            ? `<button class="btn-ghost" data-queue="reset" data-key="${p.key}">Rückgängig</button>`
            : `<button class="btn-ghost" data-queue="skip" data-key="${p.key}">Überspringen</button>
               ${p.status === 'pending' ? `<button class="btn" data-queue="approve" data-key="${p.key}">Freigeben</button>` : ''}`}
        </div>` : ''}
      </div>`).join('') : '';

  const pausedValue = client.paused_until ? dayKey(client.paused_until) : '';
  const prefs = `<div class="section-label">Nachrichten an diese Kundin</div>
    <div class="panel">
      <div class="panel-row"><div><div class="panel-title">Einladungen zum Wiederkommen</div>
        <div class="panel-sub">${client.marketing_consent ? `Einwilligung: ${esc(client.consent_source)}` : 'Keine Einwilligung vorhanden'}</div></div>
        ${toggle('invites_enabled', client.invites_enabled, !canEdit || client.do_not_contact)}</div>
      <div class="panel-row"><div><div class="panel-title">Bewertungsanfragen</div><div class="panel-sub">Am Tag nach dem Termin</div></div>
        ${toggle('reviews_enabled', client.reviews_enabled, !canEdit || client.do_not_contact)}</div>
      <div class="panel-row"><div><div class="panel-title">Pausieren bis</div><div class="panel-sub">Zum Beispiel bei Urlaub oder Schwangerschaft</div></div>
        <div class="inline-field"><input type="date" data-pause value="${pausedValue}" ${!canEdit ? 'disabled' : ''}>
        ${pausedValue && canEdit ? `<button class="icon-btn" data-unpause aria-label="Pause aufheben">${icon('x', 14)}</button>` : ''}</div></div>
      <div class="panel-row"><div><div class="panel-title">Nicht kontaktieren</div>
        <div class="panel-sub">${client.do_not_contact ? esc(client.dnc_reason || 'Keine automatischen Nachrichten') : 'Sperrt alle automatischen Nachrichten'}</div></div>
        ${toggle('do_not_contact', client.do_not_contact, !canEdit)}</div>
    </div>
    <div class="section-label">Notiz</div>
    <div class="panel"><textarea class="note" data-note rows="2" placeholder="Nur für dein Team sichtbar" ${!canEdit ? 'disabled' : ''}>${esc(client.note)}</textarea></div>`;

  const items = timeline.map(t => {
    if (t.type === 'appointment') {
      const a = t.appointment;
      const label = a.status === 'cancelled' ? 'Storniert' : a.status === 'no_show' ? 'Nicht erschienen' : a.done ? 'Besuch' : 'Termin geplant';
      return tl('calendar', `${label} · ${esc(a.service_name)}`, `${formatDate(a.starts_at)}, ${formatTime(a.starts_at)} · ${esc(a.staff_name)}${a.status === 'booked' ? ' · ' + euro(a.price) : ''}`,
        a.status === 'booked' ? (a.done ? '' : 'future') : 'muted');
    }
    if (t.type === 'chat') {
      return `<div class="tl-item" data-href="#/chat/${client.id}">${tlInner('message-circle', `Chat · ${t.count} Nachrichten`, `${formatDate(t.at)} · „${esc(t.first.slice(0, 60))}${t.first.length > 60 ? '…' : ''}“`)}</div>`;
    }
    const m = t.message;
    const res = m.result ? ` · ${RESULT_META[m.result][0]}` : '';
    return tl('send', `${KIND_LABELS[m.kind]} gesendet${res}`, `${formatDate(m.at)}, ${formatTime(m.at)} · automatisch`);
  }).join('');

  const convBadge = conversation ? badge(...CONV_META[conversation.status]) : '';
  return overlayHeader(client.name, client.phone, contactButtons(client.phone, { demo: ctx.api.isDemo, size: 16, cls: 'header-btn' })) + `
    <div class="overlay-body">
      ${stats}
      ${status}
      ${next}
      ${prefs}
      <div class="section-label section-row">Verlauf ${conversation ? `<a class="link" href="#/chat/${client.id}">Chat öffnen ${convBadge}</a>` : ''}</div>
      <div class="timeline">${items || '<div class="empty">Noch keine Einträge</div>'}</div>
    </div>`;
}

const tlInner = (ic, title, sub) => `<div class="tl-dot">${icon(ic, 13)}</div><div><div class="tl-title">${title}</div><div class="tl-sub">${sub}</div></div>`;
const tl = (ic, title, sub, cls = '') => `<div class="tl-item ${cls}">${tlInner(ic, title, sub)}</div>`;

export function mount(el, ctx) {
  const id = ctx.params[0];
  const save = async (patch, msg = 'Gespeichert') => {
    await ctx.api.updateClient(ctx.salonId, id, patch);
    toast(msg);
    ctx.refresh();
  };

  el.addEventListener('change', e => {
    const f = e.target.dataset.field;
    if (f === 'do_not_contact' && e.target.checked) {
      if (!confirm('Diese Kundin bekommt dann keine automatischen Nachrichten mehr. Fortfahren?')) { e.target.checked = false; return; }
      return save({ do_not_contact: true, dnc_reason: 'Von dir gesperrt' });
    }
    if (f === 'do_not_contact') return save({ do_not_contact: false, dnc_reason: '' });
    if (f) return save({ [f]: e.target.checked });
    if (e.target.matches('[data-pause]')) {
      const v = e.target.value;
      return save({ paused_until: v ? new Date(v + 'T23:59:00').toISOString() : null });
    }
    if (e.target.matches('[data-note]')) return save({ note: e.target.value }, 'Notiz gespeichert');
  });

  el.addEventListener('click', async e => {
    if (e.target.closest('[data-unpause]')) return save({ paused_until: null }, 'Pause aufgehoben');
    const q = e.target.closest('[data-queue]');
    if (q) {
      await ctx.api.setQueueStatus(ctx.salonId, [q.dataset.key], q.dataset.queue);
      toast({ approve: 'Freigegeben', skip: 'Übersprungen', reset: 'Wiederhergestellt' }[q.dataset.queue]);
      ctx.refresh();
    }
  });
}
