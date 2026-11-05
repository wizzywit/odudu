import { withTenant, type DatabaseHandle } from '@odudu/db';
import { and, eq, gt, lte, notInArray, sql } from 'drizzle-orm';
import { clientMetadataCache } from '#/schema/client-metadata-cache';

/** Most documents kept per tenant; a tenant's 1,001st fetch evicts its oldest. */
export const CIMD_CACHE_MAX_ROWS = 1000;

export interface CachedCimdDocument {
  readonly body: unknown;
  readonly expiresAt: Date;
}

// Each method opens its own transaction: the network fetch between a miss and
// the store must not hold a connection.
export function cimdCacheRepository(database: DatabaseHandle) {
  return {
    async find(tenantId: string, url: string, now: Date): Promise<CachedCimdDocument | null> {
      return withTenant(database.db, tenantId, async (tx) => {
        const [row] = await tx
          .select({ body: clientMetadataCache.body, expiresAt: clientMetadataCache.expiresAt })
          .from(clientMetadataCache)
          .where(
            and(
              eq(clientMetadataCache.tenantId, tenantId),
              eq(clientMetadataCache.url, url),
              gt(clientMetadataCache.expiresAt, now),
            ),
          );
        return row ?? null;
      });
    },

    // Upserts, then keeps the tenant's `maxRows` most recently fetched. Served
    // by client_metadata_cache_by_fetch: the inner select reads `maxRows`
    // index entries and the delete touches only what falls outside them.
    async store(
      tenantId: string,
      url: string,
      body: unknown,
      now: Date,
      expiresAt: Date,
      maxRows: number,
    ): Promise<void> {
      await withTenant(database.db, tenantId, async (tx) => {
        // One writer per tenant at a time, so the trim below sees every
        // other store's row and the ceiling holds under concurrency.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${tenantId}))`);
        await tx
          .insert(clientMetadataCache)
          .values({ tenantId, url, body, fetchedAt: now, expiresAt })
          .onConflictDoUpdate({
            target: [clientMetadataCache.tenantId, clientMetadataCache.url],
            set: { body, fetchedAt: now, expiresAt },
            // `now` is when the fetch began, so a slower earlier fetch that
            // finishes last cannot replace a document fetched after it.
            setWhere: lte(clientMetadataCache.fetchedAt, now),
          });
        await tx.delete(clientMetadataCache).where(
          and(
            eq(clientMetadataCache.tenantId, tenantId),
            notInArray(
              clientMetadataCache.url,
              sql`(select url from client_metadata_cache
                    where tenant_id = ${tenantId}
                    order by fetched_at desc, url
                    limit ${maxRows})`,
            ),
          ),
        );
      });
    },
  };
}
