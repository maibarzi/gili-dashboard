// Who gets which automated message, and when.
//
// In production this logic lives in ONE place on the server (a Postgres view,
// `due_messages`), read by both n8n (to send) and the dashboard (to show the
// queue). This file is the mock stand-in for that view, so the dashboard can
// show realistic states without a backend.

const DAY = 86400000;
const MONTHS = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const fmt = iso => { const d = new Date(iso); return `${d.getDate()}. ${MONTHS[d.getMonth()]}`; };

// First moment at or after `target` that is inside the salon's send window.
export function nextSlot(target, settings, now = new Date()) {
  const { days, from, to } = settings.window;
  const d = new Date(Math.max(+target, +now));
  const m = d.getMinutes();
  if (m % 15) d.setMinutes(m + 15 - (m % 15), 0, 0);
  for (let i = 0; i < 14; i++) {
    if (days.includes(d.getDay())) {
      if (d.getHours() < from) { d.setHours(from, 0, 0, 0); return d; }
      if (d.getHours() < to) return d;
    }
    d.setDate(d.getDate() + 1);
    d.setHours(from, 0, 0, 0);
  }
  return d;
}

export function clientFacts(db, client, now) {
  const appts = db.appointments.filter(a => a.client_id === client.id).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const done = appts.filter(a => a.status === 'booked' && new Date(a.starts_at) <= now);
  const upcoming = appts.filter(a => a.status === 'booked' && new Date(a.starts_at) > now);
  const msgs = db.messages.filter(m => m.client_id === client.id).sort((a, b) => a.at.localeCompare(b.at));
  // People booked from the same WhatsApp number share chats and message limits.
  const ids = new Set(client.contact_id ? db.clients.filter(c => c.contact_id === client.contact_id).map(c => c.id) : [client.id]);
  const householdMsgs = db.messages.filter(m => ids.has(m.client_id)).sort((a, b) => a.at.localeCompare(b.at));
  return {
    appts, done, upcoming, msgs, householdMsgs,
    last: done.at(-1) || null,
    next: upcoming[0] || null,
    conv: db.conversations.find(c => ids.has(c.client_id)) || null,
    visits: done.length,
    revenue: done.reduce((s, a) => s + (a.price || 0), 0),
  };
}

// Invitation state of one client. Returns { state, reason, item? } where item
// is the next planned invitation, if any.
export function reinviteInfo(db, client, settings, now, f) {
  if (client.do_not_contact) return { state: 'blocked', reason: client.dnc_reason || 'Nicht kontaktieren' };
  if (f.conv?.status === 'handoff') return { state: 'handoff', reason: 'Offene Rückfrage im Chat' };
  if (f.next) return { state: 'upcoming', reason: `Termin am ${fmt(f.next.starts_at)}` };
  if (!f.last) return { state: 'new', reason: 'Noch kein Besuch' };
  if (!settings.reinvite.enabled) return { state: 'off', reason: 'Einladungen sind ausgeschaltet' };
  if (!client.marketing_consent) return { state: 'no_consent', reason: 'Keine Einwilligung für Einladungen' };
  if (!client.invites_enabled) return { state: 'excluded', reason: 'Einladungen für diese Kundin deaktiviert' };
  if (client.paused_until && new Date(client.paused_until) > now) return { state: 'paused', reason: `Pausiert bis ${fmt(client.paused_until)}` };

  const svc = db.services.find(s => s.id === f.last.service_id);
  const weeks = settings.reinvite.per_service && svc?.reinvite_weeks ? svc.reinvite_weeks : settings.reinvite.default_weeks;
  const lastAt = +new Date(f.last.starts_at);
  const sent = f.msgs.filter(m => (m.kind === 'reinvite' || m.kind === 'followup') && +new Date(m.at) > lastAt);
  const n = sent.length;

  let kind, target, reason;
  if (n === 0) {
    kind = 'reinvite';
    target = lastAt + weeks * 7 * DAY;
    reason = `${weeks} Wochen nach ${svc?.name || 'dem letzten Besuch'}`;
    const lastAuto = f.householdMsgs.filter(m => m.direction === 'out' && m.kind !== 'chat').at(-1);
    if (lastAuto && +new Date(lastAuto.at) + settings.min_gap_days * DAY > target) {
      target = +new Date(lastAuto.at) + settings.min_gap_days * DAY;
      reason += `, frühestens ${settings.min_gap_days} Tage nach der letzten Nachricht`;
    }
  } else {
    const lastSent = sent.at(-1);
    if (sent.some(m => m.result && m.result !== 'no_reply')) return { state: 'invited', reason: 'Hat auf die Einladung geantwortet' };
    const max = settings.reinvite.followup_enabled ? 2 : 1;
    if (n >= max) return { state: 'invited', reason: `Eingeladen am ${fmt(lastSent.at)}, keine Antwort` };
    kind = 'followup';
    target = +new Date(lastSent.at) + settings.reinvite.followup_days * DAY;
    reason = `Keine Antwort auf die Einladung vom ${fmt(lastSent.at)}`;
  }

  const at = nextSlot(new Date(target), settings, now);
  const item = { key: `${kind}:${client.id}:${f.last.id}:${n}`, kind, client_id: client.id, at: at.toISOString(), reason };
  const soon = +at - +now <= 7 * DAY;
  return { state: n > 0 ? 'invited' : soon ? 'due' : 'active', reason: n > 0 ? reason : soon ? reason : `Nächste Einladung am ${fmt(item.at)}`, item };
}

// All automated messages that are still to be sent for this client.
export function pendingFor(db, client, settings, now, f) {
  const items = [];
  if (settings.review.enabled && client.reviews_enabled && !client.do_not_contact) {
    f.appts
      .filter(a => a.status === 'booked' && +new Date(a.starts_at) > +now - 3 * DAY && +new Date(a.starts_at) < +now + 8 * DAY)
      .filter(a => !f.msgs.some(m => m.kind === 'review' && m.ref_appointment_id === a.id))
      .forEach(a => {
        const target = new Date(+new Date(a.starts_at) + a.duration_min * 60000 + settings.review.delay_hours * 3600000);
        items.push({ key: `review:${client.id}:${a.id}`, kind: 'review', client_id: client.id,
          at: nextSlot(target, settings, now).toISOString(), reason: `Nach dem Termin am ${fmt(a.starts_at)}` });
      });
  }
  const r = reinviteInfo(db, client, settings, now, f);
  if (r.item) items.push(r.item);
  return items.sort((a, b) => a.at.localeCompare(b.at));
}
