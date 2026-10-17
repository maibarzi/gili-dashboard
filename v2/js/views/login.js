import { esc } from '../ui.js';
import { ROLE_LABELS } from '../auth.js';

// Live: sign-in by e-mail link (one account per person, any number of salons).
// Demo: pick one of the demo accounts.
export async function render(api) {
  const users = await api.auth.demoUsers();
  return `<div class="login">
    <div class="pin-logo">gili<span>.</span></div>
    <div class="login-box">
      <label class="login-label" for="email">E-Mail</label>
      <input id="email" class="text-input dark" type="email" placeholder="name@salon.at" disabled>
      <button class="btn wide" disabled>Anmeldelink senden</button>
      <div class="login-note">In der Demo ist die Anmeldung per E-Mail deaktiviert.</div>
    </div>
    <div class="login-label">Demo-Zugang</div>
    ${users.map(u => `<button class="login-user" data-user="${u.id}">
      <b>${esc(u.name)}</b>
      <span>${u.memberships.map(m => `${esc(m.salon)} · ${ROLE_LABELS[m.role]}`).join('<br>')}</span>
    </button>`).join('')}
  </div>`;
}
