import { tenants, type TenantScopedDatabase } from '@odudu/db';
import { eq } from 'drizzle-orm';

// Read inside the caller's transaction; row-level security hides every
// tenant but its own, so a foreign id reads as disabled.
export function tenantEnabledRepository(tx: TenantScopedDatabase) {
  return {
    async enabled(tenantId: string): Promise<boolean> {
      const rows = await tx
        .select({ enabled: tenants.enabled })
        .from(tenants)
        .where(eq(tenants.id, tenantId));
      return rows[0]?.enabled ?? false;
    },
  };
}
