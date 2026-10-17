#!/usr/bin/env node
// Dry run of the one-time history import for a salon.
//
// Reads a Google Calendar export (.ics) and the chat log sheet (.csv), turns
// them into clients / appointments / messages shaped like the planned
// Postgres tables, and writes a report of what would be imported and what
// needs attention. It writes nothing anywhere except the --out folder.
//
// Usage:
//   node tools/import/dry-run.mjs --ics calendar.ics --csv chats.csv \
//     --services tools/import/services.florence.json --salon Florence --out /tmp/import-out
//
// The output contains customer data. Keep --out outside the repository.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) =>
  a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc, []));
for (const k of ['ics', 'csv', 'services', 'out']) {
  if (!args[k]) { console.error(`missing --${k}`); process.exit(1); }
}
const NOW = args.now ? new Date(args.now) : new Date();
const DAY = 86400000;
const config = JSON.parse(readFileSync(args.services, 'utf8'));
const TZ = config.timezone || 'Europe/Vienna';
const DEFAULT_REINVITE_WEEKS = 6;

// ---------- time ----------

function tzOffsetMinutes(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(date).map(x => [x.type, x.value]));
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date / 1000) * 1000) / 60000;
}
// "2026-03-27 07:42:49" (salon local time, no offset) → Date
function localToDate(s) {
  const guess = new Date(s.replace(' ', 'T') + 'Z');
  return new Date(+guess - tzOffsetMinutes(guess, TZ) * 60000);
}
function parseSheetTime(s) {
  s = (s || '').trim();
  if (!s) return null;
  const d = /[zZ]|[+-]\d\d:\d\d$/.test(s) ? new Date(s) : localToDate(s);
  return isNaN(d) ? null : d;
}
function parseIcsTime(value, params = '') {
  const m = value.match(/^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)(Z?))?$/);
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', s = '00', z] = m;
  const iso = `${y}-${mo}-${d} ${h}:${mi}:${s}`;
  if (z) return new Date(iso.replace(' ', 'T') + 'Z');
  return localToDate(iso); // TZID=... or floating time: treat as salon local
}
const fmtDate = d => d ? d.toLocaleDateString('de-AT', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

// ---------- phone ----------

// Digits in international format without '+', or null if it can't be a real number.
function normalizePhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = '43' + digits.slice(1);
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}
// Report only shows country code and last 4 digits.
const maskPhone = p => p ? `+${p.slice(0, p.startsWith('43') ? 2 : 3)} … ${p.slice(-4)}` : '—';

// ---------- services ----------

const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim();
const SERVICES = new Map(config.services.map(s => [norm(s.name), s]));
for (const [alias, target] of Object.entries(config.aliases || {})) SERVICES.set(norm(alias), SERVICES.get(norm(target)));
// "Ansatzblondierung & Föhnen" without "(kurz)" etc.: same family, length unknown → cheapest, price is a minimum.
const FAMILIES = new Map();
for (const s of config.services) {
  const base = norm(s.name.replace(/\s*\([^)]*\)\s*$/, ''));
  if (base !== norm(s.name)) FAMILIES.set(base, [...(FAMILIES.get(base) || []), s]);
}
const lookup = text => {
  const exact = SERVICES.get(norm(text));
  if (exact) return exact;
  const family = FAMILIES.get(norm(text));
  if (!family) return null;
  const cheapest = family.reduce((a, b) => (a.price <= b.price ? a : b));
  return { ...cheapest, name: text.trim(), price_from: true };
};

// "Komplettfarbe & Waschen, Schneiden & Föhnen (lang)" → two services. Names can
// contain " & " themselves, so match the longest known name at each position.
function splitServices(text) {
  const parts = text.split(' & ').map(p => p.trim()).filter(Boolean);
  const found = [], unknown = [];
  for (let i = 0; i < parts.length;) {
    let hit = null;
    for (let j = parts.length; j > i; j--) {
      const s = lookup(parts.slice(i, j).join(' & '));
      if (s) { hit = { s, next: j }; break; }
    }
    if (hit) { found.push(hit.s); i = hit.next; }
    else { unknown.push(parts[i]); i++; }
  }
  return { found, unknown };
}

// ---------- ICS ----------

function parseIcs(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const [name, ...params] = line.slice(0, idx).split(';');
    const value = line.slice(idx + 1).replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
    cur[name] = { value, params: params.join(';') };
  }
  return events;
}

// ---------- CSV ----------

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

// ---------- import ----------

const issues = [];
const issue = (kind, detail) => issues.push({ kind, detail });

