import { RECOVERY_CODE_COUNT_RANGE, TENANT_SETTING_CHOICES } from '@odudu/contracts/admin';

export type AuthenticatorChoice = string | number;

const COUNTS = Array.from(
  { length: RECOVERY_CODE_COUNT_RANGE.max - RECOVERY_CODE_COUNT_RANGE.min + 1 },
  (_, at) => RECOVERY_CODE_COUNT_RANGE.min + at,
);

// What an authenticator setting may be set to: its choices, or for the
// recovery set size every count in its range.
export function authenticatorChoices(setting: string): readonly AuthenticatorChoice[] {
  return setting === 'recovery_code_count' ? COUNTS : (TENANT_SETTING_CHOICES[setting] ?? []);
}

function capitalised(choice: AuthenticatorChoice): string {
  const text = String(choice);
  return `${text.slice(0, 1).toUpperCase()}${text.slice(1)}`;
}

// How a value of an authenticator setting reads to a person.
export function authenticatorChoiceLabel(setting: string, choice: AuthenticatorChoice): string {
  switch (setting) {
    case 'totp_digits':
      return `${String(choice)} digits`;
    case 'totp_period':
      return `${String(choice)} seconds`;
    case 'recovery_code_count':
      return `${String(choice)} codes`;
    case 'webauthn_user_verification':
    case 'webauthn_resident_key':
      return capitalised(choice);
    default:
      return String(choice);
  }
}

export function authenticatorOptions(setting: string): { id: string; label: string }[] {
  return authenticatorChoices(setting).map((choice) => ({
    id: String(choice),
    label: authenticatorChoiceLabel(setting, choice),
  }));
}
