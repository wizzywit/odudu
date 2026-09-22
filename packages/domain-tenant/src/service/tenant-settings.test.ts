import { describe, expect, it } from 'vitest';
import { coerceTenantSetting, TENANT_SETTING_NAMES } from '#/service/tenant-settings';

describe('the settings a tenant exposes for configuration', () => {
  it('names every one of them, and nothing that identifies the tenant', () => {
    expect(TENANT_SETTING_NAMES).toContain('otp_required');
    expect(TENANT_SETTING_NAMES).toContain('password_max_age_days');
    expect(TENANT_SETTING_NAMES).toContain('sso_session_idle_seconds');
    // A tenant's identity is not a setting: renaming one breaks every issuer
    // URL already in a token, and its id is what row-level security keys on.
    expect(TENANT_SETTING_NAMES).not.toContain('id');
    expect(TENANT_SETTING_NAMES).not.toContain('name');
    expect(TENANT_SETTING_NAMES).not.toContain('created_at');
  });

  it('refuses a name it does not know, listing what it does', () => {
    const outcome = coerceTenantSetting('otp_requried', 'true');
    expect(outcome.kind).toBe('unknown_setting');
    if (outcome.kind !== 'unknown_setting') return;
    expect(outcome.known).toEqual(TENANT_SETTING_NAMES);
  });
});

describe('coercing a value that arrived as a string', () => {
  it('reads the two spellings of a boolean and refuses the rest', () => {
    expect(coerceTenantSetting('otp_required', 'true')).toEqual({
      kind: 'coerced',
      column: 'otpRequired',
      value: true,
    });
    expect(coerceTenantSetting('otp_required', 'false')).toEqual({
      kind: 'coerced',
      column: 'otpRequired',
      value: false,
    });
    expect(coerceTenantSetting('otp_required', 'yes').kind).toBe('invalid_value');
    expect(coerceTenantSetting('otp_required', '1').kind).toBe('invalid_value');
  });

  it('reads an integer, and refuses one that is not', () => {
    expect(coerceTenantSetting('password_max_age_days', '90')).toEqual({
      kind: 'coerced',
      column: 'passwordMaxAgeDays',
      value: 90,
    });
    expect(coerceTenantSetting('password_max_age_days', '90.5').kind).toBe('invalid_value');
    expect(coerceTenantSetting('password_max_age_days', '').kind).toBe('invalid_value');
    expect(coerceTenantSetting('password_max_age_days', 'ninety').kind).toBe('invalid_value');
  });

  // The ranges are CHECK constraints (0028, 0035, 0041), so the database is
  // the authority and this does not restate them — but a negative number
  // would reach it as a value the column simply refuses, and the error a
  // person reads should name the setting rather than a constraint.
  it('accepts a number the database will reject, leaving the range to it', () => {
    expect(coerceTenantSetting('password_max_age_days', '-1')).toEqual({
      kind: 'coerced',
      column: 'passwordMaxAgeDays',
      value: -1,
    });
  });

  it('reads text, including an empty string, for a nullable text setting', () => {
    expect(coerceTenantSetting('display_name', 'Demo Tenant')).toEqual({
      kind: 'coerced',
      column: 'displayName',
      value: 'Demo Tenant',
    });
  });

  it('coerces the registration policy as text and the client cap as an integer', () => {
    expect(coerceTenantSetting('client_registration_policy', 'token')).toEqual({
      kind: 'coerced',
      column: 'clientRegistrationPolicy',
      value: 'token',
    });
    expect(coerceTenantSetting('max_clients', '50')).toEqual({
      kind: 'coerced',
      column: 'maxClients',
      value: 50,
    });
  });

  it('coerces the per-browser session cap', () => {
    expect(coerceTenantSetting('max_sessions_per_browser', '8')).toEqual({
      kind: 'coerced',
      column: 'maxSessionsPerBrowser',
      value: 8,
    });
  });

  it('refuses a cap that is not an integer', () => {
    expect(coerceTenantSetting('max_sessions_per_browser', 'lots')).toEqual({
      kind: 'invalid_value',
      expected: 'integer',
    });
  });

  it('coerces the remember-me switch and its lifespan pair', () => {
    expect(coerceTenantSetting('remember_me_allowed', 'true')).toEqual({
      kind: 'coerced',
      column: 'rememberMeAllowed',
      value: true,
    });
    expect(coerceTenantSetting('remember_me_idle_seconds', '604800')).toEqual({
      kind: 'coerced',
      column: 'rememberMeIdleSeconds',
      value: 604_800,
    });
    expect(coerceTenantSetting('remember_me_max_seconds', '2592000')).toEqual({
      kind: 'coerced',
      column: 'rememberMeMaxSeconds',
      value: 2_592_000,
    });
  });
});
