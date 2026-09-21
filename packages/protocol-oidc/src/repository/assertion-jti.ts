import { type RealmScopedDatabase } from '@odudu/db';
import { clientAssertionJti } from '#/schema/client-assertion-jti';

export function assertionJtiRepository(tx: RealmScopedDatabase) {
  return {
    // True the first time this (realm, client, jti) is claimed, false on a
    // replay: `onConflictDoNothing` against the primary key, with
    // `returning`, makes the check and the write one statement. Must run
    // in a transaction of its own, never the caller's enclosing request
    // transaction — an unrelated rollback there must not release the jti,
    // the property `rotateRefreshToken` (usecase/token-issuance.ts) pins
    // for a rotated refresh token, by the same means: its caller opens a
    // fresh `withRealm` transaction rather than reusing its own.
    async claim(
      realmId: string,
      oauthClientId: string,
      jti: string,
      expiresAt: Date,
    ): Promise<boolean> {
      const rows = await tx
        .insert(clientAssertionJti)
        .values({ realmId, oauthClientId, jti, expiresAt })
        .onConflictDoNothing()
        .returning({ jti: clientAssertionJti.jti });
      return rows.length === 1;
    },
  };
}
