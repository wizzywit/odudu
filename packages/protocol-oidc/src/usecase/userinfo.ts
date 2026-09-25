import { type SessionLifespans } from '@odudu/authn-flows';
import {
  encodeUnsecuredJwt,
  encryptCompact,
  selectEncryptionKey,
  signJwt,
  verifyJwt,
  type SigningKeyRecord,
} from '@odudu/crypto';
import { type ClaimMapperRegistry } from '@odudu/kernel';
import { presentedBearerToken } from '#/service/bearer-token';
import {
  type ClaimContext,
  type LoadedClaimContext,
  narrowToRequestedClaims,
} from '#/service/claims';
import { clientIsLive, type LiveClientLookup } from '#/service/client-enabled';
import { narrowByScopeMappings } from '#/service/scope-mapping';
import { type ClientKeySet } from '#/repository/client-keys';
import { type TenantLookup } from '#/repository/tenant-lookup';

export interface UserinfoGrant {
  readonly revokedAt: Date | null;
}

export interface UserinfoDeps {
  findTenant(name: string): Promise<TenantLookup | null>;
  listPublishableKeys(tenantId: string): Promise<SigningKeyRecord[]>;
  loadClaimContext(tenantId: string, subjectId: string): Promise<LoadedClaimContext>;
  claimMappers: ClaimMapperRegistry<ClaimContext>;
  // The same two reads `/introspect` makes (usecase/introspection.ts) —
  // a grant this server revoked, or a session that has since ended, makes
  // the token no less self-contained but no longer valid either. Tenant-
  // scoped explicitly, like every other lookup below, since this deps
  // object is built once and reused across tenants.
  loadGrant(tenantId: string, grantId: string): Promise<UserinfoGrant | null>;
  isSessionLive(
    tenantId: string,
    sessionId: string,
    lifespans: SessionLifespans,
    now: Date,
  ): Promise<boolean>;
  // The third read `/introspect` and token exchange both make: a disabled
  // client's tokens read no differently than a dead grant or a dead
  // session, past this check.
  liveClientLookup: LiveClientLookup;
  // The role set a granted scope reaches, and whether the token's client
  // bypasses that intersection — the same gate token issuance applies, so
  // a role withheld from a token cannot resurface here.
  resolveRoleReach(
    tenantId: string,
    oauthClientId: string,
    scope: readonly string[],
  ): Promise<{ reachableRoleIds: ReadonlySet<string>; fullScopeAllowed: boolean }>;
  // The real request's CORS decision is checked against this one client's
  // own expanded origins, resolved from the access token's `client_id`
  // claim rather than any credential the preflight could have carried.
  resolveClientWebOrigins(tenantId: string, oauthClientId: string): Promise<ReadonlySet<string>>;
  // `null` when the client registered no `userinfo_signed_response_alg` at
  // all, or has none by the time this runs (unknown or disabled client) —
  // both read as "answer in JSON," the response format's default.
  userinfoSignedResponseAlg(tenantId: string, oauthClientId: string): Promise<string | null>;
  // `forAlg` (@odudu/crypto), not the tenant's active key: a client may be
  // registered against an algorithm a *staged* key produces, ahead of that
  // key's own promotion.
  signingKeyForAlg(tenantId: string, alg: 'RS256' | 'ES256'): Promise<SigningKeyRecord | null>;
  // Diagnostic only, read on the mismatch path below to say what a tenant's
  // keys could produce instead.
  algorithmsAvailable(tenantId: string): Promise<readonly string[]>;
  // `'none'` and `'unavailable'` are deliberately not the same value: a
  // client that never registered `userinfo_encrypted_response_alg` reads
  // `'none'` — answer plainly, same as `userinfoSignedResponseAlg`'s
  // `null` above. A disabled client that did register it reads
  // `'unavailable'` — a registration this server cannot currently honour,
  // refused rather than answered.
  userinfoEncryptionTarget(
    tenantId: string,
    oauthClientId: string,
  ): Promise<UserinfoEncryptionLookup>;
  // RFC 7523 §2.2's fetcher for a client's jwks_uri — the same one /token
  // dereferences a private_key_jwt client's key with. Consulted here for
  // the first time on the /userinfo response path; docs/superpowers/p3b-spike-jwe.md's
  // Question 2 measured what a dead jwks_uri costs on it.
  clientKeySet: ClientKeySet;
  kek: Uint8Array;
}

