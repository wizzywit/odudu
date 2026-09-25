import { subjectSchema } from '@odudu/contracts/admin';

// The real field list a subject's wire shape carries, not a hand-kept
// restatement of it — a field added to `subjectSchema` (@odudu/contracts)
// shows up here without this file changing, so the "accounts for every
// field" test below (subjects-patch.test.ts) actually exercises the
// contract rather than a copy of it.
export const SUBJECT_FIELDS: readonly string[] = Object.keys(subjectSchema.shape);

const REFUSALS: Readonly<Record<string, string>> = {
  id: 'identity: changing it breaks every reference to this subject, tokens already issued included',
  type: 'type silently changes what kind of principal this is — a user becoming a service account needs its own operation, not a general amendment',
  username:
    'username carries its own uniqueness and login semantics; renaming it belongs to a dedicated operation, not a general amendment',
  created_at: 'created_at is history',
};

export function refusalFor(field: string): string | null {
  return REFUSALS[field] ?? null;
}

export const AMENDABLE_SUBJECT_FIELDS: readonly string[] = SUBJECT_FIELDS.filter(
  (field) => refusalFor(field) === null,
);
