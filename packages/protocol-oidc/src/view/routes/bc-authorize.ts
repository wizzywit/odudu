import { withTenant, type DatabaseHandle } from '@odudu/db';
import { requestContextFrom } from '@odudu/domain-audit';
import { type Clock, systemClock } from '@odudu/kernel';
import { type FastifyInstance } from 'fastify';
import { type AuditRefusalBudget } from '#/service/audit-refusal-budget';
import { type ClientSecretLimiter } from '#/service/client-secret-throttle';
import { TokenError, TokenRateLimited } from '#/service/errors';
import { OAUTH_ERROR_DESCRIPTIONS } from '#/service/oauth-errors';
import { type AcceptedIssuersLookup } from '#/service/issuer';
import { acknowledgeBackchannelRequest, type BackchannelDeps } from '#/usecase/ciba';
import { type ApprovalMail } from '#/usecase/ciba-notice';
import { keepingSpend, tokenEndpointOf, unsettle } from '#/usecase/private-key-jwt-authentication';
import { recordRefusal } from '#/usecase/record-refusal';
import { type ClientKeySet } from '#/usecase/token-issuance';
import { tenantIssuerFor } from '#/view/issuer';

export interface BackchannelRouteDeps {
  database: DatabaseHandle;
  findTenant(
    name: string,
  ): Promise<{ id: string; enabled: boolean; loginWithEmail: boolean } | null>;
  clientKeySet: ClientKeySet;
  trustProxy: boolean;
  tlsClientCertHeader: string;
  acceptedIssuers: AcceptedIssuersLookup;
  verifyPassword: (hash: string, secret: string) => Promise<boolean>;
  clientSecretLimiter: ClientSecretLimiter;
  // Per client, on requests to this endpoint.
  cibaLimiter: ClientSecretLimiter;
  auditRefusalBudget: AuditRefusalBudget;
  // What the mail that tells a person an approval waits is built from.
  mail?: ApprovalMail;
  clock?: Clock;
}

// OpenID CIBA §7. No CORS: a client calls this with its own credentials from
// a server, never a browser.
export function registerBackchannelAuthenticationRoute(
  app: FastifyInstance,
  deps: BackchannelRouteDeps,
): void {
  const clock = deps.clock ?? systemClock;

  app.post<{
    Params: { tenant: string };
    Body: Record<string, string | string[] | undefined>;
  }>('/tenants/:tenant/protocol/openid-connect/bc-authorize', async (request, reply) => {
    const tenant = await deps.findTenant(request.params.tenant);
    if (!tenant?.enabled) return reply.code(404).send();

    const now = clock.now();
    const acceptedIssuers = await deps.acceptedIssuers(
      { id: tenant.id, name: request.params.tenant },
      tenantIssuerFor(request, request.params.tenant),
      now,
    );
    const requestDeps: BackchannelDeps = {
      tenantId: tenant.id,
      database: deps.database,
      clientKeySet: deps.clientKeySet,
      trustProxy: deps.trustProxy,
      tlsClientCertHeader: deps.tlsClientCertHeader,
      verifyPassword: deps.verifyPassword,
      clientSecretLimiter: deps.clientSecretLimiter,
      cibaLimiter: deps.cibaLimiter,
      loginWithEmail: tenant.loginWithEmail,
      tenantName: request.params.tenant,
      mail: deps.mail,
      logger: request.log,
      now: () => now,
      acceptedIssuers,
      // CIBA §7.1: the issuer, the token endpoint or this endpoint.
      assertionAudiences: acceptedIssuers.flatMap((issuer) => [
        issuer,
        tokenEndpointOf(issuer),
        `${issuer}/protocol/openid-connect/bc-authorize`,
      ]),
    };

    const context = requestContextFrom(request);
    try {
      const acknowledgement = unsettle(
        await withTenant(
          deps.database.db,
          tenant.id,
          (tx) =>
            keepingSpend(() =>
              acknowledgeBackchannelRequest(tx, requestDeps, {
                body: request.body,
                authorizationHeader: request.headers.authorization,
                headers: request.headers,
                rawHeaders: request.raw.rawHeaders,
              }),
            ),
          context,
        ),
      );
      return await reply
        .code(200)
        .header('cache-control', 'no-store')
        .header('pragma', 'no-cache')
        .send(acknowledgement);
    } catch (err) {
      if (err instanceof TokenRateLimited || err instanceof TokenError) {
        await recordRefusal(
          { database: deps.database, logger: request.log, budget: deps.auditRefusalBudget },
          tenant.id,
          context,
          err.audit,
        );
      }
      if (err instanceof TokenRateLimited) {
        return await reply
          .code(429)
          .header('cache-control', 'no-store')
          .header('pragma', 'no-cache')
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
          .header('pragma', 'no-cache')
          .send({
            error: err.error,
            error_description: err.description ?? OAUTH_ERROR_DESCRIPTIONS[err.error],
          });
      }
      throw err;
    }
  });
}
