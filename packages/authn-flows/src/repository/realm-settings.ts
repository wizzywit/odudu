import { realms, type RealmScopedDatabase } from '@odudu/db';
import { eq } from 'drizzle-orm';

// The realm switches the flow engine reads. `realms` filters on `id` rather
// than a `realm_id` column, so a realm other than the transaction's own is
// invisible here for the same reason its sessions are.
export function realmSettingsRepository(tx: RealmScopedDatabase) {
  return {
    async otpRequired(realmId: string): Promise<boolean> {
      const rows = await tx
        .select({ otpRequired: realms.otpRequired })
        .from(realms)
        .where(eq(realms.id, realmId));
      return rows[0]?.otpRequired ?? false;
    },
  };
}
