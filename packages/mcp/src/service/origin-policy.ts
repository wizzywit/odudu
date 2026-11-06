import { type TenantAddress } from '@odudu/kernel';

const HOST = /^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]+\])(?::\d{1,5})?$/iu;

function hostnameOf(host: string): string | undefined {
  if (!HOST.test(host)) return undefined;
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return undefined;
  }
}

// The Host of an MCP request must be the host the tenant is served at, the one
// its resource URL names, so a name an attacker's DNS points at this server
// cannot be used to drive it from a browser (DNS rebinding). The port is not
// compared: a proxy may or may not carry it, and the name is what an attacker
// does not control. A tenant is reached at one address (ADR 0049), so there is
// no second host to accept.
export function hostAccepted(host: string | undefined, address: TenantAddress): boolean {
  if (host === undefined) return false;
  const requested = hostnameOf(host);
  return requested !== undefined && requested === new URL(address.origin).hostname;
}

const ORIGIN = /^https?:\/\/(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]+\])(?::\d{1,5})?$/iu;

// A browser sends `Origin` with every cross-site request, so a request that
// carries one must carry the tenant's own; a client that is not a browser sends
// none and passes. Compared whole (scheme, host, port) after normalisation, and
// only text that is an origin and nothing more is read as one.
export function originAccepted(origin: string | undefined, address: TenantAddress): boolean {
  if (origin === undefined) return true;
  if (!ORIGIN.test(origin)) return false;
  return new URL(origin).origin === new URL(address.origin).origin;
}
