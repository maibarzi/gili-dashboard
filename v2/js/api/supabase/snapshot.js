// Turns one salon's rows from the CRM tables (supabase/migrations/0001) into
// the shape the dashboard core works with. Pure: no network, testable with
// rows from any Postgres.

const pad = n => String(n).padStart(2, '0');
const hour = t => Number(String(t).slice(0, 2));

// Database weekdays are Luxon style (1 = Monday … 7 = Sunday), the dashboard
// uses JavaScript's getDay() (0 = Sunday … 6 = Saturday).
export function settingsFromRow(r) {
  return {
    approval_mode: r.approval_mode,
    window: { days: r.send_days.map(d => d % 7), from: hour(r.send_from), to: hour(r.send_to) },
    min_gap_days: r.min_gap_days,
    reinvite: {
      enabled: r.reinvite_enabled, per_service: r.reinvite_per_service, default_weeks: r.reinvite_default_weeks,
      followup_enabled: r.followup_enabled, followup_days: r.followup_days,
    },
    review: { enabled: r.review_enabled, delay_hours: r.review_delay_hours },
  };
}

export function settingsToRow(s) {
  return {
    approval_mode: s.approval_mode,
    send_days: [...new Set(s.window.days.map(d => (d === 0 ? 7 : d)))].sort((a, b) => a - b),
    send_from: `${pad(s.window.from)}:00`,
    send_to: `${pad(s.window.to)}:00`,
    min_gap_days: s.min_gap_days,
    reinvite_enabled: s.reinvite.enabled,
    reinvite_per_service: s.reinvite.per_service,
    reinvite_default_weeks: s.reinvite.default_weeks,
    followup_enabled: s.reinvite.followup_enabled,
    followup_days: s.reinvite.followup_days,
    review_enabled: s.review.enabled,
    review_delay_hours: s.review.delay_hours,
  };
}

// Same defaults as the automation_settings table, for a salon without a row yet.
const DEFAULT_SETTINGS_ROW = {
  approval_mode: 'manual', send_days: [2, 3, 4, 5, 6], send_from: '10:00', send_to: '18:00', min_gap_days: 30,
  reinvite_enabled: false, reinvite_per_service: true, reinvite_default_weeks: 6, followup_enabled: true,
  followup_days: 14, review_enabled: false, review_delay_hours: 24,
};

// A contact with no person yet (chatted, never booked) still shows as a client.
export const virtualId = contactId => `contact:${contactId}`;
export const isVirtual = id => String(id).startsWith('contact:');

