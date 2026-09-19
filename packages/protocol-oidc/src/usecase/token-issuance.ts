import { sessionRepository } from '@odudu/authn-flows';
import { signJwt, signingKeyRepository, type SigningKeyRecord } from '@odudu/crypto';
import { withRealm, type DatabaseHandle, type RealmScopedDatabase } from '@odudu/db';
import { subjectRepository } from '@odudu/domain-identity';
import {
  clientRepository,
  clientScopeRepository,
  verifyClientSecret,
  type ClientRecord,
} from '@odudu/domain-realm';
import { type ClaimMapperRegistry, type Clock, newId } from '@odudu/kernel';
import { clientOidcConfigRepository, type ClientOidcConfig } from '#/repository/client-oidc-config';
import { authorizationCodeRepository } from '#/repository/codes';
import { tokenGrantRepository, type TokenGrantRecord } from '#/repository/grants';
import { refreshTokenRepository } from '#/repository/refresh';
import { accessTokenEligibleScope, reachableRoleIds } from '#/repository/scope-role-reach';
import { rotateRefreshToken } from '#/usecase/refresh-rotation';
import { acrFor, amrFor } from '#/service/acr';
import { hashAuthorizationCode } from '#/service/authorization-code';
import { evaluateAuthorizationCodeGrant } from '#/service/authorization-code-grant';
import { type ClaimContext } from '#/service/claims';
import { evaluateClientCredentialsGrant } from '#/service/client-credentials-grant';
import {
  clientSecretLimiterKey,
  isPasswordAuthMethod,
  type ClientSecretLimiter,
} from '#/service/client-secret-throttle';
import {
  invalidClient,
  invalidGrant,
  invalidRequest,
  invalidScope,
  TokenError,
  TokenRateLimited,
  unauthorizedClient,
  unsupportedGrantType,
} from '#/service/errors';
import { evaluateRefreshGrant, generateRefreshToken, hashRefreshToken } from '#/service/refresh';
import { resolveScope } from '#/service/scope';
import { narrowByScopeMappings } from '#/service/scope-mapping';
import { withRegisteredClaimsWinning } from '#/service/token-claims';

export interface TokenIssuanceDeps {
  // Used only to run a step in its own, independently committed
  // transaction: the enclosing `tx` this call runs in is always rolled
  // back once it throws, and both the authorization_code grant's
  // replay-revocation and the refresh_token grant's rotation are exactly
  // the kind of side effect that must survive that rollback.
  database: DatabaseHandle;
  realmId: string;
  issuer: string;
  kek: Uint8Array;
  clock: Clock;
  // The realm's own idle window — the same one /authorize's resolveSession
  // checks a session cookie against — so a session-bound refresh dies
  // exactly when the session it is bound to would (refresh-rotation.ts).
  idleSeconds: number;
  verifyPassword: (hash: string, secret: string) => Promise<boolean>;
  // ADR 0023's client half: a per-`client_id` budget on failed
  // client_secret_basic/client_secret_post attempts, consulted by
  // `authenticateClient` and by nothing else. The concrete instance wraps
  // `apps/server/src/throttle.ts`'s `slidingWindow`; protocol-oidc only
  // ever sees the shape.
  clientSecretLimiter: ClientSecretLimiter;
  // Shared with /userinfo: the ID token's claims beyond the envelope
  // (`iss`/`aud`/`iat`/`exp`/`nonce`/`auth_time`) come from the same
  // registry, so a claim present in one can never be missing from the
  // other for the same subject and scope.
  claimMappers: ClaimMapperRegistry<ClaimContext>;
  loadClaimContext(realmId: string, subjectId: string): Promise<ClaimContext>;
}

export interface TokenResponse {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  token_type: 'Bearer';
  expires_in: number;
  scope: string;
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
    }
  | {
      grantType: 'refresh_token';
      refreshToken: string;
      clientId: string | undefined;
      scope: string;
    }
  | {
      grantType: 'client_credentials';
      clientId: string | undefined;
      scope: string;
    };

function readField(body: Record<string, string | string[] | undefined>, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value : '';
}

// RFC 6749 §3.2: a parameter sent with an empty value is treated as if it
// had been omitted. `readField`'s callers get that for free by testing the
// result for length zero; here the absence has to be made explicit, because
// the caller cannot see the difference — `client_secret=` counted as a
// second authentication method being presented, refusing a request that
// succeeded without the parameter at all.
function readOptionalField(
  body: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const value = body[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseStructure(body: Record<string, string | string[] | undefined>): StructuredRequest {
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
    };
  }

  if (grantType === 'client_credentials') {
    return {
      grantType,
      clientId: readOptionalField(body, 'client_id'),
      scope: readField(body, 'scope'),
    };
  }

  throw unsupportedGrantType();
}

