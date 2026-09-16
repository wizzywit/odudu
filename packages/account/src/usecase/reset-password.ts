import { withRealm, type DatabaseHandle, type RealmScopedDatabase } from '@odudu/db';
import { renderResetPassword, type EmailSender } from '@odudu/email';
import { actionTokenRepository } from '#/repository/action-tokens';
import { type PasswordPolicy, type PolicyViolation } from '#/repository/realm-settings';
import { RESET_PASSWORD_TTL_SECONDS } from '#/usecase/verify-email';

// Re-exported so the view layer can reach these without importing the
// repository directly (no-view-to-repository, .dependency-cruiser.cjs):
// view → usecase is permitted, usecase → repository is where the type
// actually lives.
export type { PasswordPolicy, PolicyViolation };

export interface RequestPasswordResetDeps {
  readonly database: DatabaseHandle;
  readonly sender: EmailSender;
  readonly realmId: string;
  readonly realmName: string;
  readonly realmDisplayName: string;
  // Never derived from the request that reached this usecase: see
  // #/view/routes/registration.ts for why a request header cannot be
  // trusted with the contents of a mail sent to a third party.
  readonly issuerBase: string | undefined;
  // Injected for the reason completePasswordReset's setPassword is:
  // @odudu/account depends on neither @odudu/domain-identity nor
  // @odudu/domain-authz, so the composition root wires the actual lookup.
  // Returns null for an address with no account, and requestPasswordReset
  // does the same amount of visible work either way — the caller's
  // response must not depend on which happened. The email returned is the
  // stored column, not necessarily byte-identical to what was submitted —
  // that is what the mail actually goes to.
  readonly findByEmail: (
    tx: RealmScopedDatabase,
    email: string,
  ) => Promise<{ subjectId: string; email: string } | null>;
}

// `mailFailed` carries a transport failure without it changing the
// response: an operator's SMTP outage or rate limit must not become a
// clean 500-for-known/200-for-unknown oracle, so the route always answers
// 200 for `requested` regardless of this flag, and only logs it.
export type RequestPasswordResetOutcome =
  { kind: 'requested'; mailFailed: boolean; error?: unknown } | { kind: 'misconfigured' };

// Issues the token inside its own transaction when the address matches an
// account, then sends the mail after that transaction commits — awaited,
// the same ordering #/usecase/verify-email.ts establishes. No match does
// the same shape of work: no row, no mail, no error — the response is
// composed by the route, not here, and must come out identical either way.
// A send failure is caught rather than propagated, for the same reason —
// see `mailFailed` above.
export async function requestPasswordReset(
  deps: RequestPasswordResetDeps,
  email: string,
): Promise<RequestPasswordResetOutcome> {
  if (deps.issuerBase === undefined) {
    return { kind: 'misconfigured' };
  }

  const issued = await withRealm(deps.database.db, deps.realmId, async (tx) => {
    const user = await deps.findByEmail(tx, email);
    if (user === null) return null;
    const { token } = await actionTokenRepository(tx).issue({
      realmId: deps.realmId,
      subjectId: user.subjectId,
      type: 'reset_password',
      email: user.email,
      ttlSeconds: RESET_PASSWORD_TTL_SECONDS,
    });
    return { token, email: user.email };
  });

  if (issued === null) {
    return { kind: 'requested', mailFailed: false };
  }

  const link = `${deps.issuerBase}/realms/${deps.realmName}/login-actions/action-token?key=${encodeURIComponent(issued.token)}`;
  try {
    await deps.sender.send(
      renderResetPassword({ to: issued.email, link, realmDisplayName: deps.realmDisplayName }),
    );
  } catch (error) {
    return { kind: 'requested', mailFailed: true, error };
  }

  return { kind: 'requested', mailFailed: false };
}

export interface CompletePasswordResetDeps {
  readonly database: DatabaseHandle;
  readonly realmId: string;
  // Injected rather than imported, for the same reason
  // completeEmailVerification's getCurrentEmail and markVerified are:
  // @odudu/account never imports @odudu/domain-identity, where hashPassword
  // and the credentials table live. The composition root
  // (apps/server/src/app.ts) wires this to credentialRepository.setPassword.
  readonly setPassword: (
    tx: RealmScopedDatabase,
    subjectId: string,
    newPassword: string,
  ) => Promise<void>;
  // The realm's own configured policy, and the username to check it
  // against — injected for the reason setPassword is: @odudu/account never
  // imports @odudu/domain-identity, where users.username lives.
  readonly passwordPolicy: PasswordPolicy;
  readonly evaluatePassword: (
    candidate: string,
    policy: PasswordPolicy,
    subject: { username: string; email: string | null },
  ) => PolicyViolation[];
  readonly getUsername: (tx: RealmScopedDatabase, subjectId: string) => Promise<string>;
  // The one policy rule no candidate decides on its own: whether it is the
  // password already in force. Injected as the violations to report rather
  // than as a predicate, for the reason setPassword is — the stored hash,
  // the verifier and the message all live in @odudu/domain-identity.
  readonly unchangedPasswordViolations: (
    tx: RealmScopedDatabase,
    subjectId: string,
    candidate: string,
  ) => Promise<PolicyViolation[]>;
  // A subject who owed update-password has satisfied it by redeeming this
  // link, and must not be asked for a third password on their next login.
  // Injected because user_required_actions belongs to @odudu/authn-flows,
  // which @odudu/account does not depend on either.
  readonly clearPasswordUpdateAction: (tx: RealmScopedDatabase, subjectId: string) => Promise<void>;
}

export type CompletePasswordResetResult =
  | { kind: 'reset' }
  | { kind: 'invalid' }
  | { kind: 'invalid_password'; violations: PolicyViolation[] };

// One transaction: consuming the token, setting the new password, and
// retiring every other outstanding reset-password link for the same
// subject all commit or roll back together, so a reader never observes a
// spent link with the old password still active, nor a sibling link still
// redeemable after the account is recovered. The policy is checked against
// a non-consuming `peek` first: a weak password must not burn a link the
// redeemer could still use once they pick a compliant one.
export async function completePasswordReset(
  deps: CompletePasswordResetDeps,
  key: string,
  newPassword: string,
): Promise<CompletePasswordResetResult> {
  return withRealm(deps.database.db, deps.realmId, async (tx) => {
    const peeked = await actionTokenRepository(tx).peek(key);
    if (peeked?.type !== 'reset_password') return { kind: 'invalid' };

    const username = await deps.getUsername(tx, peeked.subjectId);
    const violations = deps.evaluatePassword(newPassword, deps.passwordPolicy, {
      username,
      email: peeked.email,
    });
    if (violations.length > 0) return { kind: 'invalid_password', violations };

    // Before the link is spent, for the same reason the rules above are:
    // setting the password already in force restarts the realm's
    // password_max_age_days on it, which would make an expired password
    // evadable by anybody who can read the account's mail.
    const unchanged = await deps.unchangedPasswordViolations(tx, peeked.subjectId, newPassword);
    if (unchanged.length > 0) return { kind: 'invalid_password', violations: unchanged };

    const record = await actionTokenRepository(tx).consume(key, 'reset_password');
    if (record === null) return { kind: 'invalid' };

    await deps.setPassword(tx, record.subjectId, newPassword);
    await deps.clearPasswordUpdateAction(tx, record.subjectId);
    await actionTokenRepository(tx).invalidateOutstanding(record.subjectId, 'reset_password');
    return { kind: 'reset' };
  });
}
