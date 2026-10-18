import { esc } from '../ui.js';
import { ROLE_LABELS } from '../auth.js';

const logo = api => `<div class="pin-logo">gili<span>.</span></div>
  ${api.label ? `<div class="login-note">${esc(api.label)}</div>` : ''}`;

export async function render(api, error = '') {
  if (!api.isDemo) {
    return `<div class="login">
      ${logo(api)}
      <form class="login-box" data-login-email>
        <label class="login-label" for="email">E-Mail</label>
        <input id="email" name="email" class="text-input dark" type="email" autocomplete="email" inputmode="email" required>
        <button class="btn wide" type="submit">Code per E-Mail senden</button>
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

export function renderCode(api, email) {
  return `<div class="login">
    ${logo(api)}
    <form class="login-box" data-login-code>
      <div class="login-note">Wir haben einen Code an <b>${esc(email)}</b> geschickt. Du kannst auch direkt auf den Link in der E-Mail tippen.</div>
      <label class="login-label" for="code">Code</label>
      <input id="code" name="code" class="text-input dark code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="10" required>
      <button class="btn wide" type="submit">Anmelden</button>
      <div class="login-error" data-error></div>
    </form>
    <div class="login-links">
      <button class="link-btn" data-login-action="resend">Neuen Code senden</button>
      <button class="link-btn" data-login-action="other-email">Andere E-Mail</button>
    </div>
  </div>`;
}
