import { type FastifyInstance } from 'fastify';
import { type OduduPort } from '#/service/odudu-port';
import { authorizeTenantRead, type TenantReadDeps } from '#/usecase/tenant-read';
import { BAD_GATEWAY, FORBIDDEN, NOT_FOUND, sendProblem } from '#/view/problem';
import { sessionEnded } from '#/view/routes/session';
import { callerOf } from '#/view/scope';

export interface DiscoveryRouteDeps extends TenantReadDeps {
  readonly odudu: OduduPort;
  readonly now: () => Date;
}

// Read-only mirrors of the public discovery and JWKS documents, reached
// through the gateway so the issuer shown is always the public base's
// (the gateway's own copy of `OduduPort` pins that authority) rather than
// whatever Host the console's browser happened to send.
export function registerDiscoveryRoutes(api: FastifyInstance, deps: DiscoveryRouteDeps): void {
  api.get<{ Params: { tenant: string } }>('/tenants/:tenant/discovery', async (request, reply) => {
    const { tenant } = request.params;
    const from = callerOf(request);
    const outcome = await authorizeTenantRead(
      deps,
      tenant,
      request.headers.cookie,
      deps.now(),
      from,
    );
    if (outcome.kind === 'ended') return sessionEnded(reply, request, deps.tls);
    if (outcome.kind === 'unavailable') return sendProblem(reply, request, BAD_GATEWAY);
    if (outcome.kind === 'forbidden') return sendProblem(reply, request, FORBIDDEN);
    const document = await deps.odudu.discoveryOf(tenant, from);
    if (document === null) return sendProblem(reply, request, NOT_FOUND);
    return reply.header('cache-control', 'no-store').send(document);
  });

  api.get<{ Params: { tenant: string } }>('/tenants/:tenant/jwks', async (request, reply) => {
    const { tenant } = request.params;
    const from = callerOf(request);
    const outcome = await authorizeTenantRead(
      deps,
      tenant,
      request.headers.cookie,
      deps.now(),
      from,
    );
    if (outcome.kind === 'ended') return sessionEnded(reply, request, deps.tls);
    if (outcome.kind === 'unavailable') return sendProblem(reply, request, BAD_GATEWAY);
    if (outcome.kind === 'forbidden') return sendProblem(reply, request, FORBIDDEN);
    const jwks = await deps.odudu.keysOf(tenant, from);
    if (jwks === null) return sendProblem(reply, request, NOT_FOUND);
    return reply.header('cache-control', 'no-store').send(jwks);
  });
}
