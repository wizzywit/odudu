import { realms, type RealmScopedDatabase } from '@odudu/db';
import { type LockoutPolicy, type PasswordPolicy } from '@odudu/domain-identity';
import { OduduError } from '@odudu/kernel';
import { eq } from 'drizzle-orm';

// What one `advance` needs from the realm row: whether it demands a second
// factor, how long it lets a password stand, and how many wrong passwords
// an account tolerates.
export interface FlowSettings {
  otpRequired: boolean;
  passwordMaxAgeDays: number;
  lockout: LockoutPolicy;
}

// The realm switches the flow engine reads. `realms` filters on `id` rather
// than a `realm_id` column, so a realm other than the transaction's own is
// invisible here for the same reason its sessions are.
export function realmSettingsRepository(tx: RealmScopedDatabase) {
  return {
    // One read for every switch, not one per switch: whether a second factor
    // applies, whether a password has aged out and what a failed password
    // costs are all decided within one `advance`, and a column apiece would
    // be a full trip to `realms` each. Raises rather than defaulting on a
    // missing row — an empty result means the realm was deleted mid-request
    // or realm context does not match, and the defaults would drop the
    // second factor for a realm that asked for one, switch expiry off, and
    // decide a lockout from numbers no realm chose.
    async flowSettings(realmId: string): Promise<FlowSettings> {
      const rows = await tx
        .select({
          otpRequired: realms.otpRequired,
          passwordMaxAgeDays: realms.passwordMaxAgeDays,
          maxFailures: realms.bruteForceMaxFailures,
          lockoutSeconds: realms.bruteForceLockoutSeconds,
          maxLockoutSeconds: realms.bruteForceMaxLockoutSeconds,
          failureResetSeconds: realms.bruteForceFailureResetSeconds,
        })
        .from(realms)
        .where(eq(realms.id, realmId));
      const row = rows[0];
      if (row === undefined) {
        throw new OduduError('realm_not_found', `no realm with id ${realmId} in this context`);
      }
      return {
        otpRequired: row.otpRequired,
        passwordMaxAgeDays: row.passwordMaxAgeDays,
        lockout: {
          maxFailures: row.maxFailures,
          lockoutSeconds: row.lockoutSeconds,
          maxLockoutSeconds: row.maxLockoutSeconds,
          failureResetSeconds: row.failureResetSeconds,
        },
      };
    },

    // The whole policy, read only where a password is being written — the
    // change-password action. Raises on a missing row for the reason above:
    // a default of zero for the depth would accept a password the realm
    // remembers, and a default minimum length would accept a weak one.
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
