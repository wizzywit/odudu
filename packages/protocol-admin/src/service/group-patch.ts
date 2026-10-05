import { groupRecordSchema } from '@odudu/contracts/admin';

// The real field list a group's wire shape carries, not a hand-kept
// restatement of it — a field added to `groupRecordSchema` (@odudu/contracts)
// shows up here without this file changing, so the "accounts for every
// field" test below (group-patch.test.ts) actually exercises the contract
// rather than a copy of it.
export const GROUP_FIELDS: readonly string[] = Object.keys(groupRecordSchema.shape);

const REFUSALS: Readonly<Record<string, string>> = {
  id: 'identity: changing it breaks every group_roles and subject_groups edge naming this group',
  name: 'name is embedded in every descendant path and in the groups claim a relying party matches on; a rename is not offered, by ADR 0039: create a new group and move its members',
  // `parent_id` is amended through `groupRepository.reparent`
  // (@odudu/domain-authz), the same write reparenting has always used —
  // never a plain column set, since it is what recomputes `path` for this
  // group and every descendant, and refuses a cycle.
  path: 'path is denormalized from name and parent_id; it is recomputed by reparenting, never written directly',
  default_for_new_subjects:
    'default_for_new_subjects changes who joins a group silently at signup; set it with PUT /admin/tenants/{tenant}/groups/{id}/default, not a general amendment',
  created_at: 'created_at is history',
  admin_reach:
    'admin_reach is derived from the roles this group and every group above it map; change those instead',
  subtree_admin_reach:
    'subtree_admin_reach is derived from the roles mapped in and above this group\u2019s subtree; change those instead',
};

export function refusalFor(field: string): string | null {
  return REFUSALS[field] ?? null;
}

export const AMENDABLE_GROUP_FIELDS: readonly string[] = GROUP_FIELDS.filter(
  (field) => refusalFor(field) === null,
);
