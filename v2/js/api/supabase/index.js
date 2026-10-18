// Supabase data source: signs the user in, loads the selected salon's rows,
// and writes the owner's changes back. Row level security in the database
// decides what is visible and what may change.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
import { SUPABASE } from '../../config.js';
import { createApi } from '../core.js';
import { buildSnapshot, settingsToRow, isVirtual } from './snapshot.js';

const sb = createClient(SUPABASE.url, SUPABASE.key);
const SALON_KEY = 'gili.v2.salon';
const FRESH_MS = 30000;

let snap = null;        // { salonId, loadedAt, db }
let loading = null;     // in-flight load, shared by parallel callers

async function q(request) {
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data;
}

// An update that row level security blocks changes nothing and returns no
// rows instead of an error.
async function changed(request) {
  const rows = await q(request);
  if (!rows.length) throw new Error('Keine Berechtigung für diese Änderung');
  return rows;
}

// PostgREST returns at most 1000 rows per request.
async function all(table, salonId, order, select = '*') {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let req = sb.from(table).select(select).eq('salon_id', salonId);
    order.forEach(col => { req = req.order(col); });
    const page = await q(req.range(from, from + 999));
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function load(salonId) {
  const [salons, staff, services, contacts, people, appointments, appointment_services, messages, settings, templates, decisions] =
    await Promise.all([
      q(sb.from('salons').select('*').eq('id', salonId)),
      all('staff', salonId, ['id']),
      all('services', salonId, ['sort', 'id']),
      all('contacts', salonId, ['id']),
      all('people', salonId, ['id']),
      all('appointments', salonId, ['starts_at', 'id']),
      all('appointment_services', salonId, ['appointment_id', 'name']),
      all('messages', salonId, ['at', 'id'], 'id,salon_id,contact_id,direction,kind,body,at,status,result,person_ids,ref_appointment_id'),
      q(sb.from('automation_settings').select('*').eq('salon_id', salonId)),
      q(sb.from('message_templates').select('salon_id,kind,language,body').or(`salon_id.is.null,salon_id.eq.${salonId}`)),
      all('queue_decisions', salonId, ['queue_key']),
    ]);
  if (!salons.length) throw new Error('Salon nicht gefunden oder kein Zugriff');
  snap = {
    salonId, loadedAt: Date.now(),
    db: buildSnapshot({ salon: salons[0], staff, services, contacts, people, appointments, appointment_services,
      messages, settings: settings[0], templates, decisions }),
  };
}

function ensure(salonId) {
  if (snap && snap.salonId === salonId && Date.now() - snap.loadedAt < FRESH_MS) return Promise.resolve();
  loading ||= load(salonId).finally(() => { loading = null; });
  return loading;
}

const localDate = iso => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function patchClient(salonId, id, patch) {
  const client = snap.db.clients.find(c => c.id === id);
  const contactPatch = {}, personPatch = {};
  if ('do_not_contact' in patch) {
    contactPatch.do_not_contact = patch.do_not_contact;
    contactPatch.dnc_reason = patch.do_not_contact ? patch.dnc_reason || null : null;
    contactPatch.dnc_at = patch.do_not_contact ? new Date().toISOString() : null;
  }
  if ('marketing_consent' in patch) {
    contactPatch.marketing_consent = patch.marketing_consent;
    contactPatch.consent_source = patch.marketing_consent ? patch.consent_source || null : null;
    contactPatch.consent_at = patch.marketing_consent ? new Date().toISOString() : null;
  }
  for (const k of ['invites_enabled', 'reviews_enabled', 'note']) if (k in patch) personPatch[k] = patch[k];
  if ('paused_until' in patch) personPatch.paused_until = patch.paused_until ? localDate(patch.paused_until) : null;

  if (Object.keys(personPatch).length) {
    if (isVirtual(id)) throw new Error('Für diese Nummer gibt es noch keinen Termin. Hier geht nur „Nicht kontaktieren“.');
    await changed(sb.from('people').update(personPatch).eq('id', id).eq('salon_id', salonId).select('id'));
  }
  if (Object.keys(contactPatch).length) {
    if (!client.contact_id) throw new Error('Diese Kundin hat keine WhatsApp-Nummer');
    await changed(sb.from('contacts').update(contactPatch).eq('id', client.contact_id).eq('salon_id', salonId).select('id'));
  }
  // Keep the loaded copy in step: contact fields apply to everyone on that number.
  Object.assign(client, patch);
  const shared = Object.fromEntries(['do_not_contact', 'dnc_reason', 'marketing_consent', 'consent_source']
    .filter(k => k in patch).map(k => [k, patch[k] ?? '']));
  snap.db.clients.filter(c => c.contact_id && c.contact_id === client.contact_id).forEach(c => Object.assign(c, shared));
}

async function patchService(salonId, id, patch) {
  await changed(sb.from('services').update(patch).eq('id', id).eq('salon_id', salonId).select('id'));
  Object.assign(snap.db.services.find(s => s.id === id), patch);
}

async function patchSalon(salonId, patch) {
  await changed(sb.from('salons').update(patch).eq('id', salonId).select('id'));
  Object.assign(snap.db.salons[0], patch);
}

async function putSettings(salonId, settings) {
  // Update, not upsert: an upsert would also set salon_id, which owners may not change.
  const row = settingsToRow(settings);
  const updated = await q(sb.from('automation_settings').update(row).eq('salon_id', salonId).select('salon_id'));
  if (!updated.length) await q(sb.from('automation_settings').insert({ salon_id: salonId, ...row }));
  snap.db.settings[salonId] = settings;
}

async function setQueue(salonId, keys, action) {
  if (action === 'reset') {
    await q(sb.from('queue_decisions').delete().eq('salon_id', salonId).in('queue_key', keys));
  } else {
    const { data: { user } } = await sb.auth.getUser();
    await q(sb.from('queue_decisions').upsert(
      keys.map(queue_key => ({ salon_id: salonId, queue_key, action, decided_by: user.id, decided_at: new Date().toISOString() })),
      { onConflict: 'salon_id,queue_key' }));
  }
  const queue = snap.db.queue;
  keys.forEach(k => {
    delete queue.skipped[k]; delete queue.approved[k];
    if (action === 'approve') queue.approved[k] = true;
    if (action === 'skip') queue.skipped[k] = true;
  });
}

async function team(salonId) {
  const { data: { user } } = await sb.auth.getUser();
  const rows = await q(sb.from('memberships').select('user_id, role').eq('salon_id', salonId));
  // Other members' e-mail addresses are not readable from the browser.
  return rows.map(r => r.user_id === user.id
    ? { name: user.email, email: 'Du', role: r.role }
    : { name: 'Teammitglied', email: r.user_id.slice(0, 8), role: r.role });
}

const auth = {
  // Sign-in by e-mail: Supabase sends a 6-digit code (and a link). Only
  // existing users get one; accounts are created by an admin or an invitation.
  async sendLoginCode(email) {
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname },
    });
    if (error) {
      if (/signups not allowed|not found/i.test(error.message)) throw new Error('Für diese E-Mail-Adresse gibt es keinen Zugang');
      if (/rate limit|security purposes/i.test(error.message)) throw new Error('Bitte kurz warten, bevor ein neuer Code angefordert wird');
      throw new Error(error.message);
    }
  },
  async verifyLoginCode(email, code) {
    const { error } = await sb.auth.verifyOtp({ email, token: code, type: 'email' });
    if (error) throw new Error(/expired|invalid/i.test(error.message) ? 'Der Code ist falsch oder abgelaufen' : error.message);
  },
  async getSession() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return null;
    const user = { id: session.user.id, email: session.user.email, name: session.user.email };
    const [own, salons, admin] = await Promise.all([
      q(sb.from('memberships').select('salon_id, role, staff_id').eq('user_id', user.id)),
      q(sb.from('salons').select('id, name, address, review_url').order('name')),   // RLS: only salons this user may see
      q(sb.rpc('is_platform_admin')),
    ]);
    const memberships = salons.map(salon => {
      const m = own.find(x => x.salon_id === salon.id);
      return { salon_id: salon.id, role: m?.role || (admin ? 'owner' : null), staff_id: m?.staff_id || null, salon };
    }).filter(m => m.role);
    if (!memberships.length) throw new Error('Dieses Konto ist noch keinem Salon zugeordnet.');
    let saved = null;
    try { saved = localStorage.getItem(SALON_KEY); } catch { /* ignore */ }
    const current = memberships.find(m => m.salon_id === saved) || memberships[0];
    return { user, memberships, salonId: current.salon_id, role: current.role, staffId: current.staff_id };
  },
  async switchSalon(salonId) {
    try { localStorage.setItem(SALON_KEY, salonId); } catch { /* ignore */ }
    snap = null;
  },
  async signOut() {
    await sb.auth.signOut();
    snap = null;
  },
};

export const api = createApi({
  isDemo: false,
  label: SUPABASE.label,
  auth,
  db: () => snap.db,
  ensure,
  patchClient, patchService, patchSalon, putSettings, setQueue, team,
});