// Appointments from the calendar
const appointments = [];
const unknownServices = new Map();
for (const ev of parseIcs(readFileSync(args.ics, 'utf8'))) {
  const raw = { summary: ev.SUMMARY?.value || '', description: ev.DESCRIPTION?.value || '' };
  // n8n expressions written as "={{ ... }}" leave a literal '=' in front.
  const summary = raw.summary.replace(/^=+/, '').trim();
  const description = raw.description.replace(/^=+/, '').trim();
  if (raw.summary.startsWith('=') || raw.description.startsWith('=')) issue('equals_prefix', summary);

  const start = ev.DTSTART && parseIcsTime(ev.DTSTART.value, ev.DTSTART.params);
  const end = ev.DTEND && parseIcsTime(ev.DTEND.value, ev.DTEND.params);
  const appt = {
    source_id: ev.UID?.value, starts_at: start, ends_at: end,
    created_at: ev.CREATED ? parseIcsTime(ev.CREATED.value) : null,
    status: (ev.STATUS?.value || 'CONFIRMED') === 'CANCELLED' ? 'cancelled' : 'booked',
    raw_summary: summary, name: null, phone: null, stylist: null, services: [], unknown_services: [],
    price: null, price_is_minimum: false, skip: null,
  };

  const descPhone = description.match(/Phone:\s*([+\d][\d\s]*)/i);
  if (descPhone) {
    appt.phone = normalizePhone(descPhone[1]);
    if (!appt.phone) appt.skip = `invalid phone "${descPhone[1].trim()}"`;
  }
  const descStylist = description.match(/Stylist:\s*([^/\n]+)/i);
  if (descStylist) appt.stylist = descStylist[1].trim();
  if (/^test\b/i.test(summary)) appt.skip = 'test booking';

  const dash = summary.split(/\s+–\s+/);
  if (dash.length < 2) {
    appt.skip ||= 'summary not in "<service> – <name>" format';
  } else {
    let [svcText, rest] = [dash[0], dash.slice(1).join(' – ')];
    const at = rest.match(/^(.*?)\s+@\s+(.+)$/);
    if (at) { rest = at[1]; appt.stylist ||= at[2].trim(); }
    appt.name = rest.trim();
    const { found, unknown } = splitServices(svcText);
    appt.services = found.map(s => s.name);
    appt.unknown_services = unknown;
    unknown.forEach(u => unknownServices.set(u, (unknownServices.get(u) || 0) + 1));
    appt.price = found.reduce((sum, s) => sum + s.price, 0) || null;
    appt.price_is_minimum = found.some(s => s.price_from) || unknown.length > 0;
    const weeks = found.map(s => s.reinvite_weeks).filter(w => w);
    appt.reinvite_weeks = weeks.length ? Math.min(...weeks) : null;
    appt.no_reinvite = found.length > 0 && found.every(s => s.reinvite_weeks === null);
  }
  if (!appt.phone && !appt.skip) appt.skip = 'no phone number';
  if (!start) appt.skip = 'no start time';
  appointments.push(appt);
}

// Chat rows from the sheet
const [header, ...rows] = parseCsv(readFileSync(args.csv, 'utf8'));
const col = name => header.findIndex(h => norm(h) === norm(name));
const C = { time: col('time'), phone: col('phone number'), user: col('user message'), bot: col('bot response'),
  status: col('STATUS'), name: col('customer_name'), service: col('SERVICE') };
const messages = [];
const otherSalon = new Map();
let rowsNoPhone = 0, rowsBadTime = 0;
for (const r of rows) {
  const at = parseSheetTime(r[C.time]);
  const phone = normalizePhone(r[C.phone]);
  if (!at) { rowsBadTime++; continue; }
  if (!phone) { rowsNoPhone++; continue; }
  const bot = r[C.bot] || '';
  const greet = bot.replace(/\*/g, '').match(/(?:Welcome to|Willkommen bei|Witamy w)\s+([^!🌸💛\n]+?)\s*[!🌸💛\n]/u);
  if (greet && args.salon && !greet[1].toLowerCase().includes(args.salon.toLowerCase())) {
    otherSalon.set(greet[1].trim(), (otherSalon.get(greet[1].trim()) || 0) + 1);
  }
  const base = { phone, at, status: r[C.status] || '', profile_name: (r[C.name] || '').trim() };
  if (r[C.user]) messages.push({ ...base, direction: 'in', body: r[C.user] });
  if (bot) messages.push({ ...base, direction: 'out', body: bot.replace(/\[\[STATUS:\w+\]\]/g, '').trim() });
}

