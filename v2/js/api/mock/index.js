// Mock implementation of the dashboard API. Every function here has a planned
// counterpart in the real backend (see v2/README.md). Functions are async and
// return copies, so the views behave exactly as they will against the network.

import { db, patchRow, putSettings, saveQueue, reset } from './store.js';
import { clientFacts, reinviteInfo, pendingFor } from './rules.js';
import { TEMPLATES, fill } from './templates.js';

const DAY = 86400000;
const SESSION_KEY = 'gili.v2.session';
const out = v => Promise.resolve(structuredClone(v));
const now = () => new Date();

const CLIENT_FIELDS = ['invites_enabled', 'reviews_enabled', 'do_not_contact', 'dnc_reason', 'paused_until', 'note'];

function bySalon(col, salonId) { return db()[col].filter(r => r.salon_id === salonId); }
function clientOf(salonId, clientId) {
  const c = db().clients.find(r => r.id === clientId && r.salon_id === salonId);
  if (!c) throw new Error('Kundin nicht gefunden');
  return c;
}
const brief = c => ({ id: c.id, name: c.name, phone: c.phone });

function decorateAppt(a) {
  const d = db();
  return {
    ...a,
    service_name: d.services.find(s => s.id === a.service_id)?.name || '',
    staff_name: d.staff.find(s => s.id === a.staff_id)?.name || '',
    done: a.status === 'booked' && new Date(a.starts_at) <= now(),
  };
}

function summary(client) {
  const d = db();
  const settings = d.settings[client.salon_id];
  const f = clientFacts(d, client, now());
  const r = reinviteInfo(d, client, settings, now(), f);
  const pending = pendingFor(d, client, settings, now(), f).map(withQueueStatus(client.salon_id));
  return {
    ...brief(client),
    last_visit_at: f.last?.starts_at || null,
    last_service: f.last ? d.services.find(s => s.id === f.last.service_id)?.name : null,
    next_appointment_at: f.next?.starts_at || null,
    visits: f.visits,
    revenue: f.revenue,
    state: r.state,
    state_reason: r.reason,
    next_item: pending[0] || null,
  };
}

function preview(item) {
  const d = db();
  const client = d.clients.find(c => c.id === item.client_id);
  const salon = d.salons.find(s => s.id === client.salon_id);
  const tpl = TEMPLATES[item.kind];
  return fill(tpl, { name: client.name.split(' ')[0], salon: salon.name, link: salon.review_url });
}

const withQueueStatus = salonId => item => {
  const q = db().queue;
  const mode = db().settings[salonId].approval_mode;
  const status = q.skipped[item.key] ? 'skipped' : (mode === 'auto' || q.approved[item.key]) ? 'scheduled' : 'pending';
  return { ...item, status, preview: preview(item) };
};

