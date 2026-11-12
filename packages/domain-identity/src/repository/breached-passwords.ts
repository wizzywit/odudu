import { type Database, type TenantScopedDatabase, tenants } from '@odudu/db';
import { and, eq, sql } from 'drizzle-orm';
import { breachedPasswordHashes } from '#/schema/breached-password-hashes';
import {
  breachedHash,
  type BreachedCheckMode,
  type BreachedOnError,
  type BreachedPasswordSource,
  type BreachedSettings,
} from '#/service/breached-password';

export interface BreachedHashRow {
  prefix: string;
  suffix: string;
}

function isMode(value: string): value is BreachedCheckMode {
  return value === 'off' || value === 'dataset' || value === 'remote';
}

function isOnError(value: string): value is BreachedOnError {
  return value === 'open' || value === 'closed';
}

export function breachedPasswordRepository(tx: TenantScopedDatabase) {
  return {
    /** One probe of the primary key; the table is read for one row and never listed. */
    datasetSource(): BreachedPasswordSource {
      return {
        async isBreached(password) {
          const { prefix, suffix } = breachedHash(password);
          const rows = await tx
            .select({ one: sql<number>`1` })
            .from(breachedPasswordHashes)
            .where(
              and(
                eq(breachedPasswordHashes.prefix, prefix),
                eq(breachedPasswordHashes.suffix, suffix),
              ),
            )
            .limit(1);
          return rows.length > 0;
        },
      };
    },

    /** One row probe, read only when a lookup found nothing. */
    async datasetIsEmpty(): Promise<boolean> {
      const rows = await tx
        .select({ one: sql<number>`1` })
        .from(breachedPasswordHashes)
        .limit(1);
      return rows.length === 0;
    },

    async settings(tenantId: string): Promise<BreachedSettings> {
      const [row] = await tx
        .select({ check: tenants.breachedCheck, onError: tenants.breachedOnError })
        .from(tenants)
        .where(eq(tenants.id, tenantId));
      // The columns carry a CHECK, so anything else is a defect to see, and
      // the narrower fallback to "off" would hide it.
      if (row === undefined || !isMode(row.check) || !isOnError(row.onError)) {
        throw new Error(`no breached-password settings for tenant ${tenantId}`);
      }
      return { check: row.check, onError: row.onError };
    },
  };
}

/**
 * Inserts one chunk on the owner connection and returns how many rows were new.
 * `on conflict do nothing` makes a second load of the same file add nothing.
 */
export async function insertBreachedHashes(
  db: Database,
  rows: readonly BreachedHashRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(breachedPasswordHashes)
    .values([...rows])
    .onConflictDoNothing()
    .returning({ prefix: breachedPasswordHashes.prefix });
  return inserted.length;
}

/** Rows the dataset holds, counted up to `cap`; `capped` says there are more. */
export async function breachedDatasetSize(
  db: Database,
  cap: number,
): Promise<{ rows: number; capped: boolean }> {
  const found = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from (select 1 from ${breachedPasswordHashes} limit ${cap + 1}) s`,
  );
  const n = found[0]?.n ?? 0;
  return n > cap ? { rows: cap, capped: true } : { rows: n, capped: false };
}
