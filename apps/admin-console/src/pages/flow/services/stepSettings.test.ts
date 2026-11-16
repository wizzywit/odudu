import { describe, expect, it } from 'vitest';
import { settingControls, withSetting } from '#/pages/flow/services/stepSettings';
import type { Step } from '#/pages/flow/services/steps';

const TENANT = {
  totp_algorithm: 'SHA1',
  totp_digits: 6,
  totp_period: 30,
  webauthn_user_verification: 'required',
  webauthn_resident_key: 'required',
  recovery_code_count: 10,
};

const OTP: Step = { authenticator: 'otp', requirement: 'required' };

describe('settingControls', () => {
  it('offers the authenticator app’s three settings, each defaulting to the tenant’s value', () => {
    const controls = settingControls(OTP, TENANT);
    expect(controls.map((control) => control.key)).toEqual(['algorithm', 'digits', 'period']);
    expect(controls.map((control) => control.value)).toEqual(['', '', '']);
    expect(controls[1]?.options).toEqual([
      { id: '', label: 'Tenant setting (6 digits)' },
      { id: '6', label: '6 digits' },
      { id: '8', label: '8 digits' },
    ]);
  });

  it('shows what the step names over the tenant’s value', () => {
    const controls = settingControls({ ...OTP, settings: { digits: 8 } }, TENANT);
    expect(controls.map((control) => control.value)).toEqual(['', '8', '']);
  });

  it('offers the passkey’s two and the recovery set’s size, and none for any other step', () => {
    expect(
      settingControls({ authenticator: 'passkey', requirement: 'alternative' }, TENANT).map(
        (control) => control.key,
      ),
    ).toEqual(['user_verification', 'resident_key']);
    const count = settingControls(
      { authenticator: 'recovery-code', requirement: 'required' },
      TENANT,
    );
    expect(count.map((control) => control.key)).toEqual(['count']);
    expect(count[0]?.options.map((option) => option.id)).toEqual([
      '',
      ...['8', '9', '10', '11', '12', '13', '14', '15', '16'],
    ]);
    expect(settingControls({ authenticator: 'password', requirement: 'required' }, TENANT)).toEqual(
      [],
    );
  });

  it('says only "Tenant setting" while the tenant’s settings are not read', () => {
    expect(settingControls(OTP, undefined)[0]?.options[0]).toEqual({
      id: '',
      label: 'Tenant setting',
    });
  });

  it('labels each control by the step it is on', () => {
    expect(settingControls(OTP, TENANT)[0]?.label).toBe('Algorithm for otp');
  });
});

describe('withSetting', () => {
  const FLOW: readonly Step[] = [{ authenticator: 'password', requirement: 'required' }, OTP];

  it('sets a key as the number or text the contract holds', () => {
    expect(withSetting(FLOW, 'otp', 'digits', '8')[1]?.settings).toEqual({ digits: 8 });
    expect(withSetting(FLOW, 'otp', 'algorithm', 'SHA256')[1]?.settings).toEqual({
      algorithm: 'SHA256',
    });
  });

  it('keeps the other keys, and drops a key set back to the tenant’s value', () => {
    const both = withSetting(withSetting(FLOW, 'otp', 'digits', '8'), 'otp', 'period', '60');
    expect(both[1]?.settings).toEqual({ digits: 8, period: 60 });
    expect(withSetting(both, 'otp', 'digits', '')[1]?.settings).toEqual({ period: 60 });
  });

  it('leaves the step with no settings at all once none is named', () => {
    const cleared = withSetting(withSetting(FLOW, 'otp', 'digits', '8'), 'otp', 'digits', '');
    expect(cleared[1]).toEqual(OTP);
    expect(cleared[1]).not.toHaveProperty('settings');
  });

  it('changes no other step, and ignores a value the contract does not take', () => {
    expect(withSetting(FLOW, 'otp', 'digits', '7')).toEqual(FLOW);
    expect(withSetting(FLOW, 'otp', 'digits', '8')[0]).toEqual(FLOW[0]);
  });
});

describe('an authenticator named like an inherited property', () => {
  it('has no controls', () => {
    expect(
      settingControls({ authenticator: 'constructor', requirement: 'required' }, TENANT),
    ).toEqual([]);
  });
});
