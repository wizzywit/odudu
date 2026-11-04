import { tenants, withTenant, type Database, type TenantScopedDatabase } from '@odudu/db';
import { canonicalHostOf } from '@odudu/domain-tenant';
import { type TenantAddress } from '@odudu/kernel';
import { eq } from 'drizzle-orm';
import { consoleAddressOf } from '#/service/tenant-address';

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

export function canonicalHostById(runtime: Database, tenantId: string): Promise<string | null> {
  return withTenant(runtime, tenantId, (tx) => canonicalHostOf(tx, tenantId));
}

// Where a tenant is addressed now, read on each call so a switch of canonical
// address, in either direction, is followed by the next sign-in and refresh.
// A name no tenant has is addressed as a path, which nothing serves.
export function tenantAddresses(
  owner: Database,
  runtime: Database,
  base: URL,
): (tenant: string) => Promise<TenantAddress> {
  return async (tenant) => {
    const id = await tenantDirectory(owner).idByName(tenant);
    const host = id === null ? null : await canonicalHostById(runtime, id);
    return consoleAddressOf(base, tenant, host);
  };
}
