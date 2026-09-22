import cors, { type FastifyCorsOptions } from '@fastify/cors';
import { type FastifyInstance, type FastifyRequest } from 'fastify';
import { corsHeadersForPreflight } from '#/service/cors';

// Matches only the two endpoints whose real request is enforced against a
// resolved client rather than the tenant — a preflight carries no client
// identity, so this is also the only pattern this plugin ever answers.
const TOKEN_OR_USERINFO_PATH = /^\/tenants\/([^/]+)\/protocol\/openid-connect\/(?:token|userinfo)$/;

export interface CorsRouteDeps {
  findTenant(name: string): Promise<{ id: string; enabled: boolean } | null>;
  webOriginsForTenant(tenantId: string): Promise<ReadonlySet<string>>;
}

// Answers the preflight for /token and /userinfo from the tenant's union of
// every enabled client's origins, via `@fastify/cors`'s async delegator
// (docs/superpowers/p2a-spike-log.md). The real request on those two routes
// sets its own header once the client is resolved — see their route
// handlers. Every other route gets nothing from this plugin: `false`
// disables both the preflight reply and any header on the eventual
// response, which is what a top-level navigation needs and what the two
// public documents get instead from their own handlers.
export function registerCors(app: FastifyInstance, deps: CorsRouteDeps): void {
  // Wrapped in `{ delegator }` rather than passed as a bare function:
  // `fastify.register(plugin, fn)` treats a bare function as an
  // options-factory called once at boot with the parent instance, not
  // per request — `@fastify/cors`'s own per-request delegator hook only
  // engages through this `delegator` option.
  app.register(cors, { delegator: (request: FastifyRequest) => resolvePreflight(deps, request) });
}

async function resolvePreflight(
  deps: CorsRouteDeps,
  request: FastifyRequest,
): Promise<FastifyCorsOptions> {
  if (request.raw.method !== 'OPTIONS') return { origin: false };

  const path = (request.raw.url ?? '').split('?')[0] ?? '';
  const match = TOKEN_OR_USERINFO_PATH.exec(path);
  if (match === null) return { origin: false };

  const tenantName = match[1];
  if (tenantName === undefined) return { origin: false };

  const tenant = await deps.findTenant(decodeURIComponent(tenantName));
  if (!tenant?.enabled) return { origin: false };

  const allowed = await deps.webOriginsForTenant(tenant.id);
  const headers = corsHeadersForPreflight(request.headers.origin, allowed);
  const origin = headers?.['access-control-allow-origin'];
  if (origin === undefined) return { origin: false };

  return {
    origin,
    methods: 'GET, POST, OPTIONS',
    allowedHeaders: 'authorization, content-type',
    maxAge: 600,
  };
}
