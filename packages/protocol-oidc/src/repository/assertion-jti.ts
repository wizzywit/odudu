import { withTenant, type DatabaseHandle, type TenantScopedDatabase } from '@odudu/db';
import { clientAssertionJti } from '#/schema/client-assertion-jti';

// `claim` takes the pool handle and opens a transaction of its own, so its
// write commits whatever becomes of the caller's: the way a jti is spent
// after a request has failed. `claimWithin` is the same write on the
// request's own transaction.
export function assertionJtiRepository(database: DatabaseHandle) {
  return {
    // The same statement on a transaction the caller already holds, so a
    // request authenticating by assertion needs no second pooled connection
    // beside it. A rollback releases the jti, which is why a request that
    // fails after this spends it again through `claim`, once its connection
    // is back (usecase/private-key-jwt-authentication.ts).
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
