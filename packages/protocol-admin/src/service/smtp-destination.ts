import { isIP } from 'node:net';
import { assertPublicAddresses, RemoteAddressRefused } from '@odudu/protocol-oidc';

/** Every address a hostname resolves to — `dns.lookup(host, { all: true })` in production. */
export type ResolveHost = (host: string) => Promise<readonly string[]>;

export interface SmtpDestinationPolicy {
  /**
   * The escape hatch ADR 0028 gives the JWKS fetcher, for a deployment
   * whose relay genuinely sits on a private network. Loopback, link-local
   * and multicast stay refused regardless, as they do there.
   */
  readonly allowPrivate: boolean;
  readonly resolve: ResolveHost;
}

export type SmtpDestinationOutcome =
  /** `address` is the one the check passed; connect to it, never to `host` again. */
  { kind: 'allowed'; address: string } | { kind: 'refused'; reason: string };

function unresolvable(host: string): string {
  return `this server will not connect to ${host}: it resolves to no address`;
}

/**
 * A tenant's `host` is administrator-supplied and this server connects to
 * it from inside its own perimeter, so it is bounded by exactly the rule
 * ADR 0028 puts on a client-supplied `jwks_uri`: every resolved address
 * checked in the numeric domain, and the connection then made to an
 * address that passed rather than to the name that produced it. The
 * returned `address` is that second half; a caller that reconnects by name
 * reopens the gap, so `smtpConfigFromRecord` is the only thing that reads
 * it.
 */
export async function checkSmtpDestination(
  host: string,
  policy: SmtpDestinationPolicy,
): Promise<SmtpDestinationOutcome> {
  let addresses: readonly string[];
  if (isIP(host) !== 0) {
    addresses = [host];
  } else {
    try {
      addresses = await policy.resolve(host);
    } catch {
      return { kind: 'refused', reason: unresolvable(host) };
    }
    if (addresses.length === 0) {
      return { kind: 'refused', reason: unresolvable(host) };
    }
  }

  const address = addresses[0];
  if (address === undefined) return { kind: 'refused', reason: unresolvable(host) };

  try {
    assertPublicAddresses(addresses, { allowPrivate: policy.allowPrivate });
  } catch (error) {
    if (error instanceof RemoteAddressRefused) {
      return {
        kind: 'refused',
        reason: `this server will not connect to ${host}: ${error.reason}`,
      };
    }
    throw error;
  }
  return { kind: 'allowed', address };
}
