import { type TenantScopedDatabase } from '@odudu/db';
import { eq } from 'drizzle-orm';
import { groups, subjectGroups } from '#/schema/groups';
import { roles, subjectRoles } from '#/schema/roles';

/**
 * Hands a subject just created the tenant's default roles and default groups.
 * Every door that creates a user subject calls this, so none of them can
 * drift on what a new subject starts with. A membership the caller already
 * wrote is left as it is.
 */
export async function grantNewSubjectDefaults(
  tx: TenantScopedDatabase,
  subjectId: string,
): Promise<void> {
  const defaultRoles = await tx
    .select({ tenantId: roles.tenantId, roleId: roles.id })
    .from(roles)
    .where(eq(roles.defaultForNewSubjects, true));
  if (defaultRoles.length > 0) {
    await tx
      .insert(subjectRoles)
      .values(defaultRoles.map((role) => ({ ...role, subjectId })))
      .onConflictDoNothing();
  }
  const defaultGroups = await tx
    .select({ tenantId: groups.tenantId, groupId: groups.id })
    .from(groups)
    .where(eq(groups.defaultForNewSubjects, true));
  if (defaultGroups.length > 0) {
    await tx
      .insert(subjectGroups)
      .values(defaultGroups.map((group) => ({ ...group, subjectId })))
      .onConflictDoNothing();
  }
}
