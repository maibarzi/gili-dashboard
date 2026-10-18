import { esc } from '../ui.js';
import { ROLE_LABELS } from '../auth.js';

export async function render(api, error = '') {
  if (!api.isDemo) {
    return `<div class="login">
      <div class="pin-logo">gili<span>.</span></div>
      ${api.label ? `<div class="login-note">${esc(api.label)}</div>` : ''}
      <form class="login-box" data-login>
        <label class="login-label" for="email">E-Mail</label>
        <input id="email" name="email" class="text-input dark" type="email" autocomplete="username" required>
        <label class="login-label" for="password">Passwort</label>
        <input id="password" name="password" class="text-input dark" type="password" autocomplete="current-password" required>
        <button class="btn wide" type="submit">Anmelden</button>
        <div class="login-error" data-error>${esc(error)}</div>
      </form>
      <a class="login-note" href="?demo=1">Demo mit erfundenen Daten ansehen</a>
    </div>`;
  }

  // Demo: pick one of the demo accounts.
  const users = await api.auth.demoUsers();
  return `<div class="login">
    <div class="pin-logo">gili<span>.</span></div>
    <div class="login-label">Demo-Zugang</div>
    ${users.map(u => `<button class="login-user" data-user="${u.id}">
      <b>${esc(u.name)}</b>
      <span>${u.memberships.map(m => `${esc(m.salon)} · ${ROLE_LABELS[m.role]}`).join('<br>')}</span>
    </button>`).join('')}
  </div>`;
}
