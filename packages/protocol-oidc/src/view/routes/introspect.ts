import { type SessionLifespans } from '@odudu/authn-flows';
import { type SigningKeyRecord } from '@odudu/crypto';
import { withTenant, type DatabaseHandle } from '@odudu/db';
import { type Clock, systemClock } from '@odudu/kernel';
import { type FastifyInstance } from 'fastify';
import { type IntrospectionGrant } from '#/usecase/introspection';
import { type ClientSecretLimiter } from '#/service/client-secret-throttle';
import { TokenError, TokenRateLimited } from '#/service/errors';
import {
  respondToIntrospectionRequest,
  type IntrospectionRequestDeps,
} from '#/usecase/introspection-request';
import { tenantIssuerFor } from '#/view/issuer';

export interface IntrospectRouteDeps {
  database: DatabaseHandle;
  findTenant(name: string): Promise<
    | ({
        id: string;
        enabled: boolean;
      } & SessionLifespans)
    | null
  >;
  listPublishableKeys(tenantId: string): Promise<SigningKeyRecord[]>;
  verifyPassword: (hash: string, secret: string) => Promise<boolean>;
  // Reused, never re-implemented — see #/usecase/client-authentication.ts.
  clientSecretLimiter: ClientSecretLimiter;
  // Built at the composition root (index.ts), the same way every other
  // repository-backed lookup this package's routes consume is — a route
  // never imports a repository (dependency-cruiser's no-view-to-repository
  // rule; see token.ts's own `findTenant` comment for the same rule stated
  // where /token obeys it).
  loadGrant(tenantId: string, grantId: string): Promise<IntrospectionGrant | null>;
  isSessionLive(
    tenantId: string,
    sessionId: string,
    lifespans: SessionLifespans,
    now: Date,
  ): Promise<boolean>;
  clock?: Clock;
}

export function registerIntrospectRoute(app: FastifyInstance, deps: IntrospectRouteDeps): void {
  const clock = deps.clock ?? systemClock;

  app.post<{
    Params: { tenant: string };
    Body: Record<string, string | string[] | undefined>;
  }>('/tenants/:tenant/protocol/openid-connect/token/introspect', async (request, reply) => {
    const tenant = await deps.findTenant(request.params.tenant);
    if (!tenant?.enabled) return reply.code(404).send();

    const issuer = tenantIssuerFor(request, request.params.tenant);
    const now = clock.now();
    const keys = await deps.listPublishableKeys(tenant.id);

    const requestDeps: IntrospectionRequestDeps = {
      tenantId: tenant.id,
      verifyPassword: deps.verifyPassword,
      clientSecretLimiter: deps.clientSecretLimiter,
      issuer,
      keys,
      lifespans: {
        ssoSessionIdleSeconds: tenant.ssoSessionIdleSeconds,
        ssoSessionMaxSeconds: tenant.ssoSessionMaxSeconds,
        rememberMeIdleSeconds: tenant.rememberMeIdleSeconds,
        rememberMeMaxSeconds: tenant.rememberMeMaxSeconds,
      },
      loadGrant: (grantId) => deps.loadGrant(tenant.id, grantId),
      isSessionLive: (sessionId, lifespans, sessionNow) =>
        deps.isSessionLive(tenant.id, sessionId, lifespans, sessionNow),
    };

    try {
      const response = await withTenant(deps.database.db, tenant.id, (tx) =>
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
