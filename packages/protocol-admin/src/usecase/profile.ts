import { type Profile } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import {
  isValidBirthdate,
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
import { type Audit } from '#/usecase/subjects';

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
// `phone_number` carries no predicate here: E.164 is only required once
// `phone_number_verified` is true, which `users_verified_phone_is_e164`
// enforces; a violation of that CHECK is caught after the write below.
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

  const current = await userRepository(tx).bySubjectId(input.subjectId);
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

  // A `users_verified_phone_is_e164` violation is left to escape the
  // transaction rather than caught here: PostgreSQL aborts the whole
  // transaction the moment a statement violates a CHECK, so recovering
  // inside it and going on to audit and return `ok` would commit nothing
  // and answer a caller as though it had. `amendProfileHandler` (#/view/
  // routes/subjects.ts) catches it outside `adminTx`, the same way
  // `createSubjectHandler` catches a unique violation outside its own.
  let updated = current;
  if (Object.keys(profilePatch).length > 0) {
    updated = await userRepository(tx).updateProfile(input.subjectId, profilePatch);
  }
  if (Object.keys(verificationPatch).length > 0) {
    updated = await userRepository(tx).setVerification(input.subjectId, verificationPatch);
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
