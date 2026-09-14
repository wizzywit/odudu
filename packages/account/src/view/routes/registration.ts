import { type DatabaseHandle, type RealmScopedDatabase } from '@odudu/db';
import { type EmailSender } from '@odudu/email';
import { type FastifyInstance, type FastifyRequest } from 'fastify';
import { type CreateAccountResult, type NewAccountInput, register } from '#/usecase/register';
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
}

export interface RegistrationRouteDeps {
  readonly database: DatabaseHandle;
  readonly sender: EmailSender;
  readonly findRealm: (name: string) => Promise<RegistrationRealmLookup | null>;
  readonly createAccount: (
    tx: RealmScopedDatabase,
    realmId: string,
    input: NewAccountInput,
  ) => Promise<CreateAccountResult>;
}

// @fastify/formbody parses a repeated field into an array; every field this
// handler reads is meant to carry exactly one value, so a repeat is treated
// as absent rather than silently picking one — the same rule
// packages/protocol-oidc/src/view/routes/login.ts's firstString applies.
function firstString(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

// Not the full canonicalization packages/protocol-oidc/src/view/issuer.ts
// applies for the issuer identifier: a mailed link is only ever followed,
// never compared for identity, so it needs to be reachable, not canonical.
function issuerBaseFor(request: Pick<FastifyRequest, 'protocol' | 'host'>): string {
  return `${request.protocol}://${request.host}`;
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
    const username = firstString(body.username);
    const email = firstString(body.email);
    const password = firstString(body.password);
    if (username === undefined || email === undefined || password === undefined) {
      return sendVerificationHtml(
        reply,
        400,
        renderRegistrationFailedPage('Username, email and password are all required.'),
      );
    }

    const outcome = await register(
      {
        database: deps.database,
        sender: deps.sender,
        realmId: realm.id,
        realmName: realm.name,
        realmDisplayName: realm.displayName ?? realm.name,
        issuerBase: issuerBaseFor(request),
        verifyEmailEnabled: realm.verifyEmail,
        createAccount: deps.createAccount,
      },
      { username, email, password },
    );

    if (outcome.kind === 'email_taken') {
      return sendVerificationHtml(
        reply,
        400,
        renderRegistrationFailedPage('That email address is already registered.'),
      );
    }

    return sendVerificationHtml(reply, 201, renderRegistrationSucceededPage(realm.verifyEmail));
  });
}
