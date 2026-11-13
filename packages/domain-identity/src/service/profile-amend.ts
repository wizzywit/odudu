import { BIDI_REFUSED_MESSAGE, refusesBidi } from '@odudu/contracts';
import type { MeAmendProfileRequest } from '@odudu/contracts/me';
import { CLAIM_KEY, shapeInvalidityFor } from '#/service/profile';
import { type ProfileUpdate, type UserRecord, type VerificationUpdate } from '#/schema/users';

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
  | {
      readonly kind: 'invalid_value';
      readonly field: string;
      readonly description: string;
      // A control that would reorder the text around it, or a shape the claim
      // cannot take, for a page that words each in its own language.
      readonly reason: 'bidi' | 'shape';
    }
  | { readonly kind: 'unchanged' }
  | {
      readonly kind: 'change';
      // The claims to write, null when only the username changes.
      readonly profile: ProfileUpdate | null;
      readonly verification: VerificationUpdate | null;
      // The new username, null when it is not being changed.
      readonly username: string | null;
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
  let username: string | null = null;
  for (const [field, raw] of Object.entries(values)) {
    if (field === 'username') {
      if (typeof raw !== 'string' || raw === current.username) continue;
      if (refusesBidi(raw, current.username)) {
        return { kind: 'invalid_value', field, description: BIDI_REFUSED_MESSAGE, reason: 'bidi' };
      }
      username = raw;
      fields.push(field);
      continue;
    }
    const key = CLAIM_KEY[field];
    if (key === undefined || raw === undefined) continue;
    // Every claim the schema admits is a string or null; this narrows the
    // entries' `unknown` for the compiler and skips nothing at run time.
    if (raw !== null && typeof raw !== 'string') continue;
    if (raw === current[key]) continue;
    if (NAME_CLAIMS.has(field) && refusesBidi(raw, current[key])) {
      return { kind: 'invalid_value', field, description: BIDI_REFUSED_MESSAGE, reason: 'bidi' };
    }
    const invalidity = raw === null ? null : shapeInvalidityFor(field, raw);
    if (invalidity !== null) {
      return { kind: 'invalid_value', field, description: invalidity, reason: 'shape' };
    }
    profile[key] = raw;
    fields.push(field);
  }
  if (fields.length === 0) return { kind: 'unchanged' };

  const verification: VerificationUpdate | null =
    'phoneNumber' in profile && current.phoneNumberVerified ? { phoneNumberVerified: false } : null;
  return {
    kind: 'change',
    profile: Object.keys(profile).length === 0 ? null : profile,
    verification,
    username,
    fields,
  };
}
