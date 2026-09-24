import { type tenants } from '@odudu/db';

type TenantColumn = keyof typeof tenants.$inferSelect;

// What a tenant exposes for configuration, keyed by the column name a reader
// sees in the schema and in `docs/request-paths.md` rather than by Drizzle's
// camel case. Identity is absent on purpose: `name` is in every issuer URL
// already minted, and `id` is what row-level security keys on. `column` is
// typed against the real row, so a typo is a compile error, not a silent
// miss. Ranges are not here — they are CHECK constraints (migrations 0028,
// 0035, 0041 and 0049), the idiom for a rule no writer may bypass.
const SETTINGS = {
  display_name: { column: 'displayName', type: 'text' },
  enabled: { column: 'enabled', type: 'boolean' },
  registration_allowed: { column: 'registrationAllowed', type: 'boolean' },
  verify_email: { column: 'verifyEmail', type: 'boolean' },
  reset_password_allowed: { column: 'resetPasswordAllowed', type: 'boolean' },
  sso_session_idle_seconds: { column: 'ssoSessionIdleSeconds', type: 'integer' },
  sso_session_max_seconds: { column: 'ssoSessionMaxSeconds', type: 'integer' },
  password_min_length: { column: 'passwordMinLength', type: 'integer' },
  password_require_digit: { column: 'passwordRequireDigit', type: 'boolean' },
  password_require_uppercase: { column: 'passwordRequireUppercase', type: 'boolean' },
  password_require_lowercase: { column: 'passwordRequireLowercase', type: 'boolean' },
  password_require_special: { column: 'passwordRequireSpecial', type: 'boolean' },
  password_not_username: { column: 'passwordNotUsername', type: 'boolean' },
  password_not_email: { column: 'passwordNotEmail', type: 'boolean' },
  password_history_depth: { column: 'passwordHistoryDepth', type: 'integer' },
  password_max_age_days: { column: 'passwordMaxAgeDays', type: 'integer' },
  otp_required: { column: 'otpRequired', type: 'boolean' },
  brute_force_max_failures: { column: 'bruteForceMaxFailures', type: 'integer' },
  brute_force_lockout_seconds: { column: 'bruteForceLockoutSeconds', type: 'integer' },
  brute_force_max_lockout_seconds: { column: 'bruteForceMaxLockoutSeconds', type: 'integer' },
  brute_force_failure_reset_seconds: { column: 'bruteForceFailureResetSeconds', type: 'integer' },
  client_registration_policy: { column: 'clientRegistrationPolicy', type: 'text' },
  max_clients: { column: 'maxClients', type: 'integer' },
  max_sessions_per_browser: { column: 'maxSessionsPerBrowser', type: 'integer' },
  remember_me_allowed: { column: 'rememberMeAllowed', type: 'boolean' },
  remember_me_idle_seconds: { column: 'rememberMeIdleSeconds', type: 'integer' },
  remember_me_max_seconds: { column: 'rememberMeMaxSeconds', type: 'integer' },
} as const satisfies Record<string, { column: TenantColumn; type: 'boolean' | 'integer' | 'text' }>;

export type TenantSettingName = keyof typeof SETTINGS;

export const TENANT_SETTING_NAMES: readonly string[] = Object.keys(SETTINGS);

export interface TenantSettingColumn {
  readonly name: TenantSettingName;
  readonly column: TenantColumn;
}

// A reader's view of the same map a writer coerces through
// (`coerceTenantSetting`), so a repository listing every setting's current
// value walks the identical name-to-column pairs a write would have used —
// never a second list a future setting could be added to only one of.
export const TENANT_SETTING_COLUMNS: readonly TenantSettingColumn[] = Object.entries(SETTINGS).map(
  ([name, setting]) => ({ name: name as TenantSettingName, column: setting.column }),
);

export type CoerceOutcome =
  | { kind: 'coerced'; column: TenantColumn; value: boolean | number | string }
  | { kind: 'unknown_setting'; known: readonly string[] }
  | { kind: 'invalid_value'; expected: 'boolean' | 'integer' | 'text' };

function isSettingName(value: string): value is TenantSettingName {
  return Object.hasOwn(SETTINGS, value);
}

// `true`/`false` and nothing else, because a setting read off a command line
// is read by a person too: `1` and `yes` each look obvious and disagree with
// the other's reading of `0` and `no`.
function coerceBoolean(raw: string): boolean | null {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return null;
}

// Number() accepts '', '0x10', '1e3' and ' 7 ', none of which a person means
// by an integer setting, so the digits are matched before conversion.
function coerceInteger(raw: string): number | null {
  return /^-?\d+$/u.test(raw) ? Number(raw) : null;
}

export function coerceTenantSetting(name: string, raw: string): CoerceOutcome {
  if (!isSettingName(name)) {
    return { kind: 'unknown_setting', known: TENANT_SETTING_NAMES };
  }
  const setting = SETTINGS[name];
  if (setting.type === 'text') {
    return { kind: 'coerced', column: setting.column, value: raw };
  }
  const value = setting.type === 'boolean' ? coerceBoolean(raw) : coerceInteger(raw);
  return value === null
    ? { kind: 'invalid_value', expected: setting.type }
    : { kind: 'coerced', column: setting.column, value };
}
