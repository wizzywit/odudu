import { type TenantScopedDatabase } from '@odudu/db';
import { sql } from 'drizzle-orm';

export function dynamicClientRepository(tx: TenantScopedDatabase) {
  return {
    // The self-registered client that has waited longest and never did
    // anything: enabled (a disabled one is an administrator's decision),
    // never approved, no consent, no grant, no live code and no sign-in under
    // way for it, the same rule `odudu reap` applies after a week. Walks
    // clients_anonymous_by_created in order and stops at the first such row;
    // the sign-in test is served by authentication_sessions_by_pending_client.
    // Only a public client is offered, as `odudu reap` only removes one: a
    // confidential anonymous client may be a working service integration with
    // a service account that deleting it would leave behind, so at the ceiling
    // with nothing but those left a registration is refused instead.
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
