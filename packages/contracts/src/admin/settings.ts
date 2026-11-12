import { z } from 'zod';
import { ACCESS_TOKEN_CEILING_SECONDS } from '#/admin/client-rules';

// Deliberately generic: the setting names and their types are
// `@odudu/domain-tenant`'s `SETTINGS` map, the one authority for both.
// Restating them here as a literal-keyed schema would be a second list a
// new setting could be added to without.
const settingValueSchema = z.union([z.boolean(), z.number(), z.string(), z.array(z.string())]);

export const amendSettingsRequestSchema = z.record(z.string(), settingValueSchema);
export type AmendSettingsRequest = z.infer<typeof amendSettingsRequestSchema>;

// A read additionally answers `null` for `display_name`, the one text
// setting with no default — nothing a caller ever writes accepts it back.
export const settingsSchema = z.record(z.string(), settingValueSchema.nullable());
export type Settings = z.infer<typeof settingsSchema>;

export interface TenantSettingRange {
  min: number;
  /** Omitted, the column's own integer ceiling. */
  max?: number;
}

// The ranges the CHECK constraints on `tenants` hold each integer setting
// to (migrations 0028, 0035, 0041, 0045, 0048, 0049, 0068, 0082, 0126, 0131 and 0132), here so
// the console words the same limits the server enforces;
// tests/tenant-setting-checks.int.test.ts in @odudu/domain-tenant holds the
// two in agreement.
export const TENANT_SETTING_RANGES: Readonly<Partial<Record<string, TenantSettingRange>>> = {
  sso_session_idle_seconds: { min: 60, max: 2_592_000 },
  sso_session_max_seconds: { min: 60, max: 2_592_000 },
  password_min_length: { min: 8, max: 256 },
  password_history_depth: { min: 0, max: 24 },
  password_max_age_days: { min: 0, max: 3650 },
  brute_force_max_failures: { min: 1, max: 100 },
  brute_force_lockout_seconds: { min: 1, max: 86_400 },
  brute_force_failure_reset_seconds: { min: 60, max: 2_592_000 },
  max_clients: { min: 0 },
  max_sessions_per_browser: { min: 1, max: 32 },
  remember_me_idle_seconds: { min: 60, max: 31_536_000 },
  remember_me_max_seconds: { min: 60, max: 31_536_000 },
  audit_retention_days: { min: 1, max: 3650 },
  access_token_ttl_seconds: { min: 1, max: ACCESS_TOKEN_CEILING_SECONDS },
  id_token_ttl_seconds: { min: 1, max: 3600 },
  refresh_token_ttl_seconds: { min: 1 },
  authorization_code_ttl_seconds: { min: 1, max: 600 },
  login_ttl_seconds: { min: 60, max: 86_400 },
  verify_email_ttl_seconds: { min: 60, max: 604_800 },
  reset_password_ttl_seconds: { min: 60, max: 86_400 },
  session_freshness_seconds: { min: 30, max: 3600 },
  recovery_code_warn_below: { min: 0, max: 10 },
  recovery_code_count: { min: 8, max: 16 },
};

// The values a setting may take where the CHECK is a list rather than a range:
// the TOTP and WebAuthn parameters an authenticator app or a browser understands.
export const TENANT_SETTING_CHOICES: Readonly<Record<string, readonly (string | number)[]>> = {
  totp_algorithm: ['SHA1', 'SHA256', 'SHA512'],
  totp_digits: [6, 8],
  totp_period: [30, 60],
  webauthn_user_verification: ['required', 'preferred', 'discouraged'],
  webauthn_resident_key: ['required', 'preferred', 'discouraged'],
};

/** Pairs `[lower, upper]` a CHECK holds `lower <= upper`. */
export const TENANT_SETTING_ORDERINGS: readonly (readonly [string, string])[] = [
  ['sso_session_idle_seconds', 'sso_session_max_seconds'],
  ['remember_me_idle_seconds', 'remember_me_max_seconds'],
  ['brute_force_lockout_seconds', 'brute_force_max_lockout_seconds'],
  ['recovery_code_warn_below', 'recovery_code_count'],
];
