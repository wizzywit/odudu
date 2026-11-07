import { type TenantScopedDatabase } from '@odudu/db';
import { and, eq, gt, lte, sql } from 'drizzle-orm';
import { idempotencyKeys } from '#/schema/idempotency-keys';

// The first integer of the capacity lock, which cannot meet a lock another
// subsystem keys on a single value. The per-key lock is a 64-bit hash of a
// text that begins `idempotency:`.
const CAPACITY_LOCK = 20_261_106;

export interface IdempotentResponse {
  readonly status: number;
  readonly body: string;
  readonly headers: Record<string, string>;
}

export interface StoredIdempotency {
  readonly fingerprint: string;
  readonly response: IdempotentResponse;
}

export interface NewIdempotency {
  readonly tenantId: string;
  readonly key: string;
  readonly route: string;
  readonly fingerprint: string;
  readonly response: IdempotentResponse;
  readonly now: Date;
  readonly expiresAt: Date;
}

interface LockRow {
  got: boolean;
}

// Every method runs in the transaction of the call it records.
export function idempotencyRepository(tx: TenantScopedDatabase) {
  return {
    // Held to the end of the transaction. Whoever holds it is the call in
    // flight for this key; nobody waits for it.
    async tryLockKey(tenantId: string, key: string, route: string): Promise<boolean> {
      const rows = await tx.execute(
        sql`select pg_try_advisory_xact_lock(
              hashtextextended('idempotency:' || ${tenantId}::text || ':' || ${key}::text || ':' || ${route}::text, 0)) as got`,
      );
      return (rows as unknown as LockRow[])[0]?.got === true;
    },

    // One writer per tenant at a time, so a count read under it sees every
    // other row about to commit.
    async lockCapacity(tenantId: string): Promise<void> {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${CAPACITY_LOCK}::int, hashtext(${tenantId}::text))`,
      );
    },

    async find(
      tenantId: string,
      key: string,
      route: string,
      now: Date,
    ): Promise<StoredIdempotency | null> {
      const [row] = await tx
        .select()
        .from(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.tenantId, tenantId),
            eq(idempotencyKeys.key, key),
            eq(idempotencyKeys.route, route),
            gt(idempotencyKeys.expiresAt, now),
          ),
        );
      if (row === undefined) return null;
      return {
        fingerprint: row.fingerprint,
        response: {
          status: row.responseStatus,
          body: row.responseBody,
          headers: row.responseHeaders,
        },
      };
    },

    // Reads at most `limit` index entries of idempotency_keys_by_expiry, whatever
    // the tenant holds.
    async countLive(tenantId: string, now: Date, limit: number): Promise<number> {
      const rows = await tx.execute(
        sql`select count(*)::int as n from (
              select 1 from idempotency_keys
               where tenant_id = ${tenantId} and expires_at > ${now.toISOString()}::timestamptz
               limit ${limit}) live`,
      );
      return (rows as unknown as { n: number }[])[0]?.n ?? 0;
    },

    // An expired row of the same key is replaced; a live one is never touched.
    async insert(row: NewIdempotency): Promise<void> {
      const values = {
        tenantId: row.tenantId,
        key: row.key,
        route: row.route,
        fingerprint: row.fingerprint,
        status: 'completed',
        responseStatus: row.response.status,
        responseBody: row.response.body,
        responseHeaders: row.response.headers,
        createdAt: row.now,
        expiresAt: row.expiresAt,
      };
      await tx
        .insert(idempotencyKeys)
        .values(values)
        .onConflictDoUpdate({
          target: [idempotencyKeys.tenantId, idempotencyKeys.key, idempotencyKeys.route],
          set: values,
          setWhere: lte(idempotencyKeys.expiresAt, row.now),
        });
    },
  };
}
