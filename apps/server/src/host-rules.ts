import { canonicalHost } from '@odudu/domain-tenant';
import { addressPath, pathAddress } from '@odudu/kernel';
import { type IncomingMessage } from 'node:http';

function headerText(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// The canonical host the request was addressed to, or null when it names no
// registrable one. `X-Forwarded-Host` counts only behind a proxy the
// deployment trusts, and then the last entry: a proxy appends its own on the
// right, so everything left of it is what the client wrote. Fastify's
// `request.host` reads the header the same way.
export function requestHost(
  raw: Pick<IncomingMessage, 'headers'>,
  trustProxy: boolean,
): string | null {
  const forwarded = trustProxy ? headerText(raw.headers['x-forwarded-host']) : undefined;
  const written =
    forwarded === undefined ? headerText(raw.headers.host) : forwarded.split(',').at(-1);
  return written === undefined ? null : canonicalHost(written.trim());
}

// The host of the configured public base URL, by name: a port does not make
// it another host, and an address names no domain a tenant could register.
export function baseHostOf(publicBaseUrl: string): string | null {
  return canonicalHost(new URL(publicBaseUrl).hostname);
}

const HEALTH = /^\/health(?:[/?]|$)/u;
const DOMAIN_CHECK = /^\/internal\/domain-check(?:\?|$)/u;

// Paths answered for any host without asking which tenant it belongs to: a
// probe addressed by an internal name, and the question a proxy asks about a
// domain.
export function isExemptPath(url: string): boolean {
  return HEALTH.test(url) || DOMAIN_CHECK.test(url);
}

// The URL a domain host's request is routed as: its path under its tenant, so
// what no tenant route serves is as unknown there as anywhere. Null when the
// target is not a path (`*`, an absolute URI), which nothing may be routed for.
export function rewriteForDomain(url: string, tenantName: string): string | null {
  if (!url.startsWith('/')) return null;
  return addressPath(pathAddress('', tenantName), url);
}
