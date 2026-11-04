export interface TenantAddress {
  readonly origin: string;
  readonly prefix: string;
}

export function pathAddress(issuerBase: string, tenant: string): TenantAddress {
  return { origin: issuerBase.replace(/\/+$/, ''), prefix: `/tenants/${tenant}` };
}

export function domainAddress(host: string, tls: boolean): TenantAddress {
  return { origin: `${tls ? 'https' : 'http'}://${host}`, prefix: '' };
}

export function addressIssuer(a: TenantAddress): string {
  return `${a.origin}${a.prefix}`;
}

export function addressPath(a: TenantAddress, rest: string): string {
  return `${a.prefix}${rest}`;
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
