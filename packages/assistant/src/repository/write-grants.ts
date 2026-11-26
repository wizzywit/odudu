// The grants made for single approved changes, as the upkeep sees them. A grant is
// revoked as the call returns; one left live by a process that died is revoked here.
import { sql, type SQL } from 'drizzle-orm';
import { type AssistantTx } from '#/repository/tx';

const TENANT = sql`nullif(current_setting('app.tenant_id', true), '')::uuid`;

// Served by `token_grants_assistant_write_live`, whose predicate (`scope = 'mcp:write'`
// and `revoked_at is null`) this statement repeats so the planner may use it.
export function revokeStaleStatement(before: Date, now: Date, limit: number): SQL {
  return sql`
    update token_grants g set revoked_at = ${now.toISOString()}::timestamptz
     where g.ctid in (
       select t.ctid from token_grants t
         join clients c on c.id = t.client_id and c.tenant_id = t.tenant_id
        where t.tenant_id = ${TENANT} and t.scope = 'mcp:write' and t.revoked_at is null
          and t.created_at < ${before.toISOString()}::timestamptz
          and c.client_id = 'odudu-assistant'
        order by t.created_at
        limit ${limit})`;
}

export function writeGrantRepository(tx: AssistantTx) {
  return {
    // Revokes up to `limit` live `mcp:write` grants of the built-in assistant client made
    // before `before`. Such a grant is made for one call and has no child grant or instance
    // beneath it (`mintAgentToken` runs without a `run`), so stamping `revoked_at` is the whole
    // of a revoke: `tokenGrantRepository.revoke` would only find nothing to cascade to.
    async revokeStale(before: Date, now: Date, limit: number): Promise<number> {
      const rows = await tx.execute(revokeStaleStatement(before, now, limit));
      return rows.count;
    },
  };
}
