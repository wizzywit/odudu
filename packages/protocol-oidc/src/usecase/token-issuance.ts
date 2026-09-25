import { sessionRepository, type SessionLifespans } from '@odudu/authn-flows';
import {
  signJwt,
  signingKeyRepository,
  verifyJwtAgainstJwkSet,
  type SigningKeyRecord,
} from '@odudu/crypto';
import { withTenant, type DatabaseHandle, type TenantScopedDatabase } from '@odudu/db';
import { subjectRepository } from '@odudu/domain-identity';
import { clientRepository, clientScopeRepository, type ClientRecord } from '@odudu/domain-tenant';
import { type ClaimMapperRegistry, type Clock, newId } from '@odudu/kernel';
import { assertionJtiRepository } from '#/repository/assertion-jti';
import { type ClientKeySet } from '#/repository/client-keys';
import { clientOidcConfigRepository, type ClientOidcConfig } from '#/repository/client-oidc-config';
import { authorizationCodeRepository } from '#/repository/codes';
import { tokenGrantRepository, type TokenGrantRecord } from '#/repository/grants';
import { refreshTokenRepository } from '#/repository/refresh';
import { accessTokenEligibleScope, reachableRoleIds } from '#/repository/scope-role-reach';
import { rotateRefreshToken } from '#/usecase/refresh-rotation';
import { acrFor, amrFor } from '#/service/acr';
import { hashAuthorizationCode } from '#/service/authorization-code';
import { evaluateAuthorizationCodeGrant } from '#/service/authorization-code-grant';
import { parseClientAssertion, type AssertionOutcome } from '#/service/client-assertion';
import {
  type ClaimContext,
  type LoadedClaimContext,
  narrowToRequestedClaims,
} from '#/service/claims';
import { evaluateClientCredentialsGrant } from '#/service/client-credentials-grant';
import {
  invalidClient,
  invalidGrant,
  invalidRequest,
  invalidScope,
  invalidTarget,
  unauthorizedClient,
  unsupportedGrantType,
} from '#/service/errors';
import { evaluateRefreshGrant, generateRefreshToken, hashRefreshToken } from '#/service/refresh';
import { parseResource } from '#/service/resource-indicator';
import { resolveScope } from '#/service/scope';
import { narrowByScopeMappings } from '#/service/scope-mapping';
import {
  attenuateScope,
  buildActChain,
  mayActPermits,
  narrowActClaim,
  parseTokenType,
  resolveExchangeAudience,
  TOKEN_EXCHANGE_GRANT,
  type ActClaim,
  type ExchangeTokenType,
} from '#/service/token-exchange';
import { withRegisteredClaimsWinning } from '#/service/token-claims';
import { tlsClientAuthSubjectMatches, tlsClientSubject } from '#/service/tls-client-auth';
import {
  authenticateClient,
  parseBasicAuth,
  readOptionalField,
  WWW_AUTHENTICATE,
  type ClientAuthenticationDeps,
} from '#/usecase/client-authentication';
import { resolveExchangeToken, type ResolveDeps } from '#/usecase/token-exchange-subject';

// Re-exported so the view layer can name it without reaching into
// repository directly (dependency-cruiser's no-view-to-repository rule) —
// view/routes/token.ts is the one caller.
export type { ClientKeySet } from '#/repository/client-keys';

export interface TokenIssuanceDeps extends ClientAuthenticationDeps {
  // Used only to run a step in its own, independently committed
  // transaction: the enclosing `tx` this call runs in is always rolled
  // back once it throws, and both the authorization_code grant's
  // replay-revocation and the refresh_token grant's rotation are exactly
  // the kind of side effect that must survive that rollback.
  database: DatabaseHandle;
  issuer: string;
  kek: Uint8Array;
  clock: Clock;
  // The tenant's own lifespan pair — the same one /authorize's
  // resolveSessions checks a browser's sessions against — so a
  // session-bound refresh dies exactly when the session it is bound to
  // would, ordinary or remembered alike (refresh-rotation.ts).
  lifespans: SessionLifespans;
  // Shared with /userinfo: the ID token's claims beyond the envelope
  // (`iss`/`aud`/`iat`/`exp`/`nonce`/`auth_time`) come from the same
  // registry, so a claim present in one can never be missing from the
  // other for the same subject and scope.
  claimMappers: ClaimMapperRegistry<ClaimContext>;
  loadClaimContext(tenantId: string, subjectId: string): Promise<LoadedClaimContext>;
  // RFC 7523 §2.2's fetcher for a client's jwks_uri — the dereference
  // `usecase/client-registration.ts` deliberately never performs (P3a
  // reverted that). private_key_jwt authentication is the one caller.
  // No safe default: a caller with no opinion says so explicitly with
  // `NO_CLIENT_KEY_FETCHER` (`#/repository/client-keys.ts`) rather than
  // this package silently choosing on its behalf — the same reasoning as
  // `clientSecretLimiter` above.
  clientKeySet: ClientKeySet;
  // Where a private_key_jwt refusal's real cause goes — the caller sees
  // one invalid_client whatever it was; see
  // authenticatePrivateKeyJwt below.
  logger: AssertionLogger;
  // Gates tls_client_auth exactly the way it already gates Fastify's own
  // `X-Forwarded-*` trust (apps/server/src/app.ts) — the proxy-supplied
  // certificate-subject header is exactly as forgeable as those, so it is
  // read only when an operator has said something in front of this
  // process controls it. See authenticateTlsClientAuth below.
  trustProxy: boolean;
  // `ODUDU_TLS_CLIENT_CERT_HEADER` — no deployment's reverse proxy agrees
  // on a name for this (nginx, Envoy, Apache and HAProxy each use a
  // different one), so it is never a constant here.
  tlsClientCertHeader: string;
}

export interface AssertionLogger {
  warn(details: Record<string, unknown>, message: string): void;
}

export interface TokenResponse {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  // RFC 8693 §2.2.1: 'N_A' when the issued token named in `access_token`
  // above is not itself an access token — an id_token or a refresh_token
  // exchange, neither of which is a bearer credential of the kind this
  // names.
  token_type: 'Bearer' | 'N_A';
  expires_in: number;
  scope: string;
  // RFC 8693 §2.2.1: names what `access_token` actually holds on an
  // exchange response — an access token is not the only thing that field
  // can carry there. Absent from every other grant's response.
  issued_token_type?: string;
}

