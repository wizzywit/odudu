import { tenants, type Database } from '@odudu/db';
import { eq } from 'drizzle-orm';

// Duplicated rather than imported from @odudu/domain-identity: @odudu/account
// depends on neither that package nor @odudu/domain-authz
// (packages/account/src/usecase/register.ts explains why), and this shape is
// exactly what packages/domain-identity/src/service/password-policy.ts's
// evaluatePassword takes as its second argument. The two stay structurally
// identical by convention, the same way RegistrationTenantLookup below
// duplicates a subset of this file's own TenantSettings.
export interface PasswordPolicy {
  tenantName: string;
  minLength: number;
  requireDigit: boolean;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireSpecial: boolean;
  notUsername: boolean;
  notEmail: boolean;
  historyDepth: number;
  maxAgeDays: number;
}

export interface PolicyViolation {
  rule: string;
  message: string;
  // Set on the minimum-length rule, whose sentence states the number.
  minLength?: number;
}

export interface TenantSettings {
  id: string;
  name: string;
  displayName: string | null;
  enabled: boolean;
  verifyEmail: boolean;
  verifyEmailTtlSeconds: number;
  registrationAllowed: boolean;
  resetPasswordAllowed: boolean;
  // What a page of this tenant is offered in and shown in by default.
  supportedLocales: string[];
  defaultLocale: string | null;
  passwordPolicy: PasswordPolicy;
}

// Resolving {tenant} from a request path happens before any tenant context
// exists to `SET LOCAL app.tenant_id` into, so `db` must be the owner
// (RLS-bypassing) connection — the same requirement and the same amendment
// (ADR 0009, 2026-09-13) that packages/protocol-oidc/src/repository/tenant-lookup.ts
// documents. Duplicated rather than imported: that file lives in a protocol
// package's internals, which no feature reaches into (CLAUDE.md, Layering).
export function tenantSettingsRepository(db: Database) {
  return {
    async byName(name: string): Promise<TenantSettings | null> {
      const rows = await db.select().from(tenants).where(eq(tenants.name, name));
      const row = rows[0];
      return row === undefined
        ? null
        : {
            id: row.id,
            name: row.name,
            displayName: row.displayName,
            enabled: row.enabled,
            verifyEmail: row.verifyEmail,
            verifyEmailTtlSeconds: row.verifyEmailTtlSeconds,
            registrationAllowed: row.registrationAllowed,
            resetPasswordAllowed: row.resetPasswordAllowed,
            supportedLocales: row.supportedLocales,
            defaultLocale: row.defaultLocale,
            passwordPolicy: {
              tenantName: row.name,
              minLength: row.passwordMinLength,
              requireDigit: row.passwordRequireDigit,
              requireUppercase: row.passwordRequireUppercase,
              requireLowercase: row.passwordRequireLowercase,
              requireSpecial: row.passwordRequireSpecial,
              notUsername: row.passwordNotUsername,
              notEmail: row.passwordNotEmail,
              historyDepth: row.passwordHistoryDepth,
              maxAgeDays: row.passwordMaxAgeDays,
            },
          };
    },
  };
}
