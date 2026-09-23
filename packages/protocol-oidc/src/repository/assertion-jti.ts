import { withTenant, type DatabaseHandle } from '@odudu/db';
import { clientAssertionJti } from '#/schema/client-assertion-jti';

// Takes the pool handle rather than a `TenantScopedDatabase`, so that
// `claim` opens its own `withTenant` inside itself and a caller's enclosing
// request transaction is structurally out of reach and an unrelated
// rollback there can never release a spent jti — the same property
// `rotateRefreshToken` (usecase/refresh-rotation.ts) gets only because its
// caller remembers to open a fresh transaction. `authenticatePrivateKeyJwt`
// (usecase/token-issuance.ts) is that call site, and calls it with the pool
// handle for exactly this reason.
export function assertionJtiRepository(database: DatabaseHandle) {
  return {
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