interface BasicCredentials {
  clientId: string;
  secret: string;
}

const WWW_AUTHENTICATE = 'Basic realm="token"';

// RFC 6749 §2.3.1 encodes each half with
// `application/x-www-form-urlencoded` before joining them, so decoding is
// what lets a secret containing `:` — the separator itself — or `%` survive
// the round trip. `decodeURIComponent` raises `URIError` on a sequence like
// `%` or `%zz`, and such bytes are not a form-urlencoding at all: they hold
// no client identifier and no secret to recover. Falling back to them
// undecoded, as some servers do for clients that never encoded, would leave
// one registered secret with two accepted spellings on the wire.
function decodeBasicCredentials(payload: string): BasicCredentials | undefined {
  const decoded = Buffer.from(payload, 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator === -1) return undefined;
  try {
    return {
      clientId: decodeURIComponent(decoded.slice(0, separator)),
      secret: decodeURIComponent(decoded.slice(separator + 1)),
    };
  } catch {
    return undefined;
  }
}

// RFC 6749 §2.3.1: `Authorization: Basic base64(client_id:client_secret)`.
// A header naming another scheme presents no client credential — a bearer
// token here is not client authentication — and is left to the body. A
// header that names `Basic` and cannot be read is a failed presentation of
// `client_secret_basic`, and fails as one rather than being dropped so the
// body can be tried instead: a client cannot escape §2.3's
// one-method-per-request rule, or a wrong secret, by corrupting its header.
function parseBasicAuth(header: string | undefined): BasicCredentials | undefined {
  if (header === undefined) return undefined;
  const match = /^Basic(?:\s+(.*))?$/i.exec(header);
  if (match === null) return undefined;

  const credentials = decodeBasicCredentials(match[1] ?? '');
  if (credentials === undefined) throw invalidClient(WWW_AUTHENTICATE);
  return credentials;
}

// Stage 2: client authentication. Every failure here — unknown client_id,
// disabled client, wrong secret, a public client presenting a secret, the
// method the client is not configured for, or two methods at once — reports
// the same `invalid_client` (401, WWW-Authenticate: Basic), never which,
// and (ADR 0023's amendment) is metered identically against the same
// per-`client_id` budget. A healthy client never reaches that budget:
// `verifyClientCredentials` returns its result untouched on success, so
// only the `throw` path below ever calls `check`.
async function authenticateClient(
  tx: RealmScopedDatabase,
  deps: TokenIssuanceDeps,
  basic: BasicCredentials | undefined,
  bodyClientId: string | undefined,
  bodyClientSecret: string | undefined,
): Promise<{ client: ClientRecord; config: ClientOidcConfig }> {
  if (basic !== undefined && bodyClientSecret !== undefined) throw invalidClient(WWW_AUTHENTICATE);

  const oauthClientId = basic?.clientId ?? bodyClientId;
  if (oauthClientId === undefined) throw invalidClient(WWW_AUTHENTICATE);

  // What this request is attempting, from how the credential arrived —
  // never the client's registered method, which an unknown client_id has
  // none of. Basic and a body secret are §2.3.1's two password methods by
  // construction; there is no third presentation /token accepts today.
  const attemptedMethod =
    basic !== undefined
      ? 'client_secret_basic'
      : bodyClientSecret !== undefined
        ? 'client_secret_post'
        : undefined;

  try {
    return await verifyClientCredentials(tx, deps, oauthClientId, basic, bodyClientSecret);
  } catch (err) {
    if (
      err instanceof TokenError &&
      attemptedMethod !== undefined &&
      isPasswordAuthMethod(attemptedMethod)
    ) {
      const decision = deps.clientSecretLimiter.check(
        clientSecretLimiterKey(deps.realmId, oauthClientId),
      );
      if (!decision.allowed) throw new TokenRateLimited(decision.retryAfterSeconds);
    }
    throw err;
  }
}