// Contact = one WhatsApp number (where messages go). Person = someone booked
// from that number, by name: a mother booking for her daughter is one contact
// with two people, each with their own visits and reinvite date.
const contacts = new Map();
const contact = phone => {
  if (!contacts.has(phone)) contacts.set(phone, { phone, people: new Map(), profile_names: new Set(), msgs: [] });
  return contacts.get(phone);
};
const personKey = name => norm(name || '').normalize('NFKC');
const usable = appointments.filter(a => !a.skip);
usable.forEach(a => {
  const c = contact(a.phone);
  const k = personKey(a.name);
  if (!c.people.has(k)) c.people.set(k, { name: a.name, appts: [] });
  c.people.get(k).appts.push(a);
});
messages.forEach(m => {
  const c = contact(m.phone);
  c.msgs.push(m);
  if (m.profile_name && normalizePhone(m.profile_name) !== m.phone) c.profile_names.add(m.profile_name);
});

// Cross-check: does every chat marked BOOKED have a calendar event created around that time?
const bookedRows = messages.filter(m => m.status === 'BOOKED' && m.direction === 'out');
const bookedMatched = bookedRows.filter(m =>
  usable.some(a => a.phone === m.phone && a.created_at && Math.abs(+a.created_at - +m.at) < 15 * 60000));

function personSummary(p) {
  const appts = p.appts.filter(a => a.status === 'booked').sort((a, b) => a.starts_at - b.starts_at);
  const past = appts.filter(a => a.starts_at <= NOW);
  const future = appts.filter(a => a.starts_at > NOW);
  const last = past.at(-1) || null;
  let reinvite = null;
  if (last && !future.length && !last.no_reinvite) {
    reinvite = new Date(+last.starts_at + (last.reinvite_weeks || DEFAULT_REINVITE_WEEKS) * 7 * DAY);
  }
  return {
    name: p.name,
    visits: past.length,
    first_visit: past[0]?.starts_at || null,
    last_visit: last?.starts_at || null,
    last_services: last?.services || [],
    next_appointment: future[0]?.starts_at || null,
    revenue: past.reduce((s, a) => s + (a.price || 0), 0),
    revenue_is_minimum: past.some(a => a.price_is_minimum),
    reinvite_due: reinvite,
  };
}

// Latin names one letter apart under the same number (Mili / Milli) are probably
// the same person typed differently. Only a hint; the owner merges in the UI.
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

const summaries = [...contacts.values()].map(c => {
  const people = [...c.people.values()].map(personSummary).sort((a, b) => (b.last_visit || 0) - (a.last_visit || 0));
  const similar = [];
  people.forEach((a, i) => people.slice(i + 1).forEach(b => {
    const x = personKey(a.name), y = personKey(b.name);
    if (/^[a-z]+$/.test(x) && /^[a-z]+$/.test(y) && lev(x, y) <= 1) similar.push([a.name, b.name]);
  }));
  return {
    phone: c.phone,
    people,
    similar_names: similar,
    whatsapp_names: [...c.profile_names],
    chat_messages: c.msgs.length,
    last_chat: c.msgs.length ? new Date(Math.max(...c.msgs.map(m => +m.at))) : null,
    last_visit: people.map(p => p.last_visit).filter(Boolean).sort((a, b) => b - a)[0] || null,
  };
}).sort((a, b) => (b.last_visit || 0) - (a.last_visit || 0));

// ---------- report ----------

const skipped = appointments.filter(a => a.skip);
const allPeople = summaries.flatMap(s => s.people);
const multiPeople = summaries.filter(s => s.people.length > 1);
const range = list => { const t = list.filter(Boolean).map(Number); return t.length ? `${fmtDate(new Date(Math.min(...t)))} – ${fmtDate(new Date(Math.max(...t)))}` : '—'; };
const equalsCount = issues.filter(i => i.kind === 'equals_prefix').length;

const md = [];
md.push(`# Import dry run: ${config.salon}`, '', `Generated ${NOW.toISOString()}. Nothing was written anywhere; this is what an import would produce.`, '');
md.push('## Summary', '');
md.push(`| | |`, `|---|---|`);
md.push(`| Calendar events | ${appointments.length} (${range(appointments.map(a => a.starts_at))}) |`);
md.push(`| → importable appointments | ${usable.length} (${usable.filter(a => a.starts_at <= NOW).length} past, ${usable.filter(a => a.starts_at > NOW).length} upcoming) |`);
md.push(`| → skipped | ${skipped.length} |`);
md.push(`| Chat rows in sheet | ${rows.length} (${range(messages.map(m => m.at))}) |`);
md.push(`| → rows without phone number | ${rowsNoPhone} |`);
md.push(`| → rows with unreadable time | ${rowsBadTime} |`);
md.push(`| Contacts (WhatsApp numbers) | ${summaries.length} |`);
md.push(`| → with at least one booking | ${summaries.filter(s => s.people.length).length} |`);
md.push(`| → chatted but never booked | ${summaries.filter(s => !s.people.length).length} |`);
md.push(`| People (booked under a contact) | ${allPeople.length} |`);
md.push(`| Chats marked BOOKED that match a calendar event | ${bookedMatched.length} of ${bookedRows.length} |`, '');

