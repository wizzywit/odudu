import {
  credentialRepository,
  hashPassword,
  userRepository,
  verifyPassword,
} from '@odudu/domain-identity';
import { type RealmScopedDatabase } from '@odudu/db';
import { type AuthenticatorResult } from '#/schema/authenticator';

// Verify against a constant hash when the user does not exist, so an unknown
// username and a wrong password cost the same time as well as returning the
// same result.
const DUMMY_HASH = await hashPassword('odudu-dummy-verification-target');

export interface PasswordInput {
  username?: string;
  password?: string;
}

export async function passwordStep(
  tx: RealmScopedDatabase,
  input: PasswordInput,
): Promise<AuthenticatorResult> {
  if (input.username === undefined || input.password === undefined) {
    return { kind: 'challenge', form: 'password' };
  }

  const found = await userRepository(tx).byUsername(input.username);
  const stored =
    found === null ? null : await credentialRepository(tx).passwordFor(found.subject.id);

  // Same call shape whether the user exists or not: an unknown username
  // reaches verifyPassword against DUMMY_HASH exactly as a wrong password
  // reaches it against the real one.
  const valid = await verifyPassword(stored ?? DUMMY_HASH, input.password);

  if (found !== null && stored !== null && valid) {
    return { kind: 'success', subjectId: found.subject.id };
  }
  return { kind: 'failure', reason: 'invalid_credentials' };
}
