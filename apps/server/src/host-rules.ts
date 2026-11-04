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
// `request.host` reads the header the same way. The port that is the other
// scheme's default (`:80` behind TLS, `:443` without) is as foreign as any
// other port: no connection of this scheme arrives on it.
export function requestHost(
  raw: Pick<IncomingMessage, 'headers'>,
  trustProxy: boolean,
  tls: boolean,
): string | null {
  const forwarded = trustProxy ? headerText(raw.headers['x-forwarded-host']) : undefined;
  const written =
    forwarded === undefined ? headerText(raw.headers.host) : forwarded.split(',').at(-1);
  if (written === undefined) return null;
  const text = written.trim();
  if (text.endsWith(tls ? ':80' : ':443')) return null;
  return canonicalHost(text);
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

const TENANT_PATH = /^\/tenants\/([^/?#]+)/u;
const TENANT_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

// The tenant a path address names, read as the router reads it (the segment
// percent-decoded), or null when the URL is not under `/tenants/` or the
// segment is not a name a tenant can have.
export function tenantOfPath(url: string): string | null {
  const segment = TENANT_PATH.exec(url)?.[1];
  if (segment === undefined) return null;
  let name: string;
  try {
    name = decodeURIComponent(segment);
  } catch {
    return null;
  }
  return TENANT_NAME.test(name) ? name : null;
}

// What a tenant's previous address still answers for the window after a
// switch: discovery, the endpoints a token already issued is used at, and the
// brand files the logout page draws. Anything else is somewhere the tenant no
// longer offers, and gets the pointer to its canonical address.
const WINDOW_SERVES =
  /^\/tenants\/[^/?#]+(?:\/\.well-known\/openid-configuration|\/protocol\/openid-connect\/(?:token|token\/introspect|revoke|userinfo|certs|logout)|\/brand\/[^?#]*)(?:\?.*)?$/u;

export function previousAddressServes(tenantUrl: string): boolean {
  return WINDOW_SERVES.test(tenantUrl);
}
