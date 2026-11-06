import { addressIssuer, domainAddress, pathAddress } from '@odudu/kernel';
import { StdioError } from '#/service/stdio-error';

// One way a tenant can be addressed: the issuer its metadata must name and where
// that metadata is. A tenant is at its path address under the instance, or, when
// it has a domain of its own, at the domain with no path.
export interface AddressForm {
  readonly issuer: string;
  readonly metadataUrl: string;
}

export interface StdioTarget {
  // The instance's origin, with no path.
  readonly base: string;
  readonly tenant: string;
  // The tenant's issuer at its path address; also the key its sign-in is kept under.
  readonly issuer: string;
  // RFC 8414 §3.1: the well-known suffix sits between the host and the issuer's path.
  readonly metadataUrl: string;
  // The path address, then the base URL's own origin as a domain address. Discovery
  // takes the first the server answers for; the document's issuer must be its own.
  readonly forms: readonly AddressForm[];
  adminUrl(path: string): string;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/u.test(hostname)
  );
}

// Where a stdio server sends a bearer: an origin, over TLS unless it is this
// machine. The message never carries the address, which can hold a credential.
export function stdioTarget(baseUrl: string, tenant: string): StdioTarget {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new StdioError('mcp_invalid_options', '--base-url is not a URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new StdioError('mcp_invalid_options', '--base-url must be an https URL');
  }
  if (url.username !== '' || url.password !== '') {
    throw new StdioError(
      'mcp_invalid_options',
      '--base-url must not carry a user name or password',
    );
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new StdioError(
      'mcp_invalid_options',
      '--base-url is the instance origin: no path, query or fragment',
    );
  }
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    throw new StdioError(
      'mcp_invalid_options',
      '--base-url must be https unless it is a loopback address',
    );
  }
  if (tenant === '') {
    throw new StdioError('mcp_invalid_options', '--tenant names the tenant to act in');
  }
  const base = url.origin;
  const address = pathAddress(base, tenant);
  const own = domainAddress(url.host, url.protocol === 'https:');
  const path: AddressForm = {
    issuer: addressIssuer(address),
    metadataUrl: `${base}/.well-known/oauth-authorization-server${address.prefix}`,
  };
  return {
    base,
    tenant,
    issuer: path.issuer,
    metadataUrl: path.metadataUrl,
    forms: [
      path,
      { issuer: addressIssuer(own), metadataUrl: `${base}/.well-known/oauth-authorization-server` },
    ],
    adminUrl: (path) => `${base}${path}`,
  };
}
