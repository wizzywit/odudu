import { withRealm, type DatabaseHandle, type RealmScopedDatabase } from '@odudu/db';
import { renderVerifyEmail, type EmailSender } from '@odudu/email';
import { OduduError } from '@odudu/kernel';
import { actionTokenRepository } from '#/repository/action-tokens';
import { type PasswordPolicy, type PolicyViolation } from '#/repository/realm-settings';
import { VERIFY_EMAIL_TTL_SECONDS } from '#/usecase/verify-email';

// Re-exported so the view layer can reach these without importing the
// repository directly (no-view-to-repository, .dependency-cruiser.cjs):
// view → usecase is permitted, usecase → repository is where the type
// actually lives.
export type { PasswordPolicy, PolicyViolation };

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
  // The base a verification link is built from — operator configuration
  // (ODUDU_PUBLIC_BASE_URL), never derived from the request that reached
  // this usecase: see #/view/routes/registration.ts for why a request
  // header cannot be trusted with the contents of a mail sent to a third
  // party. Undefined when unset; register() refuses to send rather than
  // building a link some other way.
  readonly issuerBase: string | undefined;
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
  // The realm's own configured policy, and the leaf function that checks a
  // candidate against it (packages/domain-identity/src/service/password-policy.ts).
  // Injected for the same reason createAccount is: @odudu/account never
  // imports @odudu/domain-identity.
  readonly passwordPolicy: PasswordPolicy;
  readonly evaluatePassword: (
    candidate: string,
    policy: PasswordPolicy,
    subject: { username: string; email: string | null },
  ) => PolicyViolation[];
}

export type RegisterOutcome =
  | { kind: 'created'; subjectId: string }
  | { kind: 'email_taken' }
  | { kind: 'username_taken' }
  | { kind: 'invalid_email' }
  // The realm's password policy — read from the realm, never defaulted
  // here — refused the candidate before any write was attempted.
  | { kind: 'invalid_password'; violations: PolicyViolation[] }
  // verify_email is on for this realm but no ODUDU_PUBLIC_BASE_URL is
  // configured to build a verification link from — refused before any
  // write, rather than falling back to something request-derived or
  // creating an account nothing can ever verify.
  | { kind: 'misconfigured' };

type AccountCreationFailure = 'email_taken' | 'username_taken' | 'invalid_email';

// `users_email_unique` (0023) and `users_username_unique` (0005) are what
// actually refuse a duplicate; this only recognizes the refusal after the
// fact. Recent drizzle-orm wraps a driver failure in its own error and
// keeps the underlying `postgres` error as `.cause`, which is where the
// constraint name pg_get_constraintdef would report actually appears.
// `userRepository.create`'s own pre-flight (packages/domain-identity/src/repository/users.ts)
// throws OduduError('invalid_email', …) before the row-level CHECK is even
// reached, for the same malformed-address case.
function classifyAccountCreationError(err: unknown): AccountCreationFailure | null {
  if (err instanceof OduduError && err.code === 'invalid_email') return 'invalid_email';
  if (!(err instanceof Error)) return null;
  const cause = err.cause;
  if (!(cause instanceof Error)) return null;
  if (cause.message.includes('users_email_unique')) return 'email_taken';
  if (cause.message.includes('users_username_unique')) return 'username_taken';
  return null;
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
  if (deps.verifyEmailEnabled && deps.issuerBase === undefined) {
    return { kind: 'misconfigured' };
  }

  const violations = deps.evaluatePassword(input.password, deps.passwordPolicy, {
    username: input.username,
    email: input.email,
  });
  if (violations.length > 0) {
    return { kind: 'invalid_password', violations };
  }

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
    const failure = classifyAccountCreationError(err);
    if (failure !== null) return { kind: failure };
    throw err;
  }

  // The earlier misconfigured check already guarantees issuerBase is
  // defined whenever a token was actually issued; re-checking it here
  // (rather than asserting past the type) is what lets that stay true by
  // construction instead of by convention.
  if (created.token !== null && deps.issuerBase !== undefined) {
    const link = `${deps.issuerBase}/realms/${deps.realmName}/login-actions/action-token?key=${encodeURIComponent(created.token)}`;
    await deps.sender.send(
      renderVerifyEmail({ to: input.email, link, realmDisplayName: deps.realmDisplayName }),
    );
  }

  return { kind: 'created', subjectId: created.subjectId };
}
