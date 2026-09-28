import { tenants, type Database, type TenantScopedDatabase } from '@odudu/db';
import { eq } from 'drizzle-orm';

// A sign-in names its tenant before any tenant context exists, so the name
// is resolved on the owner connection — the one read ADR 0009's amendment
// of 2026-09-13 allows outside tenant context.
export function tenantDirectory(db: Database) {
  return {
    async idByName(name: string): Promise<string | null> {
      const rows = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.name, name));
      return rows[0]?.id ?? null;
    },
  };
}

export function tenantNameRepository(tx: TenantScopedDatabase) {
  return {
    async nameOf(tenantId: string): Promise<string | null> {
      const rows = await tx
        .select({ name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, tenantId));
      return rows[0]?.name ?? null;
    },
  };
}
