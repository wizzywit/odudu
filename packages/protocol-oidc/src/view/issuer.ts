import { type FastifyRequest } from 'fastify';
import { realmIssuer } from '#/service/issuer';

const DEFAULT_PORT: Record<string, string> = { http: '80', https: '443' };

// The port separator is the last colon that is not inside an IPv6 literal's
// brackets, so an authority ending in `]` carries no port at all. RFC 3986
// §3.2.3 spells the port `*DIGIT`, which admits leading zeros and an empty
// port, so the digits are matched rather than a single canonical form.
const PORT_SUFFIX = /:(\d*)$/u;

// §3.2.3: an empty port is the same as no port, and both mean the scheme's
// default — so `:`, `:443` and `:00443` are one thing under https, and the
// canonical spelling of all three is silence.
function canonicalPort(protocol: string, digits: string): string {
  if (digits === '') return '';
  const port = String(Number.parseInt(digits, 10));
  return port === DEFAULT_PORT[protocol] ? '' : `:${port}`;
}

// A trailing dot states the DNS root label that every other spelling leaves
// implicit; `idp.example.` and `idp.example` resolve to one host and are
// presented on one certificate. A bracketed IPv6 literal has no such form.
function withoutRootLabel(host: string): string {
  return host.endsWith('.') ? host.slice(0, -1) : host;
}

// `Host: idp.example:443` and `Host: idp.example` name the same authority
// over https. Left as they arrived, they would be two different issuer
// strings for one deployment — and since `/userinfo` verifies an access
// token against the issuer recomputed from the Host of the request
// presenting it, a token minted through one spelling would be rejected at
// the other. RFC 3986 §6.2.2.1 (the host is case-insensitive) and §3.2.3
// (the port's spelling and the default port's presence are insignificant)
// say which differences are spelling rather than substance.
function canonicalAuthority(protocol: string, rawHost: string): string {
  const host = rawHost.toLowerCase();
  const match = PORT_SUFFIX.exec(host);
  if (match === null) return withoutRootLabel(host);
  return withoutRootLabel(host.slice(0, match.index)) + canonicalPort(protocol, match[1] ?? '');
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
