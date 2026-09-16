import { type DatabaseHandle, type RealmScopedDatabase } from '@odudu/db';
import { type EmailSender } from '@odudu/email';
import { PASSWORD_TOO_LONG, readPasswordField } from '@odudu/kernel';
import { type FastifyInstance } from 'fastify';
import {
  register,
  type CreateAccountResult,
  type NewAccountInput,
  type PasswordPolicy,
  type PolicyViolation,
} from '#/usecase/register';
import {
  renderRegistrationFailedPage,
  renderRegistrationForm,
  renderRegistrationSucceededPage,
} from '#/view/registration-html';
import { sendVerificationHtml } from '#/view/verification-html';

export interface RegistrationRealmLookup {
  readonly id: string;
  readonly name: string;
  readonly displayName: string | null;
  readonly enabled: boolean;
  readonly registrationAllowed: boolean;
  readonly verifyEmail: boolean;
  readonly passwordPolicy: PasswordPolicy;
}

export interface RegistrationRouteDeps {
  readonly database: DatabaseHandle;
  readonly sender: EmailSender;
  readonly findRealm: (name: string) => Promise<RegistrationRealmLookup | null>;
  // Operator configuration (ODUDU_PUBLIC_BASE_URL), never anything read off
  // the request: `request.host` is the client-controlled Host header, and
  // building a mailed link from it would let an attacker point a
  // verification link at a host they control — the account-takeover
  // primitive email verification exists to close. Undefined when unset; a
  // realm with verify_email on then refuses to register rather than
  // building a link some other way.
  readonly publicBaseUrl: string | undefined;
  readonly createAccount: (
    tx: RealmScopedDatabase,
    realmId: string,
    input: NewAccountInput,
  ) => Promise<CreateAccountResult>;
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

function realmIsOpenForRegistration(
  realm: RegistrationRealmLookup | null,
): realm is RegistrationRealmLookup {
  return realm !== null && realm.enabled && realm.registrationAllowed;
}

// Not under /protocol/openid-connect/: this is Odudu's own account UI, the
// same namespace choice login.ts documents for /login-actions/authenticate.
// A realm with registration_allowed off (the default) serves nothing here
// at all — 404, not a page saying registration is closed, the same way a
// disabled realm's action-token route refuses rather than explaining.
export function registerRegistrationRoute(app: FastifyInstance, deps: RegistrationRouteDeps): void {
  app.get<{ Params: { realm: string } }>(
    '/realms/:realm/login-actions/registration',
    async (request, reply) => {
      const realm = await deps.findRealm(request.params.realm);
      if (!realmIsOpenForRegistration(realm)) {
        return reply.code(404).send();
      }
      return sendVerificationHtml(reply, 200, renderRegistrationForm(request.params.realm));
    },
  );

  app.post<{
    Params: { realm: string };
    Body: Record<string, string | string[] | undefined>;
  }>('/realms/:realm/login-actions/registration', async (request, reply) => {
    const realm = await deps.findRealm(request.params.realm);
    if (!realmIsOpenForRegistration(realm)) {
      return reply.code(404).send();
    }

    const body = request.body;
    const username = firstNonEmptyString(body.username);
    const email = firstNonEmptyString(body.email);
    const candidate = readPasswordField(body.password);
    if (candidate.kind === 'too_long') {
      return sendVerificationHtml(
        reply,
        400,
        renderRegistrationFailedPage([PASSWORD_TOO_LONG.message]),
      );
    }
    const password =
      candidate.kind === 'present' && candidate.password.length > 0
        ? candidate.password
        : undefined;
    if (username === undefined || email === undefined || password === undefined) {
      return sendVerificationHtml(
        reply,
        400,
        renderRegistrationFailedPage(['Username, email and password are all required.']),
      );
    }

    const outcome = await register(
      {
        database: deps.database,
        sender: deps.sender,
        realmId: realm.id,
        realmName: realm.name,
        realmDisplayName: realm.displayName ?? realm.name,
        issuerBase: deps.publicBaseUrl,
        verifyEmailEnabled: realm.verifyEmail,
        createAccount: deps.createAccount,
        passwordPolicy: realm.passwordPolicy,
        evaluatePassword: deps.evaluatePassword,
      },
      { username, email, password },
    );

    if (outcome.kind === 'invalid_password') {
      return sendVerificationHtml(
        reply,
        400,
        renderRegistrationFailedPage(outcome.violations.map((v) => v.message)),
      );
    }
    if (outcome.kind === 'email_taken') {
      return sendVerificationHtml(
        reply,
        400,
        renderRegistrationFailedPage(['That email address is already registered.']),
      );
    }
    if (outcome.kind === 'username_taken') {
      return sendVerificationHtml(
        reply,
        400,
        renderRegistrationFailedPage(['That username is already taken.']),
      );
    }
    if (outcome.kind === 'invalid_email') {
      return sendVerificationHtml(
        reply,
        400,
        renderRegistrationFailedPage(['That is not an address the email claim may carry.']),
      );
    }
    if (outcome.kind === 'misconfigured') {
      request.log.error(
        { realm: realm.name },
        'registration refused: verify_email is on but ODUDU_PUBLIC_BASE_URL is unset',
      );
      return sendVerificationHtml(
        reply,
        500,
        renderRegistrationFailedPage(['Registration is temporarily unavailable. Try again later.']),
      );
    }

    return sendVerificationHtml(reply, 201, renderRegistrationSucceededPage(realm.verifyEmail));
  });
}