md.push('## Needs attention', '');
if (skipped.length) {
  md.push(`### Skipped calendar events (${skipped.length})`, '', '| Date | Summary | Reason |', '|---|---|---|');
  skipped.forEach(a => md.push(`| ${fmtDate(a.starts_at)} | ${a.raw_summary} | ${a.skip} |`));
  md.push('');
}
if (unknownServices.size) {
  md.push(`### Service names not in the price list (${unknownServices.size})`, '', 'Appointments still import; price counts as unknown. Add them to the services file or map them with an alias.', '', '| Name in calendar | Times |', '|---|---|');
  [...unknownServices].sort((a, b) => b[1] - a[1]).forEach(([n, k]) => md.push(`| ${n} | ${k} |`));
  md.push('');
}
const similar = summaries.filter(s => s.similar_names.length);
if (similar.length) {
  md.push('### Possibly the same person spelled differently', '', 'Imported as separate people. The owner can merge them later.', '', '| Contact | Names |', '|---|---|');
  similar.forEach(s => s.similar_names.forEach(([a, b]) => md.push(`| ${maskPhone(s.phone)} | ${a} / ${b} |`)));
  md.push('');
}
if (otherSalon.size) {
  md.push('### Chat rows that greet with another salon name', '', `The sheet seems to contain conversations from another salon's bot. These would be imported into the wrong salon.`, '', '| Salon name in greeting | Rows |', '|---|---|');
  otherSalon.forEach((k, n) => md.push(`| ${n} | ${k} |`));
  md.push('');
}
md.push('### Data quality in the bot workflow', '');
if (equalsCount) md.push(`- ${equalsCount} calendar events start with a stray \`=\` in summary or description (n8n expression written as \`=={{ … }}\`). The import strips it; the workflow should be fixed.`);
if (appointments.some(a => a.stylist)) md.push(`- Some events carry a stylist (\`@ Name\` in the summary or \`Stylist:\` in the description) and no phone number. Two booking formats are in use.`);
md.push(`- \`customer_name\` in the sheet is the WhatsApp profile name, not the name given in the chat. The calendar name is used for people; profile names are kept on the contact.`);
md.push(`- \`STATUS\` and \`SERVICE\` in the sheet are guessed from the bot's text by keywords, so they are not reliable. The import uses the calendar for bookings and services.`, '');

md.push(`## People (${allPeople.length})`, '', `Grouped by contact. Reinvite date = last visit + weeks for that service (default ${DEFAULT_REINVITE_WEEKS}), only when the person has no upcoming appointment. Messages go to the contact's number.`, '');
md.push('| Contact | Person | Visits | Last visit | Services | Next | Revenue | Reinvite due |', '|---|---|---|---|---|---|---|---|');
summaries.filter(s => s.people.length).forEach(s => s.people.forEach((p, i) => md.push(
  `| ${i === 0 ? `${maskPhone(s.phone)}${s.people.length > 1 ? ` (${s.people.length})` : ''}` : ''} | ${p.name} | ${p.visits} | ${fmtDate(p.last_visit)} | ${p.last_services.join(' + ') || '—'} | ${fmtDate(p.next_appointment)} | ${p.revenue ? `€${p.revenue}${p.revenue_is_minimum ? '+' : ''}` : '—'} | ${p.reinvite_due ? fmtDate(p.reinvite_due) + (p.reinvite_due < NOW ? ' (overdue)' : '') : '—'} |`)));
md.push('');
const chatOnly = summaries.filter(s => !s.people.length);
if (chatOnly.length) {
  md.push(`## Contacts without bookings (${chatOnly.length})`, '', 'Chatted with the bot but never booked. Imported as contacts with chat history.', '', '| Contact | WhatsApp name | Chat msgs | Last chat |', '|---|---|---|---|');
  chatOnly.forEach(s => md.push(`| ${maskPhone(s.phone)} | ${s.whatsapp_names.join(', ') || '—'} | ${s.chat_messages} | ${fmtDate(s.last_chat)} |`));
}

mkdirSync(args.out, { recursive: true });
writeFileSync(join(args.out, 'report.md'), md.join('\n') + '\n');
writeFileSync(join(args.out, 'data.json'), JSON.stringify({ contacts: summaries, appointments: usable, skipped, messages }, null, 2));
console.log(`report: ${join(args.out, 'report.md')}`);
console.log(`contacts ${summaries.length}, people ${allPeople.length}, appointments ${usable.length} (+${skipped.length} skipped), messages ${messages.length}`);
