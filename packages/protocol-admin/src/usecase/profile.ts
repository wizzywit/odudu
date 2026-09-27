import { type Profile } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import {
  isValidBirthdate,
  isValidE164,
  isValidLocale,
  isValidProfileUrl,
  isValidZoneinfo,
  userRepository,
  type ProfileUpdate,
  type UserRecord,
  type VerificationUpdate,
} from '@odudu/domain-identity';
import { redactedDiff } from '#/service/audit-detail';
import { etagOf, matches } from '#/service/etag';
import {
  lockSubjectRow,
  refuseOverTargetCeiling,
  type Audit,
  type TargetCeilingRefusal,
} from '#/usecase/subjects';

// `amendProfileHandler` (#/view/routes/subjects.ts) reuses this for the
// outer, transaction-aborting catch of `users_verified_phone_is_e164` — a
// safety net for a race this function's own pre-write check already
// closes for a single request.
export const PHONE_E164_MESSAGE =
  'phone_number must be E.164-shaped for phone_number_verified to be true';

// The wire shape a caller reads and amends — every OIDC Core §5.1 claim
// column on `users`, `email_verified` and `phone_number_verified` beside
// them, and `profile_updated_at` last, read-only. Never `email` or
// `username`: those are identity, not profile, and `PATCH
// /admin/tenants/{tenant}/subjects/{id}` is what owns each.
export function profileWireShape(user: UserRecord): Profile {
  return {
    name: user.name,
    given_name: user.givenName,
    family_name: user.familyName,
    middle_name: user.middleName,
    nickname: user.nickname,
    preferred_username: user.preferredUsername,
    profile: user.profile,
    picture: user.picture,
    website: user.website,
    gender: user.gender,
    birthdate: user.birthdate,
    zoneinfo: user.zoneinfo,
    locale: user.locale,
    phone_number: user.phoneNumber,
    phone_number_verified: user.phoneNumberVerified,
    email_verified: user.emailVerified,
    address_formatted: user.addressFormatted,
    address_street: user.addressStreet,
    address_locality: user.addressLocality,
    address_region: user.addressRegion,
    address_postal_code: user.addressPostalCode,
    address_country: user.addressCountry,
    profile_updated_at: user.profileUpdatedAt === null ? null : user.profileUpdatedAt.toISOString(),
  };
}

export type ReadProfileOutcome =
  { kind: 'not_found' } | { kind: 'ok'; view: Profile; etag: string };

/** A subject with no `users` row — a service or agent_instance subject — answers `not_found`. */
export async function readProfile(
  tx: TenantScopedDatabase,
  subjectId: string,
): Promise<ReadProfileOutcome> {
  const user = await userRepository(tx).bySubjectId(subjectId);
  if (user === null) return { kind: 'not_found' };
  const view = profileWireShape(user);
  return { kind: 'ok', view, etag: etagOf(view) };
}

