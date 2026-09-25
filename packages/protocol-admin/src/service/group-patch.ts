import { groupSchema } from '@odudu/contracts/admin';

// The real field list a group's wire shape carries, not a hand-kept
// restatement of it — a field added to `groupSchema` (@odudu/contracts)
// shows up here without this file changing, so the "accounts for every
// field" test below (group-patch.test.ts) actually exercises the contract
// rather than a copy of it.
export const GROUP_FIELDS: readonly string[] = Object.keys(groupSchema.shape);

const REFUSALS: Readonly<Record<string, string>> = {
  id: 'identity: changing it breaks every group_roles and subject_groups edge naming this group',
  name: 'name is embedded in every descendant path; renaming it needs its own operation, not a general amendment',
  // `parent_id` is amended through `groupRepository.reparent`
  // (@odudu/domain-authz), the same write reparenting has always used —
  // never a plain column set, since it is what recomputes `path` for this
  // group and every descendant, and refuses a cycle.
  path: 'path is denormalized from name and parent_id; it is recomputed by reparenting, never written directly',
  created_at: 'created_at is history',
};

export function refusalFor(field: string): string | null {
  return REFUSALS[field] ?? null;
}

export const AMENDABLE_GROUP_FIELDS: readonly string[] = GROUP_FIELDS.filter(
  (field) => refusalFor(field) === null,
);
