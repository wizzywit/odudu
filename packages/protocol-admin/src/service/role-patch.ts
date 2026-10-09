import { roleSchema } from '@odudu/contracts/admin';

// The real field list a role's wire shape carries, not a hand-kept
// restatement of it — a field added to `roleSchema` (@odudu/contracts)
// shows up here without this file changing, so the "accounts for every
// field" test below (role-patch.test.ts) actually exercises the contract
// rather than a copy of it.
export const ROLE_FIELDS: readonly string[] = Object.keys(roleSchema.shape);

const REFUSALS: Readonly<Record<string, string>> = {
  id: 'identity: changing it breaks every subject_roles and role_composites edge naming this role',
  name: 'name is what a token qualifies into a capability string, and what a relying party matches the roles claim on; a rename is not offered, by ADR 0039: create a new role and move its assignments',
  client_id:
    'client_id decides whether this role is tenant-wide or scoped to one client; changing it after creation needs its own operation',
  default_for_new_subjects:
    'default_for_new_subjects changes who a role is silently handed to at signup; set it with PUT /admin/tenants/{tenant}/roles/{id}/default, not a general amendment',
  client_key:
    'client_key is the owning client\u2019s own client_id, read from that client; it follows client_id',
  created_at: 'created_at is history',
  admin_reach:
    'admin_reach is derived from the roles this role nests; change its composites instead',
};

export function refusalFor(field: string): string | null {
  return REFUSALS[field] ?? null;
}

export const AMENDABLE_ROLE_FIELDS: readonly string[] = ROLE_FIELDS.filter(
  (field) => refusalFor(field) === null,
);
