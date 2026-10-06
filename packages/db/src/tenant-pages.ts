import { asc, gt } from 'drizzle-orm';
import { type Database } from '#/client';
import { tenants } from '#/schema/index';

// Tenants read per page by a pass that visits every one. A page is all this
// holds at a time, so the walk's memory is this and not the tenant count.
export const TENANT_PAGE_SIZE = 500;

// The tenant ids, in key order, a page at a time: a keyset walk on the
// primary key, so every page is one index range however many tenants follow.
// Read on the owner connection, which a tenant's own policy cannot scope.
export async function* tenantIdPages(
  db: Database,
  size: number = TENANT_PAGE_SIZE,
): AsyncGenerator<readonly string[]> {
  let after: string | undefined;
  for (;;) {
    const rows = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(after === undefined ? undefined : gt(tenants.id, after))
      .orderBy(asc(tenants.id))
      .limit(size);
    const last = rows[rows.length - 1];
    if (last === undefined) return;
    yield rows.map((row) => row.id);
    if (rows.length < size) return;
    after = last.id;
  }
}
