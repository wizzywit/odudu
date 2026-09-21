import { AUDIENCE_UNCHECKED, verifyJwt, type SigningKeyRecord } from '@odudu/crypto';
import { type RealmScopedDatabase } from '@odudu/db';
import { tokenGrantRepository } from '#/repository/grants';
import { refreshTokenRepository } from '#/repository/refresh';
import { invalidGrant } from '#/service/errors';
import { hashRefreshToken } from '#/service/refresh';
import {
  authenticateClient,
  parseBasicAuth,
  readOptionalField,
  type ClientAuthenticationDeps,
} from '#/usecase/client-authentication';

export interface RevocationDeps extends ClientAuthenticationDeps {
  readonly issuer: string;
  readonly keys: readonly SigningKeyRecord[];
}

// Resolves the presented token to the `token_grants` row it names — a
// refresh token by its own row (`refreshTokenRepository.byHash`), an access
// token by the private `grant_id` claim `mintAccessToken` signs into it
// (rfc7662.md's "Why a grant needs its own claim" has the reasoning, shared
// verbatim by revocation). `undefined` covers both "not a refresh token we
// hold" and "not a token this server signed" — RFC 7009 §2.2 does not
// distinguish them, so neither does this.
async function resolveGrantId(
  tx: RealmScopedDatabase,
  deps: RevocationDeps,
  token: string,
): Promise<string | undefined> {
  const refreshRecord = await refreshTokenRepository(tx).byHash(hashRefreshToken(token));
  if (refreshRecord !== null) return refreshRecord.grantId;

  try {
    const payload = await verifyJwt(token, {
      keys: [...deps.keys],
      issuer: deps.issuer,
      audience: AUDIENCE_UNCHECKED,
      typ: 'at+jwt',
    });
    const grantId = payload.grant_id;
    return typeof grantId === 'string' && grantId.length > 0 ? grantId : undefined;
  } catch {
    return undefined;
  }
}

// RFC 7009 §2.2: an invalid or unknown token answers success, never an
// error — telling a caller which token strings exist is the leak the
// endpoint would otherwise create. §2.1 draws the one line this stops
// short of: a token that *is* found, under a grant issued to a different
// client, is refused with `invalid_grant`. Every other outcome — unknown,
// already revoked, freshly revoked — returns normally.
export async function respondToRevocationRequest(
  tx: RealmScopedDatabase,
  deps: RevocationDeps,
  body: Record<string, string | string[] | undefined>,
  authorizationHeader: string | undefined,
  now: Date,
): Promise<void> {
  const basic = parseBasicAuth(authorizationHeader);
  const { client } = await authenticateClient(
    tx,
    deps,
    basic,
    readOptionalField(body, 'client_id'),
    readOptionalField(body, 'client_secret'),
  );

  const token = readOptionalField(body, 'token') ?? '';
  const grantId = await resolveGrantId(tx, deps, token);
  if (grantId === undefined) return;

  const grant = await tokenGrantRepository(tx).byId(grantId);
  if (grant === null) return;

  // The grant is the record a family's rotation shares — revoking it by id
  // reaches a refresh token's current row whatever rotation it is on, the
  // same way `rotateRefreshToken` reads `grant.revokedAt` rather than
  // anything on the presented token itself.
  if (grant.clientId !== client.id) throw invalidGrant();

  if (grant.revokedAt !== null) return;

  await tokenGrantRepository(tx).revoke(grant.id, now);
}
