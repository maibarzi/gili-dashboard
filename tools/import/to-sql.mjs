#!/usr/bin/env node
// Turns the dry run's data.json into one SQL file that loads a salon's history
// into the CRM tables (supabase/migrations/0001). Safe to run twice: every
// insert skips rows that already exist.
//
// Usage:
//   node tools/import/to-sql.mjs --data /tmp/import-florence/data.json \
//     --salon-slug florence-demo --out /tmp/import-florence/import.sql
//
// The SQL contains customer data. Keep it outside the repository.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) =>
  a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc, []));
for (const k of ['data', 'salon-slug', 'out']) {
  if (!args[k]) { console.error(`missing --${k}`); process.exit(1); }
}
const data = JSON.parse(readFileSync(args.data, 'utf8'));
const q = v => v === null || v === undefined || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`;
const ts = v => v ? `${q(new Date(v).toISOString())}::timestamptz` : 'null';
const slug = q(args['salon-slug']);

// The salon and the contact for a phone; callers add joins and then whereSalon.
const contactFrom = phone => `from public.salons s join public.contacts c on c.salon_id = s.id and c.phone = ${q(phone)}`;
const whereSalon = `where s.slug = ${slug}`;

const sql = [
  `-- History import for salon ${args['salon-slug']}, generated ${new Date().toISOString()}.`,
  '-- Re-running skips rows that already exist.',
  'begin;',
  '',
  `do $$ begin if not exists (select 1 from public.salons where slug = ${slug}) then`,
  `  raise exception 'salon ${args['salon-slug']} does not exist, run the seed first'; end if; end $$;`,
  '',
  '-- contacts',
];

for (const c of data.contacts) {
  // First time we heard from this number: earliest chat message or calendar booking.
  const first = [...data.messages.filter(m => m.phone === c.phone).map(m => m.at),
    ...data.appointments.filter(a => a.phone === c.phone).map(a => a.created_at)].filter(Boolean).sort()[0];
  // All of these came through the bot; marketing consent stays false until the owner records it.
  sql.push(`insert into public.contacts (salon_id, phone, whatsapp_name, source, created_at)
  select s.id, ${q(c.phone)}, ${q(c.whatsapp_names[0])}, 'bot', coalesce(${ts(first)}, now())
  from public.salons s where s.slug = ${slug}
  on conflict (salon_id, phone) do nothing;`);
}

sql.push('', '-- people');
const seenPeople = new Set();
for (const a of data.appointments) {
  const key = `${a.phone}|${a.name.toLowerCase()}`;
  if (seenPeople.has(key)) continue;
  seenPeople.add(key);
  sql.push(`insert into public.people (salon_id, contact_id, name, source)
  select s.id, c.id, ${q(a.name)}, 'bot' ${contactFrom(a.phone)} ${whereSalon}
  on conflict (contact_id, lower(name)) where merged_into is null do nothing;`);
}

sql.push('', '-- appointments and their services');
for (const a of data.appointments) {
  sql.push(`insert into public.appointments (salon_id, person_id, calendar_event_id, title, starts_at, ends_at, status, source, price, price_is_minimum, booked_at)
  select s.id, p.id, ${q(a.source_id)}, ${q(a.raw_summary)}, ${ts(a.starts_at)}, ${ts(a.ends_at)}, ${q(a.status)}, 'bot',
    ${a.price ?? 'null'}, ${a.price_is_minimum}, ${ts(a.created_at)}
  ${contactFrom(a.phone)}
  join public.people p on p.contact_id = c.id and lower(p.name) = lower(${q(a.name)}) and p.merged_into is null
  ${whereSalon}
  on conflict (salon_id, calendar_event_id) do nothing;`);
  for (const name of [...a.services, ...a.unknown_services]) {
    sql.push(`insert into public.appointment_services (appointment_id, salon_id, service_id, name, price)
  select ap.id, ap.salon_id, sv.id, ${q(name)}, sv.price
  from public.appointments ap join public.salons s on s.id = ap.salon_id and s.slug = ${slug}
  left join public.services sv on sv.salon_id = ap.salon_id and lower(sv.name) = lower(${q(name)})
  where ap.calendar_event_id = ${q(a.source_id)}
  on conflict do nothing;`);
  }
}

sql.push('', '-- chat messages (rows that greet as another salon are left out)');
let skippedForeign = 0;
for (const m of data.messages) {
  if (m.other_salon) { skippedForeign++; continue; }
  // No WhatsApp id in the sheet: a stable hash keeps re-runs from inserting twice.
  const key = 'import:' + createHash('sha1').update(`${m.phone}|${m.at}|${m.direction}|${m.body}`).digest('hex');
  sql.push(`insert into public.messages (salon_id, contact_id, direction, kind, body, at, wa_message_id)
  select s.id, c.id, ${q(m.direction)}, 'chat', ${q(m.body)}, ${ts(m.at)}, ${q(key)} ${contactFrom(m.phone)} ${whereSalon}
  on conflict (wa_message_id) do nothing;`);
}

sql.push('', 'commit;', '');
writeFileSync(args.out, sql.join('\n'));
console.log(`wrote ${args.out}: ${data.contacts.length} contacts, ${seenPeople.size} people, ${data.appointments.length} appointments, ${data.messages.length - skippedForeign} messages (${skippedForeign} from another salon left out)`);
