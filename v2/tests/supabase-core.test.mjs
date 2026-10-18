// Runs the dashboard core on real rows from the CRM tables, without a browser
// or network: builds the snapshot the Supabase source would build and calls
// every read function the screens use.
//
//   DUMP_DIR=/tmp/dump supabase/tests/run.sh <import.sql>   # load data, dump tables
//   node v2/tests/supabase-core.test.mjs /tmp/dump
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApi } from '../js/api/core.js';
import { buildSnapshot, settingsFromRow, settingsToRow } from '../js/api/supabase/snapshot.js';

const dir = process.argv[2];
const read = t => JSON.parse(readFileSync(join(dir, `${t}.json`), 'utf8'));
const salon = read('salons')[0];
const only = rows => rows.filter(r => r.salon_id === salon.id);
const raw = {
  salon, staff: only(read('staff')), services: only(read('services')), contacts: only(read('contacts')),
  people: only(read('people')), appointments: only(read('appointments')),
  appointment_services: only(read('appointment_services')), messages: only(read('messages')),
  settings: only(read('automation_settings'))[0],
  templates: read('message_templates').filter(t => !t.salon_id || t.salon_id === salon.id),
  decisions: only(read('queue_decisions')),
};

let failures = 0;
const check = (cond, label) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failures++; };

const db = buildSnapshot(raw);
const api = createApi({ isDemo: false, db: () => db, ensure: async () => {}, auth: {}, team: async () => [] });

const clients = await api.listClients(salon.id);
check(clients.length === raw.people.length + raw.contacts.filter(c => !raw.people.some(p => p.contact_id === c.id)).length,
  `clients: ${clients.length} (people + contacts that only chatted)`);
check(clients.filter(c => c.visits > 0).every(c => c.last_visit_at && c.last_service !== null), 'everyone with visits has last visit and service');

const appts = await api.listAppointments(salon.id, { from: new Date(0), to: new Date(Date.now() + 365 * 864e5) });
check(appts.length === raw.appointments.filter(a => a.status !== 'cancelled').length, `appointments: ${appts.length}`);
check(appts.every(a => a.client && a.service_name), 'every appointment has a client and a service name');

const convs = await api.listConversations(salon.id);
check(convs.length === raw.contacts.filter(c => raw.messages.some(m => m.contact_id === c.id)).length, `conversations: ${convs.length}, one per WhatsApp number`);
const shared = convs.find(c => c.client.others);
check(!!shared, `shared number shown once with +${shared?.client.others}`);

const chatTotal = (await Promise.all(convs.map(c => api.getChat(salon.id, c.client.id)))).reduce((s, c) => s + c.messages.length, 0);
check(chatTotal === raw.messages.length, `all ${raw.messages.length} messages reachable through chats (${chatTotal})`);

for (const c of clients) {
  const detail = await api.getClient(salon.id, c.id);
  if (!detail.client) { check(false, `profile of ${c.name}`); break; }
}
check(true, `every profile opens (${clients.length})`);
const sharedProfile = await api.getClient(salon.id, shared.client.id);
check(sharedProfile.others.length === shared.client.others, 'profile lists the other people on the same number');
check(sharedProfile.timeline.some(t => t.type === 'chat'), 'profile timeline shows the chats of the number');

const queue = await api.listQueue(salon.id, { days: 365 });
check(queue.every(i => i.status === 'pending'), `queue: ${queue.length} items, all waiting for approval (manual mode)`);
const stats = await api.getStats(salon.id, { year: 2026, month: 4 });
check(stats.revenue.count > 0, `May 2026: ${stats.revenue.count} appointments, €${stats.revenue.total}`);
const tpl = await api.templates(salon.id);
check(tpl.reinvite?.includes('Florence Beauty Salon'), 'templates filled with the salon name');

const settings = await api.getSettings(salon.id);
check(settings.window.days.join() === '2,3,4,5,6' && settings.window.from === 10, 'settings: Tue–Sat from 10:00');
const roundTrip = settingsToRow(settingsFromRow(raw.settings));
check(JSON.stringify(roundTrip.send_days) === JSON.stringify(raw.settings.send_days) && roundTrip.review_delay_hours === raw.settings.review_delay_hours,
  'settings convert to the table and back unchanged');
const sunday = settingsToRow({ ...settings, window: { ...settings.window, days: [0, 6] } });
check(sunday.send_days.join() === '6,7', 'Sunday maps to weekday 7 in the database');

// Switch invitations and review requests on: overdue people get planned messages.
db.settings[salon.id] = { ...settings, reinvite: { ...settings.reinvite, enabled: true }, review: { ...settings.review, enabled: true } };
const planned = await api.listQueue(salon.id, { days: 7 });
check(planned.length > 0 && planned.every(i => i.preview && !i.preview.includes('{')), `with invitations on: ${planned.length} planned, previews filled`);
check(planned.every(i => clients.find(c => c.id === i.client.id)), 'every planned message belongs to a known client');
check(planned.every(i => i.kind === 'review'), 'no invitations without marketing consent');
db.clients.forEach(c => { c.marketing_consent = true; });
const withConsent = await api.listQueue(salon.id, { days: 7 });
const perNumber = new Map();
withConsent.filter(i => i.kind.startsWith('reinvite')).forEach(i => {
  const phone = clients.find(c => c.id === i.client.id).phone;
  perNumber.set(phone, (perNumber.get(phone) || 0) + 1);
});
check(perNumber.size > 0, `with consent: invitations planned for ${perNumber.size} numbers`);
check([...perNumber.values()].every(n => n === 1), 'never more than one invitation per WhatsApp number');
const multi = withConsent.find(i => i.kind === 'reinvite_multi');
check(multi && multi.names.length > 1 && multi.preview.includes(' und '), `shared number gets one message naming ${multi?.names.length} people`);
const memberProfile = await api.getClient(salon.id, multi.client_ids.at(-1));
check(memberProfile.pending.some(p => p.key === multi.key), 'each named person shows the same combined message (same approve/skip)');

console.log(failures ? `\n${failures} FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
