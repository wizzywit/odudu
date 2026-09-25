import { type EffectiveRole, qualifiedRoleName } from '@odudu/domain-authz';
import { type UserRecord } from '@odudu/domain-identity';
import { ClaimMapperRegistry, type ClaimMapper } from '@odudu/kernel';

// What every claim mapper needs to compute its output from. `user` is null
// for a subject the identity domain has no users row for — every mapper
// below treats that as "nothing to add", not an error, since a claim mapper
// never runs a query of its own (service is a leaf): the usecase that calls
// `assemble` already did the one lookup this needs. `roles`, `groups` and
// `bindings` are resolved the same way, once per issuance; no mapper reads
// `bindings` itself, it is only carried for `assemble` to read beside the rest.
export interface ClaimContext {
  readonly subjectId: string;
  readonly user: UserRecord | null;
  readonly roles: readonly EffectiveRole[];
  readonly groups: readonly string[];
  readonly bindings: ReadonlyMap<string, readonly string[]>;
}

const subMapper: ClaimMapper<ClaimContext> = {
  name: 'sub',
  scopes: ['openid'],
  claims: ['sub'],
  map: (ctx) => Promise.resolve({ sub: ctx.subjectId }),
};

type ClaimValue = string | number | boolean | null | undefined;

// A claim with nothing behind it is left out rather than emitted as `null`
// or `false` — every mapper below builds its result through this rather
// than an object literal, so "nothing stored" and "omitted" stay the same
// thing everywhere.
function definedClaims(
  entries: readonly (readonly [string, ClaimValue])[],
): Record<string, string | number | boolean> {
  const claims: Record<string, string | number | boolean> = {};
  for (const [claimName, value] of entries) {
    if (value !== null && value !== undefined) claims[claimName] = value;
  }
  return claims;
}

function epochSeconds(date: Date | null): number | null {
  return date === null ? null : Math.floor(date.getTime() / 1000);
}

// OIDC Core §5.4's full `profile` scope claim list. `name` and
// `preferred_username` fall back to `username` — the one human-facing
// identifier every user row is guaranteed to carry — so a user who has
// never set a display name still surfaces one instead of the claim
// silently disappearing.
const profileMapper: ClaimMapper<ClaimContext> = {
  name: 'profile',
  scopes: ['profile'],
  claims: [
    'name',
    'given_name',
    'family_name',
    'middle_name',
    'nickname',
    'preferred_username',
    'profile',
    'picture',
    'website',
    'gender',
    'birthdate',
    'zoneinfo',
    'locale',
    'updated_at',
  ],
  map: (ctx) => {
    const user = ctx.user;
    if (user === null) return Promise.resolve({});
    return Promise.resolve(
      definedClaims([
        ['name', user.name ?? user.username],
        ['given_name', user.givenName],
        ['family_name', user.familyName],
        ['middle_name', user.middleName],
        ['nickname', user.nickname],
        ['preferred_username', user.preferredUsername ?? user.username],
        ['profile', user.profile],
        ['picture', user.picture],
        ['website', user.website],
        ['gender', user.gender],
        ['birthdate', user.birthdate],
        ['zoneinfo', user.zoneinfo],
        ['locale', user.locale],
        ['updated_at', epochSeconds(user.profileUpdatedAt)],
      ]),
    );
  },
};

// OIDC Core §5.1.1: `address` is one JSON object, not six flat claims, and
// the object itself is left out entirely — never emitted as `{}` — when no
// component is stored.
const addressMapper: ClaimMapper<ClaimContext> = {
  name: 'address',
  scopes: ['address'],
  claims: ['address'],
  map: (ctx) => {
    const user = ctx.user;
    if (user === null) return Promise.resolve({});
    const address = definedClaims([
      ['formatted', user.addressFormatted],
      ['street_address', user.addressStreet],
      ['locality', user.addressLocality],
      ['region', user.addressRegion],
      ['postal_code', user.addressPostalCode],
      ['country', user.addressCountry],
    ]);
    return Promise.resolve(Object.keys(address).length === 0 ? {} : { address });
  },
};

// Follows the `email` mapper's rule exactly: a missing phone number and an
// unverified one are different things, so `phone_number` and
// `phone_number_verified` leave together rather than asserting a false
// verification status for a number that does not exist.
const phoneMapper: ClaimMapper<ClaimContext> = {
  name: 'phone',
  scopes: ['phone'],
  claims: ['phone_number', 'phone_number_verified'],
  map: (ctx) => {
    const user = ctx.user;
    if (user?.phoneNumber === null || user?.phoneNumber === undefined) {
      return Promise.resolve({});
    }
    return Promise.resolve({
      phone_number: user.phoneNumber,
      phone_number_verified: user.phoneNumberVerified,
    });
  },
};

// No email on file is not the same as an empty string: both `email` and
// `email_verified` are left out together rather than asserting a false
// verification status for an address that doesn't exist.
const emailMapper: ClaimMapper<ClaimContext> = {
  name: 'email',
  scopes: ['email'],
  claims: ['email', 'email_verified'],
  map: (ctx) => {
    const user = ctx.user;
    if (user?.email === null || user?.email === undefined) return Promise.resolve({});
    return Promise.resolve({ email: user.email, email_verified: user.emailVerified });
  },
};

// RFC 9068 §2.2.3.1 names `roles` and `groups` as JWT claims, referencing
// RFC 7643 §4.1.2's SCIM schema for their meaning. Both are emitted here as
// the flat string arrays RFC 9068 shows, not SCIM's complex form. That same
// registry also names `entitlements`, which Odudu deliberately never emits:
// there is no entitlement concept in this domain, and no mapper claims it.
const rolesMapper: ClaimMapper<ClaimContext> = {
  name: 'roles',
  scopes: ['roles'],
  claims: ['roles'],
  map: (ctx) => {
    const names = [
      ...new Set(ctx.roles.map((role) => qualifiedRoleName(role, role.clientKey))),
    ].sort();
    return Promise.resolve(names.length === 0 ? {} : { roles: names });
  },
};

const groupsMapper: ClaimMapper<ClaimContext> = {
  name: 'groups',
  scopes: ['groups'],
  claims: ['groups'],
  map: (ctx) => {
    const paths = [...new Set(ctx.groups)].sort();
    return Promise.resolve(paths.length === 0 ? {} : { groups: paths });
  },
};

// OIDC Core §5.5: once a `claims` request member names anything, the
// response narrows to it — never widening past what `assemble` already
// limited to scope. Empty `requested` leaves `claims` untouched.
export function narrowToRequestedClaims(
  claims: Record<string, unknown>,
  requested: readonly string[],
): Record<string, unknown> {
  if (requested.length === 0) return claims;
  const keep = new Set(requested);
  const narrowed: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(claims)) {
    if (keep.has(name)) narrowed[name] = value;
  }
  return narrowed;
}

// Registered mappers, not a switch: the plugin system's registry is what
// both `/userinfo` and ID token issuance assemble claims through, so a
// third-party mapper added later reaches both the same way these do.
export function standardClaimMappers(): ClaimMapperRegistry<ClaimContext> {
  return new ClaimMapperRegistry<ClaimContext>()
    .register(subMapper)
    .register(profileMapper)
    .register(emailMapper)
    .register(rolesMapper)
    .register(groupsMapper)
    .register(addressMapper)
    .register(phoneMapper);
}
