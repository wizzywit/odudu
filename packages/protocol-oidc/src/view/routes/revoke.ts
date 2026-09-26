import { type SigningKeyRecord } from '@odudu/crypto';
import { withTenant, type DatabaseHandle } from '@odudu/db';
import { requestContextFrom } from '@odudu/domain-audit';
import { type Clock, systemClock } from '@odudu/kernel';
import { type FastifyInstance } from 'fastify';
import { type AuditRefusalBudget } from '#/service/audit-refusal-budget';
import { type ClientSecretLimiter } from '#/service/client-secret-throttle';
import { TokenError, TokenRateLimited } from '#/service/errors';
import { respondToRevocationRequest, type RevocationDeps } from '#/usecase/revocation';
import { tenantIssuerFor } from '#/view/issuer';
import { recordRefusal } from '#/view/routes/record-refusal';

export interface RevokeRouteDeps {
  database: DatabaseHandle;
  findTenant(name: string): Promise<{ id: string; enabled: boolean } | null>;
  listPublishableKeys(tenantId: string): Promise<SigningKeyRecord[]>;
  verifyPassword: (hash: string, secret: string) => Promise<boolean>;
  // Reused, never re-implemented — see #/usecase/client-authentication.ts.
  clientSecretLimiter: ClientSecretLimiter;
  // ADR 0037: whether a client authentication refusal is a row or a log line.
  auditRefusalBudget: AuditRefusalBudget;
  clock?: Clock;
}

export function registerRevokeRoute(app: FastifyInstance, deps: RevokeRouteDeps): void {
  const clock = deps.clock ?? systemClock;

  app.post<{
    Params: { tenant: string };
    Body: Record<string, string | string[] | undefined>;
  }>('/tenants/:tenant/protocol/openid-connect/revoke', async (request, reply) => {
    const tenant = await deps.findTenant(request.params.tenant);
    if (!tenant?.enabled) return reply.code(404).send();

    const issuer = tenantIssuerFor(request, request.params.tenant);
    const now = clock.now();
    const keys = await deps.listPublishableKeys(tenant.id);

    const requestDeps: RevocationDeps = {
      tenantId: tenant.id,
      verifyPassword: deps.verifyPassword,
      clientSecretLimiter: deps.clientSecretLimiter,
      logger: request.log,
      issuer,
      keys,
    };

    const context = requestContextFrom(request);
    try {
      await withTenant(
        deps.database.db,
        tenant.id,
        (tx) =>
          respondToRevocationRequest(
            tx,
            requestDeps,
            request.body,
            request.headers.authorization,
            now,
          ),
        context,
      );
      return await reply.code(200).header('cache-control', 'no-store').send();
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