export function buildSnapshot(raw) {
  const { salon, staff, services, contacts, people, appointments, appointment_services, messages,
    settings, templates, decisions } = raw;
  const svcById = new Map(services.map(s => [s.id, s]));
  const contactById = new Map(contacts.map(c => [c.id, c]));
  const activePeople = people.filter(p => !p.merged_into);
  const phone = c => (c ? `+${c.phone}` : '');

  const clients = activePeople.map(p => {
    const c = contactById.get(p.contact_id);
    return {
      id: p.id, salon_id: p.salon_id, name: p.name, phone: phone(c), contact_id: p.contact_id || null,
      source: p.source, virtual: false,
      marketing_consent: !!c?.marketing_consent, consent_source: c?.consent_source || '',
      do_not_contact: !!c?.do_not_contact, dnc_reason: c?.dnc_reason || '',
      invites_enabled: p.invites_enabled, reviews_enabled: p.reviews_enabled,
      paused_until: p.paused_until ? `${p.paused_until}T23:59:00` : null,
      note: p.note || '', created_at: p.created_at,
    };
  });
  const withPeople = new Set(activePeople.map(p => p.contact_id));
  contacts.filter(c => !withPeople.has(c.id)).forEach(c => clients.push({
    id: virtualId(c.id), salon_id: c.salon_id, name: c.whatsapp_name || phone(c), phone: phone(c), contact_id: c.id,
    source: c.source, virtual: true,
    marketing_consent: c.marketing_consent, consent_source: c.consent_source || '',
    do_not_contact: c.do_not_contact, dnc_reason: c.dnc_reason || '',
    invites_enabled: true, reviews_enabled: true, paused_until: null, note: '', created_at: c.created_at,
  }));

  const svcRows = new Map();
  appointment_services.forEach(r => (svcRows.get(r.appointment_id) || svcRows.set(r.appointment_id, []).get(r.appointment_id)).push(r));
  const appts = appointments.filter(a => a.person_id).map(a => {
    const rows = svcRows.get(a.id) || [];
    const svcs = rows.map(r => svcById.get(r.service_id)).filter(Boolean);
    // The service that brings her back soonest decides when to invite.
    const main = [...svcs].filter(s => s.reinvite_weeks).sort((x, y) => x.reinvite_weeks - y.reinvite_weeks)[0] || svcs[0];
    const minutes = a.ends_at ? (new Date(a.ends_at) - new Date(a.starts_at)) / 60000 : main?.duration_min || 60;
    return {
      id: a.id, salon_id: a.salon_id, client_id: a.person_id, service_id: main?.id || null,
      service_name: rows.map(r => r.name).join(' + ') || a.title || '',
      staff_id: a.staff_id, starts_at: a.starts_at, duration_min: minutes,
      price: a.price == null ? 0 : Number(a.price), status: a.status, source: a.source,
      booked_at: a.booked_at || a.created_at,
    };
  });

  // Chats belong to the WhatsApp number; show them on the person who was there last.
  const primary = new Map();
  contacts.forEach(c => {
    const ps = clients.filter(x => x.contact_id === c.id);
    const lastVisit = id => appts.filter(a => a.client_id === id).reduce((m, a) => (a.starts_at > m ? a.starts_at : m), '');
    primary.set(c.id, ps.sort((x, y) => lastVisit(y.id).localeCompare(lastVisit(x.id)))[0]?.id);
  });
  const msgs = [];
  messages.forEach(m => {
    const base = { id: m.id, salon_id: m.salon_id, direction: m.direction, kind: m.kind, body: m.body, at: m.at,
      status: m.status, result: m.result, ref_appointment_id: m.ref_appointment_id };
    const targets = m.kind !== 'chat' && m.person_ids?.length ? m.person_ids : [primary.get(m.contact_id)];
    targets.filter(Boolean).forEach(client_id => msgs.push({ ...base, client_id }));
  });

  const conversations = contacts.map(c => {
    const chat = messages.filter(m => m.contact_id === c.id && m.kind === 'chat');
    if (!chat.length) return null;
    const lastAt = chat.reduce((m, x) => (x.at > m ? x.at : m), '');
    const ids = new Set(clients.filter(x => x.contact_id === c.id).map(x => x.id));
    // No status from the bot yet: a booking made around the last chat counts as booked.
    const booked = appts.some(a => ids.has(a.client_id) && a.booked_at && Math.abs(new Date(a.booked_at) - new Date(lastAt)) < 86400000);
    return { id: c.id, salon_id: c.salon_id, client_id: primary.get(c.id), contact_id: c.id,
      status: c.chat_status || (booked ? 'booked' : 'open'), updated_at: c.chat_status_at || lastAt };
  }).filter(Boolean);

  const tpl = {};
  [...templates].sort((a, b) => (a.salon_id ? 1 : 0) - (b.salon_id ? 1 : 0))   // salon's own wins over shared
    .filter(t => t.language === 'de').forEach(t => { tpl[t.kind] = t.body; });

  const queue = { skipped: {}, approved: {} };
  decisions.forEach(d => { (d.action === 'skip' ? queue.skipped : queue.approved)[d.queue_key] = true; });

  return {
    salons: [salon],
    staff,
    services: services.map(s => ({ ...s, price: s.price == null ? null : Number(s.price) })),
    clients,
    appointments: appts,
    conversations,
    messages: msgs,
    settings: { [salon.id]: settingsFromRow(settings || DEFAULT_SETTINGS_ROW) },
    queue,
    templates: tpl,
  };
}
