import { esc, badge, euro, formatTime, formatDayLabel, dayKey, startOfDay, contactButtons, empty } from '../ui.js';

const DAY = 86400000;
let staffFilter = 'all';

export async function render(ctx) {
  const from = startOfDay();
  const [appts, staff] = await Promise.all([
    ctx.api.listAppointments(ctx.salonId, { from, to: new Date(+from + 14 * DAY) }),
    ctx.api.listStaff(ctx.salonId),
  ]);
  if (staffFilter !== 'all' && !staff.some(s => s.id === staffFilter)) staffFilter = 'all';
  const shown = appts.filter(a => staffFilter === 'all' || a.staff_id === staffFilter);

  const todayKey = dayKey(new Date());
  const today = appts.filter(a => dayKey(a.starts_at) === todayKey);
  const strip = `<div class="stat-strip">
      <div><div class="stat-label">Heute</div><div class="stat-value">${today.length} Termine</div></div>
      <div><div class="stat-label">Umsatz heute</div><div class="stat-value">${euro(today.reduce((s, a) => s + a.price, 0))}</div></div>
      <div><div class="stat-label">14 Tage</div><div class="stat-value">${appts.length} Termine</div></div>
    </div>`;

  const chips = staff.length > 1 ? `<div class="chips">
      ${[{ id: 'all', name: 'Alle' }, ...staff].map(s =>
        `<button class="chip ${staffFilter === s.id ? 'active' : ''}" data-staff="${s.id}">${esc(s.name)}</button>`).join('')}
    </div>` : '';

  const byDay = {};
  shown.forEach(a => (byDay[dayKey(a.starts_at)] ||= []).push(a));
  const list = Object.keys(byDay).length === 0 ? empty('Keine Termine in den nächsten 14 Tagen') :
    Object.entries(byDay).map(([, list]) => `
      <div class="section-label">${formatDayLabel(list[0].starts_at)}</div>
      ${list.map(a => `
        <div class="card" data-href="#/kundin/${a.client.id}">
          <div class="card-time-col ${a.done ? 'done' : ''}">${formatTime(a.starts_at)}</div>
          <div class="card-info">
            <div class="card-name">${esc(a.client.name)}</div>
            <div class="card-sub">${esc(a.service_name)}${staff.length > 1 ? ` · ${esc(a.staff_name)}` : ''}</div>
            ${a.source === 'reinvite' ? '<div class="card-tag">Über Einladung gebucht</div>' : a.source === 'bot' ? '<div class="card-tag">Über Gili gebucht</div>' : ''}
          </div>
          <div class="card-right">
            ${a.done ? badge('Erledigt', 'muted') : badge('Bestätigt', 'green')}
            ${contactButtons(a.client.phone, { demo: ctx.api.isDemo })}
          </div>
        </div>`).join('')}
    `).join('');

  return strip + chips + list;
}

export function mount(el, ctx) {
  el.addEventListener('click', e => {
    const chip = e.target.closest('[data-staff]');
    if (chip) { staffFilter = chip.dataset.staff; ctx.refresh(); }
  });
}
