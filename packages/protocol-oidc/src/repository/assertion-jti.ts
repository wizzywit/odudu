import { withRealm, type DatabaseHandle } from '@odudu/db';
import { clientAssertionJti } from '#/schema/client-assertion-jti';

// Takes the pool handle, not a `RealmScopedDatabase`, unlike every other
// repository in this package: `claim` opens its own `withRealm` inside
// itself, so a caller's enclosing request transaction is structurally out
// of reach and an unrelated rollback there can never release a spent jti
// — the same property `rotateRefreshToken` (usecase/refresh-rotation.ts)
// gets only because its caller (usecase/token-issuance.ts) remembers to
// open a fresh transaction. There is no call site yet for this one to
// forget.
export function assertionJtiRepository(database: DatabaseHandle) {
  return {
    // True the first time this (realm, client, jti) is claimed, false on a
    // replay: `onConflictDoNothing` against the primary key, with
    // `returning`, makes the check and the write one statement.
    async claim(
      realmId: string,
      oauthClientId: string,
      jti: string,
      expiresAt: Date,
    ): Promise<boolean> {
      return withRealm(database.db, realmId, async (tx) => {
        const rows = await tx
          .insert(clientAssertionJti)
          .values({ realmId, oauthClientId, jti, expiresAt })
          .onConflictDoNothing()
          .returning({ jti: clientAssertionJti.jti });
        return rows.length === 1;
      });
    },
  };
}