// Stage 1: structural validation. What's genuinely malformed — no
// grant_type, an authorization_code request missing `code`/`redirect_uri`,
// or a refresh_token request missing `refresh_token` — is `invalid_request`
// here. `code_verifier`'s presence is a PKCE rule (RFC 7636 §4.5), not
// shape, so its absence is left to stage 3, which reports it exactly like
// any other PKCE failure: `invalid_grant`, per ADR 0007's split between
// structure at the boundary and rules in a service.
type StructuredRequest =
  | {
      grantType: 'authorization_code';
      code: string;
      redirectUri: string;
      clientId: string | undefined;
      codeVerifier: string;
      resource: string | string[] | undefined;
    }
  | {
      grantType: 'refresh_token';
      refreshToken: string;
      clientId: string | undefined;
      scope: string;
      resource: string | string[] | undefined;
    }
  | {
      grantType: 'client_credentials';
      clientId: string | undefined;
      scope: string;
      resource: string | string[] | undefined;
    }
  | {
      grantType: typeof TOKEN_EXCHANGE_GRANT;
      clientId: string | undefined;
      subjectToken: string;
      subjectTokenType: string;
      actorToken: string | undefined;
      actorTokenType: string | undefined;
      requestedTokenType: string | undefined;
      scope: string;
      resource: string | string[] | undefined;
      audience: string | string[] | undefined;
    };

function readField(body: Record<string, string | string[] | undefined>, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value : '';
}

// RFC 8707 §2's whole rule is "reject two values", so a multi-valued
// parameter cannot be folded down to one string the way `readField` folds
// every other parameter — the same reason /authorize's own `resourceParam`
// (usecase/authorization-request.ts) reads it off the raw query instead of
// the normalized params. `body` already carries this shape, so there is no
// raw query to read here; only the empty-value and repeat-collapsing rules
// need restating. Shared by `resource` (RFC 8707 §2) and, for token
// exchange, `audience` (RFC 8693 §2.1), which collapses identically.
function readMultiField(
  body: Record<string, string | string[] | undefined>,
  key: string,
): string | string[] | undefined {
  const raw = body[key];
  const sent = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  const present = sent.filter((entry) => entry !== '');
  return present.length > 1 ? present : present[0];
}

function readResourceField(
  body: Record<string, string | string[] | undefined>,
): string | string[] | undefined {
  return readMultiField(body, 'resource');
}

export function parseStructure(
  body: Record<string, string | string[] | undefined>,
): StructuredRequest {
  const grantType = readField(body, 'grant_type');
  if (grantType.length === 0) throw invalidRequest();

  if (grantType === 'authorization_code') {
    const code = readField(body, 'code');
    const redirectUri = readField(body, 'redirect_uri');
    if (code.length === 0 || redirectUri.length === 0) throw invalidRequest();
    return {
      grantType,
      code,
      redirectUri,
      clientId: readOptionalField(body, 'client_id'),
      codeVerifier: readField(body, 'code_verifier'),
      resource: readResourceField(body),
    };
  }

  if (grantType === 'refresh_token') {
    const refreshToken = readField(body, 'refresh_token');
    if (refreshToken.length === 0) throw invalidRequest();
    return {
      grantType,
      refreshToken,
      clientId: readOptionalField(body, 'client_id'),
      scope: readField(body, 'scope'),
      resource: readResourceField(body),
    };
  }

  if (grantType === 'client_credentials') {
    return {
      grantType,
      clientId: readOptionalField(body, 'client_id'),
      scope: readField(body, 'scope'),
      resource: readResourceField(body),
    };
  }

  if (grantType === TOKEN_EXCHANGE_GRANT) {
    const subjectToken = readField(body, 'subject_token');
    const subjectTokenType = readField(body, 'subject_token_type');
    if (subjectToken.length === 0 || subjectTokenType.length === 0) throw invalidRequest();
    const actorToken = readOptionalField(body, 'actor_token');
    const actorTokenType = readOptionalField(body, 'actor_token_type');
    // RFC 8693 §2.1 makes actor_token_type REQUIRED whenever actor_token is
    // present.
    if (actorToken !== undefined && actorTokenType === undefined) throw invalidRequest();
    return {
      grantType,
      clientId: readOptionalField(body, 'client_id'),
      subjectToken,
      subjectTokenType,
      actorToken,
      actorTokenType,
      requestedTokenType: readOptionalField(body, 'requested_token_type'),
      scope: readField(body, 'scope'),
      resource: readResourceField(body),
      audience: readMultiField(body, 'audience'),
    };
  }

  throw unsupportedGrantType();
}

// Stage 3: the authorization_code grant. `consume` is one atomic UPDATE, so
// the database — not a check-then-set race — decides which of two
// concurrent redemptions wins. The grant rules themselves (client match,
// redirect_uri match, PKCE) are `evaluateAuthorizationCodeGrant`, which
// runs no queries; this usecase only loads, consumes and, on failure,
// revokes. Every way it can fail converges on the same `invalid_grant`, so
// a caller probing them cannot learn which check failed (RFC 6749 §5.2).
async function redeemAuthorizationCode(
  tx: TenantScopedDatabase,
  deps: TokenIssuanceDeps,
  request: Extract<StructuredRequest, { grantType: 'authorization_code' }>,
  client: ClientRecord,
) {
  const codeHash = hashAuthorizationCode(request.code);
  const record = await authorizationCodeRepository(tx).consume(codeHash);
  if (record === null) {
    // Could be unknown, expired, or already redeemed once — all report the
    // same invalid_grant below. Only the last of those (replay) also has a
    // grant to revoke (RFC 6749 §4.1.2 SHOULD): a read-only lookup, never
    // part of the decision that already rejected this call above.
    const existing = await authorizationCodeRepository(tx).byHash(codeHash);
    const grantId = existing?.grantId;
    if (grantId !== null && grantId !== undefined) {
      const revokedAt = deps.clock.now();
      await withTenant(deps.database.db, deps.tenantId, (revokeTx) =>
        tokenGrantRepository(revokeTx).revoke(grantId, revokedAt),
      );
    }
    throw invalidGrant();
  }

  const decision = evaluateAuthorizationCodeGrant(record, client, {
    redirectUri: request.redirectUri,
    codeVerifier: request.codeVerifier,
  });
  if (!decision.ok) throw invalidGrant();

  return record;
}

// RFC 8707 §2 at /token: what a request's `resource` narrows `base` to.
// `base` is the ceiling each caller already resolved — a code's stored
// `resource`, a rotated grant's `audience`, or a codeless
// client_credentials grant's `audiences` — never `config.audiences` once
// one of those has narrowed it. No `resource` keeps `base` verbatim, empty
// or not (an empty `base` is a resolved empty audience, not "unset"). A
// named `resource` must be found in `base`; empty is one way not to be.
function resolveAudience(
  base: readonly string[],
  requestedResource: string | string[] | undefined,
): string[] {
  const outcome = parseResource(requestedResource, base);
  if (outcome.kind === 'invalid_target') throw invalidTarget();
  return [...outcome.audience];
}

