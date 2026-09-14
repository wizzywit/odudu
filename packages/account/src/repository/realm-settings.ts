import { realms, type Database } from '@odudu/db';
import { eq } from 'drizzle-orm';

export interface RealmSettings {
  id: string;
  name: string;
  displayName: string | null;
  enabled: boolean;
  verifyEmail: boolean;
  registrationAllowed: boolean;
  resetPasswordAllowed: boolean;
}

// Resolving {realm} from a request path happens before any realm context
// exists to `SET LOCAL app.realm_id` into, so `db` must be the owner
// (RLS-bypassing) connection — the same requirement and the same amendment
// (ADR 0009, 2026-09-13) that packages/protocol-oidc/src/repository/realm-lookup.ts
// documents. Duplicated rather than imported: that file lives in a protocol
// package's internals, which no feature reaches into (CLAUDE.md, Layering).
export function realmSettingsRepository(db: Database) {
  return {
    async byName(name: string): Promise<RealmSettings | null> {
      const rows = await db.select().from(realms).where(eq(realms.name, name));
      const row = rows[0];
      return row === undefined
        ? null
        : {
            id: row.id,
            name: row.name,
            displayName: row.displayName,
            enabled: row.enabled,
            verifyEmail: row.verifyEmail,
            registrationAllowed: row.registrationAllowed,
            resetPasswordAllowed: row.resetPasswordAllowed,
          };
    },
  };
}
