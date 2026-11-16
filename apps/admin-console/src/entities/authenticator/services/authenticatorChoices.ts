import { RECOVERY_CODE_COUNT_RANGE, TENANT_SETTING_CHOICES } from '@odudu/contracts/admin';

export type AuthenticatorChoice = string | number;

const COUNTS = Array.from(
  { length: RECOVERY_CODE_COUNT_RANGE.max - RECOVERY_CODE_COUNT_RANGE.min + 1 },
  (_, at) => RECOVERY_CODE_COUNT_RANGE.min + at,
);

// What an authenticator setting may be set to: its choices, or for the
// recovery set size every count in its range.
export function authenticatorChoices(setting: string): readonly AuthenticatorChoice[] {
  return setting === 'recovery_code_count'
    ? COUNTS
    : Object.hasOwn(TENANT_SETTING_CHOICES, setting)
      ? (TENANT_SETTING_CHOICES[setting] ?? [])
      : [];
}

const WORDS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  totp_algorithm: { SHA1: 'SHA1', SHA256: 'SHA256', SHA512: 'SHA512' },
  totp_digits: { '6': '6 digits', '8': '8 digits' },
  totp_period: { '30': '30 seconds', '60': '60 seconds' },
  webauthn_user_verification: {
    required: 'Required',
    preferred: 'Preferred',
    discouraged: 'Discouraged',
  },
  webauthn_resident_key: {
    required: 'Required',
    preferred: 'Preferred',
    discouraged: 'Discouraged',
  },
};

// How a value of an authenticator setting reads to a person.
export function authenticatorChoiceLabel(setting: string, choice: AuthenticatorChoice): string {
  const key = String(choice);
  if (setting === 'recovery_code_count') return `${key} codes`;
  return (Object.hasOwn(WORDS, setting) ? WORDS[setting]?.[key] : undefined) ?? key;
}

export function authenticatorOptions(setting: string): { id: string; label: string }[] {
  return authenticatorChoices(setting).map((choice) => ({
    id: String(choice),
    label: authenticatorChoiceLabel(setting, choice),
  }));
}
