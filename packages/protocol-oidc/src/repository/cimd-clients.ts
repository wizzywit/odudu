import { type TenantScopedDatabase } from '@odudu/db';
import { sql, type SQL } from 'drizzle-orm';

/** The longest an access token lives: tenants_access_token_ttl_range. */
export const ACCESS_TOKEN_CEILING_SECONDS = 3600;

// Whether the client `clientId` (a column reference) holds a refresh token
// that is, or was within an access token's life, usable: one the grant has not
// revoked and that was not spent. An access token outlives the refresh token
// that minted it by at most the ceiling above, and deleting the client would
// make introspection call it inactive.
export function holdsLiveRefreshToken(clientId: SQL, now: Date): SQL {
  const horizon = new Date(now.getTime() - ACCESS_TOKEN_CEILING_SECONDS * 1000).toISOString();
  return sql`EXISTS (
    SELECT 1 FROM token_grants g
      JOIN refresh_tokens r ON r.tenant_id = g.tenant_id AND r.grant_id = g.id
     WHERE g.client_id = ${clientId}
       AND g.revoked_at IS NULL
       AND r.used_at IS NULL
       AND r.expires_at > ${horizon}::timestamptz)`;
}

export function cimdClientRepository(tx: TenantScopedDatabase) {
  return {
    // The metadata document client that has gone longest unused and never
    // completed anything: enabled (a disabled one is an administrator's
    // decision and stays), no consent recorded, no usable refresh token, no
    // authorization code that has not expired. Walks clients_cimd_by_use in
    // order and stops at the first such row.
    async evictable(now: Date): Promise<string | null> {
      const rows = await tx.execute<{ id: string }>(sql`
        SELECT c.id FROM clients c
         WHERE c.registration_origin = 'cimd'
           AND c.enabled
           AND NOT EXISTS (SELECT 1 FROM consents k WHERE k.client_id = c.id)
           AND NOT ${holdsLiveRefreshToken(sql`c.id`, now)}
           AND NOT EXISTS (
             SELECT 1 FROM authorization_codes a
              WHERE a.client_id = c.id AND a.expires_at > ${now.toISOString()}::timestamptz)
         ORDER BY c.metadata_used_at, c.id
         LIMIT 1`);
      return rows[0]?.id ?? null;
    },
  };
}