// Stages 5-6, shared by every grant: sign an access token bound to `sub`
// and `scope`. The audience is the issuer itself, plus the audience the
// caller has already resolved via `resolveAudience` — the issuer is never
// dropped in favor of it, since a token that cannot be used at the
// issuer's own endpoints (e.g. /userinfo) would be unusable for anything
// OIDC promised the client (RFC 9068 §4: a resource server, including
// this one, must find itself in `aud` or refuse the token).
async function mintAccessToken(
  deps: TokenIssuanceDeps,
  input: {
    subjectId: string;
    clientId: string;
    scope: string[];
    config: ClientOidcConfig;
    // The resolved audience this token is bound to, before the issuer is
    // appended — see `resolveAudience`, which every caller runs before
    // reaching here.
    audience: readonly string[];
    // Resolved once per issuance by the caller — see loadClaimContext's own
    // doc comment for why a claim mapper never resolves this itself.
    claimContext: LoadedClaimContext;
    reachableRoleIds: ReadonlySet<string>;
    fullScopeAllowed: boolean;
    // The subset of `scope` that `client_scopes.include_in_access_token`
    // actually admits — not every granted scope, or an access token bound
    // for a resource server named in `aud` would carry the end-user's
    // profile and email by default (RFC 9068 §2.2 draws no line here; the
    // tenant's own scope definitions do).
    accessTokenScope: string[];
    // The grant's session, if it has one — see the `sid` comment below.
    sessionId: string | null;
    // The id the caller has already generated for the grant this token
    // belongs to — see the `grant_id` comment below.
    grantId: string;
    // The `claims` parameter's `userinfo` member, embedded so `/userinfo`
    // (no code left to consult) can narrow the same way. Absent for a
    // grant not minted from a code.
    requestedUserinfoClaims?: readonly string[];
    // RFC 8693 §4.4's delegation chain, present only for a token-exchange
    // grant that named an actor. Never derived here — the caller resolves
    // it via `buildActChain` before this function ever runs.
    act?: ActClaim;
    // An exchange may not lengthen the credential it was handed; every
    // other grant mints from one the client already owns and passes no
    // ceiling, so `exp` is never capped for them.
    expCeiling?: Date;
  },
  key: SigningKeyRecord,
  now: Date,
): Promise<{ accessToken: string; audience: string[]; iat: number; exp: number }> {
  const iat = Math.floor(now.getTime() / 1000);
  const ttlExp = iat + input.config.accessTokenTtlSeconds;
  const ceiling =
    input.expCeiling === undefined ? ttlExp : Math.floor(input.expCeiling.getTime() / 1000);
  const exp = Math.min(ttlExp, ceiling);
  const audience = input.audience.includes(deps.issuer)
    ? [...input.audience]
    : [...input.audience, deps.issuer];

  const narrowedContext: ClaimContext = {
    ...input.claimContext.context,
    roles: narrowByScopeMappings(
      input.claimContext.context.roles,
      input.reachableRoleIds,
      input.fullScopeAllowed,
    ),
  };
  const mapped = await deps.claimMappers.assemble(
    input.accessTokenScope,
    narrowedContext,
    input.claimContext.bindings,
  );

  const accessTokenClaims = withRegisteredClaimsWinning(mapped, {
    iss: deps.issuer,
    sub: input.subjectId,
    aud: audience,
    client_id: input.clientId,
    scope: input.scope.join(' '),
    iat,
    exp,
    jti: newId(),
    // OpenID Connect Back-Channel Logout 1.0 §2.1: an opaque identifier for
    // the End-User's session at this OP. Emitted so a resource server's
    // introspection, and later a logout addressed to a client, can both
    // name the session; absent on an offline grant, which has none.
    ...(input.sessionId !== null ? { sid: input.sessionId } : {}),
    // Odudu-private: the token_grants row's own id, generated by the
    // caller before this function runs. `jti` cannot stand in for it — a
    // fresh id per token, independent of the grant a refresh reuses — and
    // no combination of the other claims identifies one row uniquely. See
    // docs/protocols/rfc9068.md's reading note on private claims.
    grant_id: input.grantId,
    ...(input.requestedUserinfoClaims !== undefined && input.requestedUserinfoClaims.length > 0
      ? { requested_userinfo_claims: input.requestedUserinfoClaims }
      : {}),
    ...(input.act === undefined ? {} : { act: input.act }),
  });
  const accessToken = await signJwt(accessTokenClaims, { key, kek: deps.kek, typ: 'at+jwt' });
  return { accessToken, audience, iat, exp };
}

