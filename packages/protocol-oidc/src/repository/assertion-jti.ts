import { withTenant, type DatabaseHandle, type TenantScopedDatabase } from '@odudu/db';
import { and, eq, sql } from 'drizzle-orm';
import { clientAssertionJti } from '#/schema/client-assertion-jti';

// `claim` takes the pool handle and opens a transaction of its own, so its
// write commits whatever becomes of the caller's: how a jti is spent after a
// request has failed. The rest act on the request's own transaction.
export function assertionJtiRepository(database: DatabaseHandle) {
  return {
    // A transaction-scoped advisory lock on (tenant, client, jti), tried and
    // never waited for: true when no other transaction holds it. Whoever holds
    // it is using this very assertion right now, so a false answer is a replay
    // and is refused at once, holding no connection (docs/protocols/rfc7523.md,
    // "A jti is never waited on").
    async tryLock(
      tx: TenantScopedDatabase,
      tenantId: string,
      oauthClientId: string,
      jti: string,
    ): Promise<boolean> {
      const rows = await tx.execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(hashtextextended(${`${tenantId}:${oauthClientId}:${jti}`}, 0)) as locked`,
      );
      return rows[0]?.locked === true;
    },

    // Whether a committed row already spends it. Read under the lock, so no
    // transaction is part-way through spending it.
    async spentWithin(
      tx: TenantScopedDatabase,
      tenantId: string,
      oauthClientId: string,
      jti: string,
    ): Promise<boolean> {
      const rows = await tx
        .select({ jti: clientAssertionJti.jti })
        .from(clientAssertionJti)
        .where(
          and(
            eq(clientAssertionJti.tenantId, tenantId),
            eq(clientAssertionJti.oauthClientId, oauthClientId),
            eq(clientAssertionJti.jti, jti),
          ),
        );
      return rows.length > 0;
    },

    // The spending itself, on the request's transaction, so a request that
    // succeeds needs no connection beside its own. Run only once the request
    // has done its work; one that fails spends through `claim` instead.
    async claimWithin(
      tx: TenantScopedDatabase,
      tenantId: string,
      oauthClientId: string,
      jti: string,
      expiresAt: Date,
    ): Promise<boolean> {
      const rows = await tx
        .insert(clientAssertionJti)
        .values({ tenantId, oauthClientId, jti, expiresAt })
        .onConflictDoNothing()
        .returning({ jti: clientAssertionJti.jti });
      return rows.length === 1;
    },

    // True the first time this (tenant, client, jti) is claimed, false on a
    // replay: `onConflictDoNothing` against the primary key, with
    // `returning`, makes the check and the write one statement.
    async claim(
      tenantId: string,
      oauthClientId: string,
      jti: string,
      expiresAt: Date,
    ): Promise<boolean> {
      return withTenant(database.db, tenantId, async (tx) => {
        const rows = await tx
          .insert(clientAssertionJti)
          .values({ tenantId, oauthClientId, jti, expiresAt })
          .onConflictDoNothing()
          .returning({ jti: clientAssertionJti.jti });
        return rows.length === 1;
      });
    },
  };
}