export interface UserinfoEncryptionTarget {
  alg: string;
  enc: string;
  jwks: unknown;
  jwksUri: string | null;
}

export type UserinfoEncryptionLookup =
  { kind: 'none' } | { kind: 'unavailable' } | { kind: 'target'; target: UserinfoEncryptionTarget };

export type UserinfoBody =
  { kind: 'json'; claims: Record<string, unknown> } | { kind: 'jwt'; token: string };

// RFC 8725 §3.11's explicit typing, applied where confusing this response
// with an ID Token hint would matter: `subjectOfIdTokenHint` demands
// `TYP_ABSENT` (see docs/protocols/oidc-core.md's reading note for why "no
// registered typ exists" is not the same claim as "emit none").
export const USERINFO_JWT_TYP = 'userinfo+jwt';

export type UserinfoOutcome =
  | { kind: 'not_found' }
  // No Authorization header at all: RFC 6750 §3.1 SHOULD omits an error
  // code here, distinct from a header that was present but rejected.
  | { kind: 'missing_credentials' }
  // The token arrived by more than one method, or twice by one. RFC 6750
  // §3.1 gives this `invalid_request`, and §3.1's HTTP 400.
  | { kind: 'invalid_request' }
  // `clientId` is `undefined` only for the one refusal reached before the
  // signature verifies (nothing in the payload is trustworthy yet); every
  // other invalid_token — a missing `sub`, a missing or unknown `grant_id`,
  // a revoked grant, a dead session — is reached with a verified, readable
  // `client_id` claim, and carries it so CORS can still answer.
  | { kind: 'invalid_token'; clientId: string | undefined }
  // clientId is set here and on `ok` because both are reached only once the
  // token verifies — it names the client CORS checks the response's origin
  // against; every earlier outcome never got that far.
  | { kind: 'insufficient_scope'; clientId: string | undefined }
  // A client registered `userinfo_signed_response_alg` for an algorithm no
  // non-retired key of this tenant produces — see `view/routes/userinfo.ts`
  // for how this is answered and logged.
  | {
      kind: 'signing_unavailable';
      clientId: string | undefined;
      registeredAlg: string;
      availableAlgs: readonly string[];
    }
  // A client registered `userinfo_encrypted_response_alg` and this response
  // could not be encrypted for it — an unreachable jwks_uri, or a JWKS that
  // names no encryption key unambiguously (see `view/routes/userinfo.ts`
  // for how this is answered and logged). Answering in clear text here
  // would publish exactly what the client asked to have protected, so this
  // is a refusal, never a fallback to `ok`.
  | { kind: 'encryption_unavailable'; clientId: string | undefined; reason: string }
  | { kind: 'ok'; body: UserinfoBody; clientId: string | undefined };

function scopesOf(scopeClaim: unknown): string[] {
  return typeof scopeClaim === 'string'
    ? scopeClaim.split(' ').filter((token) => token.length > 0)
    : [];
}

// `requested_userinfo_claims`: the `claims` parameter's `userinfo` member,
// embedded on the access token by token issuance. Absent reads as empty.
function requestedClaimsOf(claim: unknown): string[] {
  if (!Array.isArray(claim)) return [];
  return claim.filter((value): value is string => typeof value === 'string');
}

