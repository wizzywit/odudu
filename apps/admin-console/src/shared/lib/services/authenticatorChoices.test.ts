import { describe, expect, it } from 'vitest';
import {
  authenticatorChoiceLabel,
  authenticatorChoices,
  authenticatorOptions,
} from '#/shared/lib/services/authenticatorChoices';

describe('authenticator choices', () => {
  it('words each setting’s values', () => {
    expect(authenticatorOptions('totp_digits')).toEqual([
      { id: '6', label: '6 digits' },
      { id: '8', label: '8 digits' },
    ]);
    expect(authenticatorOptions('totp_period').map((o) => o.label)).toEqual([
      '30 seconds',
      '60 seconds',
    ]);
    expect(authenticatorOptions('webauthn_resident_key').map((o) => o.label)).toEqual([
      'Required',
      'Preferred',
      'Discouraged',
    ]);
    expect(authenticatorOptions('totp_algorithm').map((o) => o.label)).toEqual([
      'SHA1',
      'SHA256',
      'SHA512',
    ]);
  });

  it('offers every size of a recovery set, 8 to 16', () => {
    expect(authenticatorChoices('recovery_code_count')).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(authenticatorChoiceLabel('recovery_code_count', 12)).toBe('12 codes');
  });

  it('offers nothing for a setting it does not know', () => {
    expect(authenticatorChoices('nonesuch')).toEqual([]);
  });
});
