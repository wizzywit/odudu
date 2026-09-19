import { type RealmScopedDatabase } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { consentScopes, consents } from '#/schema/consents';

export function consentRepository(tx: RealmScopedDatabase) {
  return {
    async grantedScopeIds(
      realmId: string,
      subjectId: string,
      clientId: string,
    ): Promise<ReadonlySet<string>> {
      const rows = await tx
        .select({ clientScopeId: consentScopes.clientScopeId })
        .from(consentScopes)
        .innerJoin(consents, eq(consentScopes.consentId, consents.id))
        .where(
          and(
            eq(consents.realmId, realmId),
            eq(consents.subjectId, subjectId),
            eq(consents.clientId, clientId),
          ),
        );
      return new Set(rows.map((row) => row.clientScopeId));
    },

    // Replaces the granted set; it does not merge. A consent screen shows
    // the whole set and the user's answer is the whole answer, so an
    // unticked box has to mean "revoked", not "unmentioned". The upsert, the
    // delete of what fell out of the new set, and the insert of what is new
    // to it all run against the one transaction `tx` already is.
    async record(
      realmId: string,
      subjectId: string,
      clientId: string,
      scopeIds: readonly string[],
    ): Promise<void> {
      const rows = await tx
        .insert(consents)
        .values({ id: newId(), realmId, subjectId, clientId })
        .onConflictDoUpdate({
          target: [consents.realmId, consents.subjectId, consents.clientId],
          set: { updatedAt: sql`now()` },
        })
        .returning({ id: consents.id });
      const row = rows[0];
      if (row === undefined) {
        throw new Error('upsert into consents returned no row');
      }
      const consentId = row.id;

      await tx
        .delete(consentScopes)
        .where(
          and(
            eq(consentScopes.consentId, consentId),
            scopeIds.length > 0
              ? notInArray(consentScopes.clientScopeId, [...scopeIds])
              : undefined,
          ),
        );

      if (scopeIds.length > 0) {
        await tx
          .insert(consentScopes)
          .values(scopeIds.map((clientScopeId) => ({ realmId, consentId, clientScopeId })))
          .onConflictDoNothing();
      }
    },
  };
}