async function issueAuthorizationCodeTokens(
  tx: TenantScopedDatabase,
  deps: TokenIssuanceDeps,
  request: Extract<StructuredRequest, { grantType: 'authorization_code' }>,
  client: ClientRecord,
  config: ClientOidcConfig,
): Promise<TokenResponse> {
  const code = await redeemAuthorizationCode(tx, deps, request, client);

  // Stage 4: scope resolution against the scopes this client is assigned
  // now, not the ones it held when /authorize accepted the request — an
  // assignment withdrawn in between narrows the tokens the code redeems.
  const assigned = await clientScopeRepository(tx).forClient(client.id);
  const scope = resolveScope(
    code.scope,
    assigned.map((clientScope) => clientScope.name),
    null,
    null,
  );
  const now = deps.clock.now();
  const key = await signingKeyRepository(tx).active();

  // Loaded once per issuance and shared by the access token below and the
  // ID token that follows it — see loadClaimContext's own doc comment.
  const claimContext = await deps.loadClaimContext(deps.tenantId, code.subjectId);
  const reachable = await reachableRoleIds(tx, scope);
  const accessTokenScope = await accessTokenEligibleScope(tx, scope);

  // `offline_access` asks for a grant no session bounds (OpenID Connect
  // Back-Channel Logout 1.0 §2.7): whatever session the code carries is
  // dropped for this grant, its access token and its ID token alike. The
  // *resolved* scope decides this, never the raw request — a client
  // without the scope assigned gets it stripped by resolveScope above, and
  // sees an ordinary session-bound grant.
  const sessionId = scope.includes('offline_access') ? null : code.sessionId;

  // RFC 8707 §2: `/token` may narrow what `/authorize` already resolved
  // onto the code, and may never widen it — `code.resource` is the
  // ceiling, not `config.audiences`, which a client's registered list
  // could since have grown past what this code was ever authorized for.
  const resolvedAudience = resolveAudience(code.resource, request.resource);

  // Generated ahead of the grant row itself so the same id can be signed
  // into the access token below and passed to `create` afterward — the
  // `grant_id` comment on `mintAccessToken` explains why.
  const grantId = newId();

  const { accessToken, audience, iat, exp } = await mintAccessToken(
    deps,
    {
      subjectId: code.subjectId,
      clientId: client.clientId,
      scope,
      config,
      audience: resolvedAudience,
      claimContext,
      reachableRoleIds: reachable,
      fullScopeAllowed: client.fullScopeAllowed,
      accessTokenScope,
      sessionId,
      grantId,
      requestedUserinfoClaims: Object.keys(code.claims.userinfo),
    },
    key,
    now,
  );

  // The ID token's audience is the client itself — RFC 9068 §2.2 vs. OIDC
  // Core §2, the distinction the access token's `typ` header alone cannot
  // carry.
  let idToken: string | undefined;
  if (scope.includes('openid')) {
    // A scope granted on the request reaches the ID token only if its own
    // definition says so (`client_scopes.include_in_id_token`) — `roles`
    // and `groups` ship with that off, since the ID token reaches the
    // browser and a client cannot opt out of what lands there.
    const idTokenScope = assigned
      .filter((clientScope) => scope.includes(clientScope.name) && clientScope.includeInIdToken)
      .map((clientScope) => clientScope.name);
    const narrowedContext: ClaimContext = {
      ...claimContext.context,
      roles: narrowByScopeMappings(claimContext.context.roles, reachable, client.fullScopeAllowed),
    };
    // The same claim mapper registry /userinfo assembles from — `sub`
    // arrives through it too, so there is exactly one place that decides
    // what a subject's `openid`/`profile`/`email` scopes produce, not one
    // for the ID token and a second for /userinfo.
    const assembledClaims = await deps.claimMappers.assemble(
      idTokenScope,
      narrowedContext,
      claimContext.bindings,
    );
    // `auth_time` never comes from `standardClaimMappers` (the envelope
    // sets it below), so it is excluded here — otherwise a `max_age`-only
    // request, naming nothing else, would narrow away every other claim.
    const requestedIdTokenClaims = Object.keys(code.claims.idToken).filter(
      (name) => name !== 'auth_time',
    );
    const userClaims = narrowToRequestedClaims(assembledClaims, requestedIdTokenClaims);
    // What actually authenticated this login, read off the session the
    // code's own login established (or, for a reused session, established
    // originally) — `amr`/`acr` state what ran, never what the subject
    // could have used instead, the reason a subject who could use a
    // passkey but signed in with a password must not get `hwk` in the
    // token. `code.sessionId`, not the offline-nulled local `sessionId`,
    // because `amr`/`acr` describe the authentication, not the grant's
    // session binding.
    const authenticators =
      code.sessionId !== null
        ? ((await sessionRepository(tx).byId(code.sessionId))?.authenticators ?? [])
        : [];
    const amr = amrFor(authenticators);
    const acr = acrFor(authenticators);
    // Guarded the same way the access token's assembly is, 83 lines above:
    // a mapper's output can never overwrite the envelope, `sub` included —
    // `subMapper` reaches its `sub` claim through the same registry.
    const idTokenClaims = withRegisteredClaimsWinning(userClaims, {
      iss: deps.issuer,
      sub: code.subjectId,
      aud: client.clientId,
      iat,
      exp,
      // OIDC Core §2/§15.1: required for an Essential Claim or a `max_age`
      // request, both folded into this one flag at /authorize — otherwise
      // left out (authorization-request.ts's `claims` synthesis).
      ...(code.claims.idToken.auth_time?.essential === true
        ? { auth_time: Math.floor(code.authTime.getTime() / 1000) }
        : {}),
      ...(code.nonce !== null ? { nonce: code.nonce } : {}),
      ...(sessionId !== null ? { sid: sessionId } : {}),
      ...(amr.length > 0 ? { amr } : {}),
      ...(acr !== null ? { acr } : {}),
    });
    idToken = await signJwt(idTokenClaims, { key, kek: deps.kek });
  }

  // Persist the grant and bind the code's redemption to it — the anchor a
  // future revocation call, or a refresh token, points back at. The
  // session travels from the code, which is where the login that minted it
  // recorded one, unless the resolved scope asked for an offline grant.
  const grant = await tokenGrantRepository(tx).create({
    id: grantId,
    tenantId: deps.tenantId,
    clientId: client.id,
    subjectId: code.subjectId,
    scope: scope.join(' '),
    audience,
    sessionId,
  });
  await authorizationCodeRepository(tx).attachGrant(code.codeHash, grant.id);

  // A refresh token is meaningless without an interactive grant to
  // originate from — client_oidc_config's own check constraint requires a
  // redirect_uri wherever `refresh_token` appears in `grant_types` for
  // exactly this reason — so it is issued only for a client actually
  // configured for it, never unconditionally.
  let refreshToken: string | undefined;
  if (config.grantTypes.includes('refresh_token')) {
    refreshToken = generateRefreshToken();
    await refreshTokenRepository(tx).create({
      tokenHash: hashRefreshToken(refreshToken),
      tenantId: deps.tenantId,
      grantId: grant.id,
      expiresAt: new Date(now.getTime() + config.refreshTokenTtlSeconds * 1000),
    });
  }

  return {
    access_token: accessToken,
    ...(idToken !== undefined ? { id_token: idToken } : {}),
    ...(refreshToken !== undefined ? { refresh_token: refreshToken } : {}),
    token_type: 'Bearer',
    expires_in: config.accessTokenTtlSeconds,
    scope: scope.join(' '),
  };
}

// The grant rules for `refresh_token`, decided from the presented token
// before anything is rotated. Nothing here writes: it can refuse the
// request, never admit it, which is why running it ahead of the atomic
// single-use consume costs that consume none of its authority. Deciding
// only *after* rotation let any authenticated client burn another's token —
// ADR 0019.
async function evaluatePresentedRefreshToken(
  tx: TenantScopedDatabase,
  request: Extract<StructuredRequest, { grantType: 'refresh_token' }>,
  client: ClientRecord,
  presentedHash: string,
): Promise<void> {
  const presented = await refreshTokenRepository(tx).byHash(presentedHash);
  // Unknown here and unknown to the rotation below are the same
  // `invalid_grant`; the rotation is skipped because there is nothing to
  // rotate, not because this is a different answer.
  if (presented === null) throw invalidGrant();

  const grant = await tokenGrantRepository(tx).byId(presented.grantId);
  if (grant === null) throw invalidGrant();

  const subject = await subjectRepository(tx).byId(grant.subjectId);
  if (subject === null) throw invalidGrant();

  const decision = evaluateRefreshGrant(grant, client, subject, { requestedScope: request.scope });
  if (!decision.ok) {
    throw decision.reason === 'scope_widened' ? invalidScope() : invalidGrant();
  }

  // Repeated after rotation (line ~680 below), where it stays the
  // authoritative check — the comment above `issueRefreshTokens` explains
  // why that copy cannot move earlier. This one only needs to be right
  // often enough to refuse before the presented token is consumed; a
  // revocation landing between the two reads is still caught there.
  resolveAudience(grant.audience, request.resource);
}

