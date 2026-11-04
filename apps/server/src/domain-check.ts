import { canonicalHost, type HostState } from '@odudu/domain-tenant';
import { type FastifyInstance } from 'fastify';
import { type RateLimiter } from '#/throttle';
import { throttleOrigin } from '#/throttle-origin';

export const DOMAIN_CHECK_PATH = '/internal/domain-check';

export interface DomainCheckDeps {
  // Reads on the owner connection; the serving role sees no domain row.
  readonly state: (host: string) => Promise<HostState>;
  // False when no host is resolved to a tenant (no public base URL): a
  // certificate for a host that would then route as an unknown one is no help.
  readonly resolving: boolean;
  // Its own budget: a proxy asking about every handshake must never spend
  // what a person signing in has, nor the other way round.
  readonly throttle: RateLimiter;
}

function hostAsked(query: unknown): string | null {
  if (typeof query !== 'object' || query === null) return null;
  const value: unknown = (query as Record<string, unknown>).domain;
  return typeof value === 'string' ? canonicalHost(value) : null;
}

// The reverse proxy's on-demand TLS question: may a certificate be obtained
// for this host. The answer is the status and nothing else, so what a probe
// learns is which hosts are registered and live. No shared secret guards it;
// the per-origin budget bounds how fast that can be asked.
export function registerDomainCheck(app: FastifyInstance, deps: DomainCheckDeps): void {
  app.get(
    DOMAIN_CHECK_PATH,
    {
      onRequest: async (request, reply) => {
        const decision = deps.throttle.check(throttleOrigin(request.ip));
        if (decision.allowed) return;
        return reply.header('retry-after', String(decision.retryAfterSeconds)).code(429).send();
      },
    },
    async (request, reply) => {
      const host = hostAsked(request.query);
      const found = host === null || !deps.resolving ? null : await deps.state(host);
      return reply.code(found?.kind === 'live' ? 200 : 404).send();
    },
  );
}
