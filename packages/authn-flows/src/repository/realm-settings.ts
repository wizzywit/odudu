import { realms, type RealmScopedDatabase } from '@odudu/db';
import { OduduError } from '@odudu/kernel';
import { eq } from 'drizzle-orm';

// The realm switches the flow engine reads. `realms` filters on `id` rather
// than a `realm_id` column, so a realm other than the transaction's own is
// invisible here for the same reason its sessions are.
export function realmSettingsRepository(tx: RealmScopedDatabase) {
  return {
    // Raises rather than defaulting when the row is not there. Every caller
    // passes the id of the realm its own transaction is already scoped to,
    // so an empty result means the realm was deleted mid-request or realm
    // context does not match — and a default would have to be `false`, the
    // value that switches a second factor off for everybody in the realm
    // that asked for one.
    async otpRequired(realmId: string): Promise<boolean> {
      const rows = await tx
        .select({ otpRequired: realms.otpRequired })
        .from(realms)
        .where(eq(realms.id, realmId));
      const row = rows[0];
      if (row === undefined) {
        throw new OduduError('realm_not_found', `no realm with id ${realmId} in this context`);
      }
      return row.otpRequired;
    },
  };
}