// Stage 3 (and everything after) for `refresh_token`. Rotation runs in its
// own transaction via `withTenant`, because reuse detection and family
// revocation must survive a request ending in `invalid_grant`, which rolls
// the enclosing `tx` back. Everything after it is read-only against settled
// state. The grant decision taken here is the one that governs — it reads
// the grant inside the transaction that rotated the token, where the
// earlier one (ADR 0019) could not see a revocation landing between them.
async function issueRefreshTokens(
  tx: TenantScopedDatabase,
  deps: TokenIssuanceDeps,
  request: Extract<StructuredRequest, { grantType: 'refresh_token' }>,
  client: ClientRecord,
  config: ClientOidcConfig,
): Promise<TokenResponse> {
  const now = deps.clock.now();
  const presentedHash = hashRefreshToken(request.refreshToken);

  await evaluatePresentedRefreshToken(tx, request, client, presentedHash);

  const outcome = await withTenant(deps.database.db, deps.tenantId, (rotationTx) =>
    rotateRefreshToken(
      rotationTx,
      presentedHash,
      now,
      config.refreshTokenTtlSeconds,
      deps.lifespans,
    ),
  );
  if (outcome.kind !== 'rotated') throw invalidGrant();

  const grant: TokenGrantRecord = outcome.grant;
  const subject = await subjectRepository(tx).byId(grant.subjectId);
  if (subject === null) throw invalidGrant();

  const decision = evaluateRefreshGrant(grant, client, subject, { requestedScope: request.scope });
  if (!decision.ok) {
    throw decision.reason === 'scope_widened' ? invalidScope() : invalidGrant();
  }

  const scope = [...decision.scope];
  const key = await signingKeyRepository(tx).active();
  const claimContext = await deps.loadClaimContext(deps.tenantId, grant.subjectId);
  const reachable = await reachableRoleIds(tx, scope);
  const accessTokenScope = await accessTokenEligibleScope(tx, scope);

  // RFC 8707 §2: a refresh derives its ceiling from the grant it rotated,
  // never from `config.audiences` — the grant is what a `resource` at the
  // original redemption already may have narrowed, and re-deriving from
  // the client's current configured list would let a wider audience back
  // in on the next refresh after that redemption deliberately narrowed it.
  // A `resource` on this request may narrow `grant.audience` further, and,
  // by the same rule as the authorization_code path, may never widen it.
  const resolvedAudience = resolveAudience(grant.audience, request.resource);

  // RFC 8693 §4.4 / schema/token-grants.ts's own comment on the columns: a grant this
  // table wrote for an ordinary authorization_code or client_credentials
  // redemption carries neither, and every access token this branch has
  // ever minted before token-exchange existed passed neither field either
  // — so an ordinary refresh is completely unaffected by both columns
  // existing. An exchanged grant's rotation is the one case where both are
  // reapplied, rather than silently dropped: the delegation this credential
  // was minted to record, and the ceiling it was minted never to outlive.
  const act = narrowActClaim(grant.actChain) ?? undefined;
  const expCeiling = grant.expCeiling ?? undefined;

  const { accessToken, iat, exp } = await mintAccessToken(
    deps,
    {
      subjectId: grant.subjectId,
      clientId: client.clientId,
      scope,
      config,
      audience: resolvedAudience,
      claimContext,
      reachableRoleIds: reachable,
      fullScopeAllowed: client.fullScopeAllowed,
      accessTokenScope,
      sessionId: grant.sessionId,
      // The rotated grant's own id — stable across every refresh, unlike
      // `jti`, which is why revocation and introspection can still name
      // this grant after several rotations.
      grantId: grant.id,
      ...(act === undefined ? {} : { act }),
      ...(expCeiling === undefined ? {} : { expCeiling }),
    },
    key,
    now,
  );

  return {
    access_token: accessToken,
    refresh_token: outcome.next,
    token_type: 'Bearer',
    expires_in: exp - iat,
    scope: scope.join(' '),
  };
}

// Stage 3 (and everything after) for `client_credentials`. No PKCE, no
// redirect_uri, no session and no human: `sub` is the client's own
// service-account subject, so there is no refresh token (nothing to avoid
// re-involving) and no ID token (nobody authenticated).
async function issueClientCredentialsTokens(
  tx: TenantScopedDatabase,
  deps: TokenIssuanceDeps,
  request: Extract<StructuredRequest, { grantType: 'client_credentials' }>,
  client: ClientRecord,
  config: ClientOidcConfig,
): Promise<TokenResponse> {
  const decision = evaluateClientCredentialsGrant(client, config.clientCredentialsScopes, {
    requestedScope: request.scope,
  });
  if (!decision.ok) {
    if (decision.reason === 'not_confidential') throw invalidClient(WWW_AUTHENTICATE);
    if (decision.reason === 'no_service_subject') throw unauthorizedClient();
    throw invalidScope();
  }

  // `evaluateClientCredentialsGrant` already refused a client with no
  // service_subject_id, so this is a plain non-null read here.
  const serviceSubjectId = client.serviceSubjectId;
  if (serviceSubjectId === null) throw unauthorizedClient();

  const scope = [...decision.scope];
  const now = deps.clock.now();
  const key = await signingKeyRepository(tx).active();
  const claimContext = await deps.loadClaimContext(deps.tenantId, serviceSubjectId);
  const reachable = await reachableRoleIds(tx, scope);
  const accessTokenScope = await accessTokenEligibleScope(tx, scope);

  // RFC 8707 §2: no code and no prior grant here, so the ceiling `resource`
  // may narrow is the client's own configured `audiences` — the same base
  // /authorize's `parseResource` resolves a code's `resource` from when the
  // request carries none.
  const resolvedAudience = resolveAudience(config.audiences, request.resource);

  // Every client_credentials issuance for this client shares `subjectId`
  // (its stable `service_subject_id`) and `sessionId` (always null) — this
  // id is the only thing that ever distinguishes one such grant from
  // another. See the `grant_id` comment on `mintAccessToken`.
  const grantId = newId();

  const { accessToken, audience } = await mintAccessToken(
    deps,
    {
      subjectId: serviceSubjectId,
      clientId: client.clientId,
      scope,
      config,
      audience: resolvedAudience,
      claimContext,
      reachableRoleIds: reachable,
      fullScopeAllowed: client.fullScopeAllowed,
      accessTokenScope,
      // client_credentials authenticates no End-User, so there is no
      // session for a grant here to carry.
      sessionId: null,
      grantId,
    },
    key,
    now,
  );

  await tokenGrantRepository(tx).create({
    id: grantId,
    tenantId: deps.tenantId,
    clientId: client.id,
    subjectId: serviceSubjectId,
    scope: scope.join(' '),
    audience,
  });

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: config.accessTokenTtlSeconds,
    scope: scope.join(' '),
  };
}

