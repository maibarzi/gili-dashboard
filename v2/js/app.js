import { api } from './api/index.js';
import { can, ROLE_LABELS } from './auth.js';
import { esc, icon, renderIcons, toast, DAYS, MONTHS } from './ui.js';
import * as login from './views/login.js';
import * as termine from './views/termine.js';
import * as kundinnen from './views/kundinnen.js';
import * as kundin from './views/kundin.js';
import * as nachrichten from './views/nachrichten.js';
import * as chat from './views/chat.js';
import * as einnahmen from './views/einnahmen.js';
import * as einstellungen from './views/einstellungen.js';

const TABS = [
  { id: 'termine', label: 'Termine', icon: 'calendar', href: '#/termine' },
  { id: 'kundinnen', label: 'Kundinnen', icon: 'users', href: '#/kundinnen' },
  { id: 'nachrichten', label: 'Nachrichten', icon: 'message-circle', href: '#/nachrichten' },
  { id: 'einnahmen', label: 'Einnahmen', icon: 'trending-up', href: '#/einnahmen', perm: 'view_income' },
];

const ROUTES = [
  { re: /^\/termine$/, view: termine, tab: 'termine' },
  { re: /^\/kundinnen$/, view: kundinnen, tab: 'kundinnen' },
  { re: /^\/nachrichten(?:\/(chats|geplant|gesendet))?$/, view: nachrichten, tab: 'nachrichten' },
  { re: /^\/einnahmen$/, view: einnahmen, tab: 'einnahmen', perm: 'view_income' },
  { re: /^\/kundin\/([\w-]+)$/, view: kundin, overlay: true },
  { re: /^\/chat\/([\w-]+)$/, view: chat, overlay: true },
  { re: /^\/einstellungen$/, view: einstellungen, overlay: true, perm: 'edit_settings' },
];

const $ = sel => document.querySelector(sel);
let session = null;
let lastTabHash = '#/termine';
const history = [];
const cache = {};

function match(hash) {
  const path = hash.replace(/^#/, '') || '/termine';
  for (const r of ROUTES) {
    const m = path.match(r.re);
    if (m) return { ...r, params: m.slice(1).filter(Boolean) };
  }
  return null;
}

function ctxFor(route, target) {
  return {
    api, cache, session,
    salonId: session.salonId,
    role: session.role,
    params: route.params,
    can: p => can(session.role, p),
    pendingCount: cache.pendingCount || 0,
    refresh: () => draw(route, target),
  };
}

async function draw(route, target) {
  if (!route.overlay) await updatePendingCount();
  const ctx = ctxFor(route, target);
  try {
    const html = await route.view.render(ctx);
    const el = document.createElement('div');
    el.className = 'view';
    el.innerHTML = html;
    target.replaceChildren(el);
    route.view.mount?.(el, ctx);
    renderIcons();
  } catch (err) {
    console.error(err);
    target.innerHTML = `<div class="empty">Konnte nicht geladen werden.<br><small>${esc(err.message)}</small></div>`;
  }
}

async function updatePendingCount() {
  if (!can(session.role, 'manage_queue')) return;
  const items = await api.listQueue(session.salonId, { days: 7 });
  cache.pendingCount = items.filter(i => i.status === 'pending').length;
  const dot = document.querySelector('[data-tab="nachrichten"] .nav-count');
  if (dot) { dot.textContent = cache.pendingCount; dot.hidden = !cache.pendingCount; }
}

async function route() {
  if (!session) return;
  const hash = location.hash || '#/termine';
  if (history.at(-2) === hash) history.pop(); else history.push(hash);

  const r = match(hash);
  if (!r || (r.perm && !can(session.role, r.perm))) { location.replace('#/termine'); return; }

  const overlay = $('#overlay');
  if (r.overlay) {
    overlay.classList.add('open');
    document.body.classList.add('no-scroll');
    if (!$('#main').firstChild) await draw(match(lastTabHash), $('#main'));
    await draw(r, overlay);
    overlay.scrollTop = 0;
  } else {
    overlay.classList.remove('open');
    overlay.replaceChildren();
    document.body.classList.remove('no-scroll');
    const tabChanged = !lastTabHash.startsWith(`#/${r.tab}`);
    lastTabHash = hash;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === r.tab));
    await draw(r, $('#main'));
    if (tabChanged) window.scrollTo(0, 0);
  }
}

