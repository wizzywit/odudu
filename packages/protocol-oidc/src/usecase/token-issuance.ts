import { signJwt, signingKeyRepository, type SigningKeyRecord } from '@odudu/crypto';
import { SUPPORTED_SCOPES } from '@odudu/contracts';
import { withRealm, type DatabaseHandle, type RealmScopedDatabase } from '@odudu/db';
import { subjectRepository } from '@odudu/domain-identity';
import { clientRepository, verifyClientSecret, type ClientRecord } from '@odudu/domain-realm';
import { type Clock, newId } from '@odudu/kernel';
import { clientOidcConfigRepository, type ClientOidcConfig } from '#/repository/client-oidc-config';
import { authorizationCodeRepository } from '#/repository/codes';
import { tokenGrantRepository, type TokenGrantRecord } from '#/repository/grants';
import { refreshTokenRepository } from '#/repository/refresh';
import { rotateRefreshToken } from '#/usecase/refresh-rotation';
import { hashAuthorizationCode } from '#/service/authorization-code';
import { evaluateAuthorizationCodeGrant } from '#/service/authorization-code-grant';
import { evaluateClientCredentialsGrant } from '#/service/client-credentials-grant';
import {
  invalidClient,
  invalidGrant,
  invalidRequest,
  invalidScope,
  unauthorizedClient,
  unsupportedGrantType,
} from '#/service/errors';
import { evaluateRefreshGrant, generateRefreshToken, hashRefreshToken } from '#/service/refresh';
import { resolveScope } from '#/service/scope';

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
  verifyPassword: (hash: string, secret: string) => Promise<boolean>;
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

function readOptionalField(
  body: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const value = body[key];
  return typeof value === 'string' ? value : undefined;
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

// RFC 6749 §2.3.1: `Authorization: Basic base64(client_id:client_secret)`,
// with both halves percent-decoded per the errata this design follows.
function parseBasicAuth(header: string | undefined): BasicCredentials | undefined {
  if (header === undefined) return undefined;
  const match = /^Basic\s+(.+)$/i.exec(header);
  if (!match?.[1]) return undefined;

  let decoded: string;
  try {
    decoded = Buffer.from(match[1], 'base64').toString('utf8');
  } catch {
    return undefined;
  }

  const separator = decoded.indexOf(':');
  if (separator === -1) return undefined;
  return {
    clientId: decodeURIComponent(decoded.slice(0, separator)),
    secret: decodeURIComponent(decoded.slice(separator + 1)),
  };
}

const WWW_AUTHENTICATE = 'Basic realm="token"';

// Stage 2: client authentication. Every failure here — an unknown
// client_id, a disabled client, a wrong secret, a public client presenting
// a secret it was never issued, a client presenting the method it is not
// configured for, or a client presenting more than one method at once —
// reports the same `invalid_client` (401, WWW-Authenticate: Basic), never
// which of those it was.
//
// A client authenticates the way it is registered to, not whichever way
// happens to work: `client_secret_basic` (RFC 6749 §2.3.1's Authorization
// header) and `client_secret_post` (the same section's body parameters) are
// both accepted, but only from a client whose stored
// `token_endpoint_auth_method` names that one — and never both in the same
// request (RFC 6749 §2.3: a client uses no more than one authentication
// method per request).
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
// concurrent redemptions wins. The grant-specific rules themselves (client
// match, redirect_uri match, PKCE) are `evaluateAuthorizationCodeGrant`, a
// pure service function that runs no queries — this usecase only loads,
// consumes and, on failure, revokes. Every way this can fail (unknown code,
// expired, replayed, wrong client, wrong redirect_uri, PKCE mismatch)
// converges on the same `invalid_grant`: a resource server or attacker
// probing these cannot learn which check they failed (RFC 6749 §5.2).
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
// and `scope`. The audience is the resource API this realm's client is
// configured for, falling back to the issuer itself when none is set.
async function mintAccessToken(
  deps: TokenIssuanceDeps,
  input: { subjectId: string; clientId: string; scope: string[]; config: ClientOidcConfig },
  key: SigningKeyRecord,
  now: Date,
): Promise<{ accessToken: string; audience: string[]; iat: number; exp: number }> {
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + input.config.accessTokenTtlSeconds;
  const audience = input.config.audiences.length > 0 ? input.config.audiences : [deps.issuer];

  const accessTokenClaims = {
    iss: deps.issuer,
    sub: input.subjectId,
    aud: audience,
    client_id: input.clientId,
    scope: input.scope.join(' '),
    iat,
    exp,
    jti: newId(),
  };
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

  // Stage 4: scope resolution. P1 has no consent screen and no per-client
  // scope allowlist beyond what /authorize already accepted against
  // SUPPORTED_SCOPES, so this mostly passes the stored scope through.
  const scope = resolveScope(code.scope, [...SUPPORTED_SCOPES], null, null);
  const now = deps.clock.now();
  const key = await signingKeyRepository(tx).active();

  const { accessToken, audience, iat, exp } = await mintAccessToken(
    deps,
    { subjectId: code.subjectId, clientId: client.clientId, scope, config },
    key,
    now,
  );

  // The ID token's audience is the client itself — RFC 9068 §2.2 vs. OIDC
  // Core §2, the distinction the access token's `typ` header alone cannot
  // carry.
  let idToken: string | undefined;
  if (scope.includes('openid')) {
    const idTokenClaims = {
      iss: deps.issuer,
      sub: code.subjectId,
      aud: client.clientId,
      iat,
      exp,
      auth_time: Math.floor(code.authTime.getTime() / 1000),
      ...(code.nonce !== null ? { nonce: code.nonce } : {}),
    };
    idToken = await signJwt(idTokenClaims, { key, kek: deps.kek });
  }

  // Persist the grant and bind the code's redemption to it — the anchor a
  // future revocation call, or a refresh token, points back at.
  const grant = await tokenGrantRepository(tx).create({
    realmId: deps.realmId,
    clientId: client.id,
    subjectId: code.subjectId,
    scope: scope.join(' '),
    audience,
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

// Stage 3 (and everything after) for `refresh_token`. Rotation runs in its
// own transaction, independently committed via `withRealm`, before this
// function's own `tx` does anything else: reuse detection and family
// revocation must survive even though the request this call belongs to
// will end in `invalid_grant`, which rolls the enclosing `tx` back. Once
// rotation has committed, everything else here is read-only against
// already-settled state, so running it inside the enclosing `tx` risks
// nothing.
async function issueRefreshTokens(
  tx: RealmScopedDatabase,
  deps: TokenIssuanceDeps,
  request: Extract<StructuredRequest, { grantType: 'refresh_token' }>,
  client: ClientRecord,
  config: ClientOidcConfig,
): Promise<TokenResponse> {
  const now = deps.clock.now();
  const presentedHash = hashRefreshToken(request.refreshToken);

  const outcome = await withRealm(deps.database.db, deps.realmId, (rotationTx) =>
    rotateRefreshToken(rotationTx, presentedHash, now, config.refreshTokenTtlSeconds),
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
  const { accessToken } = await mintAccessToken(
    deps,
    { subjectId: grant.subjectId, clientId: client.clientId, scope, config },
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
  const { accessToken, audience } = await mintAccessToken(
    deps,
    { subjectId: serviceSubjectId, clientId: client.clientId, scope, config },
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
