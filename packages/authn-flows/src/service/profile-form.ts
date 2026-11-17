import { CLAIM_KEY, planProfileAmend, type UserRecord } from '@odudu/domain-identity';

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

// The required fields that are empty after the form: the form is finished only
// when there are none. A field the form did not send keeps what is held.
export function unfilledFields(
  user: UserRecord,
  submitted: Readonly<Record<string, string | null>>,
  required: readonly string[],
): string[] {
  return required.filter((field) =>
    isEmpty(Object.hasOwn(submitted, field) ? submitted[field] : currentValue(user, field)),
  );
}

export interface InvalidField {
  readonly field: string;
  // A control that would reorder the text around it, or a shape the claim
  // cannot take, for a page that words each in its own language.
  readonly reason: 'bidi' | 'shape';
}

// Every submitted value the write would refuse, each judged as the me API
// judges it on its own, so the page names them all at once.
export function invalidProfileFields(
  user: UserRecord,
  submitted: Readonly<Record<string, string | null>>,
): InvalidField[] {
  return Object.entries(submitted).flatMap(([field, value]) => {
    const plan = planProfileAmend(user, { [field]: value });
    return plan.kind === 'invalid_value' ? [{ field: plan.field, reason: plan.reason }] : [];
  });
}
