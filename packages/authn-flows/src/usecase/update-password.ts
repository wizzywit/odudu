import { type TenantScopedDatabase } from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
import {
  credentialRepository,
  evaluatePassword,
  hashUserPassword,
  isLockedOut,
  loginFailureRepository,
  passwordExpired,
  REUSED_PASSWORD,
  userRepository,
  verifyUserPassword,
} from '@odudu/domain-identity';
import { OduduError, systemClock, type Clock } from '@odudu/kernel';
import { type PasswordViolation } from '#/schema/password-violation';
import { tenantSettingsRepository } from '#/repository/tenant-settings';
import { requiredActionRepository } from '#/repository/required-actions';

export type UpdatePasswordOutcome =
  | { kind: 'updated' }
  // Every message the tenant's policy produced for this candidate, for the
  // page to list at once: a form that reports one rule at a time takes as
  // many attempts as there are rules.
  | { kind: 'rejected'; violations: readonly PasswordViolation[] }
  // Some other transaction set a password for this subject first, so the
  // candidate this submission carried was never stored. Distinct from
  // 'updated' because the person at the form would otherwise be told their
  // password is one it is not.
  | { kind: 'superseded' };

// A password set elsewhere between the page being rendered and submitted,
// listed as a rule so one page shows every reason; the page words it by code.
export const SUPERSEDED_PASSWORD: PasswordViolation = {
  rule: 'superseded',
  message: 'password superseded',
};

// The current password was not the one in force, or the account is locked
// out: the page cannot tell the two apart, and neither can a guesser.
export const CURRENT_PASSWORD_REFUSED: PasswordViolation = {
  rule: 'current-password',
  message: 'current password is not correct',
};

export interface UpdatePassword {
  tenantId: string;
  subjectId: string;
  password: string;
  // Present where the person has to prove the password in force before
  // choosing a new one, an empty string included: a form that left the field
  // out is a wrong answer, not an exemption. Absent for the action a tenant
  // owes the subject at sign-in, which has just proved it.
  currentPassword?: string;
  // Ends the person's other sessions once the new password is stored, in this
  // transaction. Absent, they are left; never run for a candidate that was
  // refused or lost a race, since no password changed.
  endOtherSessions?: (tx: TenantScopedDatabase) => Promise<void>;
}

// A subject's password, and the candidates a reuse check has to refuse:
// the one in force plus the retired hashes the tenant still remembers.
interface PasswordState {
  current: string;
  history: readonly string[];
}

async function passwordState(
  tx: TenantScopedDatabase,
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
    if (await verifyUserPassword(hash, candidate)) return true;
  }
  return false;
}

// A wrong answer counts as a failed sign-in against the tenant's lockout, and
// an account already locked out is refused without the answer being looked at,
// the way a second-factor guess is: this check must not be a way round the
// lockout the sign-in form enforces.
async function currentPasswordProved(
  tx: TenantScopedDatabase,
  input: UpdatePassword,
  answer: string,
  now: Date,
): Promise<boolean> {
  const failures = loginFailureRepository(tx);
  const { lockout } = await tenantSettingsRepository(tx).flowSettings(input.tenantId);
  if (isLockedOut(await failures.forSubject(input.subjectId), now)) {
    await failures.recordFailure(input.subjectId, lockout, now);
    return false;
  }
  const current = await credentialRepository(tx).passwordFor(input.subjectId);
  if (current !== null && (await verifyUserPassword(current, answer))) {
    // As a completed sign-in with a password ends the run before it.
    await failures.clear(input.subjectId);
    return true;
  }
  await failures.recordFailure(input.subjectId, lockout, now);
  return false;
}

// The fourth writer of a password in a tenant, bound by the same policy as
// registration, reset redemption and the seed CLI — and the only one that
// consults history, which is why it is the only one that keeps any.
//
// Reached only through the required-action gate
// (packages/protocol-oidc/src/usecase/required-action-submission.ts): the
// subject comes from the authentication session, and the action has to be
// one this subject actually owes.
export async function completeUpdatePassword(
  tx: TenantScopedDatabase,
  input: UpdatePassword,
  clock: Clock = systemClock,
): Promise<UpdatePasswordOutcome> {
  if (
    input.currentPassword !== undefined &&
    !(await currentPasswordProved(tx, input, input.currentPassword, clock.now()))
  ) {
    return { kind: 'rejected', violations: [{ ...CURRENT_PASSWORD_REFUSED }] };
  }
  const policy = await tenantSettingsRepository(tx).passwordPolicy(input.tenantId);
  const user = await userRepository(tx).bySubjectId(input.subjectId);
  if (user === null) {
    throw new OduduError('user_not_found', `no user for subject ${input.subjectId}`);
  }

  const violations = evaluatePassword(input.password, policy, {
    username: user.username,
    email: user.email,
  });
  if (violations.length > 0) {
    return {
      kind: 'rejected',
      violations: violations.map(({ rule, message }) =>
        rule === 'min-length' ? { rule, message, minLength: policy.minLength } : { rule, message },
      ),
    };
  }

  // Nothing in the tenant holds a password for this subject, so there is
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
  // re-settable. Above zero the tenant remembers that many retired
  // passwords, and refuses the one in force as well — which needs no row.
  if (policy.historyDepth > 0 && (await reusesAKnownPassword(input.password, state))) {
    return { kind: 'rejected', violations: [{ ...REUSED_PASSWORD }] };
  }

  const rotated = await credentialRepository(tx).rotatePassword(
    input.subjectId,
    { from: state.current, to: await hashUserPassword(input.password) },
    policy.historyDepth,
  );
  // A password change landed either way, so the action is satisfied and is
  // completed rather than left owed to a subject with nothing left to do.
  // Which password is in force is the part the caller has to be told apart:
  // on a false return it is the one the other transaction set.
  await requiredActionRepository(tx).complete(input.subjectId, 'update-password');
  if (!rotated) return { kind: 'superseded' };
  await input.endOtherSessions?.(tx);
  await auditRepository(tx).record({
    eventType: 'credential',
    action: 'password.changed',
    outcome: 'allowed',
    actorSubjectId: input.subjectId,
    resourceType: 'subject',
    resourceId: input.subjectId,
    detail: { ended_other_sessions: input.endOtherSessions !== undefined },
  });
  return { kind: 'updated' };
}

// A tenant that ages passwords out has to say so somewhere the login can act
// on it, and that is the required action — refusing the password step
// instead would lock out every account the policy is trying to move along,
// since the gate that would rescue them sits downstream of a success.
export async function recordPasswordExpiryIfOwed(
  tx: TenantScopedDatabase,
  tenantId: string,
  subjectId: string,
  // Handed in from the tenant read the flow's own applicability decisions
  // already made (flowSettings), rather than read again here.
  maxAgeDays: number,
  clock: Clock = systemClock,
): Promise<void> {
  if (maxAgeDays === 0) return;
  const [credential] = await credentialRepository(tx).listFor(subjectId, 'password');
  if (credential === undefined || !passwordExpired(credential, maxAgeDays, clock.now())) return;
  await requiredActionRepository(tx).add(tenantId, subjectId, 'update-password');
}

// Whether the subject has a password to prove or change: one who signs in with
// a passkey alone has none, and a password change cannot be asked of them.
export async function holdsPassword(tx: TenantScopedDatabase, subjectId: string): Promise<boolean> {
  return (await credentialRepository(tx).passwordFor(subjectId)) !== null;
}