// `claimedClientId`, not `clientId`: nothing here is verified until a
// signature check passes, so the log names it for what it is — the
// assertion's own say-so — the same distinction `client-assertion.ts` draws
// in `AssertionOutcome`'s own doc comment. Shared by `authenticatePrivateKeyJwt`
// below and `issueTokens`'s own both-methods-presented refusal, so that
// refusal — upstream of the eight branches below and not one of them — logs
// a reason too, instead of being the one assertion refusal that doesn't.
function refusePrivateKeyJwt(
  deps: TokenIssuanceDeps,
  reason: string,
  claimedClientId?: string,
): never {
  deps.logger.warn(
    { reason, ...(claimedClientId !== undefined ? { claimedClientId } : {}) },
    'private_key_jwt authentication refused',
  );
  throw invalidClient(WWW_AUTHENTICATE);
}

// RFC 7523 §2.2 / OIDC Core §9's `private_key_jwt`. Every failure reports
// the same `invalid_client`, verification runs before the jti is ever
// claimed, and the timing residual that leaves open is stated rather than
// hidden — see docs/protocols/rfc7523.md's reading notes for why each of
// those holds. The specific reason goes to `deps.logger`; only an operator
// reads it.
async function authenticatePrivateKeyJwt(
  tx: TenantScopedDatabase,
  deps: TokenIssuanceDeps,
  outcome: Exclude<AssertionOutcome, { kind: 'unsupported' }>,
  tokenEndpoint: string,
): Promise<{ client: ClientRecord; config: ClientOidcConfig }> {
  const fail = (reason: string): never =>
    refusePrivateKeyJwt(deps, reason, outcome.kind === 'ok' ? outcome.claimedClientId : undefined);

  if (outcome.kind !== 'ok') return fail('assertion failed structural validation');

  const client = await clientRepository(tx).byClientId(outcome.claimedClientId);
  if (client === null) return fail('unknown client');
  // `authenticateClient`'s password path gets this only incidentally, inside
  // `verifyClientSecret` (packages/domain-tenant/src/service/client.ts) —
  // this path calls no such function, so a disabled client must be refused
  // here explicitly or the operator's one revocation lever does nothing to
  // a private_key_jwt client.
  if (!client.enabled) return fail('client is disabled');

  const config = await clientOidcConfigRepository(tx).byClientId(client.id);
  if (config?.tokenEndpointAuthMethod !== 'private_key_jwt') {
    return fail('client is not registered for private_key_jwt');
  }

  let jwks: unknown;
  if (config.jwks !== null) {
    jwks = config.jwks;
  } else if (config.jwksUri !== null) {
    try {
      jwks = await deps.clientKeySet.fetch(config.jwksUri, deps.tenantId);
    } catch (err) {
      return fail(err instanceof Error ? err.message : 'jwks_uri fetch failed');
    }
  } else {
    return fail('client publishes no keys');
  }

  const verified = await verifyJwtAgainstJwkSet(outcome.assertion, jwks, {
    issuer: outcome.claimedClientId,
    audience: tokenEndpoint,
    now: deps.clock.now(),
  });
  if (!verified) return fail('assertion signature did not verify');

  const claimed = await assertionJtiRepository(deps.database).claim(
    deps.tenantId,
    outcome.claimedClientId,
    outcome.jti,
    outcome.expiresAt,
  );
  if (!claimed) return fail('jti already spent');

  return { client, config };
}

// Shares `refusePrivateKeyJwt`'s shape (same log message pattern, same
// single invalid_client) rather than its function: the two methods refuse
// for entirely different reasons, and folding them into one function would
// make a future change to one method's logging silently change the
// other's too.
function refuseTlsClientAuth(
  deps: TokenIssuanceDeps,
  reason: string,
  claimedClientId?: string,
): never {
  deps.logger.warn(
    { reason, ...(claimedClientId !== undefined ? { claimedClientId } : {}) },
    'tls_client_auth authentication refused',
  );
  throw invalidClient(WWW_AUTHENTICATE);
}

// RFC 8705 §2.1's PKI mutual-TLS method, proxy-terminated
// (`tls-client-auth.ts` has the deployment shape). Seven preconditions,
// each checked here explicitly rather than assumed: a client_id was
// presented, the client is known, enabled, confidential, registered for
// this method, a registered subject exists, and it matches. `enabled` in
// particular is checked directly rather than inherited from a callee —
// nothing here may assume a property of the client that some other
// function established.
async function authenticateTlsClientAuth(
  tx: TenantScopedDatabase,
  deps: TokenIssuanceDeps,
  certificateSubject: string,
  claimedClientId: string | undefined,
): Promise<{ client: ClientRecord; config: ClientOidcConfig }> {
  if (claimedClientId === undefined) {
    return refuseTlsClientAuth(deps, 'no client_id presented alongside the certificate');
  }

  const client = await clientRepository(tx).byClientId(claimedClientId);
  if (client === null) return refuseTlsClientAuth(deps, 'unknown client', claimedClientId);
  if (!client.enabled) return refuseTlsClientAuth(deps, 'client is disabled', claimedClientId);
  // tls_client_auth is a confidential-client method — checked again here
  // rather than trusted from registration. The only confidentiality check
  // on this path: `evaluateClientCredentialsGrant` also refuses a public
  // client, but only for the client_credentials grant it belongs to —
  // authorization_code and refresh_token have no such downstream check, so
  // for those grants this is the only thing standing between a public
  // client and a token.
  if (client.type !== 'confidential') {
    return refuseTlsClientAuth(deps, 'client is not confidential', claimedClientId);
  }

  const config = await clientOidcConfigRepository(tx).byClientId(client.id);
  // client-metadata.ts's `parseClientMetadata` stores
  // `tlsClientAuthSubjectDn` only for a client registered `tls_client_auth`
  // — a client of any other method always reaches this with `config`
  // either absent or carrying a null subject, so skipping this check
  // would still 401 there, at the null-subject check below, just with a
  // less specific reason logged. True only because that storage rule
  // holds; checked directly anyway, not trusted.
  if (config?.tokenEndpointAuthMethod !== 'tls_client_auth') {
    return refuseTlsClientAuth(
      deps,
      'client is not registered for tls_client_auth',
      claimedClientId,
    );
  }
  // Unreachable only because the check immediately above already pinned
  // `tokenEndpointAuthMethod === 'tls_client_auth'`, and
  // client_oidc_config_tls_client_auth_needs_subject_dn (migration
  // 0055_client_tls_client_auth_subject_dn.sql) guarantees a non-null
  // subject for exactly that method — the constraint alone does not, since
  // it says nothing about any other method. Checked anyway, the same
  // defense the client_credentials path takes on `serviceSubjectId` above.
  if (config.tlsClientAuthSubjectDn === null) {
    return refuseTlsClientAuth(
      deps,
      'client has no registered certificate subject',
      claimedClientId,
    );
  }
  if (!tlsClientAuthSubjectMatches(certificateSubject, config.tlsClientAuthSubjectDn)) {
    return refuseTlsClientAuth(
      deps,
      'certificate subject does not match the registered value',
      claimedClientId,
    );
  }

  return { client, config };
}

