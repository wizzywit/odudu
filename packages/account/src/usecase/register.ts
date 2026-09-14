import { withRealm, type DatabaseHandle, type RealmScopedDatabase } from '@odudu/db';
import { renderVerifyEmail, type EmailSender } from '@odudu/email';
import { actionTokenRepository } from '#/repository/action-tokens';
import { VERIFY_EMAIL_TTL_SECONDS } from '#/usecase/verify-email';

export interface NewAccountInput {
  readonly username: string;
  readonly email: string;
  readonly password: string;
}

export interface CreateAccountResult {
  readonly subjectId: string;
}

export interface RegisterDeps {
  readonly database: DatabaseHandle;
  readonly sender: EmailSender;
  readonly realmId: string;
  readonly realmName: string;
  readonly realmDisplayName: string;
  readonly issuerBase: string;
  readonly verifyEmailEnabled: boolean;
  // Injected for the same reason verify-email.ts's getCurrentEmail and
  // markVerified are: @odudu/account depends on neither
  // @odudu/domain-identity (subjects, users, credentials) nor
  // @odudu/domain-authz (roles), so the composition root wires the actual
  // writes and this usecase only owns the transaction boundary and the
  // action token issued inside it.
  readonly createAccount: (
    tx: RealmScopedDatabase,
    realmId: string,
    input: NewAccountInput,
  ) => Promise<CreateAccountResult>;
}

export type RegisterOutcome = { kind: 'created'; subjectId: string } | { kind: 'email_taken' };

// `users_email_unique` (packages/db/drizzle/0023_users_email_unique.sql) is
// what actually refuses a second registration for an address already held
// in the realm; this only recognizes that refusal after the fact. Recent
// drizzle-orm wraps a driver failure in its own error and keeps the
// underlying `postgres` error as `.cause`, which is where the constraint
// name pg_get_constraintdef would report actually appears.
function isDuplicateEmail(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const cause = err.cause;
  return cause instanceof Error && cause.message.includes('users_email_unique');
}

// Creates the subject, the user row, the password credential and the
// default roles in one transaction, and — only when the realm requires
// verification — issues the verify_email token inside that same
// transaction. The mail goes out after commit and is awaited, exactly as
// sendVerificationEmail (#/usecase/verify-email.ts) establishes: a token a
// user could receive but the database never durably stored would be a
// support call with no trace.
export async function register(
  deps: RegisterDeps,
  input: NewAccountInput,
): Promise<RegisterOutcome> {
  let created: { subjectId: string; token: string | null };
  try {
    created = await withRealm(deps.database.db, deps.realmId, async (tx) => {
      const account = await deps.createAccount(tx, deps.realmId, input);
      if (!deps.verifyEmailEnabled) {
        return { subjectId: account.subjectId, token: null };
      }
      const { token } = await actionTokenRepository(tx).issue({
        realmId: deps.realmId,
        subjectId: account.subjectId,
        type: 'verify_email',
        email: input.email,
        ttlSeconds: VERIFY_EMAIL_TTL_SECONDS,
      });
      return { subjectId: account.subjectId, token };
    });
  } catch (err) {
    if (isDuplicateEmail(err)) return { kind: 'email_taken' };
    throw err;
  }

  if (created.token !== null) {
    const link = `${deps.issuerBase}/realms/${deps.realmName}/login-actions/action-token?key=${encodeURIComponent(created.token)}`;
    await deps.sender.send(
      renderVerifyEmail({ to: input.email, link, realmDisplayName: deps.realmDisplayName }),
    );
  }

  return { kind: 'created', subjectId: created.subjectId };
}
