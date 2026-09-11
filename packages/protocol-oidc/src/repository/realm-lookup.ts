import { realms, type Database } from '@odudu/db';
import { eq } from 'drizzle-orm';

export interface RealmLookup {
  id: string;
  enabled: boolean;
}

// Resolving {realm} from the request path happens before any realm context
// exists to `SET LOCAL app.realm_id` into, so there is no id yet to scope
// this lookup by. `realms`' own isolation policy keys on `id`, and FORCE ROW
// LEVEL SECURITY binds every non-bypass role including the table owner —
// verified against a real container: an unscoped SELECT from the ordinary
// serving role (odudu_svc) returns zero rows regardless of name. `db` here
// must therefore be the owner connection (apps/server/src/app.ts's
// AppDeps.ownerDatabase; already used for migrations and bootstrap, and
// already understood in this codebase to bypass RLS — see the warning in
// apps/server/src/main.ts), not the RLS-scoped serving connection. The
// query still selects only `id` and `enabled`, so the bypass discloses
// nothing about a realm beyond what a client already learns one realm at a
// time by requesting its discovery document.
export function realmLookupRepository(db: Database) {
  return {
    async byName(name: string): Promise<RealmLookup | null> {
      const rows = await db
        .select({ id: realms.id, enabled: realms.enabled })
        .from(realms)
        .where(eq(realms.name, name));
      return rows[0] ?? null;
    },
  };
}
