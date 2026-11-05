import { type TenantScopedDatabase } from '@odudu/db';
import { sql } from 'drizzle-orm';

export function cimdClientRepository(tx: TenantScopedDatabase) {
  return {
    // The metadata document client that has gone longest unused and never
    // completed anything: no consent recorded, no refresh token that can still
    // be used, no authorization code that has not expired. Walks
    // clients_cimd_by_use in order and stops at the first such row.
    async evictable(): Promise<string | null> {
      const rows = await tx.execute<{ id: string }>(sql`
        SELECT c.id FROM clients c
         WHERE c.registration_origin = 'cimd'
           AND NOT EXISTS (SELECT 1 FROM consents k WHERE k.client_id = c.id)
           AND NOT EXISTS (
             SELECT 1 FROM token_grants g
               JOIN refresh_tokens r ON r.tenant_id = g.tenant_id AND r.grant_id = g.id
              WHERE g.client_id = c.id AND r.used_at IS NULL AND r.expires_at > now())
           AND NOT EXISTS (
             SELECT 1 FROM authorization_codes a
              WHERE a.client_id = c.id AND a.expires_at > now())
         ORDER BY c.metadata_used_at, c.id
         LIMIT 1`);
      return rows[0]?.id ?? null;
    },
  };
}
