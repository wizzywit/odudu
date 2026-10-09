import { withSavepoint, type TenantScopedDatabase } from '@odudu/db';
import { isSystemTenantId, MANAGE_TENANTS, TENANT_ADMIN } from '@odudu/domain-tenant';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { hasEnabledHolder } from '#/service/capability-ceiling';

export interface LastAdministratorRefusal {
  readonly kind: 'last_administrator';
  readonly reason: string;
}

/** Who performed a guarded write, for the row its refusal gets. */
export interface GuardedActor {
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface GuardedDoor<A extends string, R extends string> {
  readonly action: A;
  readonly resourceType: R;
  readonly resourceId: string;
  readonly actor: GuardedActor;
  readonly audit: (
    tx: TenantScopedDatabase,
    event: GuardedActor & {
      action: A;
      resourceType: R;
      resourceId: string;
      outcome: 'refused';
      detail: Record<string, unknown>;
    },
  ) => Promise<void>;
}

class LeavesNoAdministrator extends Error {}

const tenantRowsSchema = z.array(z.object({ tenant_id: z.string() }));

// The system tenant's administrators are whoever reaches every other tenant;
// anywhere else, whoever holds the role that nests every capability.
async function guardedCapability(tx: TenantScopedDatabase): Promise<string> {
  const rows = tenantRowsSchema.parse(
    await tx.execute(sql`SELECT current_setting('app.tenant_id') AS tenant_id`),
  );
  return isSystemTenantId(rows[0]?.tenant_id ?? '') ? MANAGE_TENANTS : TENANT_ADMIN;
}

/**
 * Runs `write`, and undoes it with a refused row when it leaves the tenant
 * with no enabled holder of `tenant-admin` (`manage-tenants` in `system`)
 * where there was one. The lock comes before anything `write` locks, so two
 * guarded writes in one tenant are judged one after the other, never
 * against the same count. A tenant with no holder to begin with is left as
 * it is: nothing is lost that was there.
 */
export async function guardLastAdministrator<T, A extends string, R extends string>(
  tx: TenantScopedDatabase,
  door: GuardedDoor<A, R>,
  write: (tx: TenantScopedDatabase) => Promise<T>,
): Promise<T | LastAdministratorRefusal> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('administrators'), hashtext(current_setting('app.tenant_id')))`,
  );
  const capability = await guardedCapability(tx);
  if (!(await hasEnabledHolder(tx, capability))) return write(tx);

  try {
    return await withSavepoint(tx, async (inner) => {
      const outcome = await write(inner);
      if (!(await hasEnabledHolder(inner, capability))) throw new LeavesNoAdministrator();
      return outcome;
    });
  } catch (error) {
    if (!(error instanceof LeavesNoAdministrator)) throw error;
  }

  const reason = `this would leave no enabled subject holding ${capability}`;
  await door.audit(tx, {
    action: door.action,
    resourceType: door.resourceType,
    resourceId: door.resourceId,
    actorSubjectId: door.actor.actorSubjectId,
    actorTenantId: door.actor.actorTenantId,
    actorClientId: door.actor.actorClientId,
    outcome: 'refused',
    detail: { reason },
  });
  return { kind: 'last_administrator', reason };
}
