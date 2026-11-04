import { type HostState } from '@odudu/domain-tenant';
import { domainAddress } from '@odudu/kernel';
import { type FastifyInstance, type FastifyReply } from 'fastify';
import { type IncomingMessage } from 'node:http';
import { baseHostOf, isExemptPath, requestHost, rewriteForDomain } from '#/host-rules';

export interface HostResolutionDeps {
  readonly publicBaseUrl: string | undefined;
  readonly trustProxy: boolean;
  readonly tls: boolean;
  // Reads on the owner connection; the serving role sees no domain row.
  readonly state: (host: string) => Promise<HostState>;
}

// One answer for every host that has a row and is not serving: no body, and
// nothing a probe can tell one refusal from another by.
function refuse(reply: FastifyReply): FastifyReply {
  return reply.code(404).send();
}

// Serves a verified domain at its root as its tenant. The router has already
// matched by the time an onRequest hook runs, and the lookup is asynchronous,
// so a live host's request is handed to the router again with the URL it
// would have had under `/tenants/<name>`; every route, throttle and hook
// declared for that path then applies unchanged. The first pass is abandoned
// without a response (`hijack`), and the second reads what the first learned.
// Nothing is resolved without a base URL to tell the operator's own host by.
export function configureHostResolution(app: FastifyInstance, deps: HostResolutionDeps): void {
  const { publicBaseUrl, trustProxy, tls, state } = deps;
  if (publicBaseUrl === undefined) return;
  const baseHost = baseHostOf(publicBaseUrl);
  const served = new WeakMap<IncomingMessage, string>();

  app.addHook('onRequest', async (request, reply) => {
    const settled = served.get(request.raw);
    if (settled !== undefined) {
      request.tenantAddress = domainAddress(settled, tls);
      return;
    }
    const url = request.raw.url ?? '';
    if (isExemptPath(url)) return;
    const host = requestHost(request.raw, trustProxy);
    if (host === null || host === baseHost) return;
    const found = await state(host);
    if (found.kind === 'unknown') return;
    if (found.kind === 'not_live') return refuse(reply);
    const target = rewriteForDomain(url, found.route.tenantName);
    if (target === null) return refuse(reply);
    served.set(request.raw, host);
    reply.hijack();
    request.raw.url = target;
    app.routing(request.raw, reply.raw);
  });
}