export interface AmendProfileInput {
  readonly subjectId: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly ifMatch: string | undefined;
  readonly callerCapabilities: ReadonlySet<string>;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface AmendProfileDeps {
  readonly audit: Audit;
}

export type AmendProfileOutcome =
  | { kind: 'not_found' }
  | { kind: 'refused_field'; field: string; reason: string }
  | { kind: 'invalid_value'; field: string; description: string }
  | { kind: 'precondition_failed' }
  | TargetCeilingRefusal
  | { kind: 'ok'; view: Profile; etag: string };

// `email` and `username` are typed on `amendProfileRequestSchema`
// (@odudu/contracts) precisely so this can name the door that owns each,
// rather than ajv's generic "additional property" message.
const REFUSALS: Readonly<Record<string, string>> = {
  email:
    'email is amended through PATCH /admin/tenants/{tenant}/subjects/{id}, not a subject’s profile',
  username:
    'username is amended through PATCH /admin/tenants/{tenant}/subjects/{id}, not a subject’s profile',
};

// Every writable claim column, keyed by the snake_case wire name a caller
// sends — the same mapping `profileWireShape` reads in reverse. Excludes
// `phoneNumberVerified`, `ProfileUpdate`'s one non-string member, so every
// value this maps to shares the same `string | null` property type.
type StringClaimKey = Exclude<keyof ProfileUpdate, 'phoneNumberVerified'>;
const CLAIM_KEY: Readonly<Record<string, StringClaimKey>> = {
  name: 'name',
  given_name: 'givenName',
  family_name: 'familyName',
  middle_name: 'middleName',
  nickname: 'nickname',
  preferred_username: 'preferredUsername',
  profile: 'profile',
  picture: 'picture',
  website: 'website',
  gender: 'gender',
  birthdate: 'birthdate',
  zoneinfo: 'zoneinfo',
  locale: 'locale',
  phone_number: 'phoneNumber',
  address_formatted: 'addressFormatted',
  address_street: 'addressStreet',
  address_locality: 'addressLocality',
  address_region: 'addressRegion',
  address_postal_code: 'addressPostalCode',
  address_country: 'addressCountry',
};

const URL_FIELDS = new Set(['profile', 'picture', 'website']);

// Mirrors the same shape check `updateProfile`'s domain path applies
// (packages/domain-identity/src/service/profile.ts) — a friendly 400
// instead of a caller learning of `users_birthdate_shape` from a 500.
// `phone_number`'s own E.164 requirement is conditional on
// `phone_number_verified`, so it is checked separately, against the
// patch's final state, once both are known — never per-field here.
function shapeInvalidityFor(field: string, value: string): string | null {
  if (field === 'birthdate' && !isValidBirthdate(value)) {
    return `${JSON.stringify(value)} is not a birthdate the claim may carry (YYYY-MM-DD, or YYYY alone)`;
  }
  if (field === 'zoneinfo' && !isValidZoneinfo(value)) {
    return `${JSON.stringify(value)} is not an IANA Time Zone Database name`;
  }
  if (field === 'locale' && !isValidLocale(value)) {
    return `${JSON.stringify(value)} is not a BCP 47 locale the claim may carry`;
  }
  if (URL_FIELDS.has(field) && !isValidProfileUrl(value)) {
    return `${JSON.stringify(value)} is not an http or https URL`;
  }
  return null;
}

/**
 * Amends the claim columns through `updateProfile` and the two
 * verification flags through `setVerification`, both against the one `tx`
 * the caller already opened — one transaction, the way the interface
 * promises. `If-Match` is optional: honoured when present, never required.
 */
export async function amendProfile(
  tx: TenantScopedDatabase,
  deps: AmendProfileDeps,
  input: AmendProfileInput,
): Promise<AmendProfileOutcome> {
  for (const field of Object.keys(input.values)) {
    const refusal = REFUSALS[field];
    if (refusal !== undefined) {
      return { kind: 'refused_field', field, reason: refusal };
    }
  }

  // Locked, not merely read: two concurrent PATCHes reading the same row
  // would both compute the same `ETag`, both pass `If-Match`, and the
  // second's audit `before` would already be stale by the time it writes.
  // `FOR UPDATE` serialises them the same way `lockSubjectForAmend`
  // (#/usecase/subjects.ts) serialises a subject amendment.
  if (!(await lockSubjectRow(tx, input.subjectId))) return { kind: 'not_found' };
  const refused = await refuseOverTargetCeiling(tx, deps.audit, 'subject.profile_amend', input);
  if (refused !== null) return refused;
  const current = await userRepository(tx).lockBySubjectId(input.subjectId);
  if (current === null) return { kind: 'not_found' };

  const before = profileWireShape(current);
  if (matches(input.ifMatch, etagOf(before)) === 'mismatch') {
    return { kind: 'precondition_failed' };
  }

  const profilePatch: ProfileUpdate = {};
  const verificationPatch: VerificationUpdate = {};

  for (const [field, raw] of Object.entries(input.values)) {
    if (field === 'email_verified' || field === 'phone_number_verified') {
      if (typeof raw !== 'boolean') {
        return { kind: 'invalid_value', field, description: `${field} must be a boolean` };
      }
      if (field === 'email_verified') verificationPatch.emailVerified = raw;
      else verificationPatch.phoneNumberVerified = raw;
      continue;
    }

    const claimKey = CLAIM_KEY[field];
    if (claimKey === undefined) {
      return { kind: 'refused_field', field, reason: `${field} is not a profile field` };
    }
    if (raw !== null && typeof raw !== 'string') {
      return { kind: 'invalid_value', field, description: `${field} must be a string or null` };
    }
    if (raw !== null) {
      const invalidity = shapeInvalidityFor(field, raw);
      if (invalidity !== null) {
        return { kind: 'invalid_value', field, description: invalidity };
      }
    }
    profilePatch[claimKey] = raw;
  }

  // A different number is not a verified one — the same reasoning
  // `updateEmail` resets `emailVerified` on every address change.
  // Compared against the stored value, not merely "the field was sent":
  // an echoed full-object PATCH that resubmits the same `phone_number`
  // must not cost a subject its verification, only an actual change of
  // number does, when the caller leaves `phone_number_verified` unsaid.
  if (
    'phone_number' in input.values &&
    !('phone_number_verified' in input.values) &&
    (profilePatch.phoneNumber ?? null) !== current.phoneNumber
  ) {
    verificationPatch.phoneNumberVerified = false;
  }

  // The state this patch would leave the row in — a field it does not
  // touch keeps `current`'s value — checked before either write runs, so
  // a refusal is never a caller reading a garbled number back off the
  // very CHECK meant to refuse it, worded as though verifying were what
  // they had asked for.
  const finalPhoneNumber =
    'phone_number' in input.values ? (profilePatch.phoneNumber ?? null) : current.phoneNumber;
  const finalPhoneNumberVerified =
    'phoneNumberVerified' in verificationPatch
      ? (verificationPatch.phoneNumberVerified ?? false)
      : current.phoneNumberVerified;
  if (finalPhoneNumberVerified && (finalPhoneNumber === null || !isValidE164(finalPhoneNumber))) {
    return { kind: 'invalid_value', field: 'phone_number', description: PHONE_E164_MESSAGE };
  }

  // `updateProfile` and `setVerification` are two separate `UPDATE`
  // statements, each checked immediately — a `CHECK` is never deferred in
  // PostgreSQL — so their *order* decides what the row briefly looks like
  // between them, not only what it ends as. Ending unverified is written
  // first: dropping `phone_number_verified` before the number changes
  // means neither statement ever holds `true` against a number that is
  // mid-change. Ending verified keeps the original order, since a final
  // state already known to be valid (checked above) makes either
  // statement pass regardless of what still holds the old value.
  let updated = current;
  if (finalPhoneNumberVerified) {
    if (Object.keys(profilePatch).length > 0) {
      updated = await userRepository(tx).updateProfile(input.subjectId, profilePatch);
    }
    if (Object.keys(verificationPatch).length > 0) {
      updated = await userRepository(tx).setVerification(input.subjectId, verificationPatch);
    }
  } else {
    if (Object.keys(verificationPatch).length > 0) {
      updated = await userRepository(tx).setVerification(input.subjectId, verificationPatch);
    }
    if (Object.keys(profilePatch).length > 0) {
      updated = await userRepository(tx).updateProfile(input.subjectId, profilePatch);
    }
  }

  const after = profileWireShape(updated);

  await deps.audit(tx, {
    action: 'subject.profile_amend',
    resourceType: 'subject',
    resourceId: input.subjectId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    detail: redactedDiff('subject_profile', before, after),
  });

  return { kind: 'ok', view: after, etag: etagOf(after) };
}
