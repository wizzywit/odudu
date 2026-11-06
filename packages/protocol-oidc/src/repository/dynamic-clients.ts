import { type TenantScopedDatabase } from '@odudu/db';
import { sql } from 'drizzle-orm';

export function dynamicClientRepository(tx: TenantScopedDatabase) {
  return {
    // The self-registered public client that has waited longest and never did
    // anything: enabled, never approved, no consent, no grant, no live code and
    // no sign-in under way, the rule `odudu reap` applies after a week. Walks
    // clients_anonymous_by_created in order; the sign-in test is served by
    // authentication_sessions_by_pending_client. A confidential one is never
    // offered: it may be a working integration with a service account, so at
    // the ceiling with only those left a registration is refused.
    async evictable(tenantId: string, now: Date): Promise<string | null> {
      const rows = await tx.execute<{ id: string }>(sql`
        SELECT c.id FROM clients c
         WHERE c.tenant_id = ${tenantId}
           AND c.registration_origin = 'anonymous'
           AND c.type = 'public'
           AND c.enabled
           AND c.approved_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM consents k WHERE k.client_id = c.id)
           AND NOT EXISTS (SELECT 1 FROM token_grants g WHERE g.client_id = c.id)
           AND NOT EXISTS (
             SELECT 1 FROM authorization_codes a
              WHERE a.client_id = c.id AND a.expires_at > ${now.toISOString()}::timestamptz)
           AND NOT EXISTS (
             SELECT 1 FROM authentication_sessions s
              WHERE s.tenant_id = c.tenant_id
                AND s.pending_request ->> 'clientId' = c.client_id
                AND s.expires_at > ${now.toISOString()}::timestamptz)
         ORDER BY c.created_at, c.id
         LIMIT 1`);
      return rows[0]?.id ?? null;
    },
  };
}
