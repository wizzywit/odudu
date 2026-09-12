import { type UserRecord } from '@odudu/domain-identity';
import { ClaimMapperRegistry, type ClaimMapper } from '@odudu/kernel';

// What every claim mapper needs to compute its output from. `user` is null
// for a subject the identity domain has no users row for (a service or
// agent_instance subject, or a user subject looked up before its row is
// loaded) — every mapper below treats that as "nothing to add", not an
// error, since a claim mapper never runs a query of its own (service is a
// leaf): the usecase that calls `assemble` already did the one lookup this
// needs.
export interface ClaimContext {
  readonly subjectId: string;
  readonly user: UserRecord | null;
}

const subMapper: ClaimMapper<ClaimContext> = {
  name: 'sub',
  scopes: ['openid'],
  claims: ['sub'],
  map: (ctx) => Promise.resolve({ sub: ctx.subjectId }),
};

// OIDC Core §5.4 names `name` among the `profile` scope's default claims;
// Odudu carries no separate display name, so `name` is the username —
// the one human-facing identifier the domain actually stores.
const profileMapper: ClaimMapper<ClaimContext> = {
  name: 'profile',
  scopes: ['profile'],
  claims: ['name'],
  map: (ctx) => Promise.resolve(ctx.user === null ? {} : { name: ctx.user.username }),
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

// Registered mappers, not a switch: the plugin system's registry is what
// both `/userinfo` and ID token issuance assemble claims through, so a
// third-party mapper added later reaches both the same way these three do.
export function standardClaimMappers(): ClaimMapperRegistry<ClaimContext> {
  return new ClaimMapperRegistry<ClaimContext>()
    .register(subMapper)
    .register(profileMapper)
    .register(emailMapper);
}
