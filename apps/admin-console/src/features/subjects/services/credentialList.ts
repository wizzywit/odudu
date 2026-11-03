import { type Credential } from '@odudu/contracts/admin';
import { formatAbsolute } from '#/shared/services/format';

export interface Credentials {
  password: Credential | null;
  // A TOTP enrolment or a passkey, each removable on its own.
  factors: readonly Credential[];
  // Unspent codes, or null when none was ever issued.
  recoveryCodes: number | null;
}

export function credentialsOf(items: readonly Credential[]): Credentials {
  const codes = items.find((item) => item.type === 'recovery-code');
  return {
    password: items.find((item) => item.type === 'password') ?? null,
    factors: items.filter((item) => item.type === 'totp' || item.type === 'webauthn'),
    recoveryCodes: codes === undefined ? null : (codes.recovery_code_count ?? 0),
  };
}

export function factorLabel(type: Credential['type']): string {
  return type === 'totp' ? 'Authenticator app (TOTP)' : 'Passkey';
}

// Two passkeys share a label, so each Remove names when its own was enrolled.
export function removeFactorLabel(credential: Credential): string {
  return `Remove ${factorLabel(credential.type)} enrolled ${formatAbsolute(new Date(credential.created_at))}`;
}
