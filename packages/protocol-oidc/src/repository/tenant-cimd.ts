import { tenants, type TenantScopedDatabase } from '@odudu/db';
import { eq } from 'drizzle-orm';

// Read inside the request's transaction, so the setting an administrator has
// just changed applies from the next request. `tenants` filters on `id`, and
// row-level security hides every tenant but the transaction's own.
export function tenantCimdRepository(tx: TenantScopedDatabase) {
  return {
    async enabled(tenantId: string): Promise<boolean> {
      const rows = await tx
        .select({ cimdEnabled: tenants.cimdEnabled })
        .from(tenants)
        .where(eq(tenants.id, tenantId));
      return rows[0]?.cimdEnabled ?? false;
    },
  };
}