export const api = {
  isDemo: true,

  auth: {
    async demoUsers() {
      const d = db();
      return out(d.users.map(u => ({
        ...u,
        memberships: d.memberships.filter(m => m.user_id === u.id)
          .map(m => ({ role: m.role, salon: d.salons.find(s => s.id === m.salon_id).name })),
      })));
    },
    async signIn(userId) {
      const m = db().memberships.find(x => x.user_id === userId);
      try { localStorage.setItem(SESSION_KEY, JSON.stringify({ userId, salonId: m.salon_id })); } catch { /* ignore */ }
      sessionFallback = { userId, salonId: m.salon_id };
      return api.auth.getSession();
    },
    async getSession() {
      let s = sessionFallback;
      try { s = JSON.parse(localStorage.getItem(SESSION_KEY)) || s; } catch { /* ignore */ }
      if (!s) return null;
      const d = db();
      const user = d.users.find(u => u.id === s.userId);
      if (!user) return null;
      const memberships = d.memberships.filter(m => m.user_id === user.id)
        .map(m => ({ ...m, salon: d.salons.find(x => x.id === m.salon_id) }));
      const current = memberships.find(m => m.salon_id === s.salonId) || memberships[0];
      return out({ user, memberships, salonId: current.salon_id, role: current.role, staffId: current.staff_id || null });
    },
    async switchSalon(salonId) {
      const s = await api.auth.getSession();
      if (!s.memberships.some(m => m.salon_id === salonId)) throw new Error('Kein Zugriff');
      try { localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: s.user.id, salonId })); } catch { /* ignore */ }
      sessionFallback = { userId: s.user.id, salonId };
    },
    async signOut() {
      sessionFallback = null;
      try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    },
  },

  async getSalon(salonId) { return out(db().salons.find(s => s.id === salonId)); },
  async updateSalon(salonId, patch) { return out(patchRow('salons', salonId, { review_url: patch.review_url })); },

  async listStaff(salonId) { return out(bySalon('staff', salonId)); },
  async listTeam(salonId) {
    const d = db();
    return out(d.memberships.filter(m => m.salon_id === salonId)
      .map(m => ({ ...d.users.find(u => u.id === m.user_id), role: m.role })));
  },

  async listServices(salonId) { return out(bySalon('services', salonId)); },
  async updateService(salonId, serviceId, patch) {
    const svc = db().services.find(s => s.id === serviceId && s.salon_id === salonId);
    if (!svc) throw new Error('Leistung nicht gefunden');
    return out(patchRow('services', serviceId, { reinvite_weeks: Math.max(1, Math.min(52, Number(patch.reinvite_weeks) || svc.reinvite_weeks)) }));
  },

  async listAppointments(salonId, { from, to }) {
    const d = db();
    return out(bySalon('appointments', salonId)
      .filter(a => a.status !== 'cancelled' && new Date(a.starts_at) >= from && new Date(a.starts_at) < to)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .map(a => ({ ...decorateAppt(a), client: brief(d.clients.find(c => c.id === a.client_id)) })));
  },

  async listClients(salonId) {
    return out(bySalon('clients', salonId).map(summary));
  },

  async getClient(salonId, clientId) {
    const d = db();
    const client = clientOf(salonId, clientId);
    const f = clientFacts(d, client, now());
    const pending = pendingFor(d, client, d.settings[salonId], now(), f).map(withQueueStatus(salonId));

    // One timeline: appointments, automated messages, and chats grouped per day.
    const timeline = [];
    f.appts.forEach(a => timeline.push({ type: 'appointment', at: a.starts_at, appointment: decorateAppt(a) }));
    const chatDays = {};
    f.msgs.forEach(m => {
      if (m.kind === 'chat') {
        const k = m.at.slice(0, 10);
        (chatDays[k] ||= { type: 'chat', at: m.at, count: 0, first: m.body }).count++;
      } else timeline.push({ type: 'automation', at: m.at, message: m });
    });
    timeline.push(...Object.values(chatDays));
    timeline.sort((a, b) => b.at.localeCompare(a.at));

    return out({ client, summary: summary(client), pending, timeline, conversation: f.conv });
  },

  async updateClient(salonId, clientId, patch) {
    clientOf(salonId, clientId);
    const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => CLIENT_FIELDS.includes(k)));
    return out(patchRow('clients', clientId, clean));
  },

  async listConversations(salonId) {
    const d = db();
    return out(bySalon('conversations', salonId).map(conv => {
      const msgs = d.messages.filter(m => m.client_id === conv.client_id).sort((a, b) => a.at.localeCompare(b.at));
      const last = msgs.at(-1);
      return { client: brief(d.clients.find(c => c.id === conv.client_id)), status: conv.status,
        last: { body: last.body, at: last.at, direction: last.direction }, count: msgs.length };
    }).sort((a, b) => b.last.at.localeCompare(a.last.at)));
  },

  async getChat(salonId, clientId) {
    const d = db();
    const client = clientOf(salonId, clientId);
    const msgs = d.messages.filter(m => m.client_id === clientId).sort((a, b) => a.at.localeCompare(b.at));
    return out({ client: brief(client), status: d.conversations.find(c => c.client_id === clientId)?.status || null, messages: msgs });
  },

  async listQueue(salonId, { days = 7 } = {}) {
    const d = db();
    const until = +now() + days * DAY;
    const items = [];
    bySalon('clients', salonId).forEach(client => {
      const f = clientFacts(d, client, now());
      pendingFor(d, client, d.settings[salonId], now(), f)
        .filter(i => +new Date(i.at) <= until)
        .forEach(i => items.push({ ...withQueueStatus(salonId)(i), client: brief(client) }));
    });
    return out(items.sort((a, b) => a.at.localeCompare(b.at)));
  },

  // action: 'approve' | 'skip' | 'reset'
  async setQueueStatus(salonId, keys, action) {
    const q = db().queue;
    keys.forEach(k => {
      delete q.skipped[k]; delete q.approved[k];
      if (action === 'approve') q.approved[k] = true;
      if (action === 'skip') q.skipped[k] = true;
    });
    saveQueue();
  },

  async listSent(salonId, { days = 30 } = {}) {
    const d = db();
    const since = +now() - days * DAY;
    return out(bySalon('messages', salonId)
      .filter(m => m.direction === 'out' && m.kind !== 'chat' && +new Date(m.at) >= since)
      .sort((a, b) => b.at.localeCompare(a.at))
      .map(m => ({ ...m, client: brief(d.clients.find(c => c.id === m.client_id)) })));
  },

  async getStats(salonId, { year, month }) {
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

  async getSettings(salonId) { return out(db().settings[salonId]); },
  async updateSettings(salonId, settings) { putSettings(salonId, structuredClone(settings)); return out(settings); },

  async templates(salonId) {
    const salon = db().salons.find(s => s.id === salonId);
    const vars = { name: 'Julia', salon: salon.name, link: salon.review_url };
    return out(Object.fromEntries(Object.entries(TEMPLATES).map(([k, t]) => [k, fill(t, vars)])));
  },

  async resetDemo() { reset(); },
};

let sessionFallback = null;
