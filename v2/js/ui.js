// Shared formatting and small UI building blocks.

export const DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
export const DAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const MONTHS = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const DAY = 86400000;

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pad = n => String(n).padStart(2, '0');
// Local calendar day (toISOString would give the UTC day).
export const dayKey = d => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

export const formatTime = iso => new Date(iso).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
export const formatDate = iso => { const d = new Date(iso); return `${d.getDate()}. ${MONTHS[d.getMonth()]}`; };

export function formatDayLabel(iso) {
  const k = dayKey(iso), today = startOfDay();
  const d = new Date(iso);
  const full = `${DAYS[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`;
  if (k === dayKey(today)) return `Heute · ${full}`;
  if (k === dayKey(+today + DAY)) return `Morgen · ${full}`;
  if (k === dayKey(+today - DAY)) return `Gestern · ${full}`;
  return full;
}

// "heute 10:00", "morgen 14:30", "Do, 23. Oktober 10:00"
export function formatWhen(iso) {
  const k = dayKey(iso), today = startOfDay();
  const d = new Date(iso);
  if (k === dayKey(today)) return `heute ${formatTime(iso)}`;
  if (k === dayKey(+today + DAY)) return `morgen ${formatTime(iso)}`;
  return `${DAYS_SHORT[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]} ${formatTime(iso)}`;
}

export function relative(iso, now = new Date()) {
  const diff = +new Date(iso) - +now;
  const abs = Math.abs(diff), min = abs / 60000, h = min / 60, d = h / 24;
  const unit = (n, sg, pl) => `${n} ${n === 1 ? sg : pl}`;
  if (min < 1) return 'gerade eben';
  let s;
  if (min < 60) s = `${Math.round(min)} Min.`;
  else if (h < 24) s = `${Math.round(h)} Std.`;
  else if (d < 14) s = unit(Math.round(d), 'Tag', 'Tagen');
  else if (d < 60) s = unit(Math.round(d / 7), 'Woche', 'Wochen');
  else s = unit(Math.round(d / 30.4), 'Monat', 'Monaten');
  return diff < 0 ? `vor ${s}` : `in ${s}`;
}

export const euro = n => `€${Math.round(n || 0).toLocaleString('de-AT')}`;

export const icon = (name, size = 16) => `<i data-lucide="${name}" style="width:${size}px;height:${size}px"></i>`;
export function renderIcons() { if (window.lucide) window.lucide.createIcons(); }

export const badge = (text, tone = 'muted') => `<span class="badge b-${tone}">${esc(text)}</span>`;

// Client state from the backend → badge.
export const STATE_META = {
  upcoming: ['Termin geplant', 'green'],
  due: ['Einladung fällig', 'amber'],
  invited: ['Eingeladen', 'sage'],
  active: ['Aktiv', 'muted'],
  new: ['Neu', 'muted'],
  handoff: ['Rückfrage offen', 'red'],
  paused: ['Pausiert', 'muted'],
  excluded: ['Keine Einladungen', 'muted'],
  no_consent: ['Keine Einwilligung', 'muted'],
  off: ['Einladungen aus', 'muted'],
  blocked: ['Nicht kontaktieren', 'red'],
};
export const stateBadge = state => badge(...(STATE_META[state] || [state, 'muted']));

export const KIND_LABELS = { reinvite: 'Einladung', reinvite_multi: 'Gemeinsame Einladung', followup: 'Erinnerung', review: 'Bewertung', chat: 'Chat' };
export const RESULT_META = {
  booked: ['Gebucht', 'green'],
  replied: ['Geantwortet', 'amber'],
  no_reply: ['Keine Antwort', 'muted'],
  opted_out: ['Abgemeldet', 'red'],
};
export const QUEUE_META = {
  pending: ['Wartet auf Freigabe', 'amber'],
  scheduled: ['Geplant', 'green'],
  skipped: ['Übersprungen', 'muted'],
};
export const CONV_META = {
  booked: ['Gebucht', 'green'],
  handoff: ['Rückfrage', 'red'],
  open: ['Offen', 'amber'],
  closed: ['Abgeschlossen', 'muted'],
};

export const WA_ICON = size => `<svg viewBox="0 0 24 24" fill="currentColor" style="width:${size}px;height:${size}px"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.69.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35zM12.05 21.5h-.01a9.4 9.4 0 0 1-4.8-1.31l-.34-.2-3.57.94.95-3.48-.22-.36a9.4 9.4 0 0 1-1.44-5.02c0-5.2 4.23-9.43 9.44-9.43 2.52 0 4.89.98 6.67 2.77a9.37 9.37 0 0 1 2.76 6.67c0 5.2-4.23 9.43-9.44 9.43zm8.03-17.46A11.27 11.27 0 0 0 12.05.72C5.79.72.7 5.81.7 12.07c0 2 .52 3.95 1.52 5.67L.6 23.6l6-1.57a11.33 11.33 0 0 0 5.43 1.38h.01c6.25 0 11.35-5.09 11.35-11.35 0-3.03-1.18-5.88-3.32-8.02z"/></svg>`;

// wa.me expects the international number as digits only (e.g. 43664...)
export function waLink(phone) {
  let digits = (phone || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = '43' + digits.slice(1);
  return 'https://wa.me/' + digits;
}

// WhatsApp + phone. In the demo the numbers are invented, so the links are disabled.
export function contactButtons(phone, { demo = false, size = 14, cls = 'tel-btn' } = {}) {
  if (!phone) return '';
  if (demo) {
    return `<div class="contact-btns">
      <button class="${cls} wa-btn" data-action="demo-contact" aria-label="WhatsApp">${WA_ICON(size)}</button>
      <button class="${cls}" data-action="demo-contact" aria-label="Anrufen">${icon('phone', size)}</button>
    </div>`;
  }
  return `<div class="contact-btns">
    <a href="${waLink(phone)}" target="_blank" rel="noopener" class="${cls} wa-btn" aria-label="WhatsApp">${WA_ICON(size)}</a>
    <a href="tel:${esc(phone)}" class="${cls}" aria-label="Anrufen">${icon('phone', size)}</a>
  </div>`;
}

export function overlayHeader(title, sub = '', right = '') {
  return `<div class="overlay-header">
    <button class="back-btn" data-action="back" aria-label="Zurück">${icon('arrow-left', 20)}</button>
    <div class="overlay-title"><div class="overlay-name">${esc(title)}</div>${sub ? `<div class="overlay-sub">${esc(sub)}</div>` : ''}</div>
    ${right}
  </div>`;
}

export const empty = text => `<div class="empty">${esc(text)}</div>`;

export function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2200);
}

export function toggle(field, checked, disabled = false) {
  return `<label class="switch"><input type="checkbox" data-field="${field}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span></span></label>`;
}

// How the client will see a template message in WhatsApp. Read-only: template
// texts are approved by Meta and can't be edited here.
export const messagePreview = text => `<div class="bubble-preview">
  <div class="bubble-preview-label">${icon('lock', 10)} Vorschau</div>
  <div class="bubble-preview-text">${esc(text)}</div>
</div>`;
