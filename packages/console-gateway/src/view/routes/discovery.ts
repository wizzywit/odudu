import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import {
  readTenantDiscovery,
  readTenantKeys,
  type TenantDocumentOutcome,
  type TenantReadDeps,
} from '#/usecase/tenant-read';
import { BAD_GATEWAY, FORBIDDEN, NOT_FOUND, sendProblem } from '#/view/problem';
import { sessionEnded } from '#/view/routes/session';
import { callerOf } from '#/view/scope';

export interface DiscoveryRouteDeps extends TenantReadDeps {
  readonly now: () => Date;
}

function sendTenantDocument<T>(
  reply: FastifyReply,
  request: FastifyRequest,
  tls: boolean,
  outcome: TenantDocumentOutcome<T>,
): FastifyReply {
  if (outcome.kind === 'ended') return sessionEnded(reply, request, tls);
  if (outcome.kind === 'unavailable') return sendProblem(reply, request, BAD_GATEWAY);
  if (outcome.kind === 'forbidden') return sendProblem(reply, request, FORBIDDEN);
  if (outcome.kind === 'not-found') return sendProblem(reply, request, NOT_FOUND);
  return reply.header('cache-control', 'no-store').send(outcome.document);
}

// Read-only mirrors of the public discovery and JWKS documents, reached
// through the gateway so the issuer shown is always the public base's
// (the gateway's own `OduduPort` pins that authority) rather than
// whatever Host the console's browser happened to send. The read and its
// authorization live in `usecase/tenant-read.ts`; this route only turns
// the outcome into a response.
export function registerDiscoveryRoutes(api: FastifyInstance, deps: DiscoveryRouteDeps): void {
  api.get<{ Params: { tenant: string } }>('/tenants/:tenant/discovery', async (request, reply) => {
    const outcome = await readTenantDiscovery(
      deps,
      request.params.tenant,
      request.headers.cookie,
      deps.now(),
      callerOf(request),
    );
    return sendTenantDocument(reply, request, deps.tls, outcome);
  });

  api.get<{ Params: { tenant: string } }>('/tenants/:tenant/jwks', async (request, reply) => {
    const outcome = await readTenantKeys(
      deps,
      request.params.tenant,
      request.headers.cookie,
      deps.now(),
      callerOf(request),
    );
    return sendTenantDocument(reply, request, deps.tls, outcome);
  });
}
