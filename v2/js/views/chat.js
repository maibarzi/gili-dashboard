import { esc, formatTime, formatDayLabel, dayKey, overlayHeader, contactButtons, icon, KIND_LABELS, CONV_META } from '../ui.js';

export async function render(ctx) {
  const { client, status, messages } = await ctx.api.getChat(ctx.salonId, ctx.params[0]);
  let lastDay = '';
  const body = messages.map(m => {
    const day = dayKey(m.at);
    const sep = day !== lastDay ? `<div class="msg-day">${formatDayLabel(m.at)}</div>` : '';
    lastDay = day;
    const auto = m.kind !== 'chat' ? `<div class="msg-auto">Automatisch · ${KIND_LABELS[m.kind]}</div>` : '';
    return `${sep}<div class="msg ${m.direction === 'in' ? 'msg-in' : 'msg-out'} ${m.kind !== 'chat' ? 'msg-automation' : ''}">
      ${auto}${esc(m.body).replace(/\n/g, '<br>')}<div class="msg-time">${formatTime(m.at)}</div></div>`;
  }).join('');

  const sub = [client.phone, status ? CONV_META[status][0] : ''].filter(Boolean).join(' · ');
  const profile = `<a class="header-btn" href="#/kundin/${client.id}" aria-label="Kundinnenprofil">${icon('user', 16)}</a>`;
  return overlayHeader(client.name, sub, `<div class="contact-btns">${profile}${contactButtons(client.phone, { demo: ctx.api.isDemo, size: 16, cls: 'header-btn' })}</div>`) +
    `<div class="chat-messages">${body || '<div class="empty">Keine Nachrichten</div>'}</div>
     <div class="chat-footer">Gili antwortet automatisch. Antworten selbst über WhatsApp.</div>`;
}

export function mount(el) {
  const box = el.querySelector('.chat-messages');
  requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
}