// Reached only if StructuredRequest gains a variant the dispatch below does
// not answer, which is a typecheck failure rather than a runtime one. The
// throw exists because a `never` parameter still needs a body.
export function assertNeverGrant(request: never): never {
  throw new Error(`unhandled grant type: ${JSON.stringify(request)}`);
}

// RFC 8693's grant, minting from a subject_token (and, optionally, an
// actor_token) rather than a credential the client owns outright.
async function issueExchangedTokens(
  tx: TenantScopedDatabase,
  deps: TokenIssuanceDeps,
  request: Extract<StructuredRequest, { grantType: typeof TOKEN_EXCHANGE_GRANT }>,
  client: ClientRecord,
  config: ClientOidcConfig,
): Promise<TokenResponse> {
  // Every failure this parse can report is invalid_request (RFC 8693
  // §2.2.2), for all three token-type parameters alike, so they are never
  // told apart here.
  const accepted = (raw: string): ExchangeTokenType => {
    const outcome = parseTokenType(raw);
    if (outcome === 'refused' || outcome === 'deferred' || outcome === 'unknown') {
      throw invalidRequest();
    }
    return outcome;
  };

  const subjectType = accepted(request.subjectTokenType);
  const issuedType =
    request.requestedTokenType === undefined
      ? 'access_token'
      : accepted(request.requestedTokenType);

  // Impersonation is the branch with no actor recorded, so it is the one
  // the per-client permission gates (client-oidc-config.ts's own comment
  // on the column) — checked before the subject token is ever resolved, so
  // an unpermitted client cannot use this response to learn whether the
  // subject token it sent would otherwise have been valid.
  if (request.actorToken === undefined && !config.tokenExchangeImpersonationAllowed) {
    throw unauthorizedClient();
  }

  const now = deps.clock.now();
  const resolveDeps: ResolveDeps = {
    issuer: deps.issuer,
    requestingClientId: client.clientId,
    lifespans: deps.lifespans,
    now,
  };

  const subject = await resolveExchangeToken(tx, resolveDeps, subjectType, request.subjectToken);
  if (subject.kind !== 'ok') throw invalidRequest();

  // `actorTokenType` is non-undefined whenever `actorToken` is — stage 1
  // refuses the pair otherwise — but narrow it rather than asserting it.
  const actorType = request.actorTokenType === undefined ? null : accepted(request.actorTokenType);
  const actor =
    request.actorToken === undefined || actorType === null
      ? null
      : await resolveExchangeToken(tx, resolveDeps, actorType, request.actorToken);
  if (actor !== null && actor.kind !== 'ok') throw invalidRequest();

  const actorSubject = actor === null ? client.clientId : actor.token.subjectId;
  if (!mayActPermits(subject.token.mayAct, actorSubject)) throw invalidRequest();

  const actChain = actor === null ? undefined : buildActChain(actorSubject, actor.token.act);
  if (actChain !== undefined && actChain.kind !== 'ok') throw invalidRequest();
  const act = actChain?.kind === 'ok' ? actChain.act : undefined;

  const scopeOutcome = attenuateScope(request.scope, subject.token.scope);
  if (scopeOutcome.kind === 'widened') throw invalidScope();
  const scope = [...scopeOutcome.scope];

  const audienceOutcome = resolveExchangeAudience({
    resource: request.resource,
    audience: request.audience,
    ceiling: config.audiences,
    issuedType,
  });
  if (audienceOutcome.kind === 'invalid_target') throw invalidTarget();

  // An exchange may not lengthen the credential it was handed —
  // mintAccessToken's own `expCeiling`, and (below) this same instant
  // stands in for it when the issued shape is not an access token.
  const expCeiling = subject.token.expiresAt ?? undefined;
  // Recorded only for a delegated exchange (`act` present); an
  // impersonation names no actor in the claim, so none is recorded here
  // either (token-grants.ts's own comment on the column).
  const actorSubjectId = act === undefined ? null : actorSubject;

  if (issuedType === 'refresh_token') {
    const grantId = newId();
    await tokenGrantRepository(tx).create({
      id: grantId,
      tenantId: deps.tenantId,
      clientId: client.id,
      subjectId: subject.token.subjectId,
      scope: scope.join(' '),
      audience: [...audienceOutcome.audience],
      sessionId: subject.token.sessionId,
      actorSubjectId,
      exchangedFromGrantId: subject.token.grantId,
      actChain: act ?? null,
      expCeiling: expCeiling ?? null,
    });
    const refreshToken = generateRefreshToken();
    const rawExpiresAt = new Date(now.getTime() + config.refreshTokenTtlSeconds * 1000);
    // The ceiling is a cap, never a grant of extra life: an exchanging
    // client's own ttl still applies whenever it is the tighter of the two.
    const refreshExpiresAt =
      expCeiling !== undefined && expCeiling.getTime() < rawExpiresAt.getTime()
        ? expCeiling
        : rawExpiresAt;
    await refreshTokenRepository(tx).create({
      tokenHash: hashRefreshToken(refreshToken),
      tenantId: deps.tenantId,
      grantId,
      expiresAt: refreshExpiresAt,
    });

    return {
      access_token: refreshToken,
      // RFC 8693 §2.2.1: not an access token.
      token_type: 'N_A',
      expires_in: Math.floor((refreshExpiresAt.getTime() - now.getTime()) / 1000),
      scope: scope.join(' '),
      issued_token_type: 'urn:ietf:params:oauth:token-type:refresh_token',
    };
  }

  const claimContext = await deps.loadClaimContext(deps.tenantId, subject.token.subjectId);
  const reachable = await reachableRoleIds(tx, scope);

  if (issuedType === 'id_token') {
    const key = await signingKeyRepository(tx).active();
    // A scope reaches this ID token only if its own definition says so
    // (`client_scopes.include_in_id_token`) — `roles`/`groups` ship with
    // that off, the same rule `issueAuthorizationCodeTokens` applies,
    // because the ID token reaches the browser and a client cannot opt
    // out of what lands there.
    const assigned = await clientScopeRepository(tx).forClient(client.id);
    const idTokenScope = assigned
      .filter((clientScope) => scope.includes(clientScope.name) && clientScope.includeInIdToken)
      .map((clientScope) => clientScope.name);
    const narrowedContext: ClaimContext = {
      ...claimContext.context,
      roles: narrowByScopeMappings(claimContext.context.roles, reachable, client.fullScopeAllowed),
    };
    const mapped = await deps.claimMappers.assemble(
      idTokenScope,
      narrowedContext,
      claimContext.bindings,
    );
    const iat = Math.floor(now.getTime() / 1000);
    const ttlExp = iat + config.accessTokenTtlSeconds;
    const ceiling = expCeiling === undefined ? ttlExp : Math.floor(expCeiling.getTime() / 1000);
    const exp = Math.min(ttlExp, ceiling);
    const idTokenClaims = withRegisteredClaimsWinning(mapped, {
      iss: deps.issuer,
      sub: subject.token.subjectId,
      aud: client.clientId,
      iat,
      exp,
      ...(subject.token.sessionId !== null ? { sid: subject.token.sessionId } : {}),
      ...(act === undefined ? {} : { act }),
    });
    const idToken = await signJwt(idTokenClaims, { key, kek: deps.kek });

    return {
      access_token: idToken,
      // RFC 8693 §2.2.1: not an access token.
      token_type: 'N_A',
      expires_in: exp - iat,
      scope: scope.join(' '),
      issued_token_type: 'urn:ietf:params:oauth:token-type:id_token',
    };
  }

  const accessTokenScope = await accessTokenEligibleScope(tx, scope);
  const key = await signingKeyRepository(tx).active();
  const grantId = newId();

  const { accessToken, audience, iat, exp } = await mintAccessToken(
    deps,
    {
      subjectId: subject.token.subjectId,
      clientId: client.clientId,
      scope,
      config,
      audience: audienceOutcome.audience,
      claimContext,
      reachableRoleIds: reachable,
      fullScopeAllowed: client.fullScopeAllowed,
      accessTokenScope,
      sessionId: subject.token.sessionId,
      grantId,
      ...(act === undefined ? {} : { act }),
      ...(expCeiling === undefined ? {} : { expCeiling }),
    },
    key,
    now,
  );

  await tokenGrantRepository(tx).create({
    id: grantId,
    tenantId: deps.tenantId,
    clientId: client.id,
    subjectId: subject.token.subjectId,
    scope: scope.join(' '),
    audience,
    sessionId: subject.token.sessionId,
    actorSubjectId,
    exchangedFromGrantId: subject.token.grantId,
    actChain: act ?? null,
    expCeiling: expCeiling ?? null,
  });

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: exp - iat,
    scope: scope.join(' '),
    issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
  };
}

