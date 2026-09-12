import { type FastifyRequest } from 'fastify';
import { realmIssuer } from '#/service/issuer';

const DEFAULT_PORT: Record<string, string> = { http: '80', https: '443' };

// The port separator is the last colon that is not inside an IPv6 literal's
// brackets, so an authority ending in `]` carries no port at all.
const PORT_SUFFIX = /:(\d+)$/u;

// `Host: idp.example:443` and `Host: idp.example` name the same authority
// over https, and RFC 3986 §3.2.3 makes the default port's presence
// insignificant. Left in, they would be two different issuer strings for
// one deployment — and since `/userinfo` verifies an access token against
// the issuer recomputed from the Host of the request presenting it, a token
// minted through one spelling would be rejected at the other.
function canonicalAuthority(protocol: string, host: string): string {
  const match = PORT_SUFFIX.exec(host);
  if (match === null) return host;
  return match[1] === DEFAULT_PORT[protocol] ? host.slice(0, match.index) : host;
}

// The one definition of Odudu's issuer identifier. OIDC Discovery §3 and
// §4.3 require the `issuer` in the discovery document, the `iss` claim in
// ID Tokens, the `iss` authorization-response parameter (RFC 9207 §2.3) and
// the well-known URL's prefix to all be the same string, so there is one
// function rather than one per route.
//
// `request.protocol` and `request.host` respect trustProxy the same way
// `request.ip` does (apps/server/src/app.ts): behind a reverse proxy that
// terminates TLS, ODUDU_TRUST_PROXY must be on for the issuer to read
// https, exactly as it must be on for request.ip to read the real client.
// `host` — not `hostname`, which drops the port — is what keeps a
// deployment served on a non-default port from advertising endpoint URLs
// nobody can reach.
export function issuerBaseFor(request: Pick<FastifyRequest, 'protocol' | 'host'>): string {
  return `${request.protocol}://${canonicalAuthority(request.protocol, request.host)}`;
}

export function realmIssuerFor(
  request: Pick<FastifyRequest, 'protocol' | 'host'>,
  realm: string,
): string {
  return realmIssuer(issuerBaseFor(request), realm);
}
