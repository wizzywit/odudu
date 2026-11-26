// The turns in progress, counted in the database so a tenant's limit on
// answers at once holds across every server. A lease lapses at its expiry, so
// a process that dies mid-turn gives its place back without anyone releasing it.
import { sql, type SQL } from 'drizzle-orm';
import { type AssistantTx } from '#/repository/tx';

const TENANT = sql`nullif(current_setting('app.tenant_id', true), '')::uuid`;

export interface LeaseInput {
  readonly turnId: string;
  readonly conversationId: string;
  /** The most live leases the tenant may hold. */
  readonly max: number;
  readonly now: Date;
  readonly ttlMs: number;
}

export type LeaseResult = { ok: true } | { ok: false; live: number };

// Deletes leases that expired before `before`, the oldest `batch` of them,
// through assistant_turn_leases_live.
export function pruneLeasesStatement(before: Date, batch: number): SQL {
  return sql`
    delete from assistant_turn_leases
     where ctid in (
       select ctid from assistant_turn_leases
        where tenant_id = ${TENANT} and expires_at < ${before.toISOString()}::timestamptz
        order by expires_at
        limit ${batch})`;
}

export function leaseRepository(tx: AssistantTx) {
  return {
    // Counting and inserting happen under one lock per tenant, so two servers
    // admitting a turn at the same moment cannot both take the last place.
    async acquire(input: LeaseInput): Promise<LeaseResult> {
      await tx.execute(sql`
        select pg_advisory_xact_lock(
          hashtextextended('assistant_turn_leases:' || current_setting('app.tenant_id', true), 0))`);
      const now = input.now.toISOString();
      const [counted] = await tx.execute<{ live: string }>(sql`
        select count(*)::text as live from assistant_turn_leases
         where tenant_id = ${TENANT} and expires_at > ${now}::timestamptz`);
      const live = Number(counted?.live ?? 0);
      if (live >= input.max) return { ok: false, live };
      await tx.execute(sql`
        insert into assistant_turn_leases (tenant_id, turn_id, conversation_id, created_at, expires_at)
        values (${TENANT}, ${input.turnId}, ${input.conversationId}, ${now}::timestamptz,
                ${new Date(input.now.getTime() + input.ttlMs).toISOString()}::timestamptz)`);
      return { ok: true };
    },

    async release(turnId: string): Promise<void> {
      await tx.execute(sql`
        delete from assistant_turn_leases where tenant_id = ${TENANT} and turn_id = ${turnId}`);
    },

    async prune(before: Date, batch: number): Promise<number> {
      return (await tx.execute(pruneLeasesStatement(before, batch))).count;
    },
  };
}
