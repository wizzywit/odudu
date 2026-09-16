import { type RealmScopedDatabase } from '@odudu/db';
import {
  credentialRepository,
  evaluatePassword,
  hashPassword,
  passwordExpired,
  REUSED_PASSWORD,
  userRepository,
  verifyPassword,
} from '@odudu/domain-identity';
import { OduduError, systemClock, type Clock } from '@odudu/kernel';
import { realmSettingsRepository } from '#/repository/realm-settings';
import { requiredActionRepository } from '#/repository/required-actions';

export type UpdatePasswordOutcome =
  | { kind: 'updated' }
  // Every message the realm's policy produced for this candidate, for the
  // page to list at once: a form that reports one rule at a time takes as
  // many attempts as there are rules.
  | { kind: 'rejected'; violations: readonly string[] };

export interface UpdatePassword {
  realmId: string;
  subjectId: string;
  password: string;
}

// A subject's password, and the candidates a reuse check has to refuse:
// the one in force plus the retired hashes the realm still remembers.
interface PasswordState {
  current: string;
  history: readonly string[];
}

async function passwordState(
  tx: RealmScopedDatabase,
  subjectId: string,
): Promise<PasswordState | null> {
  const current = await credentialRepository(tx).passwordFor(subjectId);
  if (current === null) return null;
  return { current, history: await credentialRepository(tx).passwordHistory(subjectId) };
}

// Sequential, and it stops at the first match. `password_history_depth`
// tops out at 24 (migration 0035), so this can be 25 Argon2id
// verifications, each of which occupies a libuv thread for its whole
// duration — awaiting them together would hold the entire default pool of
// four for as long as the slowest. Only a subject a factor has already
// bound to the attempt reaches here, so the latency is spent by somebody
// changing their own password, never by an anonymous caller.
async function reusesAKnownPassword(candidate: string, state: PasswordState): Promise<boolean> {
  for (const hash of [state.current, ...state.history]) {
    if (await verifyPassword(hash, candidate)) return true;
  }
  return false;
}

// The fourth writer of a password in a realm, bound by the same policy as
// registration, reset redemption and the seed CLI — and the only one that
// consults history, which is why it is the only one that keeps any.
//
// Reached only through the required-action gate
// (packages/protocol-oidc/src/usecase/required-action-submission.ts): the
// subject comes from the authentication session, and the action has to be
// one this subject actually owes.
export async function completeUpdatePassword(
  tx: RealmScopedDatabase,
  input: UpdatePassword,
): Promise<UpdatePasswordOutcome> {
  const policy = await realmSettingsRepository(tx).passwordPolicy(input.realmId);
  const user = await userRepository(tx).bySubjectId(input.subjectId);
  if (user === null) {
    throw new OduduError('user_not_found', `no user for subject ${input.subjectId}`);
  }

  const violations = evaluatePassword(input.password, policy, {
    username: user.username,
    email: user.email,
  });
  if (violations.length > 0) {
    return { kind: 'rejected', violations: violations.map((violation) => violation.message) };
  }

  // Nothing in the realm holds a password for this subject, so there is
  // nothing to rotate. Unreachable through the only thing that owes this
  // action today — expiry, which reads the credential it expires — so it is
  // a broken account rather than a refusal to render.
  const state = await passwordState(tx, input.subjectId);
  if (state === null) {
    throw new OduduError(
      'credential_not_found',
      `no password credential for subject ${input.subjectId}`,
    );
  }

  // Depth zero is the feature off, and the password in force is then
  // re-settable. Above zero the realm remembers that many retired
  // passwords, and refuses the one in force as well — which needs no row.
  if (policy.historyDepth > 0 && (await reusesAKnownPassword(input.password, state))) {
    return { kind: 'rejected', violations: [REUSED_PASSWORD.message] };
  }

  // A false return is the compare-and-swap finding the password already
  // moved — a second tab, a resubmitted form — which means some other
  // transaction set one. Either way a change landed, so the action is
  // completed rather than left owed to a subject who has nothing to do.
  await credentialRepository(tx).rotatePassword(
    input.subjectId,
    { from: state.current, to: await hashPassword(input.password) },
    policy.historyDepth,
  );
  await requiredActionRepository(tx).complete(input.subjectId, 'update-password');
  return { kind: 'updated' };
}

// A realm that ages passwords out has to say so somewhere the login can act
// on it, and that is the required action — refusing the password step
// instead would lock out every account the policy is trying to move along,
// since the gate that would rescue them sits downstream of a success.
export async function recordPasswordExpiryIfOwed(
  tx: RealmScopedDatabase,
  realmId: string,
  subjectId: string,
  clock: Clock = systemClock,
): Promise<void> {
  const { maxAgeDays } = await realmSettingsRepository(tx).passwordPolicy(realmId);
  if (maxAgeDays === 0) return;
  const [credential] = await credentialRepository(tx).listFor(subjectId, 'password');
  if (credential === undefined || !passwordExpired(credential, maxAgeDays, clock.now())) return;
  await requiredActionRepository(tx).add(realmId, subjectId, 'update-password');
}
