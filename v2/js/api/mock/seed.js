// Fictional demo data for two salons. Shaped like the planned Postgres tables
// (salons, staff, services, clients, appointments, conversations, messages,
// automation_settings, users, memberships) so the views don't change when the
// real backend replaces the mock.
//
// The data is regenerated relative to "now" on every load (same random seed,
// so ids stay stable). Edits made in the demo are stored separately and
// re-applied on top, see store.js.

import { nextSlot } from './rules.js';
import { TEMPLATES, fill } from './templates.js';

const DAY = 86400000;

export const DEFAULT_SETTINGS = {
  approval_mode: 'manual',            // 'manual' = nothing is sent without approval, 'auto'
  window: { days: [2, 3, 4, 5, 6], from: 10, to: 18 },  // 0 = Sunday
  min_gap_days: 30,                   // minimum days between two automated messages
  reinvite: { enabled: true, per_service: true, default_weeks: 6, followup_enabled: true, followup_days: 14 },
  review: { enabled: true, delay_hours: 24 },
};

const SALONS = [
  {
    id: 's_lumiere', name: 'Salon Lumière', address: 'Neubaugasse 12, 1070 Wien',
    review_url: 'https://example.com/bewertung/lumiere',
    staff: ['Lena', 'Sophie'], clientCount: 30,
    services: [
      ['Damenhaarschnitt', 55, 45, 6],
      ['Waschen, Schneiden & Föhnen', 75, 60, 6],
      ['Färben', 95, 120, 5],
      ['Balayage', 150, 180, 10],
      ['Herrenhaarschnitt', 35, 30, 4],
      ['Augenbrauen & Wimpern', 25, 30, 4],
    ],
  },
  {
    id: 's_mira', name: 'Studio Mira', address: 'Kettenbrückengasse 5, 1050 Wien',
    review_url: 'https://example.com/bewertung/mira',
    staff: ['Mira'], clientCount: 14,
    services: [
      ['Maniküre', 38, 45, 3],
      ['Gel-Nägel', 55, 75, 3],
      ['Pediküre', 45, 60, 5],
      ['Wimpernlifting', 60, 60, 6],
      ['Augenbrauen zupfen', 20, 20, 4],
    ],
  },
];

const FIRST = ['Anna', 'Sophie', 'Lena', 'Julia', 'Katharina', 'Laura', 'Sarah', 'Marie', 'Hannah', 'Lisa',
  'Elena', 'Valentina', 'Theresa', 'Magdalena', 'Johanna', 'Nina', 'Clara', 'Emilia', 'Leonie', 'Selina',
  'Miriam', 'Verena', 'Doris', 'Sabine', 'Petra', 'Nadine', 'Melanie', 'Aylin', 'Ivana', 'Jelena', 'Zeynep', 'Carina'];
const MALE = ['Lukas', 'Florian', 'David', 'Stefan', 'Markus'];
const LAST = ['Gruber', 'Huber', 'Wagner', 'Bauer', 'Pichler', 'Steiner', 'Moser', 'Mayer', 'Hofer', 'Leitner',
  'Berger', 'Fuchs', 'Eder', 'Fischer', 'Schmid', 'Winkler', 'Weber', 'Schwarz', 'Maier', 'Schneider',
  'Reiter', 'Brunner', 'Lang', 'Baumgartner', 'Novak', 'Horvat', 'Yilmaz', 'Kovač'];