async function verifyClientCredentials(
  tx: RealmScopedDatabase,
  deps: TokenIssuanceDeps,
  oauthClientId: string,
  basic: BasicCredentials | undefined,
  bodyClientSecret: string | undefined,
): Promise<{ client: ClientRecord; config: ClientOidcConfig }> {
  const client = await clientRepository(tx).byClientId(oauthClientId);
  if (client === null) throw invalidClient(WWW_AUTHENTICATE);

  const config = await clientOidcConfigRepository(tx).byClientId(client.id);
  if (config === null) throw invalidClient(WWW_AUTHENTICATE);

  let presented: string | null;
  if (basic !== undefined) {
    if (config.tokenEndpointAuthMethod !== 'client_secret_basic') {
      throw invalidClient(WWW_AUTHENTICATE);
    }
    presented = basic.secret;
  } else if (bodyClientSecret !== undefined) {
    if (config.tokenEndpointAuthMethod !== 'client_secret_post') {
      throw invalidClient(WWW_AUTHENTICATE);
    }
    presented = bodyClientSecret;
  } else {
    presented = null;
  }

  const ok = await verifyClientSecret(client, presented, deps.verifyPassword);
  if (!ok) throw invalidClient(WWW_AUTHENTICATE);

  return { client, config };
}

// Stage 3: the authorization_code grant. `consume` is one atomic UPDATE, so
// the database — not a check-then-set race — decides which of two
// concurrent redemptions wins. The grant rules themselves (client match,
// redirect_uri match, PKCE) are `evaluateAuthorizationCodeGrant`, which
// runs no queries; this usecase only loads, consumes and, on failure,
// revokes. Every way it can fail converges on the same `invalid_grant`, so
// a caller probing them cannot learn which check failed (RFC 6749 §5.2).
async function redeemAuthorizationCode(
  tx: RealmScopedDatabase,
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
      await withRealm(deps.database.db, deps.realmId, (revokeTx) =>
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

// Stages 5-6, shared by every grant: sign an access token bound to `sub`
// and `scope`. The audience is the issuer itself, plus whatever resource
// APIs this realm's client is configured for — the issuer is never
// dropped in favor of a configured audience, since a token that cannot be
// used at the issuer's own endpoints (e.g. /userinfo) would be unusable
// for anything OIDC promised the client (RFC 9068 §4: a resource server,
// including this one, must find itself in `aud` or refuse the token).
async function mintAccessToken(
  deps: TokenIssuanceDeps,
  input: {
    subjectId: string;
    clientId: string;
    scope: string[];
    config: ClientOidcConfig;
    // Resolved once per issuance by the caller — see loadClaimContext's own
    // doc comment for why a claim mapper never resolves this itself.
    claimContext: ClaimContext;
    reachableRoleIds: ReadonlySet<string>;
    fullScopeAllowed: boolean;
    // The subset of `scope` that `client_scopes.include_in_access_token`
    // actually admits — not every granted scope, or an access token bound
    // for a resource server named in `aud` would carry the end-user's
    // profile and email by default (RFC 9068 §2.2 draws no line here; the
    // realm's own scope definitions do).
    accessTokenScope: string[];
    // The grant's session, if it has one — see the `sid` comment below.
    sessionId: string | null;
  },
  key: SigningKeyRecord,
  now: Date,
): Promise<{ accessToken: string; audience: string[]; iat: number; exp: number }> {
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + input.config.accessTokenTtlSeconds;
  const audience = input.config.audiences.includes(deps.issuer)
    ? input.config.audiences
    : [...input.config.audiences, deps.issuer];

  const narrowedContext: ClaimContext = {
    ...input.claimContext,
    roles: narrowByScopeMappings(
      input.claimContext.roles,
      input.reachableRoleIds,
      input.fullScopeAllowed,
    ),
  };
  const mapped = await deps.claimMappers.assemble(input.accessTokenScope, narrowedContext);

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
  });
  const accessToken = await signJwt(accessTokenClaims, { key, kek: deps.kek, typ: 'at+jwt' });
  return { accessToken, audience, iat, exp };
}

