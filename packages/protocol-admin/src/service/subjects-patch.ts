import { subjectSchema } from '@odudu/contracts/admin';

// The real field list a subject's wire shape carries, not a hand-kept
// restatement of it — a field added to `subjectSchema` (@odudu/contracts)
// shows up here without this file changing, so the "accounts for every
// field" test below (subjects-patch.test.ts) actually exercises the
// contract rather than a copy of it.
export const SUBJECT_FIELDS: readonly string[] = Object.keys(subjectSchema.shape);

/** What the tenant decides about a subject amendment: its `username_editable` setting. */
export interface SubjectAmendPolicy {
  readonly usernameEditable: boolean;
}

const REFUSALS: Readonly<Record<string, string>> = {
  id: 'identity: changing it breaks every reference to this subject, tokens already issued included',
  type: 'type silently changes what kind of principal this is — a user becoming a service account needs its own operation, not a general amendment',
  created_at: 'created_at is history',
};

const USERNAME_NOT_EDITABLE = 'this tenant has not enabled username editing (username_editable)';

export function refusalFor(field: string, policy: SubjectAmendPolicy): string | null {
  if (field === 'username') return policy.usernameEditable ? null : USERNAME_NOT_EDITABLE;
  return REFUSALS[field] ?? null;
}

export function amendableSubjectFields(policy: SubjectAmendPolicy): readonly string[] {
  return SUBJECT_FIELDS.filter((field) => refusalFor(field, policy) === null);
}
