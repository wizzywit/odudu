import { type SessionLifespans } from '@odudu/authn-flows';
import { type SigningKeyRecord } from '@odudu/crypto';
import { withRealm, type DatabaseHandle } from '@odudu/db';
import { type Clock, systemClock } from '@odudu/kernel';
import { type FastifyInstance } from 'fastify';
import { type IntrospectionGrant } from '#/usecase/introspection';
import { type ClientSecretLimiter } from '#/service/client-secret-throttle';
import { TokenError, TokenRateLimited } from '#/service/errors';
import {
  respondToIntrospectionRequest,
  type IntrospectionRequestDeps,
} from '#/usecase/introspection-request';
import { realmIssuerFor } from '#/view/issuer';

export interface IntrospectRouteDeps {
  database: DatabaseHandle;
  findRealm(name: string): Promise<
    | ({
        id: string;
        enabled: boolean;
      } & SessionLifespans)
    | null
  >;
  listPublishableKeys(realmId: string): Promise<SigningKeyRecord[]>;
  verifyPassword: (hash: string, secret: string) => Promise<boolean>;
  // Reused, never re-implemented — see #/usecase/client-authentication.ts.
  clientSecretLimiter: ClientSecretLimiter;
  // Built at the composition root (index.ts), the same way every other
  // repository-backed lookup this package's routes consume is — a route
  // never imports a repository (dependency-cruiser's no-view-to-repository
  // rule; see token.ts's own `findRealm` comment for the same rule stated
  // where /token obeys it).
  loadGrant(realmId: string, grantId: string): Promise<IntrospectionGrant | null>;
  isSessionLive(
    realmId: string,
    sessionId: string,
    lifespans: SessionLifespans,
    now: Date,
  ): Promise<boolean>;
  clock?: Clock;
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

    const requestDeps: IntrospectionRequestDeps = {
      realmId: realm.id,
      verifyPassword: deps.verifyPassword,
      clientSecretLimiter: deps.clientSecretLimiter,
      issuer,
      keys,
      lifespans: {
        ssoSessionIdleSeconds: realm.ssoSessionIdleSeconds,
        ssoSessionMaxSeconds: realm.ssoSessionMaxSeconds,
        rememberMeIdleSeconds: realm.rememberMeIdleSeconds,
        rememberMeMaxSeconds: realm.rememberMeMaxSeconds,
      },
      loadGrant: (grantId) => deps.loadGrant(realm.id, grantId),
      isSessionLive: (sessionId, lifespans, sessionNow) =>
        deps.isSessionLive(realm.id, sessionId, lifespans, sessionNow),
    };

    try {
      const response = await withRealm(deps.database.db, realm.id, (tx) =>
        respondToIntrospectionRequest(
          tx,
          requestDeps,
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