async function issueAuthorizationCodeTokens(
  tx: RealmScopedDatabase,
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
  const claimContext = await deps.loadClaimContext(deps.realmId, code.subjectId);
  const reachable = await reachableRoleIds(tx, scope);
  const accessTokenScope = await accessTokenEligibleScope(tx, scope);

  // `offline_access` asks for a grant no session bounds (OpenID Connect
  // Back-Channel Logout 1.0 §2.7): whatever session the code carries is
  // dropped for this grant, its access token and its ID token alike. The
  // *resolved* scope decides this, never the raw request — a client
  // without the scope assigned gets it stripped by resolveScope above, and
  // sees an ordinary session-bound grant.
  const sessionId = scope.includes('offline_access') ? null : code.sessionId;

  const { accessToken, audience, iat, exp } = await mintAccessToken(
    deps,
    {
      subjectId: code.subjectId,
      clientId: client.clientId,
      scope,
      config,
      claimContext,
      reachableRoleIds: reachable,
      fullScopeAllowed: client.fullScopeAllowed,
      accessTokenScope,
      sessionId,
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
      ...claimContext,
      roles: narrowByScopeMappings(claimContext.roles, reachable, client.fullScopeAllowed),
    };
    // The same claim mapper registry /userinfo assembles from — `sub`
    // arrives through it too, so there is exactly one place that decides
    // what a subject's `openid`/`profile`/`email` scopes produce, not one
    // for the ID token and a second for /userinfo.
    const userClaims = await deps.claimMappers.assemble(idTokenScope, narrowedContext);
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
      auth_time: Math.floor(code.authTime.getTime() / 1000),
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
    realmId: deps.realmId,
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
      realmId: deps.realmId,
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
  tx: RealmScopedDatabase,
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
}

// Stage 3 (and everything after) for `refresh_token`. Rotation runs in its
// own transaction via `withRealm`, because reuse detection and family
// revocation must survive a request ending in `invalid_grant`, which rolls
// the enclosing `tx` back. Everything after it is read-only against settled
// state. The grant decision taken here is the one that governs — it reads
// the grant inside the transaction that rotated the token, where the
// earlier one (ADR 0019) could not see a revocation landing between them.
async function issueRefreshTokens(
  tx: RealmScopedDatabase,
  deps: TokenIssuanceDeps,
  request: Extract<StructuredRequest, { grantType: 'refresh_token' }>,
  client: ClientRecord,
  config: ClientOidcConfig,
): Promise<TokenResponse> {
  const now = deps.clock.now();
  const presentedHash = hashRefreshToken(request.refreshToken);

  await evaluatePresentedRefreshToken(tx, request, client, presentedHash);

  const outcome = await withRealm(deps.database.db, deps.realmId, (rotationTx) =>
    rotateRefreshToken(
      rotationTx,
      presentedHash,
      now,
      config.refreshTokenTtlSeconds,
      deps.idleSeconds,
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
  const claimContext = await deps.loadClaimContext(deps.realmId, grant.subjectId);
  const reachable = await reachableRoleIds(tx, scope);
  const accessTokenScope = await accessTokenEligibleScope(tx, scope);
  const { accessToken } = await mintAccessToken(
    deps,
    {
      subjectId: grant.subjectId,
      clientId: client.clientId,
      scope,
      config,
      claimContext,
      reachableRoleIds: reachable,
      fullScopeAllowed: client.fullScopeAllowed,
      accessTokenScope,
      sessionId: grant.sessionId,
    },
    key,
    now,
  );

  return {
    access_token: accessToken,
    refresh_token: outcome.next,
    token_type: 'Bearer',
    expires_in: config.accessTokenTtlSeconds,
    scope: scope.join(' '),
  };
}

// Stage 3 (and everything after) for `client_credentials`. No PKCE, no
// redirect_uri, no session and no human: `sub` is the client's own
// service-account subject, so there is no refresh token (nothing to avoid
// re-involving) and no ID token (nobody authenticated).
async function issueClientCredentialsTokens(
  tx: RealmScopedDatabase,
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
  const claimContext = await deps.loadClaimContext(deps.realmId, serviceSubjectId);
  const reachable = await reachableRoleIds(tx, scope);
  const accessTokenScope = await accessTokenEligibleScope(tx, scope);
  const { accessToken, audience } = await mintAccessToken(
    deps,
    {
      subjectId: serviceSubjectId,
      clientId: client.clientId,
      scope,
      config,
      claimContext,
      reachableRoleIds: reachable,
      fullScopeAllowed: client.fullScopeAllowed,
      accessTokenScope,
      // client_credentials authenticates no End-User, so there is no
      // session for a grant here to carry.
      sessionId: null,
    },
    key,
    now,
  );

  await tokenGrantRepository(tx).create({
    realmId: deps.realmId,
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

export async function issueTokens(
  tx: RealmScopedDatabase,
  deps: TokenIssuanceDeps,
  body: Record<string, string | string[] | undefined>,
  authorizationHeader: string | undefined,
): Promise<TokenResponse> {
  const request = parseStructure(body);
  const basic = parseBasicAuth(authorizationHeader);
  const { client, config } = await authenticateClient(
    tx,
    deps,
    basic,
    request.clientId,
    readOptionalField(body, 'client_secret'),
  );

  if (request.grantType === 'authorization_code') {
    return issueAuthorizationCodeTokens(tx, deps, request, client, config);
  }
  if (request.grantType === 'refresh_token') {
    return issueRefreshTokens(tx, deps, request, client, config);
  }
  return issueClientCredentialsTokens(tx, deps, request, client, config);
}
