import { type SigningKeyRecord } from '@odudu/crypto';
import { sessionRepository } from '@odudu/authn-flows';
import { withRealm, type DatabaseHandle, type RealmScopedDatabase } from '@odudu/db';
import { type Clock, systemClock } from '@odudu/kernel';
import { type FastifyInstance } from 'fastify';
import { tokenGrantRepository } from '#/repository/grants';
import { type ClientSecretLimiter } from '#/service/client-secret-throttle';
import { TokenError, TokenRateLimited } from '#/service/errors';
import {
  respondToIntrospectionRequest,
  type IntrospectionRequestDeps,
} from '#/usecase/introspection-request';
import { realmIssuerFor } from '#/view/issuer';

export interface IntrospectRouteDeps {
  database: DatabaseHandle;
  findRealm(
    name: string,
  ): Promise<{ id: string; enabled: boolean; ssoSessionIdleSeconds: number } | null>;
  listPublishableKeys(realmId: string): Promise<SigningKeyRecord[]>;
  verifyPassword: (hash: string, secret: string) => Promise<boolean>;
  // Reused, never re-implemented — see #/usecase/client-authentication.ts.
  clientSecretLimiter: ClientSecretLimiter;
  clock?: Clock;
}

// `IntrospectionDeps`'s two lookups closed over the transaction realm
// context is already resolved inside: `loadGrant` by the grant's own
// `grant_id`, `isSessionLive` by the session-liveness read every other
// consumer of a session uses (`sessionRepository(tx).liveById`).
function introspectionDepsFor(
  tx: RealmScopedDatabase,
  deps: IntrospectRouteDeps,
  realm: { id: string; ssoSessionIdleSeconds: number },
  issuer: string,
  keys: SigningKeyRecord[],
): IntrospectionRequestDeps {
  return {
    realmId: realm.id,
    verifyPassword: deps.verifyPassword,
    clientSecretLimiter: deps.clientSecretLimiter,
    issuer,
    keys,
    idleSeconds: realm.ssoSessionIdleSeconds,
    loadGrant: async (grantId) => {
      const grant = await tokenGrantRepository(tx).byId(grantId);
      return grant === null ? null : { revokedAt: grant.revokedAt };
    },
    isSessionLive: async (sessionId, idleSeconds, now) =>
      (await sessionRepository(tx).liveById(sessionId, idleSeconds, now)) !== null,
  };
}

export function registerIntrospectRoute(app: FastifyInstance, deps: IntrospectRouteDeps): void {
  const clock = deps.clock ?? systemClock;

  app.post<{
    Params: { realm: string };
    Body: Record<string, string | string[] | undefined>;
  }>('/realms/:realm/protocol/openid-connect/token/introspect', async (request, reply) => {
    const realm = await deps.findRealm(request.params.realm);
    if (!realm?.enabled) return reply.code(404).send();

    const issuer = realmIssuerFor(request, request.params.realm);
    const now = clock.now();
    const keys = await deps.listPublishableKeys(realm.id);

    try {
      const response = await withRealm(deps.database.db, realm.id, (tx) =>
        respondToIntrospectionRequest(
          tx,
          introspectionDepsFor(tx, deps, realm, issuer, keys),
          request.body,
          request.headers.authorization,
          now,
        ),
      );
      return await reply.code(200).header('cache-control', 'no-store').send(response);
    } catch (err) {
      if (err instanceof TokenRateLimited) {
        return await reply
          .code(429)
          .header('cache-control', 'no-store')
          .header('retry-after', String(err.retryAfterSeconds))
          .send();
      }
      if (err instanceof TokenError) {
        if (err.wwwAuthenticate !== undefined) {
          reply.header('www-authenticate', err.wwwAuthenticate);
        }
        return reply
          .code(err.status)
          .header('cache-control', 'no-store')
          .send({ error: err.error });
      }
      throw err;
    }
  });
}