// Validation order, matching RFC 9068 §4 and RFC 6750 §3.1: signature and
// `kid` → `typ: at+jwt`, which is what stops an ID Token signed by the same
// key being presented here → `iss` → `exp` → `aud` contains this issuer
// (all inside verifyJwt, whose `audience` option accepts an array `aud`
// containing the issuer rather than matching a bare string) → and only once
// the token is valid, the `openid` scope check: a 403, not the 401 that
// would let a caller distinguish a bad token from a valid one with the
// wrong scope.
export async function resolveUserinfo(
  deps: UserinfoDeps,
  tenantName: string,
  issuer: string,
  authorizationHeader: string | undefined,
  // Whatever a body parser produced for a POST (OIDC Core §5.3); `undefined`
  // for a GET, which has no body to carry a token in.
  body: unknown,
  now: Date,
): Promise<UserinfoOutcome> {
  const tenant = await deps.findTenant(tenantName);
  if (!tenant?.enabled) return { kind: 'not_found' };

  const presented = presentedBearerToken(authorizationHeader, body);
  if (presented.kind === 'ambiguous') return { kind: 'invalid_request' };
  if (presented.kind === 'absent') return { kind: 'missing_credentials' };
  const { token } = presented;

  const keys = await deps.listPublishableKeys(tenant.id);

  let payload;
  try {
    payload = await verifyJwt(token, { keys, issuer, audience: issuer, typ: 'at+jwt' });
  } catch {
    return { kind: 'invalid_token', clientId: undefined };
  }

  const clientId = typeof payload.client_id === 'string' ? payload.client_id : undefined;

  const scope = scopesOf(payload.scope);
  if (!scope.includes('openid')) return { kind: 'insufficient_scope', clientId };

  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    return { kind: 'invalid_token', clientId };
  }

  // A token minted before `grant_id` existed carries none — fail closed
  // rather than skip the check, mirroring `/introspect`.
  const grantId = payload.grant_id;
  if (typeof grantId !== 'string' || grantId.length === 0) {
    return { kind: 'invalid_token', clientId };
  }
  const grant = await deps.loadGrant(tenant.id, grantId);
  if (grant?.revokedAt !== null) return { kind: 'invalid_token', clientId };

  // A disabled client's tokens are read as un-owned, never partially
  // valid — the same failure mode as a revoked grant, checked the same
  // way `/introspect` and token exchange check it.
  if (
    clientId === undefined ||
    !clientIsLive(await deps.liveClientLookup.findLiveClient(tenant.id, clientId))
  ) {
    return { kind: 'invalid_token', clientId };
  }

  // Session liveness is what makes revocation real inside an access
  // token's hour (design spec §8.2) — the same check `/introspect` and
  // refresh rotation make. An `offline_access` grant carries no session
  // (`sid` absent) and must not be reported dead for lacking one.
  const sid = payload.sid;
  const sessionId = typeof sid === 'string' && sid.length > 0 ? sid : null;
  if (sessionId !== null) {
    const lifespans: SessionLifespans = {
      ssoSessionIdleSeconds: tenant.ssoSessionIdleSeconds,
      ssoSessionMaxSeconds: tenant.ssoSessionMaxSeconds,
      rememberMeIdleSeconds: tenant.rememberMeIdleSeconds,
      rememberMeMaxSeconds: tenant.rememberMeMaxSeconds,
    };
    const live = await deps.isSessionLive(tenant.id, sessionId, lifespans, now);
    if (!live) return { kind: 'invalid_token', clientId };
  }

  const ctx = await deps.loadClaimContext(tenant.id, payload.sub);
  // `clientId` is defined from here on: the live-client check above
  // already returned for a token with no readable client_id.
  const { reachableRoleIds, fullScopeAllowed } = await deps.resolveRoleReach(
    tenant.id,
    clientId,
    scope,
  );
  const narrowedCtx: ClaimContext = {
    ...ctx.context,
    roles: narrowByScopeMappings(ctx.context.roles, reachableRoleIds, fullScopeAllowed),
  };
  const assembled = await deps.claimMappers.assemble(scope, narrowedCtx, ctx.bindings);
  // `sub` is kept regardless of what was requested — OIDC Core §5.3.2's own
  // response, not a claim `narrowToRequestedClaims` was ever meant to cut.
  const requested = requestedClaimsOf(payload.requested_userinfo_claims);
  const claims = narrowToRequestedClaims(
    assembled,
    requested.length === 0 ? [] : [...requested, 'sub'],
  );
  const signed = await signedBody(deps, tenant.id, issuer, clientId, claims);
  if (signed.kind === 'mismatch') {
    return {
      kind: 'signing_unavailable',
      clientId,
      registeredAlg: signed.registeredAlg,
      availableAlgs: signed.availableAlgs,
    };
  }

  const encrypted = await encryptedBody(deps, tenant.id, clientId, signed.body);
  if (encrypted.kind === 'unavailable') {
    return { kind: 'encryption_unavailable', clientId, reason: encrypted.reason };
  }
  return { kind: 'ok', body: encrypted.body, clientId };
}

type SignedBodyResult =
  | { kind: 'body'; body: UserinfoBody }
  | { kind: 'mismatch'; registeredAlg: string; availableAlgs: readonly string[] };

