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

// A domain address has no path prefix: the host itself names the tenant.
export function isDomainAddress(a: TenantAddress | undefined): boolean {
  return a?.prefix === '';
}

export function addressIssuer(a: TenantAddress): string {
  return `${a.origin}${a.prefix}`;
}

export function addressPath(a: TenantAddress, rest: string): string {
  return `${a.prefix}${rest}`;
}

// The path of a tenant's MCP endpoint under its address, which is also the
// audience its MCP tokens carry (RFC 9728 §3.3).
export const MCP_RESOURCE_PATH = '/mcp';

export function mcpAudienceOfIssuer(issuer: string): string {
  return `${issuer}${MCP_RESOURCE_PATH}`;
}

// The path of a tenant's "me" API, which is also the audience its tokens carry.
export const ME_RESOURCE_PATH = '/me';

export function meAudienceOfIssuer(issuer: string): string {
  return `${issuer}${ME_RESOURCE_PATH}`;
}

export function addressUrl(a: TenantAddress, rest: string): string {
  return `${a.origin}${addressPath(a, rest)}`;
}

// An RP ID is a domain, and WebAuthn §5.1.3's same-origin check compares
// it as one: a browser can never match a credential's RP ID against an
// address literal, so a passkey registered against one is unusable from
// the moment it is created. `[…]` is how URL renders an IPv6 host, and a
// host of only digits and dots is an IPv4 one — no registrable domain
// looks like either.
export function isAddressLiteral(hostname: string): boolean {
  return hostname.startsWith('[') || /^[0-9.]+$/.test(hostname);
}

// The id is the host without its port; the origin is what clientDataJSON
// has to name, port included.
export function addressRelyingParty(a: TenantAddress): { id: string; origin: string } {
  const parsed = new URL(a.origin);
  return { id: parsed.hostname, origin: `${parsed.protocol}//${parsed.host}` };
}

// The relying-party id the configured base URL gives every passkey registered
// at the path address; null when no base URL is set or it names an address
// literal, where no passkey can have been registered.
export function baseRelyingPartyId(base: string | undefined): string | null {
  if (base === undefined) return null;
  const { id } = addressRelyingParty(pathAddress(base, ''));
  return isAddressLiteral(id) ? null : id;
}

// The path address of the tenant a route's `:tenant` segment names, for a
// request with an authority of its own to read the origin from; undefined
// off a tenant route, where no segment says whose address this is.
export function routeAddress(params: unknown, issuerBase: string): TenantAddress | undefined {
  if (typeof params !== 'object' || params === null || !('tenant' in params)) return undefined;
  return typeof params.tenant === 'string' ? pathAddress(issuerBase, params.tenant) : undefined;
}

// What a tenant route reads off its request: the hook that sets the address
// runs for every route under a tenant, so an absence here is a route
// registered outside one, not a state a request can be in.
export function tenantAddressOf(request: {
  readonly tenantAddress: TenantAddress | undefined;
}): TenantAddress {
  if (request.tenantAddress === undefined) throw new Error('the request has no tenant address');
  return request.tenantAddress;
}
