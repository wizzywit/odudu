import type { CredentialSummary } from '@odudu/domain-identity';

export type RemovalRefusal = 'last_sign_in_method' | 'last_second_factor';

export type RemovalVerdict =
  { readonly ok: true } | { readonly ok: false; readonly code: RemovalRefusal };

// How many of a person's credentials a removal reads. Counts above two change
// no verdict, so a person who holds more is judged the same.
export const HELD_LIMIT = 200;

type Kind = CredentialSummary['type'];

// A password and a passkey each sign a person in alone. A TOTP only follows a
// first factor, and recovery codes stand in for a TOTP, so neither counts.
const signsIn = (type: Kind): boolean => type === 'password' || type === 'webauthn';

const isSecondFactor = (type: Kind): boolean => type === 'totp' || type === 'webauthn';

// Whether taking `target` away leaves the person a way to sign in, and, where
// the tenant requires a second factor, a second factor. `held` may or may not
// list the target: only the others are judged.
export function canRemove(
  held: readonly CredentialSummary[],
  target: CredentialSummary,
  tenantRequiresSecondFactor: boolean,
): RemovalVerdict {
  const others = held.filter((credential) => credential.id !== target.id);
  if (signsIn(target.type) && !others.some((credential) => signsIn(credential.type))) {
    return { ok: false, code: 'last_sign_in_method' };
  }
  if (
    tenantRequiresSecondFactor &&
    isSecondFactor(target.type) &&
    !others.some((credential) => isSecondFactor(credential.type))
  ) {
    return { ok: false, code: 'last_second_factor' };
  }
  return { ok: true };
}

export function holdsSecondFactor(held: readonly CredentialSummary[]): boolean {
  return held.some((credential) => isSecondFactor(credential.type));
}

// The authentication context a sign-in that used a second factor earns.
export const SECOND_FACTOR_ACR = '2';

// Only an authenticator can be removed through the API: the password stays
// until it is changed, and recovery codes and retired passwords are not listed.
export const isRemovable = (type: Kind): boolean => type === 'totp' || type === 'webauthn';
