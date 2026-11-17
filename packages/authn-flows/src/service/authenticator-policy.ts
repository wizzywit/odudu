import { TOTP_ALGORITHMS, WEBAUTHN_REQUIREMENTS } from '@odudu/domain-identity';

export type TotpAlgorithmName = (typeof TOTP_ALGORITHMS)[number];
export type WebauthnRequirement = (typeof WEBAUTHN_REQUIREMENTS)[number];

// What a tenant asks of the authenticators enrolled from now on. An
// enrolment records the values it was made under and is verified by them.
export interface AuthenticatorPolicy {
  totp: { algorithm: TotpAlgorithmName; digits: number; period: number };
  webauthn: { userVerification: WebauthnRequirement; residentKey: WebauthnRequirement };
  recoveryCodeCount: number;
}

export interface AuthenticatorPolicyRow {
  totpAlgorithm: string;
  totpDigits: number;
  totpPeriod: number;
  webauthnUserVerification: string;
  webauthnResidentKey: string;
  recoveryCodeCount: number;
}

function oneOf<Value extends string>(
  allowed: readonly Value[],
  value: string,
  setting: string,
): Value {
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw new Error(`tenant setting ${setting} holds "${value}"`);
  return found;
}

// The columns are CHECK-constrained to these values, so one outside them is a
// row the schema should have refused, not a policy to fall back from.
export function authenticatorPolicyOf(row: AuthenticatorPolicyRow): AuthenticatorPolicy {
  return {
    totp: {
      algorithm: oneOf(TOTP_ALGORITHMS, row.totpAlgorithm, 'totp_algorithm'),
      digits: row.totpDigits,
      period: row.totpPeriod,
    },
    webauthn: {
      userVerification: oneOf(
        WEBAUTHN_REQUIREMENTS,
        row.webauthnUserVerification,
        'webauthn_user_verification',
      ),
      residentKey: oneOf(WEBAUTHN_REQUIREMENTS, row.webauthnResidentKey, 'webauthn_resident_key'),
    },
    recoveryCodeCount: row.recoveryCodeCount,
  };
}
