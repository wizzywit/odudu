import { signingKeyRepository } from '@odudu/crypto';
import { type TenantScopedDatabase } from '@odudu/db';

/**
 * Why the tenant cannot sign a client's ID tokens with `alg`, or null when
 * one of its non-retired keys can: a `rotating` key counts, so a client may
 * move to an algorithm before its key is promoted.
 */
export async function idTokenAlgUnavailable(
  tx: TenantScopedDatabase,
  alg: string | null,
): Promise<string | null> {
  if (alg === null) return null;
  const available = await signingKeyRepository(tx).algorithmsAvailable();
  return available.includes(alg)
    ? null
    : `id_token_signed_response_alg ${alg} is not produced by any of this tenant's signing keys (${available.join(', ') || 'none'})`;
}
