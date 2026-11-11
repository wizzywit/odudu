import { BIDI_REFUSED_MESSAGE, refusesBidi } from '@odudu/contracts';
import type { MeAmendProfileRequest } from '@odudu/contracts/me';
import {
  CLAIM_KEY,
  shapeInvalidityFor,
  type ProfileUpdate,
  type UserRecord,
  type VerificationUpdate,
} from '@odudu/domain-identity';

// The claims that name a person: refused when a write would add a bidirectional
// control to them.
const NAME_CLAIMS = new Set([
  'name',
  'given_name',
  'family_name',
  'middle_name',
  'nickname',
  'preferred_username',
]);

export type ProfileAmendPlan =
  | { readonly kind: 'invalid_value'; readonly field: string; readonly description: string }
  | { readonly kind: 'unchanged' }
  | {
      readonly kind: 'change';
      readonly profile: ProfileUpdate;
      readonly verification: VerificationUpdate | null;
      // The wire names of the claims that change, in the order sent.
      readonly fields: readonly string[];
    };

// What an edit of the profile writes: only the claims whose value differs, and
// the loss of a phone number's verification when the number itself changes. A
// person never sets a verification flag, so the only one that moves is that.
export function planProfileAmend(
  current: UserRecord,
  values: MeAmendProfileRequest,
): ProfileAmendPlan {
  const profile: ProfileUpdate = {};
  const fields: string[] = [];
  for (const [field, raw] of Object.entries(values)) {
    const key = CLAIM_KEY[field];
    if (key === undefined || raw === undefined) continue;
    if (raw === current[key]) continue;
    if (NAME_CLAIMS.has(field) && refusesBidi(raw, current[key])) {
      return { kind: 'invalid_value', field, description: BIDI_REFUSED_MESSAGE };
    }
    const invalidity = raw === null ? null : shapeInvalidityFor(field, raw);
    if (invalidity !== null) return { kind: 'invalid_value', field, description: invalidity };
    profile[key] = raw;
    fields.push(field);
  }
  if (fields.length === 0) return { kind: 'unchanged' };

  const verification: VerificationUpdate | null =
    'phoneNumber' in profile && current.phoneNumberVerified ? { phoneNumberVerified: false } : null;
  return { kind: 'change', profile, verification, fields };
}