export async function issueTokens(
  tx: TenantScopedDatabase,
  deps: TokenIssuanceDeps,
  body: Record<string, string | string[] | undefined>,
  authorizationHeader: string | undefined,
  // The full header set, read for exactly one thing: the proxy-supplied
  // certificate subject `tlsClientSubject` reads off it below. Kept
  // separate from `authorizationHeader` because that one is a single named
  // header every caller already threads through, where this is the raw
  // request the tls_client_auth path alone needs.
  headers: Record<string, string | string[] | undefined>,
  // Node's own `IncomingMessage.rawHeaders` — flat, duplicate-preserving
  // name/value pairs. The only consumer is `tlsClientSubject`'s duplicate
  // check; `headers` above cannot answer that question (see
  // tls-client-auth.ts's own comment on why).
  rawHeaders: readonly string[],
): Promise<TokenResponse> {
  const request = parseStructure(body);
  // OIDC Core §9: the audience a private_key_jwt assertion must name is
  // this tenant's own token endpoint — the same string discovery.ts's
  // token_endpoint publishes (contracts/discovery.ts).
  const tokenEndpoint = `${deps.issuer}/protocol/openid-connect/token`;
  const assertionOutcome = parseClientAssertion(body, deps.clock.now(), {
    audience: tokenEndpoint,
  });
  const basic = parseBasicAuth(authorizationHeader);
  const bodyClientSecret = readOptionalField(body, 'client_secret');
  const certResult = tlsClientSubject(headers, rawHeaders, {
    trustProxy: deps.trustProxy,
    headerName: deps.tlsClientCertHeader,
  });
  // A duplicated header is refused outright, the same way every other
  // tls_client_auth refusal is — never silently downgraded to "no
  // certificate presented", which would leave an operator debugging a
  // completely unexplained 401.
  if (certResult.kind === 'duplicated') {
    refuseTlsClientAuth(deps, 'certificate subject header presented more than once');
  }
  const certificateSubject = certResult.kind === 'present' ? certResult.subject : null;

  // RFC 7521 §4.2 / RFC 6749 §2.3: a client presents exactly one
  // authentication mechanism per request. `authenticateClient` already
  // refuses Basic alongside a body secret; this extends the same
  // one-method rule to the certificate subject, refused before any path
  // runs rather than silently preferring one and dropping the other.
  if (
    certificateSubject !== null &&
    (assertionOutcome.kind !== 'unsupported' ||
      basic !== undefined ||
      bodyClientSecret !== undefined)
  ) {
    refuseTlsClientAuth(deps, 'certificate presented alongside another authentication method');
  }
  if (
    assertionOutcome.kind !== 'unsupported' &&
    (basic !== undefined || bodyClientSecret !== undefined)
  ) {
    refusePrivateKeyJwt(
      deps,
      'assertion presented alongside a client_secret',
      assertionOutcome.kind === 'ok' ? assertionOutcome.claimedClientId : undefined,
    );
  }

  const { client, config } =
    assertionOutcome.kind !== 'unsupported'
      ? await authenticatePrivateKeyJwt(tx, deps, assertionOutcome, tokenEndpoint)
      : certificateSubject !== null
        ? await authenticateTlsClientAuth(tx, deps, certificateSubject, request.clientId)
        : await authenticateClient(tx, deps, basic, request.clientId, bodyClientSecret);

  // RFC 6749 §5.2. Until this landed, `config.grantTypes` gated only
  // whether a refresh token was issued, so a client could use any grant
  // this server implements regardless of what it registered for.
  if (!config.grantTypes.includes(request.grantType)) {
    throw unauthorizedClient();
  }

  switch (request.grantType) {
    case 'authorization_code':
      return issueAuthorizationCodeTokens(tx, deps, request, client, config);
    case 'refresh_token':
      return issueRefreshTokens(tx, deps, request, client, config);
    case 'client_credentials':
      return issueClientCredentialsTokens(tx, deps, request, client, config);
    case TOKEN_EXCHANGE_GRANT:
      return issueExchangedTokens(tx, deps, request, client, config);
    default:
      return assertNeverGrant(request);
  }
}
