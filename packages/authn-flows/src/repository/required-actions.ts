import { and, eq } from 'drizzle-orm';
import { type RealmScopedDatabase } from '@odudu/db';
import { userRequiredActions, type RequiredAction } from '#/schema/required-action';

// All persistence for what a subject still owes before a login of theirs
// can complete. `pendingFor` is what the login-submission gate reads;
// `add` and `complete` are how a realm's own policy and a redeemed action
// respectively change that set.
export function requiredActionRepository(tx: RealmScopedDatabase) {
  return {
    async pendingFor(subjectId: string): Promise<RequiredAction[]> {
      const rows = await tx
        .select({ action: userRequiredActions.action })
        .from(userRequiredActions)
        .where(eq(userRequiredActions.subjectId, subjectId));
      return rows.map((row) => row.action);
    },

    // Idempotent: an action a subject already owes stays owed, not
    // duplicated — the primary key (realm_id, subject_id, action) is what
    // makes a plain insert conflict rather than a second, harmless row.
    // `realmId` is explicit, the same way every other repository's insert
    // in this codebase takes one (executionRepository.create,
    // authenticationSessionRepository.create): nothing in a RealmScopedDatabase
    // hands a caller the realm id back out, so a fresh row's realm_id has to
    // come from the caller, not be inferred.
    async add(realmId: string, subjectId: string, action: RequiredAction): Promise<void> {
      await tx
        .insert(userRequiredActions)
        .values({ realmId, subjectId, action })
        .onConflictDoNothing();
    },

    async complete(subjectId: string, action: RequiredAction): Promise<void> {
      await tx
        .delete(userRequiredActions)
        .where(
          and(eq(userRequiredActions.subjectId, subjectId), eq(userRequiredActions.action, action)),
        );
    },
  };
}
