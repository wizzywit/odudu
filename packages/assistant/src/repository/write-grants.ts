// The grants made for single approved changes, as the upkeep sees them. A grant is
// revoked as the call returns; one left live by a process that died is revoked here.
import { sql } from 'drizzle-orm';
import { type AssistantTx } from '#/repository/tx';

const TENANT = sql`nullif(current_setting('app.tenant_id', true), '')::uuid`;

export function writeGrantRepository(tx: AssistantTx) {
  return {
    // Revokes up to `limit` live `mcp:write` grants of the built-in assistant client made
    // before `before`. Such a grant has no instance beneath it, so stamping it is the revoke.
    async revokeStale(before: Date, now: Date, limit: number): Promise<number> {
      const rows = await tx.execute(sql`
        update token_grants g set revoked_at = ${now.toISOString()}::timestamptz
         where g.ctid in (
           select t.ctid from token_grants t
             join clients c on c.id = t.client_id and c.tenant_id = t.tenant_id
            where t.tenant_id = ${TENANT} and c.client_id = 'odudu-assistant'
              and t.scope = 'mcp:write' and t.revoked_at is null
              and t.created_at < ${before.toISOString()}::timestamptz
            limit ${limit})`);
      return rows.count;
    },
  };
}
