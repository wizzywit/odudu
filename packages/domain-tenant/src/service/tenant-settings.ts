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
  client_registration_policy: {
    column: 'clientRegistrationPolicy',
    type: 'text',
    values: ['disabled', 'open', 'token'],
  },
  max_clients: { column: 'maxClients', type: 'integer' },
  max_sessions_per_browser: { column: 'maxSessionsPerBrowser', type: 'integer' },
  remember_me_allowed: { column: 'rememberMeAllowed', type: 'boolean' },
  remember_me_idle_seconds: { column: 'rememberMeIdleSeconds', type: 'integer' },
  remember_me_max_seconds: { column: 'rememberMeMaxSeconds', type: 'integer' },
  audit_retention_days: { column: 'auditRetentionDays', type: 'integer' },
  username_editable: { column: 'usernameEditable', type: 'boolean' },
} as const satisfies Record<string, TenantSetting>;

interface TenantSetting {
  readonly column: TenantColumn;
  readonly type: 'boolean' | 'integer' | 'text';
  readonly values?: readonly string[];
}

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
  | { kind: 'invalid_value'; expected: 'boolean' | 'integer' | 'text'; values?: readonly string[] };

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
  const setting: TenantSetting = SETTINGS[name];
  if (setting.type === 'text') {
    const values = setting.values;
    if (values !== undefined && !values.includes(raw)) {
      return { kind: 'invalid_value', expected: 'text', values };
    }
    return { kind: 'coerced', column: setting.column, value: raw };
  }
  const value = setting.type === 'boolean' ? coerceBoolean(raw) : coerceInteger(raw);
  return value === null
    ? { kind: 'invalid_value', expected: setting.type }
    : { kind: 'coerced', column: setting.column, value };
}

export interface TenantSettingRange {
  readonly min: number;
  /** Omitted, the column's own integer ceiling. */
  readonly max?: number;
}

// The ranges the CHECK constraints on `tenants` hold each integer setting
// to (migrations 0028, 0035, 0041, 0045, 0048, 0049 and 0068), restated so
// a caller can be refused per setting before anything is written;
// tests/tenant-setting-checks.int.test.ts holds the two in agreement.
export const TENANT_SETTING_RANGES: Readonly<
  Partial<Record<TenantSettingName, TenantSettingRange>>
> = {
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
};

/** Pairs `[lower, upper]` a CHECK holds `lower <= upper`. */
export const TENANT_SETTING_ORDERINGS: readonly (readonly [
  TenantSettingName,
  TenantSettingName,
])[] = [
  ['sso_session_idle_seconds', 'sso_session_max_seconds'],
  ['remember_me_idle_seconds', 'remember_me_max_seconds'],
  ['brute_force_lockout_seconds', 'brute_force_max_lockout_seconds'],
];

// PostgreSQL `integer`: a larger value fails as out of range, not a CHECK.
const INTEGER_CEILING = 2_147_483_647;

export interface TenantSettingProblem {
  readonly name: TenantSettingName;
  readonly message: string;
}

/**
 * What a full set of setting values breaks of the tenants CHECKs, by
 * setting: judged over the whole record, since an ordering spans two.
 */
export function tenantSettingProblems(
  values: Readonly<Partial<Record<string, unknown>>>,
): TenantSettingProblem[] {
  const problems: TenantSettingProblem[] = [];
  for (const { name } of TENANT_SETTING_COLUMNS) {
    const value = values[name];
    if (typeof value !== 'number' || SETTINGS[name].type !== 'integer') continue;
    const range = TENANT_SETTING_RANGES[name];
    const min = range?.min ?? 0;
    const max = range?.max ?? INTEGER_CEILING;
    if (range !== undefined && (value < min || value > max)) {
      problems.push({ name, message: `must be between ${String(min)} and ${String(max)}` });
    } else if (value > INTEGER_CEILING) {
      problems.push({ name, message: `must be at most ${String(INTEGER_CEILING)}` });
    }
  }
  for (const [lower, upper] of TENANT_SETTING_ORDERINGS) {
    const low = values[lower];
    const high = values[upper];
    if (typeof low === 'number' && typeof high === 'number' && low > high) {
      problems.push({ name: lower, message: `must not exceed ${upper}` });
    }
  }
  return problems;
}
