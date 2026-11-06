import { type TenantScopedDatabase } from '@odudu/db';
import { sql, type SQL } from 'drizzle-orm';

// Candidates tried before a registration at the ceiling gives up: each is one
// a concurrent consent or sign-in claimed between choosing and deleting it.
const EVICTION_ATTEMPTS = 5;

// A self-registered public client that never did anything: enabled, never
// approved, no consent, no grant, no live code and no sign-in under way, the
// rule `odudu reap` applies after a week. A confidential one is never offered:
// it may be a working integration with a service account. The sign-in test is
// served by authentication_sessions_by_pending_client.
function unused(now: Date, oauthClientId: SQL = sql`c.client_id`): SQL {
  const at = sql`${now.toISOString()}::timestamptz`;
  return sql`c.registration_origin = 'anonymous'
    AND c.type = 'public'
    AND c.enabled
    AND c.approved_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM consents k WHERE k.client_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM token_grants g WHERE g.client_id = c.id)
    AND NOT EXISTS (
      SELECT 1 FROM authorization_codes a WHERE a.client_id = c.id AND a.expires_at > ${at})
    AND NOT EXISTS (
      SELECT 1 FROM authentication_sessions s
       WHERE s.tenant_id = c.tenant_id
         AND s.pending_request ->> 'clientId' = ${oauthClientId}
         AND s.expires_at > ${at})`;
}

export function dynamicClientRepository(tx: TenantScopedDatabase) {
  return {
    // Removes the self-registered client that has waited longest and returns
    // its id, or null when none can go. The candidate is row-locked (a row a
    // concurrent consent or sign-in already holds is skipped, and one that
    // starts afterwards waits behind this transaction) and the DELETE asks
    // again whether it is still unused, so a client somebody began using is
    // never removed. Walks clients_anonymous_by_created in order.
    async evict(tenantId: string, now: Date): Promise<string | null> {
      const tried: string[] = [];
      for (let attempt = 0; attempt < EVICTION_ATTEMPTS; attempt += 1) {
        const skipping =
          tried.length === 0
            ? sql`true`
            : sql`c.id NOT IN (${sql.join(
                tried.map((id) => sql`${id}`),
                sql`, `,
              )})`;
        const rows = await tx.execute<{ id: string; client_id: string }>(sql`
          SELECT c.id, c.client_id FROM clients c
           WHERE c.tenant_id = ${tenantId} AND ${skipping} AND ${unused(now)}
           ORDER BY c.created_at, c.id
           LIMIT 1
             FOR UPDATE OF c SKIP LOCKED`);
        const candidate = rows[0];
        if (candidate === undefined) return null;
        if (await this.removeIfUnused(candidate.id, candidate.client_id, now)) return candidate.id;
        tried.push(candidate.id);
      }
      return null;
    },

    // The OAuth client id is passed, not read from the row, so the sign-in
    // lookup is an equality on a value the planner knows.
    async removeIfUnused(id: string, oauthClientId: string, now: Date): Promise<boolean> {
      const rows = await tx.execute<{ id: string }>(
        sql`DELETE FROM clients c
             WHERE c.id = ${id} AND ${unused(now, sql`${oauthClientId}`)}
         RETURNING c.id`,
      );
      return rows.length > 0;
    },

    // Taken when a sign-in is parked for a client: the row cannot be evicted
    // while this transaction is open, and false says it already was.
    async holdForSignIn(tenantId: string, oauthClientId: string): Promise<boolean> {
      const rows = await tx.execute(sql`
        SELECT 1 FROM clients
         WHERE tenant_id = ${tenantId} AND client_id = ${oauthClientId}
           FOR KEY SHARE`);
      return rows.length > 0;
    },
  };
}
