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
  // The tenant's issuer at its path address.
  readonly issuer: string;
  // The key a sign-in and its lock are kept under: the issuer of the form signed in at, so
  // a different `--tenant-address` is a different key and shares no secret.
  readonly account: string;
  // RFC 8414 §3.1: the well-known suffix sits between the host and the issuer's path.
  readonly metadataUrl: string;
  // Where the tenant signs in: its path address, or the domain address it was told
  // of. The document's issuer must be exactly the form's own.
  readonly forms: readonly AddressForm[];
  adminUrl(path: string): string;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/u.test(hostname)
  );
}

// An origin, over TLS unless it is this machine. The message names the option
// and never the address, which can hold a credential.
function originOf(value: string, option: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new StdioError('mcp_invalid_options', `${option} is not a URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new StdioError('mcp_invalid_options', `${option} must be an https URL`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new StdioError('mcp_invalid_options', `${option} must not carry a user name or password`);
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new StdioError(
      'mcp_invalid_options',
      `${option} is an origin: no path, query or fragment`,
    );
  }
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    throw new StdioError(
      'mcp_invalid_options',
      `${option} must be https unless it is a loopback address`,
    );
  }
  return url;
}

// Where a stdio server sends a bearer, and where it signs in. The admin API is
// at the instance (`baseUrl`) for every tenant; a tenant with a domain of its own
// signs in at that domain, which `tenantAddress` names, and otherwise at its path
// address under the instance.
export function stdioTarget(baseUrl: string, tenant: string, tenantAddress?: string): StdioTarget {
  const url = originOf(baseUrl, '--base-url');
  if (tenant === '') {
    throw new StdioError('mcp_invalid_options', '--tenant names the tenant to act in');
  }
  const base = url.origin;
  const address = pathAddress(base, tenant);
  const path: AddressForm = {
    issuer: addressIssuer(address),
    metadataUrl: `${base}/.well-known/oauth-authorization-server${address.prefix}`,
  };
  let forms: readonly AddressForm[] = [path];
  if (tenantAddress !== undefined) {
    const own = originOf(tenantAddress, '--tenant-address');
    const domain = domainAddress(own.host, own.protocol === 'https:');
    forms = [
      {
        issuer: addressIssuer(domain),
        metadataUrl: `${own.origin}/.well-known/oauth-authorization-server`,
      },
    ];
  }
  return {
    base,
    tenant,
    issuer: path.issuer,
    account: (forms[0] ?? path).issuer,
    metadataUrl: path.metadataUrl,
    forms,
    adminUrl: (route) => `${base}${route}`,
  };
}
