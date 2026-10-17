// Roles per salon membership. The UI hides what a role can't do; the backend
// enforces the same rules (row level security), so hiding is only cosmetic.

export const ROLE_LABELS = { owner: 'Inhaberin', staff: 'Mitarbeiterin' };

const PERMISSIONS = {
  owner: ['view_income', 'edit_client', 'manage_queue', 'edit_settings'],
  staff: [],
};

export function can(role, permission) {
  return (PERMISSIONS[role] || []).includes(permission);
}
