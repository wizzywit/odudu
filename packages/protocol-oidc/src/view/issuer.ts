import { type FastifyInstance, type FastifyRequest } from 'fastify';
import { addressIssuer, pathAddress, routeAddress, type TenantAddress } from '@odudu/kernel';

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

declare module 'fastify' {
  interface FastifyRequest {
    // The deployment's own public address (ODUDU_PUBLIC_BASE_URL), when it
    // states one; undefined where the issuer is read off the request.
    readonly configuredIssuerBase: string | undefined;
    // Where this request's tenant is addressed: the origin and path prefix
    // every page, cookie and issuer of the tenant is written from. Undefined
    // off a tenant route.
    tenantAddress: TenantAddress | undefined;
  }
}

// Gives every request under this instance its tenant's address. Anything
// that resolves a tenant some other way registers its own hook after this
// one, so what it sets is what the handlers read.
export function configureTenantAddress(app: FastifyInstance): void {
  app.decorateRequest('tenantAddress', undefined);
  app.addHook('onRequest', (request, _reply, done) => {
    request.tenantAddress = routeAddress(request.params, issuerBaseFor(request));
    done();
  });
}

// Makes every request of this instance, and of what is registered under it,
// answer `configuredIssuerBase` with the configured address, spelled as a
// request's authority would be: the one source `issuerBaseFor` prefers.
export function configureIssuerBase(app: FastifyInstance, publicBaseUrl: string | undefined): void {
  if (publicBaseUrl === undefined) return;
  const { protocol, host } = new URL(publicBaseUrl);
  const base = `${protocol}//${canonicalAuthority(protocol.slice(0, -1), host)}`;
  app.decorateRequest('configuredIssuerBase', { getter: () => base });
}

// The one definition of Odudu's issuer identifier: OIDC Discovery §3 and
// §4.3 require the discovery document's `issuer`, the `iss` claim, the
// `iss` authorization-response parameter (RFC 9207 §2.3) and the well-known
// URL's prefix to be the same string. It is the configured public base when
// there is one, and never a header then. Without one (local development) it
// is read off the request: `protocol` and `host` respect trustProxy as
// `request.ip` does, so behind a TLS terminating proxy ODUDU_TRUST_PROXY must
// be on to read https; `host`, not `hostname`, so the port is kept.
export function issuerBaseFor(
  request: Pick<FastifyRequest, 'protocol' | 'host'> & {
    readonly configuredIssuerBase?: string | undefined;
  },
): string {
  return (
    request.configuredIssuerBase ??
    `${request.protocol}://${canonicalAuthority(request.protocol, request.host)}`
  );
}

// The issuer of `tenant` as this request reaches it. A request served at a
// tenant's own domain reaches no other tenant, and its issuer is that domain,
// not the configured path base every other request is read against.
export function tenantIssuerFor(
  request: Pick<FastifyRequest, 'protocol' | 'host'> & {
    readonly configuredIssuerBase?: string | undefined;
    readonly tenantAddress?: TenantAddress | undefined;
  },
  tenant: string,
): string {
  const address = request.tenantAddress;
  if (address?.prefix === '') return addressIssuer(address);
  return addressIssuer(pathAddress(issuerBaseFor(request), tenant));
}
