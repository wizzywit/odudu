import { type DatabaseHandle, type TenantScopedDatabase } from '@odudu/db';
import { type MailLookResolver } from '@odudu/email';
import { requestContextFrom } from '@odudu/domain-audit';
import { PASSWORD_TOO_LONG, readPasswordField } from '@odudu/kernel';
import { type FastifyInstance, type FastifyReply } from 'fastify';
import {
  register,
  type CreateAccountResult,
  type NewAccountInput,
  type PasswordPolicy,
  type PolicyViolation,
  type RegisterDeps,
  type TakenIdentifiers,
} from '#/usecase/register';
import { type MailGate } from '#/service/mail-gate';
import { signInPath } from '#/service/sign-in-path';
import { referenceToResume, type FindHeldSignIn } from '#/service/sign-in-resume';
import {
  renderRegistrationFailedPage,
  renderRegistrationForm,
  renderRegistrationSucceededPage,
  type RegistrationField,
  type RegistrationFailure,
} from '#/view/registration-html';
import { sendVerificationHtml } from '#/view/verification-html';
import { brandedLocale, type BrandedLocaleDeps } from '#/view/request-locale';

export interface RegistrationTenantLookup {
  readonly id: string;
  readonly supportedLocales: readonly string[];
  readonly defaultLocale: string | null;
  readonly name: string;
  readonly displayName: string | null;
  readonly enabled: boolean;
  readonly registrationAllowed: boolean;
  readonly verifyEmail: boolean;
  readonly resetPasswordAllowed: boolean;
  readonly verifyEmailTtlSeconds: number;
  readonly passwordPolicy: PasswordPolicy;
}

export interface RegistrationRouteDeps extends BrandedLocaleDeps {
  readonly database: DatabaseHandle;
  readonly findTenant: (name: string) => Promise<RegistrationTenantLookup | null>;
  // Operator configuration (ODUDU_PUBLIC_BASE_URL), never anything read off
  // the request: `request.host` is the client-controlled Host header, and
  // building a mailed link from it would let an attacker point a
  // verification link at a host they control — the account-takeover
  // primitive email verification exists to close. Undefined when unset; a
  // tenant with verify_email on then refuses to register rather than
  // building a link some other way.
  readonly publicBaseUrl: string | undefined;
  // The sign-in this browser parked and can still finish, if any. A link
  // mailed from a page names it only when the page carried that request too.
  readonly findHeldSignIn: FindHeldSignIn;
  // The clock a mail's send time comes from.
  readonly now: () => Date;
  // Reads the tenant's theme for the mail this route queues, as it does for
  // the page: a route cannot queue a mail without being handed it.
  readonly resolveMailLook: MailLookResolver;
  readonly createAccount: (
    tx: TenantScopedDatabase,
    tenantId: string,
    input: NewAccountInput,
  ) => Promise<CreateAccountResult>;
  readonly lockAddress: RegisterDeps['lockAddress'];
  readonly findTaken: (
    tx: TenantScopedDatabase,
    tenantId: string,
    who: { username: string; email: string },
  ) => Promise<TakenIdentifiers>;
  readonly hashPassword: (password: string) => Promise<string>;
  readonly isEmailAddress: (value: string) => boolean;
  readonly mailGate: MailGate;
  readonly evaluatePassword: (
    candidate: string,
    policy: PasswordPolicy,
    subject: { username: string; email: string | null },
  ) => PolicyViolation[];
}

// @fastify/formbody parses a repeated field into an array; every field this
// handler reads is meant to carry exactly one value, so a repeat is treated
// as absent rather than silently picking one — the same rule
// packages/protocol-oidc/src/view/routes/login.ts's firstString applies.
// Unlike that one, an empty string is also treated as absent: every field
// here is mandatory, not merely present-or-not, and a blank username would
// otherwise create an account nobody could type back in.
function firstNonEmptyString(value: string | string[] | undefined): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value;
}

function tenantIsOpenForRegistration(
  tenant: RegistrationTenantLookup | null,
): tenant is RegistrationTenantLookup {
  return tenant !== null && tenant.enabled && tenant.registrationAllowed;
}

