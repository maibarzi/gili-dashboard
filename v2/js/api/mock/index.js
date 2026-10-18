// Demo data source: invented salons kept in memory (see seed.js / store.js).

import { createApi } from '../core.js';
import { db, patchRow, putSettings, saveQueue, reset } from './store.js';
import { TEMPLATES } from './templates.js';

const SESSION_KEY = 'gili.v2.session';
let sessionFallback = null;
const out = v => Promise.resolve(structuredClone(v));

function readSession() {
  let s = sessionFallback;
  try { s = JSON.parse(localStorage.getItem(SESSION_KEY)) || s; } catch { /* ignore */ }
  return s;
}
function writeSession(s) {
  sessionFallback = s;
  try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

const auth = {
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
    writeSession({ userId, salonId: m.salon_id });
    return auth.getSession();
  },
  async getSession() {
    const s = readSession();
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
    const s = await auth.getSession();
    if (!s.memberships.some(m => m.salon_id === salonId)) throw new Error('Kein Zugriff');
    writeSession({ userId: s.user.id, salonId });
  },
  async signOut() { writeSession(null); },
};

export const api = createApi({
  isDemo: true,
  auth,
  db: () => {
    const d = db();
    d.templates ||= TEMPLATES;
    return d;
  },
  async ensure() {},
  async patchClient(salonId, id, patch) { patchRow('clients', id, patch); },
  async patchService(salonId, id, patch) { patchRow('services', id, patch); },
  async patchSalon(salonId, patch) { patchRow('salons', salonId, patch); },
  async putSettings(salonId, settings) { putSettings(salonId, settings); },
  async setQueue(salonId, keys, action) {
    const q = db().queue;
    keys.forEach(k => {
      delete q.skipped[k]; delete q.approved[k];
      if (action === 'approve') q.approved[k] = true;
      if (action === 'skip') q.skipped[k] = true;
    });
    saveQueue();
  },
  async team(salonId) {
    const d = db();
    return d.memberships.filter(m => m.salon_id === salonId).map(m => ({ ...d.users.find(u => u.id === m.user_id), role: m.role }));
  },
  async resetDemo() { reset(); },
});
