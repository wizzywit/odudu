import { type DatabaseHandle, type RealmScopedDatabase } from '@odudu/db';
import { type FastifyInstance } from 'fastify';
import { peekActionToken } from '#/usecase/action-token';
import { completePasswordReset } from '#/usecase/reset-password';
import { completeEmailVerification } from '#/usecase/verify-email';
import {
  renderResetLinkFailedPage,
  renderResetPasswordForm,
  renderResetPasswordSucceededPage,
} from '#/view/reset-html';
import {
  renderVerificationFailedPage,
  renderVerificationSucceededPage,
  sendVerificationHtml,
} from '#/view/verification-html';

export interface ActionTokenRealmLookup {
  readonly id: string;
  readonly enabled: boolean;
}

export interface ActionTokenRouteDeps {
  readonly database: DatabaseHandle;
  readonly findRealm: (name: string) => Promise<ActionTokenRealmLookup | null>;
  readonly getCurrentEmail: (tx: RealmScopedDatabase, subjectId: string) => Promise<string | null>;
  readonly markVerified: (tx: RealmScopedDatabase, subjectId: string) => Promise<void>;
  // Injected for the same reason getCurrentEmail and markVerified are:
  // @odudu/account never imports @odudu/domain-identity, where hashPassword
  // and the credentials table live.
  readonly setPassword: (
    tx: RealmScopedDatabase,
    subjectId: string,
    newPassword: string,
  ) => Promise<void>;
}

// @fastify/formbody parses a repeated query or body field into an array; a
// repeat is treated as absent rather than silently picking one, the same
// rule packages/protocol-oidc/src/view/routes/login.ts's firstString
// applies.
function firstString(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function firstNonEmptyString(value: string | string[] | undefined): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value;
}

// Not under /protocol/openid-connect/: this is Odudu's own account UI, the
// same namespace choice login.ts documents for /login-actions/authenticate.
export function registerActionTokenRoute(app: FastifyInstance, deps: ActionTokenRouteDeps): void {
  app.get<{
    Params: { realm: string };
    Querystring: Record<string, string | string[] | undefined>;
  }>('/realms/:realm/login-actions/action-token', async (request, reply) => {
    const key = firstString(request.query.key);
    const realm = key === undefined ? null : await deps.findRealm(request.params.realm);

    // A disabled realm refuses here the same way it refuses at /token,
    // /userinfo, discovery and login: consuming a token is a write against
    // that realm's users table, and disabling a realm is meant to stop all
    // of those, not just the ones a client can see.
    if (key === undefined || !realm?.enabled) {
      return sendVerificationHtml(reply, 400, renderVerificationFailedPage());
    }

    // A read, not a redemption: a reset-password link needs a page shown
    // before anything is consumed, so its type has to be known ahead of
    // that decision. A verify-email link consumes on this same GET, the
    // way it always has — peeking first only tells the two branches apart,
    // it never changes the verify-email one's behaviour.
    const peeked = await peekActionToken({ database: deps.database, realmId: realm.id }, key);
    if (peeked.kind === 'invalid') {
      return sendVerificationHtml(reply, 400, renderVerificationFailedPage());
    }

    if (peeked.type === 'reset_password') {
      return sendVerificationHtml(reply, 200, renderResetPasswordForm(request.params.realm, key));
    }

    const result = await completeEmailVerification(
      {
        database: deps.database,
        realmId: realm.id,
        getCurrentEmail: deps.getCurrentEmail,
        markVerified: deps.markVerified,
      },
      key,
    );

    if (result.kind === 'invalid') {
      return sendVerificationHtml(reply, 400, renderVerificationFailedPage());
    }
    return sendVerificationHtml(reply, 200, renderVerificationSucceededPage());
  });

  app.post<{
    Params: { realm: string };
    Body: Record<string, string | string[] | undefined>;
  }>('/realms/:realm/login-actions/action-token', async (request, reply) => {
    const body = request.body;
    const key = firstNonEmptyString(body.key);
    const password = firstNonEmptyString(body.password);
    const realm = key === undefined ? null : await deps.findRealm(request.params.realm);

    if (key === undefined || password === undefined || !realm?.enabled) {
      return sendVerificationHtml(reply, 400, renderResetLinkFailedPage());
    }

    const result = await completePasswordReset(
      { database: deps.database, realmId: realm.id, setPassword: deps.setPassword },
      key,
      password,
    );

    if (result.kind === 'invalid') {
      return sendVerificationHtml(reply, 400, renderResetLinkFailedPage());
    }
    return sendVerificationHtml(reply, 200, renderResetPasswordSucceededPage());
  });
}