// Not under /protocol/openid-connect/: this is Odudu's own account UI, the
// same namespace choice login.ts documents for /login-actions/authenticate.
// A tenant with registration_allowed off (the default) serves nothing here
// at all — 404, not a page saying registration is closed, the same way a
// disabled tenant's action-token route refuses rather than explaining.
export function registerRegistrationRoute(app: FastifyInstance, deps: RegistrationRouteDeps): void {
  app.get<{
    Params: { tenant: string };
    Querystring: Record<string, string | string[] | undefined>;
  }>('/tenants/:tenant/login-actions/registration', async (request, reply) => {
    const tenant = await deps.findTenant(request.params.tenant);
    if (!tenantIsOpenForRegistration(tenant)) {
      return reply.code(404).send();
    }
    const returnTo = signInPath(request.params.tenant, request.query.return_to);
    const locale = await brandedLocale(request, deps, tenant, returnTo);
    return sendVerificationHtml(
      reply,
      200,
      renderRegistrationForm(
        request.params.tenant,
        { rules: tenant.passwordPolicy, signInPath: returnTo },
        locale,
      ),
    );
  });

  app.post<{
    Params: { tenant: string };
    Body: Record<string, string | string[] | undefined>;
  }>('/tenants/:tenant/login-actions/registration', async (request, reply) => {
    const tenant = await deps.findTenant(request.params.tenant);
    if (!tenantIsOpenForRegistration(tenant)) {
      return reply.code(404).send();
    }

    const body = request.body;
    const username = firstNonEmptyString(body.username);
    const email = firstNonEmptyString(body.email);
    const candidate = readPasswordField(body.password);
    const again = readPasswordField(body.password_confirm);
    const returnTo = signInPath(request.params.tenant, body.return_to);
    const locale = await brandedLocale(request, deps, tenant, returnTo);
    // The form comes back in place, keeping the two values that are safe to
    // keep; a password is never put into a field again.
    const refuse = (status: number, failure: RegistrationFailure): FastifyReply =>
      sendVerificationHtml(
        reply,
        status,
        renderRegistrationForm(
          request.params.tenant,
          {
            rules: tenant.passwordPolicy,
            signInPath: returnTo,
            failure,
            ...(username === undefined ? {} : { username }),
            ...(email === undefined ? {} : { email }),
          },
          locale,
        ),
      );
    if (candidate.kind === 'too_long') {
      return refuse(400, { violations: [PASSWORD_TOO_LONG] });
    }
    const password =
      candidate.kind === 'present' && candidate.password.length > 0
        ? candidate.password
        : undefined;
    const confirmation =
      again.kind === 'present' && again.password.length > 0 ? again.password : undefined;
    if (
      username === undefined ||
      email === undefined ||
      password === undefined ||
      confirmation === undefined
    ) {
      const missing: RegistrationField[] = [
        ...(username === undefined ? (['username'] as const) : []),
        ...(email === undefined ? (['email'] as const) : []),
        ...(password === undefined ? (['password'] as const) : []),
        ...(confirmation === undefined && password !== undefined
          ? (['passwordConfirm'] as const)
          : []),
      ];
      return refuse(400, { missing });
    }
    if (password.normalize('NFC') !== confirmation.normalize('NFC')) {
      return refuse(400, { mismatch: true });
    }

    // Only a mail that will carry a link needs to know the sign-in it came out of.
    const held =
      tenant.verifyEmail && returnTo !== null
        ? await deps.findHeldSignIn(tenant, request.headers.cookie)
        : null;
    const outcome = await register(
      {
        database: deps.database,
        tenantId: tenant.id,
        tenantName: tenant.name,
        tenantDisplayName: tenant.displayName ?? tenant.name,
        request: requestContextFrom(request),
        issuerBase: deps.publicBaseUrl,
        verifyEmailEnabled: tenant.verifyEmail,
        resetPasswordAllowed: tenant.resetPasswordAllowed,
        authenticationSessionId: referenceToResume(held, returnTo),
        now: deps.now,
        resolveMailLook: deps.resolveMailLook,
        createAccount: deps.createAccount,
        lockAddress: deps.lockAddress,
        findTaken: deps.findTaken,
        hashPassword: deps.hashPassword,
        isEmailAddress: deps.isEmailAddress,
        mailGate: deps.mailGate,
        verifyEmailTtlSeconds: tenant.verifyEmailTtlSeconds,
        passwordPolicy: tenant.passwordPolicy,
        evaluatePassword: deps.evaluatePassword,
      },
      { username, email, password },
    );

    if (outcome.kind === 'invalid_password') {
      return refuse(400, { violations: outcome.violations });
    }
    if (
      outcome.kind === 'email_taken' ||
      outcome.kind === 'username_taken' ||
      outcome.kind === 'invalid_email' ||
      outcome.kind === 'invalid_username'
    ) {
      return refuse(400, { refusal: outcome.kind });
    }
    if (outcome.kind === 'misconfigured') {
      request.log.error(
        { tenant: tenant.name },
        'registration refused: verify_email is on but ODUDU_PUBLIC_BASE_URL is unset',
      );
      return sendVerificationHtml(
        reply,
        500,
        renderRegistrationFailedPage(request.params.tenant, returnTo, locale),
      );
    }

    // 'created' and 'verification_sent' leave here through the same call, and
    // 'verification_sent' is one outcome for a free and a held address, so
    // what the person is shown cannot tell them apart.
    return sendVerificationHtml(
      reply,
      201,
      renderRegistrationSucceededPage(tenant.verifyEmail, returnTo, locale),
    );
  });
}
