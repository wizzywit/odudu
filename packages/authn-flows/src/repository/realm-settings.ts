import { realms, type RealmScopedDatabase } from '@odudu/db';
import { type PasswordPolicy } from '@odudu/domain-identity';
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

    // Read on its own rather than folded into otpRequired: that one answers
    // an applicability question asked before anybody is identified, and this
    // one only ever runs for a subject a factor has just bound. Raises on a
    // missing row for the reason above — a default of zero would switch
    // expiry off for the realm that asked for it.
    async passwordPolicy(realmId: string): Promise<PasswordPolicy> {
      const rows = await tx
        .select({
          minLength: realms.passwordMinLength,
          requireDigit: realms.passwordRequireDigit,
          requireUppercase: realms.passwordRequireUppercase,
          requireLowercase: realms.passwordRequireLowercase,
          requireSpecial: realms.passwordRequireSpecial,
          notUsername: realms.passwordNotUsername,
          notEmail: realms.passwordNotEmail,
          historyDepth: realms.passwordHistoryDepth,
          maxAgeDays: realms.passwordMaxAgeDays,
        })
        .from(realms)
        .where(eq(realms.id, realmId));
      const row = rows[0];
      if (row === undefined) {
        throw new OduduError('realm_not_found', `no realm with id ${realmId} in this context`);
      }
      return row;
    },
  };
}