// OIDC Core §5.3.2; see "A signed UserInfo response" in
// docs/protocols/oidc-core.md before changing this.
async function signedBody(
  deps: UserinfoDeps,
  tenantId: string,
  issuer: string,
  clientId: string | undefined,
  claims: Record<string, unknown>,
): Promise<SignedBodyResult> {
  if (clientId === undefined) return { kind: 'body', body: { kind: 'json', claims } };

  const alg = await deps.userinfoSignedResponseAlg(tenantId, clientId);
  if (alg === null) return { kind: 'body', body: { kind: 'json', claims } };

  const signedClaims = { ...claims, iss: issuer, aud: clientId };
  if (alg === 'none') {
    return { kind: 'body', body: { kind: 'jwt', token: encodeUnsecuredJwt(signedClaims) } };
  }

  // `parseClientMetadata` (service/client-metadata.ts) never stores
  // anything but 'RS256', 'ES256' or 'none' here, and 'none' is handled
  // above — this is unreachable through the registration door, only
  // through a row written directly (userinfo-signed.int.test.ts's own
  // mismatch fixture).
  if (alg !== 'RS256' && alg !== 'ES256') {
    return {
      kind: 'mismatch',
      registeredAlg: alg,
      availableAlgs: await deps.algorithmsAvailable(tenantId),
    };
  }

  const key = await deps.signingKeyForAlg(tenantId, alg);
  if (key === null) {
    return {
      kind: 'mismatch',
      registeredAlg: alg,
      availableAlgs: await deps.algorithmsAvailable(tenantId),
    };
  }
  const token = await signJwt(signedClaims, { key, kek: deps.kek, typ: USERINFO_JWT_TYP });
  return { kind: 'body', body: { kind: 'jwt', token } };
}

type EncryptedBodyResult =
  { kind: 'body'; body: UserinfoBody } | { kind: 'unavailable'; reason: string };

function asJwks(value: unknown): { keys: unknown[] } | null {
  if (typeof value !== 'object' || value === null) return null;
  const keys = (value as Record<string, unknown>).keys;
  return Array.isArray(keys) ? { keys } : null;
}

// OIDC Core §5.3.2; see "docs/superpowers/p3b-spike-jwe.md" before changing
// this. Never falls back to the unencrypted form on any branch below — see
// `encryption_unavailable` on `UserinfoOutcome` for why.
async function encryptedBody(
  deps: UserinfoDeps,
  tenantId: string,
  clientId: string | undefined,
  body: UserinfoBody,
): Promise<EncryptedBodyResult> {
  if (clientId === undefined) return { kind: 'body', body };

  const lookup = await deps.userinfoEncryptionTarget(tenantId, clientId);
  if (lookup.kind === 'none') return { kind: 'body', body };
  if (lookup.kind === 'unavailable') {
    return { kind: 'unavailable', reason: 'client is disabled' };
  }
  const target = lookup.target;

  let jwks: unknown;
  if (target.jwks !== null) {
    jwks = target.jwks;
  } else if (target.jwksUri !== null) {
    try {
      jwks = await deps.clientKeySet.fetch(target.jwksUri, tenantId);
    } catch (err) {
      return {
        kind: 'unavailable',
        reason: err instanceof Error ? err.message : 'jwks_uri fetch failed',
      };
    }
  } else {
    return { kind: 'unavailable', reason: 'client publishes no keys to encrypt for' };
  }

  const parsed = asJwks(jwks);
  if (parsed === null) {
    return { kind: 'unavailable', reason: 'client keys did not answer with a JWK Set' };
  }

  // No candidate, two equally good ones, or one the filters reject — all
  // three read the same here (docs/superpowers/p3b-spike-jwe.md, "Key
  // selection from a client's JWKS"): an ambiguous or absent choice is not
  // this server's to make silently.
  const key = selectEncryptionKey(parsed, target.alg);
  if (key === null) {
    return { kind: 'unavailable', reason: 'no unambiguous encryption key in the client JWKS' };
  }

  const nested = body.kind === 'jwt';
  const payload = nested ? body.token : JSON.stringify(body.claims);
  try {
    const token = await encryptCompact(payload, key, target.alg, target.enc, { nested });
    return { kind: 'body', body: { kind: 'jwt', token } };
  } catch (err) {
    return {
      kind: 'unavailable',
      reason: err instanceof Error ? err.message : 'encryption failed',
    };
  }
}
