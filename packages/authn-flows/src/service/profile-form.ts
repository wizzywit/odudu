import { CLAIM_KEY, type UserRecord } from '@odudu/domain-identity';

// The fields a person edits: every claim `PATCH /me/profile` writes, in the
// order the form lays them out, and the username where the tenant lets one
// change. The write itself is `planProfileAmend`, so what is judged here is
// only which of them are asked for and when the form is done.
export function editableProfileFields(usernameEditable: boolean): readonly string[] {
  const claims = Object.keys(CLAIM_KEY);
  return usernameEditable ? ['username', ...claims] : claims;
}

function currentValue(user: UserRecord, field: string): string | null {
  if (field === 'username') return user.username;
  const key = CLAIM_KEY[field];
  return key === undefined ? null : user[key];
}

const isEmpty = (value: string | null | undefined): boolean => value === null || value === '';

// What the form shows for each field: the value held, or nothing.
export function prefilledValues(
  user: UserRecord,
  fields: readonly string[],
): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field, currentValue(user, field) ?? '']));
}

// What was posted, for the editable fields only: trimmed, an empty claim as
// no value, and an empty or absent username as no change.
export function submittedValues(
  posted: Readonly<Record<string, string>>,
  fields: readonly string[],
): Record<string, string | null> {
  const values: Record<string, string | null> = {};
  for (const field of fields) {
    const raw = posted[field];
    if (raw === undefined) continue;
    const trimmed = raw.trim();
    if (field === 'username') {
      if (trimmed !== '') values[field] = trimmed;
      continue;
    }
    values[field] = trimmed === '' ? null : trimmed;
  }
  return values;
}

// The fields that were empty before the form and are still empty after it:
// the form is finished only when there are none.
export function unfilledFields(
  user: UserRecord,
  submitted: Readonly<Record<string, string | null>>,
  fields: readonly string[],
): string[] {
  return fields.filter((field) => {
    if (!isEmpty(currentValue(user, field))) return false;
    return isEmpty(Object.hasOwn(submitted, field) ? submitted[field] : null);
  });
}
