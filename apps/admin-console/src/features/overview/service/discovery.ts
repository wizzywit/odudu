export interface Discovery {
  issuer: string;
  [member: string]: unknown;
}

export interface PublicKey {
  kty: string;
  kid?: string | undefined;
  alg?: string | undefined;
  use?: string | undefined;
  [member: string]: unknown;
}

export interface Jwks {
  keys: readonly PublicKey[];
  [member: string]: unknown;
}

export interface DiscoveryView {
  issuer: string;
  // Where relying parties read it, OpenID Connect Discovery 1.0 §4.
  document: string;
  raw: string;
  endpoints: readonly { name: string; url: string }[];
  lists: readonly { name: string; values: readonly string[] }[];
  flags: readonly { name: string; value: boolean }[];
}

function isEndpoint(name: string): boolean {
  return name.endsWith('_endpoint') || name === 'jwks_uri';
}

function isStrings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function rawJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function discoveryView(document: Discovery): DiscoveryView {
  const members = Object.entries(document);
  return {
    issuer: document.issuer,
    document: `${document.issuer.replace(/\/$/u, '')}/.well-known/openid-configuration`,
    raw: rawJson(document),
    endpoints: members.flatMap(([name, value]) =>
      isEndpoint(name) && typeof value === 'string' ? [{ name, url: value }] : [],
    ),
    lists: members.flatMap(([name, value]) =>
      name.endsWith('_supported') && isStrings(value) ? [{ name, values: value }] : [],
    ),
    flags: members.flatMap(([name, value]) =>
      name.endsWith('_supported') && typeof value === 'boolean' ? [{ name, value }] : [],
    ),
  };
}
