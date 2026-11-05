import { type HostState, type TenantAddressing } from '@odudu/domain-tenant';
import { addressIssuer, domainAddress, pathAddress } from '@odudu/kernel';
import { issuerBaseFor, sendPreviousAddressPage } from '@odudu/protocol-oidc';
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { type IncomingMessage } from 'node:http';
import {
  baseHostOf,
  isExemptPath,
  previousAddressServes,
  requestHost,
  rewriteForDomain,
  tenantOfPath,
} from '#/host-rules';

export interface HostResolutionDeps {
  readonly publicBaseUrl: string | undefined;
  readonly trustProxy: boolean;
  readonly tls: boolean;
  // Reads on the owner connection; the serving role sees no domain row.
  readonly state: (host: string) => Promise<HostState>;
  // Where a tenant is addressed now and whether `issuer` is one it left that
  // still answers, on the owner connection too.
  readonly addressing: (tenantName: string, issuer: string) => Promise<TenantAddressing | null>;
}

// One answer for every host that has a row and is not serving: no body, and
// nothing a probe can tell one refusal from another by.
function refuse(reply: FastifyReply): FastifyReply {
  return reply.code(404).send();
}

// What an address a tenant left answers instead of serving: nothing, or a page
// that points at `canonical`. Plain data, because awaiting a reply resolves
// through its own `then`.
type Refusal = { readonly kind: 'bare' } | { readonly kind: 'moved'; readonly canonical: string };

function answer(reply: FastifyReply, refusal: Refusal): FastifyReply {
  return refusal.kind === 'bare'
    ? refuse(reply)
    : sendPreviousAddressPage(reply, refusal.canonical);
}

// Serves a verified domain at its root as its tenant: the request is handed to
// the router again with the URL it would have had under `/tenants/<name>`, so
// every route, throttle and hook declared for that path applies unchanged.
// Nothing is resolved without a base URL. A tenant that switched address
// answers at the one it left, for a window, only where an issued token is used.
//
// Returns the hook that refuses a path address a tenant left, for the caller to
// register after the throttle hooks so a request they refuse costs no statement.
export function configureHostResolution(
  app: FastifyInstance,
  deps: HostResolutionDeps,
): (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined> {
  const { publicBaseUrl, trustProxy, tls, state, addressing } = deps;
  if (publicBaseUrl === undefined) return () => Promise.resolve(undefined);
  const baseHost = baseHostOf(publicBaseUrl);
  const served = new WeakMap<IncomingMessage, string>();

  const canonicalIssuer = (
    request: FastifyRequest,
    tenantName: string,
    found: TenantAddressing,
  ): string =>
    addressIssuer(
      found.canonicalHost === null
        ? pathAddress(issuerBaseFor(request), tenantName)
        : domainAddress(found.canonicalHost, tls),
    );

  // The path address of a tenant that has a canonical domain is a previous one.
  async function checkPathAddress(request: FastifyRequest, url: string): Promise<Refusal | null> {
    const tenantName = tenantOfPath(url);
    if (tenantName === null) return null;
    const issuer = addressIssuer(pathAddress(issuerBaseFor(request), tenantName));
    const found = await addressing(tenantName, issuer);
    if (found === null) return null;
    if (found.canonicalHost === null) return null;
    if (found.retiredUntil === null) return { kind: 'bare' };
    if (previousAddressServes(url)) return null;
    return { kind: 'moved', canonical: canonicalIssuer(request, tenantName, found) };
  }

  // A domain host that is live without being canonical is inside the window
  // of an issuer its tenant retired.
  async function checkLeftDomain(
    request: FastifyRequest,
    host: string,
    tenantName: string,
    target: string,
  ): Promise<Refusal | null> {
    if (previousAddressServes(target)) return null;
    const found = await addressing(tenantName, addressIssuer(domainAddress(host, tls)));
    if (found === null || found.canonicalHost === host) return null;
    return { kind: 'moved', canonical: canonicalIssuer(request, tenantName, found) };
  }

  async function pathAddressAnswer(
    request: FastifyRequest,
    reply: FastifyReply,
    url: string,
  ): Promise<FastifyReply | undefined> {
    const refusal = await checkPathAddress(request, url);
    return refusal === null ? undefined : answer(reply, refusal);
  }

  app.addHook('onRequest', async (request, reply) => {
    const settled = served.get(request.raw);
    if (settled !== undefined) {
      request.tenantAddress = domainAddress(settled, tls);
      return;
    }
    const url = request.raw.url ?? '';
    if (isExemptPath(url)) return;
    const host = requestHost(request.raw, trustProxy, tls);
    if (host === null || host === baseHost) return;
    reply.header('x-request-id', request.id);
    const found = await state(host);
    if (found.kind === 'unknown') return;
    if (found.kind === 'not_live') return refuse(reply);
    const target = rewriteForDomain(url, found.route.tenantName);
    if (target === null) return refuse(reply);
    if (!found.route.canonical) {
      const left = await checkLeftDomain(request, host, found.route.tenantName, target);
      if (left !== null) return answer(reply, left);
    }
    served.set(request.raw, host);
    reply.hijack();
    // The second routing reads its id from the header, so it keeps this one.
    request.raw.headers['x-request-id'] = request.id;
    request.raw.url = target;
    app.routing(request.raw, reply.raw);
  });

  return async (request, reply) => {
    const url = request.raw.url ?? '';
    if (served.has(request.raw) || isExemptPath(url)) return undefined;
    return pathAddressAnswer(request, reply, url);
  };
}
