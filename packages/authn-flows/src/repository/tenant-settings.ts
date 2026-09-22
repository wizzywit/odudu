import { tenants, type TenantScopedDatabase } from '@odudu/db';
import { type LockoutPolicy, type PasswordPolicy } from '@odudu/domain-identity';
import { OduduError } from '@odudu/kernel';
import { eq } from 'drizzle-orm';

// What one `advance` needs from the tenant row: whether it demands a second
// factor, how long it lets a password stand, and how many wrong passwords
// an account tolerates.
export interface FlowSettings {
  otpRequired: boolean;
  passwordMaxAgeDays: number;
  lockout: LockoutPolicy;
}

// The tenant switches the flow engine reads. `tenants` filters on `id` rather
// than a `tenant_id` column, so a tenant other than the transaction's own is
// invisible here for the same reason its sessions are.
export function tenantSettingsRepository(tx: TenantScopedDatabase) {
  return {
    // One read for every switch, not one per switch: whether a second factor
    // applies, whether a password has aged out and what a failed password
    // costs are all decided within one `advance`, and a column apiece would
    // be a full trip to `tenants` each. Raises rather than defaulting on a
    // missing row — an empty result means the tenant was deleted mid-request
    // or tenant context does not match, and the defaults would drop the
    // second factor for a tenant that asked for one, switch expiry off, and
    // decide a lockout from numbers no tenant chose.
    async flowSettings(tenantId: string): Promise<FlowSettings> {
      const rows = await tx
        .select({
          otpRequired: tenants.otpRequired,
          passwordMaxAgeDays: tenants.passwordMaxAgeDays,
          maxFailures: tenants.bruteForceMaxFailures,
          lockoutSeconds: tenants.bruteForceLockoutSeconds,
          maxLockoutSeconds: tenants.bruteForceMaxLockoutSeconds,
          failureResetSeconds: tenants.bruteForceFailureResetSeconds,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId));
      const row = rows[0];
      if (row === undefined) {
        throw new OduduError('realm_not_found', `no tenant with id ${tenantId} in this context`);
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
    // a default of zero for the depth would accept a password the tenant
    // remembers, and a default minimum length would accept a weak one.
    async passwordPolicy(tenantId: string): Promise<PasswordPolicy> {
      const rows = await tx
        .select({
          minLength: tenants.passwordMinLength,
          requireDigit: tenants.passwordRequireDigit,
          requireUppercase: tenants.passwordRequireUppercase,
          requireLowercase: tenants.passwordRequireLowercase,
          requireSpecial: tenants.passwordRequireSpecial,
          notUsername: tenants.passwordNotUsername,
          notEmail: tenants.passwordNotEmail,
          historyDepth: tenants.passwordHistoryDepth,
          maxAgeDays: tenants.passwordMaxAgeDays,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId));
      const row = rows[0];
      if (row === undefined) {
        throw new OduduError('realm_not_found', `no tenant with id ${tenantId} in this context`);
      }
      return row;
    },
  };
}