const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seed(now = new Date()) {
  const rnd = mulberry32(20261017);
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  let seq = 0;
  const id = prefix => `${prefix}_${++seq}`;

  const db = {
    salons: [], staff: [], services: [], clients: [], appointments: [],
    conversations: [], messages: [], settings: {}, users: [], memberships: [],
    queue: { skipped: {}, approved: {} },
  };

  // A date `offset` days from today at hh:mm, moved off Sunday/Monday (closed).
  const dayAt = (offset, hh, mm = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    d.setHours(hh, mm, 0, 0);
    const wd = d.getDay();
    if (wd === 0 || wd === 1) d.setDate(d.getDate() + (offset < 0 ? (wd === 0 ? -1 : -2) : (wd === 0 ? 2 : 1)));
    return d;
  };
  const randomHour = () => [9, 10, 11, 12, 13, 14, 15, 16, 17][Math.floor(rnd() * 9)];

  const addMsg = (salon, client, direction, kind, body, at, extra = {}) => {
    db.messages.push({ id: id('m'), salon_id: salon.id, client_id: client.id, direction, kind, body,
      at: new Date(at).toISOString(), status: 'delivered', ...extra });
  };
  const setConv = (salon, client, status, at) => {
    let conv = db.conversations.find(c => c.client_id === client.id);
    if (!conv) { conv = { id: id('cv'), salon_id: salon.id, client_id: client.id }; db.conversations.push(conv); }
    conv.status = status;
    conv.updated_at = new Date(at).toISOString();
  };
  const confirmation = (salon, client, svc, start) => {
    const d = new Date(start);
    const time = d.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
    return `Perfekt, ${client.name.split(' ')[0]}! ✨ ${time} passt wunderbar, ich habe den Termin für dich eingetragen. 🧡\n` +
      `📅 ${WEEKDAYS[d.getDay()]}, ${d.getDate()}.${d.getMonth() + 1}.\n⏰ ${time} Uhr\n✂️ ${svc.name}\n` +
      `📍 ${salon.name}, ${salon.address}\nWir freuen uns auf dich! 🌸`;
  };

  SALONS.forEach((def, salonIndex) => {
    const salon = { id: def.id, name: def.name, address: def.address, timezone: 'Europe/Vienna', review_url: def.review_url };
    db.salons.push(salon);
    db.settings[salon.id] = structuredClone(DEFAULT_SETTINGS);

    const staff = def.staff.map(name => ({ id: id('st'), salon_id: salon.id, name }));
    db.staff.push(...staff);
    const services = def.services.map(([name, price, duration_min, reinvite_weeks]) =>
      ({ id: id('sv'), salon_id: salon.id, name, price, duration_min, reinvite_weeks }));
    db.services.push(...services);
    const herren = services.find(s => s.name === 'Herrenhaarschnitt');
    const womenServices = services.filter(s => s !== herren);

    const usedNames = new Set();
    const clientInfo = [];

    for (let i = 0; i < def.clientCount; i++) {
      const male = herren && rnd() < 0.12;
      let name;
      do { name = `${pick(male ? MALE : FIRST)} ${pick(LAST)}`; } while (usedNames.has(name));
      usedNames.add(name);

      const client = {
        id: id('c'), salon_id: salon.id, name,
        phone: `+43 6${60 + Math.floor(rnd() * 40)} ${String(Math.floor(rnd() * 9000000) + 1000000)}`,
        source: 'import', marketing_consent: true, consent_source: 'Bei der Terminbuchung zugestimmt',
        invites_enabled: true, reviews_enabled: true, do_not_contact: false, dnc_reason: '',
        paused_until: null, note: '', created_at: null,
      };

      const special = salonIndex === 0 ? i : -1;
      const fav = male ? herren : pick(womenServices);
      const visits = special === 2 ? 4 : 1 + Math.floor(rnd() * 7);
      let lastDaysAgo = Math.floor(3 + rnd() * 120);
      if (special === 2) lastDaysAgo = 70;

      let off = lastDaysAgo;
      let oldest = null;
      for (let v = 0; v < visits; v++) {
        const svc = rnd() < 0.75 ? fav : pick(male ? [herren] : womenServices);
        const start = dayAt(-off, randomHour(), rnd() < 0.5 ? 0 : 30);
        const r = rnd();
        db.appointments.push({
          id: id('a'), salon_id: salon.id, client_id: client.id, service_id: svc.id, staff_id: pick(staff).id,
          starts_at: start.toISOString(), duration_min: svc.duration_min, price: svc.price,
          status: v > 0 && r < 0.05 ? 'cancelled' : v > 0 && r < 0.08 ? 'no_show' : 'booked',
          source: rnd() < 0.55 ? 'bot' : 'manual',
          booked_at: new Date(+start - (1 + Math.floor(rnd() * 6)) * DAY).toISOString(),
        });
        oldest = start;
        off += fav.reinvite_weeks * 7 + Math.round((rnd() - 0.5) * 14);
      }
      client.created_at = new Date(+oldest - DAY).toISOString();

      const forbidFuture = [2, 4, 6].includes(special);
      if (!forbidFuture && rnd() < 0.3) {
        const svc = rnd() < 0.8 ? fav : pick(male ? [herren] : womenServices);
        const start = dayAt(1 + Math.floor(rnd() * 20), randomHour(), rnd() < 0.5 ? 0 : 30);
        db.appointments.push({
          id: id('a'), salon_id: salon.id, client_id: client.id, service_id: svc.id, staff_id: pick(staff).id,
          starts_at: start.toISOString(), duration_min: svc.duration_min, price: svc.price, status: 'booked',
          source: rnd() < 0.6 ? 'bot' : 'manual',
          booked_at: new Date(Math.min(+now - DAY, +start - 3 * DAY)).toISOString(),
        });
      }

      if (special === 4) { client.paused_until = new Date(+now + 45 * DAY).toISOString(); client.note = 'Längerer Auslandsaufenthalt, meldet sich selbst.'; }
      if (special === 6) { client.marketing_consent = false; client.consent_source = ''; }
      if (special === 8) { client.reviews_enabled = false; client.note = 'Möchte keine Bewertungsanfragen.'; }

      db.clients.push(client);
      clientInfo.push({ client, special, lastDaysAgo, fav });
    }

    // A few appointments today (or on the next open day) for the Termine screen.
    const slots = [[10, 0], [11, 30], [14, 0], [16, 30]];
    clientInfo
      .filter(ci => ci.lastDaysAgo > 21 && ![2, 4, 6].includes(ci.special) &&
        !db.appointments.some(a => a.client_id === ci.client.id && new Date(a.starts_at) > now))
      .slice(0, salonIndex === 0 ? 4 : 2)
      .forEach((ci, k) => {
        const start = dayAt(0, ...slots[k]);
        db.appointments.push({
          id: id('a'), salon_id: salon.id, client_id: ci.client.id, service_id: ci.fav.id, staff_id: staff[k % staff.length].id,
          starts_at: start.toISOString(), duration_min: ci.fav.duration_min, price: ci.fav.price, status: 'booked',
          source: 'bot', booked_at: new Date(+start - 4 * DAY).toISOString(),
        });
      });

    const settings = db.settings[salon.id];
    const apptsOf = c => db.appointments.filter(a => a.client_id === c.id).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const serviceOf = a => services.find(s => s.id === a.service_id);

    clientInfo.forEach(({ client, special, lastDaysAgo }) => {
      const appts = apptsOf(client);
      const past = appts.filter(a => a.status === 'booked' && new Date(a.starts_at) <= now);
      const future = appts.filter(a => a.status === 'booked' && new Date(a.starts_at) > now);
      const last = past.at(-1);
      const first = client.name.split(' ')[0];

      // Booking chat with Gili for the most recent appointment booked through the bot.
      const botAppt = [...appts].reverse().find(a => a.source === 'bot' && a.status === 'booked');
      if (botAppt) {
        client.source = 'bot';
        const svc = serviceOf(botAppt);
        const start = new Date(botAppt.starts_at);
        const t0 = Math.min(+new Date(botAppt.booked_at), +now - 3600000);
        const time = start.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
        addMsg(salon, client, 'in', 'chat', `Hallo, hättet ihr am ${WEEKDAYS[start.getDay()]} Zeit für ${svc.name}?`, t0);
        addMsg(salon, client, 'out', 'chat', `Hallo ${first}, am ${WEEKDAYS[start.getDay()]} wäre um ${time} Uhr etwas frei. Passt das für dich?`, t0 + 60000);
        addMsg(salon, client, 'in', 'chat', 'Ja, das passt.', t0 + 5 * 60000);
        addMsg(salon, client, 'out', 'chat', confirmation(salon, client, svc, start), t0 + 6 * 60000);
        setConv(salon, client, 'booked', t0 + 6 * 60000);
      }

      if (special === 10) {
        const t = +now - 20 * 3600000;
        addMsg(salon, client, 'in', 'chat', 'Hallo, ich war letzte Woche bei euch und bin mit der Farbe leider nicht ganz zufrieden.', t);
        addMsg(salon, client, 'out', 'chat', 'Das tut mir leid zu hören. Ich gebe deine Nachricht an das Team weiter, wir melden uns so bald wie möglich bei dir.', t + 60000);
        setConv(salon, client, 'handoff', t + 60000);
      }

      if (special === 2) {
        const t = +now - 20 * DAY;
        addMsg(salon, client, 'out', 'reinvite', fill(TEMPLATES.reinvite, { name: first, salon: salon.name }), t, { result: 'opted_out', ref_appointment_id: last?.id });
        addMsg(salon, client, 'in', 'chat', 'Bitte keine Nachrichten mehr.', t + 2 * 3600000);
        addMsg(salon, client, 'out', 'chat', 'Alles klar, du bekommst von uns keine weiteren Nachrichten. Danke für deine Rückmeldung.', t + 2 * 3600000 + 60000);
        setConv(salon, client, 'closed', t + 2 * 3600000 + 60000);
        client.do_not_contact = true;
        client.dnc_reason = 'Hat sich per WhatsApp abgemeldet';
      }

      // Review requests that already went out.
      if (client.reviews_enabled && special !== 2) {
        past.filter(a => +now - +new Date(a.starts_at) < 40 * DAY).forEach(a => {
          const at = nextSlot(new Date(+new Date(a.starts_at) + a.duration_min * 60000 + settings.review.delay_hours * 3600000), settings, new Date(a.starts_at));
          if (at < now) addMsg(salon, client, 'out', 'review', fill(TEMPLATES.review, { name: first, salon: salon.name, link: salon.review_url }), at, { ref_appointment_id: a.id });
        });
      }

      const reachable = !client.do_not_contact && client.marketing_consent && client.invites_enabled && !client.paused_until && special !== 10;
      if (!last || !reachable) return;

      if (future.length && lastDaysAgo > 7 && rnd() < 0.7) {
        // Came back after an invitation: invitation, reply, booking.
        const next = future[0];
        const t = Math.max(+new Date(last.starts_at) + 7 * DAY, +now - (2 + Math.floor(rnd() * 8)) * DAY);
        addMsg(salon, client, 'out', 'reinvite', fill(TEMPLATES.reinvite, { name: first, salon: salon.name }), t, { result: 'booked', ref_appointment_id: last.id });
        addMsg(salon, client, 'in', 'chat', 'Ja gerne, hättet ihr nächste Woche Zeit?', t + 3 * 3600000);
        addMsg(salon, client, 'out', 'chat', confirmation(salon, client, serviceOf(next), next.starts_at), t + 3 * 3600000 + 5 * 60000);
        setConv(salon, client, 'booked', t + 3 * 3600000 + 5 * 60000);
        next.source = 'reinvite';
        next.booked_at = new Date(t + 3 * 3600000 + 5 * 60000).toISOString();
        return;
      }

      if (future.length) return;
      const weeks = serviceOf(last).reinvite_weeks;
      const due = +new Date(last.starts_at) + weeks * 7 * DAY;
      if (due < +now - 2 * DAY && rnd() < 0.85) {
        const at = nextSlot(new Date(due), settings, new Date(due));
        addMsg(salon, client, 'out', 'reinvite', fill(TEMPLATES.reinvite, { name: first, salon: salon.name }), at, { result: 'no_reply', ref_appointment_id: last.id });
        if (+now - +at > (settings.reinvite.followup_days + 1) * DAY && rnd() < 0.5) {
          const at2 = nextSlot(new Date(+at + settings.reinvite.followup_days * DAY), settings, at);
          addMsg(salon, client, 'out', 'followup', fill(TEMPLATES.followup, { name: first, salon: salon.name }), at2, { result: 'no_reply', ref_appointment_id: last.id });
        }
      }
    });

    // Two open questions that didn't lead to a booking.
    clientInfo.filter(ci => !db.conversations.some(c => c.client_id === ci.client.id)).slice(0, 2).forEach((ci, k) => {
      const t = +now - (k + 1) * 26 * 3600000;
      const svc = services[services.length > 3 ? 3 : 0];
      addMsg(salon, ci.client, 'in', 'chat', `Was kostet bei euch ${svc.name}?`, t);
      addMsg(salon, ci.client, 'out', 'chat', `${svc.name} kostet bei uns ${svc.price} €. Möchtest du einen Termin vereinbaren?`, t + 60000);
      setConv(salon, ci.client, 'open', t + 60000);
    });
  });

  db.users.push(
    { id: 'u_anna', name: 'Anna Berger', email: 'anna@demo.gili.live' },
    { id: 'u_sophie', name: 'Sophie Wagner', email: 'sophie@demo.gili.live' },
  );
  const sophieStaff = db.staff.find(s => s.salon_id === 's_lumiere' && s.name === 'Sophie');
  db.memberships.push(
    { user_id: 'u_anna', salon_id: 's_lumiere', role: 'owner' },
    { user_id: 'u_anna', salon_id: 's_mira', role: 'owner' },
    { user_id: 'u_sophie', salon_id: 's_lumiere', role: 'staff', staff_id: sophieStaff.id },
  );

  return db;
}
