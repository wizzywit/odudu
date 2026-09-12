import { hashPassword, verifyPassword } from '@odudu/domain-identity';
import { type AuthenticatorResult } from '#/schema/authenticator';

// Verify against a constant hash when the caller has no real one, so an
// unknown username and a wrong password cost the same time as well as
// returning the same result.
const DUMMY_HASH = await hashPassword('odudu-dummy-verification-target');

export interface PasswordInput {
  username?: string;
  password?: string;
}

// What the caller (usecase/executor) already looked up, before this function
// runs — this stays a leaf: no `tx`, no repository, no cross-package call.
// `subjectId` is null exactly when there is no account to succeed into,
// whether because the username doesn't exist or the account has no password
// credential; `storedHash` is null under the same two conditions.
export interface PasswordVerification {
  subjectId: string | null;
  storedHash: string | null;
}

export async function passwordStep(
  input: PasswordInput,
  verification: PasswordVerification,
): Promise<AuthenticatorResult> {
  if (input.username === undefined || input.password === undefined) {
    return { kind: 'challenge', form: 'password' };
  }

  // Same call shape whether the user exists or not: an unknown username
  // reaches verifyPassword against DUMMY_HASH exactly as a wrong password
  // reaches it against the real one.
  const valid = await verifyPassword(verification.storedHash ?? DUMMY_HASH, input.password);

  if (verification.subjectId !== null && verification.storedHash !== null && valid) {
    return { kind: 'success', subjectId: verification.subjectId };
  }
  return { kind: 'failure', reason: 'invalid_credentials' };
}
