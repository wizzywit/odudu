// Where a tenant is addressed: an origin and the path under it. The server
// derives the same strings; a test in the server's MCP package holds the two
// together.
export interface TenantAddress {
  readonly origin: string;
  readonly prefix: string;
}

export function pathAddress(issuerBase: string, tenant: string): TenantAddress {
  return {
    origin: issuerBase.replace(/\/+$/, ''),
    prefix: `/tenants/${encodeURIComponent(tenant)}`,
  };
}

export function domainAddress(host: string, tls: boolean): TenantAddress {
  return { origin: `${tls ? 'https' : 'http'}://${host}`, prefix: '' };
}

export function addressIssuer(a: TenantAddress): string {
  return `${a.origin}${a.prefix}`;
}
