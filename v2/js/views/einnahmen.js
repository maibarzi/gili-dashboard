import { esc, euro, badge, formatDate, formatTime, MONTHS, empty } from '../ui.js';

export async function render(ctx) {
  const now = new Date();
  const s = await ctx.api.getStats(ctx.salonId, { year: now.getFullYear(), month: now.getMonth() });
  const r = s.revenue, e = s.effect;
  const max = Math.max(...s.weeks.map(w => w.revenue), 1);

  return `
    <div class="income-summary">
      <div class="income-month">${MONTHS[now.getMonth()]} ${now.getFullYear()}</div>
      <div class="income-total"><span>€</span>${Math.round(r.total).toLocaleString('de-AT')}</div>
      <div class="income-grid">
        <div class="income-stat"><div class="income-stat-label">Erledigt</div><div class="income-stat-value green">${euro(r.done)}</div></div>
        <div class="income-stat"><div class="income-stat-label">Erwartet</div><div class="income-stat-value amber">${euro(r.expected)}</div></div>
        <div class="income-stat"><div class="income-stat-label">Termine</div><div class="income-stat-value">${r.count}</div></div>
      </div>
    </div>

    <div class="section-label">Was Gili in den letzten 30 Tagen gemacht hat</div>
    <div class="effect-grid">
      <div class="effect"><div class="effect-value">${e.rebooked}</div><div class="effect-label">Kundinnen über Einladung zurückgewonnen</div><div class="effect-sub">${euro(e.rebookedRevenue)} Umsatz</div></div>
      <div class="effect"><div class="effect-value">${e.botBookings}</div><div class="effect-label">Termine über den Chat gebucht</div></div>
      <div class="effect"><div class="effect-value">${e.invitesSent}</div><div class="effect-label">Einladungen gesendet</div></div>
      <div class="effect"><div class="effect-value">${e.reviewsRequested}</div><div class="effect-label">Bewertungsanfragen gesendet</div></div>
    </div>

    <div class="chart-wrap">
      <div class="chart-title">Umsatz pro Woche</div>
      <div class="chart-bars">${s.weeks.map(w => `
        <div class="bar-col" title="${euro(w.revenue)}">
          <div class="bar ${w.current ? 'active' : w.future ? 'future' : ''}" style="height:${Math.max(Math.round(w.revenue / max * 52), 3)}px"></div>
          <div class="bar-label">ab ${w.label}</div>
        </div>`).join('')}
      </div>
    </div>

    <div class="section-label">Alle Termine diesen Monat</div>
    ${s.appointments.length ? s.appointments.map(a => `
      <div class="card compact" data-href="#/kundin/${a.client.id}">
        <div class="card-info">
          <div class="card-name">${esc(a.client.name)}</div>
          <div class="card-sub">${esc(a.service_name)} · ${formatDate(a.starts_at)}, ${formatTime(a.starts_at)}</div>
        </div>
        <div class="price">${euro(a.price)}</div>
        ${a.done ? badge('Erledigt', 'green') : badge('Ausstehend', 'amber')}
      </div>`).join('') : empty('Keine Termine diesen Monat')}`;
}
