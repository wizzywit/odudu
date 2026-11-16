import { describe, expect, it } from 'vitest';
import { moveLabel, offeredOptions, stepRows } from '#/pages/flow/services/stepRows';
import type { Step } from '#/pages/flow/services/steps';

const STEPS: readonly Step[] = [
  { authenticator: 'password', requirement: 'required' },
  { authenticator: 'otp', requirement: 'conditional' },
  { authenticator: 'passkey', requirement: 'disabled' },
];

describe('stepRows', () => {
  it('numbers the steps from one and says what each is and asks', () => {
    const rows = stepRows(STEPS, null, undefined);
    expect(rows.map((row) => row.position)).toEqual([1, 2, 3]);
    expect(rows[0]).toMatchObject({
      authenticator: 'password',
      what: "The subject's password.",
      requirementWhat: 'Every sign-in must pass it.',
      requirementLabel: 'Requirement for password',
    });
  });

  it('gives a step the controls of its authenticator, with the tenant’s values as the default', () => {
    const rows = stepRows(STEPS, null, { totp_digits: 6 });
    expect(rows.map((row) => row.settings.length)).toEqual([0, 3, 2]);
    expect(rows[1]?.settings[1]?.options[0]?.label).toBe('Tenant setting (6 digits)');
  });

  it('marks a disabled step and no other', () => {
    expect(stepRows(STEPS, null, undefined).map((row) => row.disabled)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('keeps the first from moving up and the last from moving down', () => {
    const rows = stepRows(STEPS, null, undefined);
    expect(rows[0]?.up).toEqual({ label: 'Move password up', enabled: false });
    expect(rows[0]?.down.enabled).toBe(true);
    expect(rows[2]?.down).toEqual({ label: 'Move passkey down', enabled: false });
  });

  it('shows whom the one-time password asks on that step alone', () => {
    const rows = stepRows(STEPS, 'Asked of every subject.', undefined);
    expect(rows.map((row) => row.otpReading)).toEqual([null, 'Asked of every subject.', null]);
  });
});

describe('the small ones', () => {
  it('labels a move by the step and the direction', () => {
    expect(moveLabel('otp', 'down')).toBe('Move otp down');
  });

  it('offers each name as its own label', () => {
    expect(offeredOptions(['otp'])).toEqual([{ id: 'otp', label: 'otp' }]);
    expect(offeredOptions([])).toEqual([]);
  });
});
