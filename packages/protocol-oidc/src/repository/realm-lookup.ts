import { realms, type Database } from '@odudu/db';
import { eq } from 'drizzle-orm';

export interface RealmLookup {
  id: string;
  enabled: boolean;
}

export interface NewRealm {
  id: string;
  name: string;
  displayName?: string | null;
}

// Resolving {realm} from the request path happens before any realm context
// exists to `SET LOCAL app.realm_id` into, so `db` must be the owner
// connection (apps/server/src/app.ts's AppDeps.ownerDatabase), not the
// RLS-scoped serving one, which reads zero rows here. ADR 0009's amendment
// of 2026-09-13 has why that bypass is safe and why it is the only one.
export function realmLookupRepository(db: Database) {
  return {
    async byName(name: string): Promise<RealmLookup | null> {
      const rows = await db
        .select({ id: realms.id, enabled: realms.enabled })
        .from(realms)
        .where(eq(realms.name, name));
      return rows[0] ?? null;
    },

    // The bootstrap seed command creates the first realm through this same
    // owner-connection bypass: `byName` above already establishes that no
    // realm context can exist before a realm is resolved, and creating one
    // is the other side of that same gap.
    async create(input: NewRealm): Promise<RealmLookup> {
      const rows = await db
        .insert(realms)
        .values({ id: input.id, name: input.name, displayName: input.displayName ?? null })
        .returning({ id: realms.id, enabled: realms.enabled });
      const row = rows[0];
      if (row === undefined) {
        throw new Error('insert into realms returned no row');
      }
      return row;
    },
  };
}
