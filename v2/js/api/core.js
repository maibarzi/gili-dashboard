// Everything the screens ask for, computed from one salon's data. The data
// comes from a source (demo or Supabase) that provides it in one shape:
//
//   src.db()                     → { salons, staff, services, clients, appointments,
//                                    conversations, messages, settings, queue, templates }
//   src.ensure(salonId)          → loads / refreshes that salon's data
//   src.patchClient, src.patchService, src.patchSalon, src.putSettings, src.setQueue
//   src.auth, src.team(salonId), src.isDemo, src.resetDemo
//
// "clients" are people who get appointments. People who share one WhatsApp
// number have the same contact_id; chats and message limits are per contact.

import { clientFacts, reinviteInfo, pendingFor } from './mock/rules.js';
import { fill } from './mock/templates.js';

const DAY = 86400000;
const out = v => Promise.resolve(structuredClone(v));
const now = () => new Date();

const CLIENT_FIELDS = ['invites_enabled', 'reviews_enabled', 'do_not_contact', 'dnc_reason', 'paused_until', 'note',
  'marketing_consent', 'consent_source'];

export function createApi(src) {
  const db = () => src.db();
  const bySalon = (col, salonId) => db()[col].filter(r => r.salon_id === salonId);
  const clientOf = (salonId, clientId) => {
    const c = db().clients.find(r => r.id === clientId && r.salon_id === salonId);
    if (!c) throw new Error('Kundin nicht gefunden');
    return c;
  };
  // Everyone booked from the same WhatsApp number.
  const household = c => c.contact_id ? db().clients.filter(x => x.contact_id === c.contact_id) : [c];
  const brief = c => {
    const others = household(c).length - 1;
    return { id: c.id, name: c.name, phone: c.phone, ...(others > 0 && { others }) };
  };

  const decorateAppt = a => {
    const d = db();
    return {
      ...a,
      service_name: a.service_name || d.services.find(s => s.id === a.service_id)?.name || '',
      staff_name: d.staff.find(s => s.id === a.staff_id)?.name || '',
      done: a.status === 'booked' && new Date(a.starts_at) <= now(),
    };
  };

  const preview = item => {
    const d = db();
    const client = d.clients.find(c => c.id === item.client_id);
    const salon = d.salons.find(s => s.id === client.salon_id);
    const names = item.names ? `${item.names.slice(0, -1).join(', ')} und ${item.names.at(-1)}` : '';
    return fill(d.templates[item.kind] || '', { name: client.name.split(' ')[0], names, salon: salon.name, link: salon.review_url || '' });
  };

  // Planned messages for everyone on one WhatsApp number. Invitations due
  // within a week of each other go out as one message naming all of them.
  const contactItems = client => {
    const d = db();
    const settings = d.settings[client.salon_id];
    const items = household(client).flatMap(m => pendingFor(d, m, settings, now(), clientFacts(d, m, now())));
    const invites = items.filter(i => i.kind === 'reinvite').sort((a, b) => a.at.localeCompare(b.at));
    const group = invites.filter(i => +new Date(i.at) - +new Date(invites[0]?.at) <= 7 * DAY);
    if (group.length < 2) return items;
    const names = group.map(i => d.clients.find(c => c.id === i.client_id).name.split(' ')[0]);
    return [...items.filter(i => !group.includes(i)), {
      key: 'multi:' + group.map(i => i.key).sort().join('+'),
      kind: 'reinvite_multi', client_id: group[0].client_id, client_ids: group.map(i => i.client_id),
      at: group[0].at, names, reason: `Gemeinsame Einladung für ${names.length} Personen mit dieser Nummer`,
    }].sort((a, b) => a.at.localeCompare(b.at));
  };
  const itemsFor = client => contactItems(client).filter(i => i.client_id === client.id || i.client_ids?.includes(client.id));

  const withQueueStatus = salonId => item => {
    const q = db().queue;
    const mode = db().settings[salonId].approval_mode;
    const status = q.skipped[item.key] ? 'skipped' : (mode === 'auto' || q.approved[item.key]) ? 'scheduled' : 'pending';
    return { ...item, status, preview: preview(item) };
  };

  const summary = client => {
    const d = db();
    const settings = d.settings[client.salon_id];
    const f = clientFacts(d, client, now());
    const r = reinviteInfo(d, client, settings, now(), f);
    const pending = itemsFor(client).map(withQueueStatus(client.salon_id));
    return {
      ...brief(client),
      last_visit_at: f.last?.starts_at || null,
      last_service: f.last ? decorateAppt(f.last).service_name : null,
      next_appointment_at: f.next?.starts_at || null,
      visits: f.visits,
      revenue: f.revenue,
      state: r.state,
      state_reason: r.reason,
      next_item: pending[0] || null,
    };
  };

  return {
    isDemo: src.isDemo,
    label: src.label || '',
    auth: src.auth,

    async getSalon(salonId) { await src.ensure(salonId); return out(db().salons.find(s => s.id === salonId)); },
    async updateSalon(salonId, patch) { await src.patchSalon(salonId, { review_url: patch.review_url }); return out(db().salons.find(s => s.id === salonId)); },

    async listStaff(salonId) { await src.ensure(salonId); return out(bySalon('staff', salonId)); },
    async listTeam(salonId) { return out(await src.team(salonId)); },

    async listServices(salonId) { await src.ensure(salonId); return out(bySalon('services', salonId)); },
    async updateService(salonId, serviceId, patch) {
      const svc = db().services.find(s => s.id === serviceId && s.salon_id === salonId);
      if (!svc) throw new Error('Leistung nicht gefunden');
      const weeks = Math.max(1, Math.min(52, Number(patch.reinvite_weeks) || svc.reinvite_weeks));
      await src.patchService(salonId, serviceId, { reinvite_weeks: weeks });
      return out(db().services.find(s => s.id === serviceId));
    },

    async listAppointments(salonId, { from, to }) {
      await src.ensure(salonId);
      const d = db();
      return out(bySalon('appointments', salonId)
        .filter(a => a.status !== 'cancelled' && new Date(a.starts_at) >= from && new Date(a.starts_at) < to)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        .map(a => ({ ...decorateAppt(a), client: brief(d.clients.find(c => c.id === a.client_id)) })));
    },

    async listClients(salonId) {
      await src.ensure(salonId);
      return out(bySalon('clients', salonId).map(summary));
    },

    async getClient(salonId, clientId) {
      await src.ensure(salonId);
      const d = db();
      const client = clientOf(salonId, clientId);
      const f = clientFacts(d, client, now());
      const pending = itemsFor(client).map(withQueueStatus(salonId));

      // One timeline: this person's appointments and automated messages, and
      // the chats of their WhatsApp number grouped per day.
      const timeline = [];
      f.appts.forEach(a => timeline.push({ type: 'appointment', at: a.starts_at, appointment: decorateAppt(a) }));
      f.msgs.filter(m => m.kind !== 'chat').forEach(m => timeline.push({ type: 'automation', at: m.at, message: m }));
      const chatDays = {};
      f.householdMsgs.filter(m => m.kind === 'chat').forEach(m => {
        (chatDays[m.at.slice(0, 10)] ||= { type: 'chat', at: m.at, count: 0, first: m.body }).count++;
      });
      timeline.push(...Object.values(chatDays));
      timeline.sort((a, b) => b.at.localeCompare(a.at));

      const others = household(client).filter(c => c.id !== client.id).map(c => ({ id: c.id, name: c.name }));
      return out({ client, summary: summary(client), pending, timeline, conversation: f.conv, others });
    },

    async updateClient(salonId, clientId, patch) {
      clientOf(salonId, clientId);
      const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => CLIENT_FIELDS.includes(k)));
      await src.patchClient(salonId, clientId, clean);
      return out(clientOf(salonId, clientId));
    },

    async listConversations(salonId) {
      await src.ensure(salonId);
      const d = db();
      return out(bySalon('conversations', salonId).map(conv => {
        const client = d.clients.find(c => c.id === conv.client_id);
        const ids = new Set(household(client).map(c => c.id));
        const msgs = d.messages.filter(m => ids.has(m.client_id)).sort((a, b) => a.at.localeCompare(b.at));
        const last = msgs.at(-1);
        return { client: brief(client), status: conv.status,
          last: { body: last?.body || '', at: last?.at || conv.updated_at, direction: last?.direction || 'in' }, count: msgs.length };
      }).sort((a, b) => b.last.at.localeCompare(a.last.at)));
    },

    async getChat(salonId, clientId) {
      await src.ensure(salonId);
      const d = db();
      const client = clientOf(salonId, clientId);
      const ids = new Set(household(client).map(c => c.id));
      const seen = new Set();
      const msgs = d.messages.filter(m => ids.has(m.client_id) && !seen.has(m.id) && seen.add(m.id))
        .sort((a, b) => a.at.localeCompare(b.at));
      const conv = d.conversations.find(c => ids.has(c.client_id));
      return out({ client: brief(client), status: conv?.status || null, messages: msgs });
    },

    async listQueue(salonId, { days = 7 } = {}) {
      await src.ensure(salonId);
      const d = db();
      const until = +now() + days * DAY;
      const items = [];
      const seen = new Set();
      bySalon('clients', salonId).forEach(client => {
        const key = client.contact_id || client.id;
        if (seen.has(key)) return;
        seen.add(key);
        contactItems(client)
          .filter(i => +new Date(i.at) <= until)
          .forEach(i => items.push({ ...withQueueStatus(salonId)(i), client: brief(d.clients.find(c => c.id === i.client_id)) }));
      });
      return out(items.sort((a, b) => a.at.localeCompare(b.at)));
    },

    // action: 'approve' | 'skip' | 'reset'
    async setQueueStatus(salonId, keys, action) { await src.setQueue(salonId, keys, action); },

    async listSent(salonId, { days = 30 } = {}) {
      await src.ensure(salonId);
      const d = db();
      const since = +now() - days * DAY;
      return out(bySalon('messages', salonId)
        .filter(m => m.direction === 'out' && m.kind !== 'chat' && +new Date(m.at) >= since)
        .sort((a, b) => b.at.localeCompare(a.at))
        .map(m => ({ ...m, client: brief(d.clients.find(c => c.id === m.client_id)) })));
    },

    async getStats(salonId, { year, month }) {
      await src.ensure(salonId);
      const d = db();
      const start = new Date(year, month, 1), end = new Date(year, month + 1, 1);
      const appts = bySalon('appointments', salonId)
        .filter(a => a.status === 'booked' && new Date(a.starts_at) >= start && new Date(a.starts_at) < end)
        .map(decorateAppt)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      const sum = arr => arr.reduce((s, a) => s + (a.price || 0), 0);
      const doneA = appts.filter(a => a.done), openA = appts.filter(a => !a.done);
      const weeks = [];
      for (let w = 0; new Date(year, month, 1 + w * 7) < end; w++) {
        const ws = new Date(year, month, 1 + w * 7), we = new Date(year, month, 8 + w * 7);
        weeks.push({ label: `${ws.getDate()}.`, revenue: sum(appts.filter(a => new Date(a.starts_at) >= ws && new Date(a.starts_at) < we)),
          current: ws <= now() && now() < we, future: ws > now() });
      }

      const since = +now() - 30 * DAY;
      const out30 = bySalon('messages', salonId).filter(m => m.direction === 'out' && +new Date(m.at) >= since);
      const rebooked = bySalon('appointments', salonId).filter(a => a.source === 'reinvite' && a.status === 'booked' && +new Date(a.booked_at) >= since);
      return out({
        revenue: { total: sum(appts), done: sum(doneA), expected: sum(openA), count: appts.length, doneCount: doneA.length, openCount: openA.length },
        weeks,
        appointments: appts.map(a => ({ ...a, client: brief(d.clients.find(c => c.id === a.client_id)) })),
        effect: {
          invitesSent: out30.filter(m => m.kind === 'reinvite' || m.kind === 'followup').length,
          rebooked: rebooked.length,
          rebookedRevenue: sum(rebooked),
          reviewsRequested: out30.filter(m => m.kind === 'review').length,
          botBookings: bySalon('appointments', salonId).filter(a => a.source === 'bot' && +new Date(a.booked_at) >= since).length,
        },
      });
    },

    async getSettings(salonId) { await src.ensure(salonId); return out(db().settings[salonId]); },
    async updateSettings(salonId, settings) { await src.putSettings(salonId, structuredClone(settings)); return out(settings); },

    async templates(salonId) {
      await src.ensure(salonId);
      const salon = db().salons.find(s => s.id === salonId);
      const vars = { name: 'Julia', names: 'Julia und Anna', salon: salon.name, link: salon.review_url || '' };
      return out(Object.fromEntries(['reinvite', 'reinvite_multi', 'followup', 'review']
        .filter(k => db().templates[k]).map(k => [k, fill(db().templates[k], vars)])));
    },

    async resetDemo() { await src.resetDemo?.(); },
  };
}
