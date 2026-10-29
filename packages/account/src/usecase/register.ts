import { actionLink, resetPasswordLink } from '#/service/action-link';
import { type MailGate } from '#/service/mail-gate';
import { withTenant, type DatabaseHandle, type TenantScopedDatabase } from '@odudu/db';
import { auditRepository, type RequestContext } from '@odudu/domain-audit';
import {
  outboxRepository,
  mailContext,
  renderFinishRegistration,
  renderRegistrationDuplicate,
  type MailLookResolver,
} from '@odudu/email';
import { BidiControlError, containsBidiControl, OduduError } from '@odudu/kernel';
import { pendingRegistrationRepository } from '#/repository/pending-registrations';
import { type PasswordPolicy, type PolicyViolation } from '#/repository/tenant-settings';
import { withMinimum } from '#/service/password-violations';

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

// Who already holds what a registration asks for: whether the username is
// taken, and the subject holding the email address, if any.
export interface TakenIdentifiers {
  readonly username: boolean;
  readonly emailOwner: string | null;
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
  // Whether the tenant serves a password reset the mail to an existing
  // address holder can point at.
  readonly resetPasswordAllowed: boolean;
  // The sign-in the person registered from, when this browser holds it
  // (referenceToResume): kept beside the token so the page the link opens can
  // lead the same browser back to it, never put in the link.
  readonly authenticationSessionId?: string | null;
  // The send time of the mail, from the caller's clock.
  readonly now: () => Date;
  // Themes the mail the way the tenant's pages are; absent, it is unthemed.
  readonly resolveMailLook?: MailLookResolver | undefined;

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
  // Taken before findTaken asks, so two registrations for one address in two
  // cases take turns and the second finds what the first committed.
  readonly lockAddress: (
    tx: TenantScopedDatabase,
    tenantId: string,
    email: string,
  ) => Promise<void>;
  // Asked in the transaction, before anything is written, for the same
  // reason: the identity tables belong to @odudu/domain-identity.
  readonly findTaken: (
    tx: TenantScopedDatabase,
    tenantId: string,
    who: { username: string; email: string },
  ) => Promise<TakenIdentifiers>;
  // The Argon2id hash of a password, made before the transaction opens on
  // every path of a tenant that verifies addresses, so both answer in the
  // same time and no connection waits on it.
  readonly hashPassword: (password: string) => Promise<string>;
  readonly verifyEmailTtlSeconds: number;
  // The shape of address the email claim may carry; createAccount's own
  // check cannot run for a registration that creates nothing yet.
  readonly isEmailAddress: (value: string) => boolean;
  // Whether a mail may go to this address now; see #/service/mail-gate.ts.
  readonly mailGate: MailGate;
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
  // The tenant verifies addresses: nothing is created yet, and whether the
  // address was free or held, the person is told to check their email.
  | { kind: 'verification_sent' }
  | { kind: 'email_taken' }
  | { kind: 'username_taken' }
  | { kind: 'invalid_email' }
  // A bidirectional control in the username: refused, not stripped, because
  // stripping would let two different usernames collide.
  | { kind: 'invalid_username' }
  // The tenant's password policy — read from the tenant, never defaulted
  // here — refused the candidate before any write was attempted.
  | { kind: 'invalid_password'; violations: PolicyViolation[] }
  // verify_email is on for this tenant but no ODUDU_PUBLIC_BASE_URL is
  // configured to build a verification link from — refused before any
  // write, rather than falling back to something request-derived or
  // creating an account nothing can ever verify.
  | { kind: 'misconfigured' };

export type AccountCreationFailure =
  'email_taken' | 'username_taken' | 'invalid_email' | 'invalid_username';

// `users_email_unique` (0023) and `users_username_unique` (0005) are what
// actually refuse a duplicate; this only recognizes the refusal after the
// fact. Recent drizzle-orm wraps a driver failure in its own error and
// keeps the underlying `postgres` error as `.cause`, which is where the
// constraint name pg_get_constraintdef would report actually appears.
// `userRepository.create`'s own pre-flight (packages/domain-identity/src/repository/users.ts)
// throws OduduError('invalid_email', …) before the row-level CHECK is even
// reached, for the same malformed-address case.
export function classifyAccountCreationError(err: unknown): AccountCreationFailure | null {
  if (err instanceof BidiControlError && err.field === 'username') return 'invalid_username';
  if (err instanceof OduduError && err.code === 'invalid_email') return 'invalid_email';
  if (!(err instanceof Error)) return null;
  const cause = err.cause;
  if (!(cause instanceof Error)) return null;
  if (cause.message.includes('users_email_unique')) return 'email_taken';
  if (cause.message.includes('users_username_unique')) return 'username_taken';
  return null;
}

// Without verification, creates the subject, the user row, the password
// credential and the default roles in one transaction. With it, creates
// nothing: the request is kept as a pending registration and its link mailed,
// and the account is made when the link is used (#/usecase/complete-registration.ts).
// A free address and a held one then leave the same trace, and a username is
// reserved by neither, so no later request can tell them apart.
export async function register(
  deps: RegisterDeps,
  input: NewAccountInput,
): Promise<RegisterOutcome> {
  if (deps.verifyEmailEnabled && deps.issuerBase === undefined) {
    return { kind: 'misconfigured' };
  }
  if (containsBidiControl(input.username)) return { kind: 'invalid_username' };

  const violations = deps.evaluatePassword(input.password, deps.passwordPolicy, {
    username: input.username,
    email: input.email,
  });
  if (violations.length > 0) {
    return {
      kind: 'invalid_password',
      violations: withMinimum(violations, deps.passwordPolicy.minLength),
    };
  }

  if (!deps.isEmailAddress(input.email)) return { kind: 'invalid_email' };

  if (deps.verifyEmailEnabled) return requestVerification(deps, input);

  try {
    return await withTenant(
      deps.database.db,
      deps.tenantId,
      async (tx): Promise<RegisterOutcome> => {
        await deps.lockAddress(tx, deps.tenantId, input.email);
        const taken = await deps.findTaken(tx, deps.tenantId, input);
        if (taken.username) return { kind: 'username_taken' };
        if (taken.emailOwner !== null) return { kind: 'email_taken' };
        const account = await deps.createAccount(tx, deps.tenantId, input);
        await auditRepository(tx).record({
          eventType: 'credential',
          action: 'account.registered',
          outcome: 'allowed',
          actorSubjectId: account.subjectId,
          resourceType: 'subject',
          resourceId: account.subjectId,
        });
        return { kind: 'created', subjectId: account.subjectId };
      },
      deps.request,
    );
  } catch (err) {
    const failure = classifyAccountCreationError(err);
    if (failure === null) throw err;
    return { kind: failure };
  }
}

// Three reads and two writes on both paths: the tenant's theme and default
// language, who holds the username and the address; then, for a free address, the pending row and the mail with its
// link, and for a held one, the audit row and the mail to the holder. The
// username is answered first and in the open, so a held address never changes
// what a held username is told. The password is hashed first on both. A mail
// the address's budget refuses leaves the person's earlier request and link as
// they were, and the answer is the same.
async function requestVerification(
  deps: RegisterDeps,
  input: NewAccountInput,
): Promise<RegisterOutcome> {
  const issuerBase = deps.issuerBase;
  if (issuerBase === undefined) return { kind: 'misconfigured' };
  const passwordHash = await deps.hashPassword(input.password);
  return withTenant(
    deps.database.db,
    deps.tenantId,
    async (tx): Promise<RegisterOutcome> => {
      const mail = await mailContext(tx, deps.resolveMailLook, deps);
      const taken = await deps.findTaken(tx, deps.tenantId, input);
      if (taken.username) return { kind: 'username_taken' };
      if (taken.emailOwner !== null) {
        await auditRepository(tx).record({
          eventType: 'credential',
          action: 'account.registration_duplicate',
          outcome: 'refused',
          resourceType: 'subject',
          resourceId: taken.emailOwner,
          detail: { reason: 'already_registered' },
        });
        if (deps.mailGate('held', deps.tenantId, input.email)) {
          await outboxRepository(tx).enqueue({
            tenantId: deps.tenantId,
            ...renderRegistrationDuplicate({
              to: input.email,
              resetLink: deps.resetPasswordAllowed
                ? resetPasswordLink(issuerBase, deps.tenantName)
                : null,
              tenantDisplayName: deps.tenantDisplayName,
              now: deps.now(),
              ...mail,
            }),
          });
        }
        return { kind: 'verification_sent' };
      }
      if (!deps.mailGate('registration', deps.tenantId, input.email)) {
        return { kind: 'verification_sent' };
      }
      const { key } = await pendingRegistrationRepository(tx).replace({
        tenantId: deps.tenantId,
        username: input.username,
        email: input.email,
        passwordHash,
        authenticationSessionId: deps.authenticationSessionId ?? null,
        ttlSeconds: deps.verifyEmailTtlSeconds,
        now: deps.now(),
      });
      await outboxRepository(tx).enqueue({
        tenantId: deps.tenantId,
        ...renderFinishRegistration({
          to: input.email,
          link: actionLink(issuerBase, deps.tenantName, key),
          tenantDisplayName: deps.tenantDisplayName,
          now: deps.now(),
          ...mail,
        }),
      });
      return { kind: 'verification_sent' };
    },
    deps.request,
  );
}
