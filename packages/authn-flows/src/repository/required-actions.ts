import { and, eq } from 'drizzle-orm';
import { type TenantScopedDatabase } from '@odudu/db';
import { userRequiredActions, type RequiredAction } from '#/schema/required-action';

// All persistence for what a subject still owes before a login of theirs
// can complete. `pendingFor` is what the login-submission gate reads;
// `add` and `complete` are how a tenant's own policy and a redeemed action
// respectively change that set.
export function requiredActionRepository(tx: TenantScopedDatabase) {
  return {
    async pendingFor(subjectId: string): Promise<RequiredAction[]> {
      const rows = await tx
        .select({ action: userRequiredActions.action })
        .from(userRequiredActions)
        .where(eq(userRequiredActions.subjectId, subjectId));
      return rows.map((row) => row.action);
    },

    // Idempotent: an action a subject already owes stays owed, not
    // duplicated — the primary key (tenant_id, subject_id, action) is what
    // makes a plain insert conflict rather than a second, harmless row.
    // `tenantId` is explicit, the same way every other repository's insert
    // in this codebase takes one (executionRepository.create,
    // authenticationSessionRepository.create): nothing in a TenantScopedDatabase
    // hands a caller the tenant id back out, so a fresh row's tenant_id has to
    // come from the caller, not be inferred.
    async add(tenantId: string, subjectId: string, action: RequiredAction): Promise<void> {
      await tx
        .insert(userRequiredActions)
        .values({ tenantId, subjectId, action })
        .onConflictDoNothing();
    },

    async complete(subjectId: string, action: RequiredAction): Promise<void> {
      await tx
        .delete(userRequiredActions)
        .where(
          and(eq(userRequiredActions.subjectId, subjectId), eq(userRequiredActions.action, action)),
        );
    },

    // The admin API's `PUT .../required-actions`: a wholesale replacement,
    // not an add — an action left out of `actions` is one the operator
    // means to clear, the same way a client amendment replaces a list field
    // wholesale rather than appending to it.
    async replaceAll(
      tenantId: string,
      subjectId: string,
      actions: readonly RequiredAction[],
    ): Promise<void> {
      await tx.delete(userRequiredActions).where(eq(userRequiredActions.subjectId, subjectId));
      for (const action of new Set(actions)) {
        await tx.insert(userRequiredActions).values({ tenantId, subjectId, action });
      }
    },
  };
}
