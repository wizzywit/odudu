import { signJwt, signingKeyRepository } from '@odudu/crypto';
import { SUPPORTED_SCOPES } from '@odudu/contracts';
import { withRealm, type DatabaseHandle, type RealmScopedDatabase } from '@odudu/db';
import { clientRepository, verifyClientSecret, type ClientRecord } from '@odudu/domain-realm';
import { type Clock, newId } from '@odudu/kernel';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { authorizationCodeRepository } from '#/repository/codes';
import { tokenGrantRepository } from '#/repository/grants';
import { hashAuthorizationCode } from '#/service/authorization-code';
import {
  invalidClient,
  invalidGrant,
  invalidRequest,
  unsupportedGrantType,
} from '#/service/errors';
import { verifyPkce } from '#/service/pkce';
import { resolveScope } from '#/service/scope';

export interface TokenIssuanceDeps {
  // Used only to revoke a replayed code's grant in its own, independently
  // committed transaction (see redeemAuthorizationCode): the enclosing
  // `tx` this call runs in is always rolled back once it throws
  // `invalid_grant`, and a revocation is exactly the side effect that must
  // survive that rollback.
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
  token_type: 'Bearer';
  expires_in: number;
  scope: string;
}

// Stage 1: structural validation. What's genuinely malformed — no
// grant_type, or an authorization_code request missing `code`/`redirect_uri`
// — is `invalid_request` here. `code_verifier`'s presence is a PKCE rule
// (RFC 7636 §4.5), not shape, so its absence is left to stage 3, which
// reports it exactly like any other PKCE failure: `invalid_grant`, per
// ADR 0007's split between structure at the boundary and rules in a
// service.
interface StructuredRequest {
  grantType: string;
  code: string;
  redirectUri: string;
  clientId: string | undefined;
  codeVerifier: string;
}

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
// a secret it was never issued — reports the same `invalid_client` (401,
// WWW-Authenticate: Basic), never which of those it was.
async function authenticateClient(
  tx: RealmScopedDatabase,
  deps: TokenIssuanceDeps,
  basic: BasicCredentials | undefined,
  bodyClientId: string | undefined,
): Promise<ClientRecord> {
  const oauthClientId = basic?.clientId ?? bodyClientId;
  if (oauthClientId === undefined) throw invalidClient(WWW_AUTHENTICATE);

  const client = await clientRepository(tx).byClientId(oauthClientId);
  if (client === null) throw invalidClient(WWW_AUTHENTICATE);

  const presented = basic?.secret ?? null;
  const ok = await verifyClientSecret(client, presented, deps.verifyPassword);
  if (!ok) throw invalidClient(WWW_AUTHENTICATE);

  return client;
}

// Stage 3: the authorization_code grant. `consume` is one atomic UPDATE, so
// the database — not a check-then-set race — decides which of two
// concurrent redemptions wins. Every other way this can fail (unknown code,
// expired, replayed, wrong client, wrong redirect_uri, PKCE mismatch)
// converges on the same `invalid_grant`: a resource server or attacker
// probing these cannot learn which check they failed (RFC 6749 §5.2).
async function redeemAuthorizationCode(
  tx: RealmScopedDatabase,
  deps: TokenIssuanceDeps,
  request: StructuredRequest,
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
  if (record.clientId !== client.id) throw invalidGrant();
  if (record.redirectUri !== request.redirectUri) throw invalidGrant();
  if (!verifyPkce(request.codeVerifier, record.codeChallenge, record.codeChallengeMethod)) {
    throw invalidGrant();
  }
  return record;
}

export async function issueTokens(
  tx: RealmScopedDatabase,
  deps: TokenIssuanceDeps,
  body: Record<string, string | string[] | undefined>,
  authorizationHeader: string | undefined,
): Promise<TokenResponse> {
  const request = parseStructure(body);
  const basic = parseBasicAuth(authorizationHeader);
  const client = await authenticateClient(tx, deps, basic, request.clientId);
  const code = await redeemAuthorizationCode(tx, deps, request, client);

  const config = await clientOidcConfigRepository(tx).byClientId(client.id);
  if (config === null) throw invalidGrant();

  // Stage 4: scope resolution. P1 has no consent screen and no per-client
  // scope allowlist beyond what /authorize already accepted against
  // SUPPORTED_SCOPES, so this mostly passes the stored scope through — the
  // shape the refresh_token and client_credentials grants will narrow for
  // real once a consented or delegated set exists.
  const scope = resolveScope(code.scope, [...SUPPORTED_SCOPES], null, null);

  const now = deps.clock.now();
  const iat = Math.floor(now.getTime() / 1000);
  const accessTokenTtl = config.accessTokenTtlSeconds;
  const exp = iat + accessTokenTtl;

  // Stage 5: claims assembly. The access token's audience is the resource
  // API this realm's client is configured for; the ID token's audience is
  // the client itself — RFC 9068 §2.2 vs. OIDC Core §2, the distinction the
  // `typ` header alone cannot carry.
  const audience = config.audiences.length > 0 ? config.audiences : [deps.issuer];
  const accessTokenClaims = {
    iss: deps.issuer,
    sub: code.subjectId,
    aud: audience,
    client_id: client.clientId,
    scope: scope.join(' '),
    iat,
    exp,
    jti: newId(),
  };

  const key = await signingKeyRepository(tx).active();

  // Stage 6: mint. Both tokens are signed by the same key at the same
  // moment; only `typ` tells a resource server which is which.
  const accessToken = await signJwt(accessTokenClaims, { key, kek: deps.kek, typ: 'at+jwt' });

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

  // Stage 7: persist the grant and bind the code's redemption to it — the
  // anchor a future revocation call, or a refresh token, points back at.
  const grant = await tokenGrantRepository(tx).create({
    realmId: deps.realmId,
    clientId: client.id,
    subjectId: code.subjectId,
    scope: scope.join(' '),
    audience,
  });
  await authorizationCodeRepository(tx).attachGrant(code.codeHash, grant.id);

  // Stage 8: response assembly.
  return {
    access_token: accessToken,
    ...(idToken !== undefined ? { id_token: idToken } : {}),
    token_type: 'Bearer',
    expires_in: accessTokenTtl,
    scope: scope.join(' '),
  };
}
