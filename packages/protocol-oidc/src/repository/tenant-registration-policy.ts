import { tenants, type TenantScopedDatabase } from '@odudu/db';
import { eq } from 'drizzle-orm';

// Read inside the issuing transaction, so a policy an administrator has just
// changed applies from the next refresh. `tenants` filters on `id`, and
// row-level security hides every tenant but the transaction's own, so another
// tenant's id answers null.
export function tenantRegistrationPolicyRepository(tx: TenantScopedDatabase) {
  return {
    async policy(tenantId: string): Promise<string | null> {
      const rows = await tx
        .select({ policy: tenants.clientRegistrationPolicy })
        .from(tenants)
        .where(eq(tenants.id, tenantId));
      return rows[0]?.policy ?? null;
    },
  };
}
