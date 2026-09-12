import { type FastifyRequest } from 'fastify';

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
  return `${request.protocol}://${request.host}`;
}

export function realmIssuerFor(
  request: Pick<FastifyRequest, 'protocol' | 'host'>,
  realm: string,
): string {
  return `${issuerBaseFor(request)}/realms/${realm}`;
}
