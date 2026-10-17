import { esc, overlayHeader, toggle, toast, messagePreview, DAYS_SHORT, KIND_LABELS } from '../ui.js';
import { ROLE_LABELS } from '../auth.js';

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const HOURS = Array.from({ length: 15 }, (_, i) => i + 7);

export async function render(ctx) {
  const [salon, st, services, team, templates] = await Promise.all([
    ctx.api.getSalon(ctx.salonId), ctx.api.getSettings(ctx.salonId), ctx.api.listServices(ctx.salonId),
    ctx.api.listTeam(ctx.salonId), ctx.api.templates(ctx.salonId),
  ]);
  ctx.cache.settings = st;
  const hourSelect = (name, value) => `<select data-setting="${name}">${HOURS.map(h => `<option value="${h}" ${h === value ? 'selected' : ''}>${h}:00</option>`).join('')}</select>`;

  return overlayHeader('Einstellungen', salon.name) + `
    <div class="overlay-body">
      <div class="section-label">Versand</div>
      <div class="panel">
        <div class="panel-row stack">
          <div><div class="panel-title">Freigabe</div><div class="panel-sub">Wer entscheidet, ob eine geplante Nachricht rausgeht</div></div>
          <div class="radio-group">
            <label class="radio ${st.approval_mode === 'manual' ? 'active' : ''}"><input type="radio" name="approval" value="manual" ${st.approval_mode === 'manual' ? 'checked' : ''}>
              <div><b>Mit Freigabe</b><span>Nichts wird ohne dein OK gesendet</span></div></label>
            <label class="radio ${st.approval_mode === 'auto' ? 'active' : ''}"><input type="radio" name="approval" value="auto" ${st.approval_mode === 'auto' ? 'checked' : ''}>
              <div><b>Automatisch</b><span>Gili sendet, du kannst einzelne überspringen</span></div></label>
          </div>
        </div>
        <div class="panel-row stack">
          <div><div class="panel-title">Versandtage</div></div>
          <div class="day-picks">${DAY_ORDER.map(d => `<button class="day-pick ${st.window.days.includes(d) ? 'active' : ''}" data-day="${d}">${DAYS_SHORT[d]}</button>`).join('')}</div>
        </div>
        <div class="panel-row"><div><div class="panel-title">Uhrzeit</div></div>
          <div class="inline-field">${hourSelect('window.from', st.window.from)} – ${hourSelect('window.to', st.window.to)}</div></div>
        <div class="panel-row"><div><div class="panel-title">Mindestabstand</div><div class="panel-sub">Zwischen zwei automatischen Nachrichten an dieselbe Kundin</div></div>
          <div class="inline-field"><input type="number" min="1" max="120" data-setting="min_gap_days" value="${st.min_gap_days}"> Tage</div></div>
      </div>

      <div class="section-label">Einladungen zum Wiederkommen</div>
      <div class="panel">
        <div class="panel-row"><div><div class="panel-title">Einladungen senden</div><div class="panel-sub">Nur an Kundinnen mit Einwilligung und ohne geplanten Termin</div></div>
          ${toggle('reinvite.enabled', st.reinvite.enabled)}</div>
        <div class="panel-row"><div><div class="panel-title">Abstand je nach Leistung</div><div class="panel-sub">Sonst gilt für alle derselbe Abstand</div></div>
          ${toggle('reinvite.per_service', st.reinvite.per_service)}</div>
        ${st.reinvite.per_service ? services.map(s => `
          <div class="panel-row sub-row"><div class="panel-title light">${esc(s.name)}</div>
            <div class="inline-field"><input type="number" min="1" max="52" data-service="${s.id}" value="${s.reinvite_weeks}"> Wochen</div></div>`).join('') : `
          <div class="panel-row"><div class="panel-title light">Abstand für alle</div>
            <div class="inline-field"><input type="number" min="1" max="52" data-setting="reinvite.default_weeks" value="${st.reinvite.default_weeks}"> Wochen</div></div>`}
        <div class="panel-row"><div><div class="panel-title">Erinnerung ohne Antwort</div><div class="panel-sub">Einmal, wenn keine Antwort kommt</div></div>
          ${toggle('reinvite.followup_enabled', st.reinvite.followup_enabled)}</div>
        ${st.reinvite.followup_enabled ? `<div class="panel-row sub-row"><div class="panel-title light">Nach</div>
          <div class="inline-field"><input type="number" min="3" max="60" data-setting="reinvite.followup_days" value="${st.reinvite.followup_days}"> Tagen</div></div>` : ''}
      </div>

      <div class="section-label">Bewertungsanfragen</div>
      <div class="panel">
        <div class="panel-row"><div><div class="panel-title">Nach dem Termin um eine Bewertung bitten</div></div>
          ${toggle('review.enabled', st.review.enabled)}</div>
        <div class="panel-row"><div class="panel-title light">Zeitpunkt</div>
          <select data-setting="review.delay_hours">${[[2, '2 Stunden danach'], [24, 'Am nächsten Tag'], [48, 'Nach 2 Tagen']].map(([v, l]) =>
            `<option value="${v}" ${v === st.review.delay_hours ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="panel-row stack"><div class="panel-title light">Link zur Google-Bewertung</div>
          <input class="text-input" type="url" data-salon="review_url" value="${esc(salon.review_url)}"></div>
      </div>

      <div class="section-label">Nachrichtenvorlagen</div>
      <div class="panel">
        ${Object.entries(templates).map(([k, t]) => `<div class="panel-row stack"><div class="panel-title">${KIND_LABELS[k]}</div>${messagePreview(t)}</div>`).join('')}
        <div class="panel-note">Vorlagen müssen von WhatsApp freigegeben werden. Änderungswünsche bitte direkt an Gili.</div>
      </div>

      <div class="section-label">Team</div>
      <div class="panel">
        ${team.map(u => `<div class="panel-row"><div><div class="panel-title">${esc(u.name)}</div><div class="panel-sub">${esc(u.email)}</div></div>
          <span class="badge b-muted">${ROLE_LABELS[u.role]}</span></div>`).join('')}
      </div>

      ${ctx.api.isDemo ? `<div class="section-label">Demo</div>
      <div class="panel"><div class="panel-row"><div><div class="panel-title">Demodaten zurücksetzen</div><div class="panel-sub">Alle Änderungen in dieser Demo verwerfen</div></div>
        <button class="btn-ghost" data-reset>Zurücksetzen</button></div></div>` : ''}
    </div>`;
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  keys.slice(0, -1).reduce((o, k) => o[k], obj)[keys.at(-1)] = value;
}

export function mount(el, ctx) {
  const saveSettings = async mutate => {
    const st = structuredClone(ctx.cache.settings);
    mutate(st);
    if (st.window.from >= st.window.to) { toast('Die Endzeit muss nach der Startzeit liegen'); return ctx.refresh(); }
    if (!st.window.days.length) { toast('Mindestens ein Versandtag'); return ctx.refresh(); }
    await ctx.api.updateSettings(ctx.salonId, st);
    toast('Gespeichert');
    ctx.refresh();
  };

  el.addEventListener('change', async e => {
    const t = e.target;
    if (t.dataset.field) return saveSettings(st => setPath(st, t.dataset.field, t.checked));
    if (t.dataset.setting) return saveSettings(st => setPath(st, t.dataset.setting, Number(t.value)));
    if (t.name === 'approval') return saveSettings(st => { st.approval_mode = t.value; });
    if (t.dataset.service) {
      await ctx.api.updateService(ctx.salonId, t.dataset.service, { reinvite_weeks: t.value });
      toast('Gespeichert');
      return ctx.refresh();
    }
    if (t.dataset.salon) {
      await ctx.api.updateSalon(ctx.salonId, { [t.dataset.salon]: t.value.trim() });
      toast('Gespeichert');
    }
  });

  el.addEventListener('click', async e => {
    const day = e.target.closest('[data-day]');
    if (day) {
      const d = Number(day.dataset.day);
      return saveSettings(st => { st.window.days = st.window.days.includes(d) ? st.window.days.filter(x => x !== d) : [...st.window.days, d]; });
    }
    if (e.target.closest('[data-reset]') && confirm('Alle Änderungen in der Demo verwerfen?')) {
      await ctx.api.resetDemo();
      toast('Demo zurückgesetzt');
      ctx.refresh();
    }
  });
}