function back() {
  if (history.length > 1) window.history.back();
  else location.hash = lastTabHash;
}

function renderShell() {
  const now = new Date();
  const salon = session.memberships.find(m => m.salon_id === session.salonId).salon;
  const multi = session.memberships.length > 1;
  $('#app').innerHTML = `
    ${api.isDemo ? '<div class="demo-banner">Demo mit erfundenen Daten</div>' : ''}
    <header class="header">
      <div class="header-logo">gili<span>.</span></div>
      <div class="header-right">
        <button class="header-salon ${multi ? 'switch' : ''}" data-action="switch-salon">
          ${esc(salon.name)}${multi ? icon('chevrons-up-down', 12) : ''}
        </button>
        <div class="header-date">${DAYS[now.getDay()]}, ${now.getDate()}. ${MONTHS[now.getMonth()]}</div>
      </div>
      ${can(session.role, 'edit_settings') ? `<a class="header-btn" href="#/einstellungen" aria-label="Einstellungen">${icon('settings', 17)}</a>` : ''}
      <button class="header-btn" data-action="account" aria-label="Konto">${icon('user', 17)}</button>
    </header>
    <nav class="nav">
      ${TABS.filter(t => !t.perm || can(session.role, t.perm)).map(t => `
        <a class="nav-btn" data-tab="${t.id}" href="${t.href}">
          <span class="nav-icon">${icon(t.icon, 18)}<span class="nav-count" hidden></span></span>${t.label}
        </a>`).join('')}
    </nav>
    <main id="main" class="content"></main>`;
  renderIcons();
}

function sheet(html) {
  const el = document.createElement('div');
  el.className = 'sheet-backdrop';
  el.innerHTML = `<div class="sheet">${html}</div>`;
  el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-close]')) el.remove(); });
  document.body.appendChild(el);
  renderIcons();
  return el;
}

async function start() {
  session = await api.auth.getSession();
  if (!session) {
    $('#app').innerHTML = await login.render(api);
    renderIcons();
    return;
  }
  renderShell();
  await route();
}

document.addEventListener('click', async e => {
  const user = e.target.closest('[data-user]');
  if (user) { await api.auth.signIn(user.dataset.user); history.length = 0; return start(); }

  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'back') return back();
  if (action === 'demo-contact') { e.stopPropagation(); return toast('In der Demo deaktiviert'); }
  if (action === 'switch-salon' && session.memberships.length > 1) {
    const s = sheet(`<div class="sheet-title">Salon wählen</div>${session.memberships.map(m => `
      <button class="sheet-item ${m.salon_id === session.salonId ? 'active' : ''}" data-salon-id="${m.salon_id}">
        <b>${esc(m.salon.name)}</b><span>${ROLE_LABELS[m.role]}</span></button>`).join('')}`);
    s.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-salon-id]');
      if (!b) return;
      await api.auth.switchSalon(b.dataset.salonId);
      s.remove();
      session = await api.auth.getSession();
      Object.keys(cache).forEach(k => delete cache[k]);
      renderShell();
      if (location.hash === '#/termine') route(); else location.hash = '#/termine';
    });
    return;
  }
  if (action === 'account') {
    const s = sheet(`<div class="sheet-title">${esc(session.user.name)}</div>
      <div class="sheet-sub">${esc(session.user.email)} · ${ROLE_LABELS[session.role]}</div>
      <button class="sheet-item" data-signout>${icon('log-out', 16)} <b>Abmelden</b></button>`);
    s.addEventListener('click', async ev => {
      if (!ev.target.closest('[data-signout]')) return;
      await api.auth.signOut();
      s.remove();
      session = null;
      location.hash = '';
      start();
    });
    return;
  }

  // Cards link via data-href so they can contain buttons; buttons and links inside win.
  const link = e.target.closest('[data-href]');
  if (link && !e.target.closest('button, a, input, select, textarea, label')) location.hash = link.dataset.href;
});

window.addEventListener('hashchange', route);
start();
