import { withRealm, type DatabaseHandle, type RealmScopedDatabase } from '@odudu/db';
import { renderResetPassword, type EmailSender } from '@odudu/email';
import { actionTokenRepository } from '#/repository/action-tokens';
import { RESET_PASSWORD_TTL_SECONDS } from '#/usecase/verify-email';

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
  // response must not depend on which happened.
  readonly findByEmail: (
    tx: RealmScopedDatabase,
    email: string,
  ) => Promise<{ subjectId: string } | null>;
}

export type RequestPasswordResetOutcome = { kind: 'requested' } | { kind: 'misconfigured' };

// Issues the token inside its own transaction when the address matches an
// account, then sends the mail after that transaction commits — awaited,
// the same ordering #/usecase/verify-email.ts establishes. When it does
// not match, this does nothing beyond the same shape of work: no row, no
// mail, no error — the enumeration-safe response is composed by the route,
// not here, and it must come out identical either way.
export async function requestPasswordReset(
  deps: RequestPasswordResetDeps,
  email: string,
): Promise<RequestPasswordResetOutcome> {
  if (deps.issuerBase === undefined) {
    return { kind: 'misconfigured' };
  }

  const token = await withRealm(deps.database.db, deps.realmId, async (tx) => {
    const user = await deps.findByEmail(tx, email);
    if (user === null) return null;
    const { token: issued } = await actionTokenRepository(tx).issue({
      realmId: deps.realmId,
      subjectId: user.subjectId,
      type: 'reset_password',
      email,
      ttlSeconds: RESET_PASSWORD_TTL_SECONDS,
    });
    return issued;
  });

  if (token !== null) {
    const link = `${deps.issuerBase}/realms/${deps.realmName}/login-actions/action-token?key=${encodeURIComponent(token)}`;
    await deps.sender.send(
      renderResetPassword({ to: email, link, realmDisplayName: deps.realmDisplayName }),
    );
  }

  return { kind: 'requested' };
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
}

export type CompletePasswordResetResult = { kind: 'reset' } | { kind: 'invalid' };

// One transaction: consuming the token and setting the new password commit
// or roll back together, so a reader can never observe a spent link with
// the old password still active. `consume`'s own type filter is what
// refuses a verify_email token presented here — it simply matches no row.
export async function completePasswordReset(
  deps: CompletePasswordResetDeps,
  key: string,
  newPassword: string,
): Promise<CompletePasswordResetResult> {
  return withRealm(deps.database.db, deps.realmId, async (tx) => {
    const record = await actionTokenRepository(tx).consume(key, 'reset_password');
    if (record === null) return { kind: 'invalid' };

    await deps.setPassword(tx, record.subjectId, newPassword);
    return { kind: 'reset' };
  });
}
