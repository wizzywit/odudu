import { addressIssuer, pathAddress } from '@odudu/kernel';
import { StdioError } from '#/service/stdio-error';

export interface StdioTarget {
  // The instance's origin, with no path.
  readonly base: string;
  readonly tenant: string;
  // The tenant's issuer at its path address, which discovery must name.
  readonly issuer: string;
  // RFC 8414 §3.1: the well-known suffix sits between the host and the issuer's path.
  readonly metadataUrl: string;
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
  return {
    base,
    tenant,
    issuer: addressIssuer(address),
    metadataUrl: `${base}/.well-known/oauth-authorization-server${address.prefix}`,
    adminUrl: (path) => `${base}${path}`,
  };
}
