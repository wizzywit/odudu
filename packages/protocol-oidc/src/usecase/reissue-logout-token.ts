import { signingKeyRepository, signJwt } from '@odudu/crypto';
import { type TenantScopedDatabase } from '@odudu/db';
import { LOGOUT_TOKEN_TYP, reissuedLogoutTokenClaims } from '#/service/logout-token';

// Signs a stored Logout Token again under `issuer`, with the tenant's active
// key, so a delivery names the tenant's address as it is when it is sent and
// is valid from `now`, the time of this attempt.
// Anything that is not such a token goes out as it was stored: the relying
// party refuses it, which is what it would have done anyway.
export async function reissueLogoutToken(
  tx: TenantScopedDatabase,
  deps: { readonly kek: Uint8Array },
  token: string,
  issuer: string,
  now: Date,
): Promise<string> {
  const claims = reissuedLogoutTokenClaims(token, issuer, now);
  if (claims === null) return token;
  const key = await signingKeyRepository(tx).active();
  return signJwt({ ...claims }, { key, kek: deps.kek, typ: LOGOUT_TOKEN_TYP });
}
