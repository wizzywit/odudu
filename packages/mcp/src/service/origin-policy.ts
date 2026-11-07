import { type TenantAddress } from '@odudu/kernel';

const HOST = /^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]+\])(?::\d{1,5})?$/iu;
const ORIGIN = /^https?:\/\/(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]+\])(?::\d{1,5})?$/iu;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

// The root label a trailing dot states is implicit in every other spelling,
// and the issuer is written without it, so `idp.example.` is `idp.example`.
function hostnameOf(host: string): string | undefined {
  const plain = host.replace(/\.(?=(?::\d{1,5})?$)/u, '');
  if (!HOST.test(plain)) return undefined;
  try {
    return new URL(`http://${plain}`).hostname;
  } catch {
    return undefined;
  }
}

// `configured` is whether the deployment states its public address. Without
// one the tenant's address is read off the request, so comparing the two would
// compare a header with itself: only a loopback host is accepted then. With
// one, the Host must be the host of the tenant's address (ADR 0049 gives it one),
// so a name an attacker's DNS points at this server cannot drive it from a
// browser. The port is not compared: a proxy may or may not carry it.
export function hostAccepted(
  host: string | undefined,
  address: TenantAddress,
  configured: boolean,
): boolean {
  if (host === undefined) return false;
  const requested = hostnameOf(host);
  if (requested === undefined) return false;
  if (!configured) return LOOPBACK.has(requested);
  return requested === new URL(address.origin).hostname;
}

// A browser sends `Origin` with every cross-site request, so a request that
// carries one must carry the tenant's own; a client that is not a browser sends
// none and passes. Compared whole (scheme, host, port) after normalisation, and
// only text that is an origin and nothing more is read as one. Without a
// configured address the origin must also be a loopback one.
export function originAccepted(
  origin: string | undefined,
  address: TenantAddress,
  configured: boolean,
): boolean {
  if (origin === undefined) return true;
  if (!ORIGIN.test(origin)) return false;
  const parsed = new URL(origin);
  if (!configured && !LOOPBACK.has(parsed.hostname)) return false;
  return parsed.origin === new URL(address.origin).origin;
}
