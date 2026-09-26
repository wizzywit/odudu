import { withTenant, type DatabaseHandle, type TenantScopedDatabase } from '@odudu/db';
import { auditRepository, type RequestContext } from '@odudu/domain-audit';
import { outboxRepository, renderVerifyEmail } from '@odudu/email';
import { OduduError } from '@odudu/kernel';
import { actionTokenRepository } from '#/repository/action-tokens';
import { type PasswordPolicy, type PolicyViolation } from '#/repository/tenant-settings';
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
  readonly tenantId: string;
  readonly tenantName: string;
  readonly tenantDisplayName: string;
  readonly request: RequestContext;
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
    tx: TenantScopedDatabase,
    tenantId: string,
    input: NewAccountInput,
  ) => Promise<CreateAccountResult>;
  // The tenant's own configured policy, and the leaf function that checks a
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
  // The tenant's password policy — read from the tenant, never defaulted
  // here — refused the candidate before any write was attempted.
  | { kind: 'invalid_password'; violations: PolicyViolation[] }
  // verify_email is on for this tenant but no ODUDU_PUBLIC_BASE_URL is
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
// default roles in one transaction, and — only when the tenant requires
// verification — issues the verify_email token and queues the mail that
// carries it inside that same transaction, exactly as sendVerificationEmail
// (#/usecase/verify-email.ts) establishes: an account that rolls back
// leaves no link in anybody's inbox, and a link that reaches an inbox names
// a token the database durably stored.
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

  let created: { subjectId: string };
  try {
    created = await withTenant(
      deps.database.db,
      deps.tenantId,
      async (tx) => {
        const account = await deps.createAccount(tx, deps.tenantId, input);
        await auditRepository(tx).record({
          eventType: 'credential',
          action: 'account.registered',
          outcome: 'allowed',
          actorSubjectId: account.subjectId,
          resourceType: 'subject',
          resourceId: account.subjectId,
        });
        // The earlier misconfigured check already guarantees issuerBase is
        // defined whenever verification is on; re-checking it here (rather
        // than asserting past the type) is what lets that stay true by
        // construction instead of by convention.
        if (!deps.verifyEmailEnabled || deps.issuerBase === undefined) {
          return { subjectId: account.subjectId };
        }
        const { token } = await actionTokenRepository(tx).issue({
          tenantId: deps.tenantId,
          subjectId: account.subjectId,
          type: 'verify_email',
          email: input.email,
          ttlSeconds: VERIFY_EMAIL_TTL_SECONDS,
        });
        const link = `${deps.issuerBase}/tenants/${deps.tenantName}/login-actions/action-token?key=${encodeURIComponent(token)}`;
        await outboxRepository(tx).enqueue({
          tenantId: deps.tenantId,
          ...renderVerifyEmail({
            to: input.email,
            link,
            tenantDisplayName: deps.tenantDisplayName,
          }),
        });
        return { subjectId: account.subjectId };
      },
      deps.request,
    );
  } catch (err) {
    const failure = classifyAccountCreationError(err);
    if (failure !== null) return { kind: failure };
    throw err;
  }

  return { kind: 'created', subjectId: created.subjectId };
}
