import { type DatabaseHandle, type RealmScopedDatabase } from '@odudu/db';
import { type FastifyInstance } from 'fastify';
import { completeEmailVerification } from '#/usecase/verify-email';
import {
  renderVerificationFailedPage,
  renderVerificationSucceededPage,
  sendVerificationHtml,
} from '#/view/verification-html';

export interface ActionTokenRouteDeps {
  readonly database: DatabaseHandle;
  readonly findRealmId: (name: string) => Promise<string | null>;
  readonly getCurrentEmail: (tx: RealmScopedDatabase, subjectId: string) => Promise<string | null>;
  readonly markVerified: (tx: RealmScopedDatabase, subjectId: string) => Promise<void>;
}

// @fastify/formbody parses a repeated query field into an array; a repeat is
// treated as absent rather than silently picking one, the same rule
// packages/protocol-oidc/src/view/routes/login.ts's firstString applies.
function firstString(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

// Not under /protocol/openid-connect/: this is Odudu's own account UI, the
// same namespace choice login.ts documents for /login-actions/authenticate.
export function registerActionTokenRoute(app: FastifyInstance, deps: ActionTokenRouteDeps): void {
  app.get<{
    Params: { realm: string };
    Querystring: Record<string, string | string[] | undefined>;
  }>('/realms/:realm/login-actions/action-token', async (request, reply) => {
    const key = firstString(request.query.key);
    const realmId = key === undefined ? null : await deps.findRealmId(request.params.realm);

    if (key === undefined || realmId === null) {
      return sendVerificationHtml(reply, 400, renderVerificationFailedPage());
    }

    const result = await completeEmailVerification(
      {
        database: deps.database,
        realmId,
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
}
