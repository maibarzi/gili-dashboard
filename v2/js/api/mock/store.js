// In-memory demo database. The seed is rebuilt relative to "now" on each page
// load; changes made in the demo (client settings, automation settings, queue
// decisions) are kept in localStorage as a patch layer and re-applied.

import { seed } from './seed.js';

const EDITS_KEY = 'gili.v2.demo-edits';
const emptyEdits = () => ({ clients: {}, services: {}, salons: {}, settings: {}, queue: { skipped: {}, approved: {} } });

let base = null;
let edits = loadEdits();

function loadEdits() {
  try {
    const raw = localStorage.getItem(EDITS_KEY);
    return raw ? { ...emptyEdits(), ...JSON.parse(raw) } : emptyEdits();
  } catch { return emptyEdits(); }
}

function persist() {
  try { localStorage.setItem(EDITS_KEY, JSON.stringify(edits)); } catch { /* private mode: demo still works, edits are not kept */ }
}

export function db() {
  if (!base) {
    base = seed(new Date());
    for (const col of ['clients', 'services', 'salons']) {
      for (const [id, patch] of Object.entries(edits[col])) {
        const row = base[col].find(r => r.id === id);
        if (row) Object.assign(row, patch);
      }
    }
    Object.assign(base.settings, structuredClone(edits.settings));
    base.queue = edits.queue;
  }
  return base;
}

export function patchRow(collection, id, patch) {
  const row = db()[collection].find(r => r.id === id);
  if (!row) throw new Error(`${collection}/${id} not found`);
  Object.assign(row, patch);
  edits[collection][id] = { ...edits[collection][id], ...patch };
  persist();
  return row;
}

export function putSettings(salonId, settings) {
  db().settings[salonId] = settings;
  edits.settings[salonId] = structuredClone(settings);
  persist();
}

export function saveQueue() { persist(); }

export function reset() {
  edits = emptyEdits();
  base = null;
  try { localStorage.removeItem(EDITS_KEY); } catch { /* ignore */ }
}
