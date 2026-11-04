import { domainToASCII } from 'node:url';

export type DomainRefusal =
  'ip_literal' | 'localhost' | 'operator_host' | 'reserved_name' | 'invalid';

export const DOMAIN_CODES = {
  systemTenant: 'domain_system_tenant',
  noBaseUrl: 'domain_no_base_url',
  limit: 'domain_limit',
  alreadyRegistered: 'domain_already_registered',
  verifiedElsewhere: 'domain_verified_elsewhere',
  ipLiteral: 'domain_host_ip_literal',
  localhost: 'domain_host_localhost',
  operatorHost: 'domain_host_operator',
  reservedName: 'domain_host_reserved',
  invalid: 'domain_host_invalid',
} as const;

export type DomainCode = (typeof DOMAIN_CODES)[keyof typeof DOMAIN_CODES];

export const REFUSAL_CODES: Record<DomainRefusal, DomainCode> = {
  ip_literal: DOMAIN_CODES.ipLiteral,
  localhost: DOMAIN_CODES.localhost,
  operator_host: DOMAIN_CODES.operatorHost,
  reserved_name: DOMAIN_CODES.reservedName,
  invalid: DOMAIN_CODES.invalid,
};

export const CHALLENGE_PREFIX = 'odudu-domain-verification=';
const CHALLENGE_LABEL = '_odudu-challenge.';
const MIN_CHALLENGE_BYTES = 32;

// The shape the tenant_domains host CHECK accepts.
const DNS_NAME = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/u;
const MAX_HOST_LENGTH = 253;
const PORT_SUFFIX = /^(.*):(\d*)$/u;
const IPV4 = /^\d+(\.\d+){3}$/u;
const DEFAULT_PORTS = new Set([80, 443]);
const RESERVED_TOP_LABELS = new Set(['test', 'example', 'invalid', 'local']);
const RESERVED_APEXES = ['example.com', 'example.org', 'example.net'];

interface Authority {
  name: string;
  port: number | null;
}

function splitAuthority(raw: string): Authority {
  const lower = raw.toLowerCase();
  const match = PORT_SUFFIX.exec(lower);
  if (match === null || lower.endsWith(']')) return { name: lower, port: null };
  const digits = match[2] ?? '';
  return { name: match[1] ?? '', port: digits === '' ? null : Number.parseInt(digits, 10) };
}

function withoutRootLabel(name: string): string {
  return name.endsWith('.') ? name.slice(0, -1) : name;
}

function dnsNameOf(name: string): string | null {
  const ascii = domainToASCII(withoutRootLabel(name));
  if (ascii === '' || ascii.length > MAX_HOST_LENGTH || !DNS_NAME.test(ascii)) return null;
  return ascii;
}

/**
 * The spelling a host is stored and compared in: lowercase, punycode, no
 * trailing dot and no default port. Null when it is not a plain DNS name the
 * table accepts, which includes a host carrying any other port.
 */
export function canonicalHost(raw: string): string | null {
  const { name, port } = splitAuthority(raw);
  if (port !== null && !DEFAULT_PORTS.has(port)) return null;
  return dnsNameOf(name);
}

function isIpLiteral(name: string): boolean {
  return name.startsWith('[') || name.includes(':') || IPV4.test(withoutRootLabel(name));
}

function isReserved(host: string): boolean {
  const top = host.slice(host.lastIndexOf('.') + 1);
  if (RESERVED_TOP_LABELS.has(top)) return true;
  return RESERVED_APEXES.some((apex) => host === apex || host.endsWith(`.${apex}`));
}

/**
 * Why a host may not be registered, or null when it may. `operatorHost` is
 * the host of the configured public base URL; its subdomains stay allowed.
 */
export function refuseHost(host: string, operatorHost: string): DomainRefusal | null {
  const { name, port } = splitAuthority(host);
  if (isIpLiteral(name)) return 'ip_literal';
  const bare = withoutRootLabel(name);
  if (bare === 'localhost' || bare.endsWith('.localhost')) return 'localhost';
  if (bare === splitAuthority(operatorHost).name.toLowerCase()) return 'operator_host';
  if (port !== null && !DEFAULT_PORTS.has(port)) return 'invalid';
  const canonical = dnsNameOf(name);
  if (canonical === null) return 'invalid';
  if (isReserved(canonical)) return 'reserved_name';
  return null;
}

export function challengeName(host: string): string {
  return `${CHALLENGE_LABEL}${host}`;
}

export function newChallenge(random: () => Buffer): string {
  const bytes = random();
  if (bytes.length < MIN_CHALLENGE_BYTES) {
    throw new Error(
      `a domain challenge needs at least ${String(MIN_CHALLENGE_BYTES)} random bytes`,
    );
  }
  return `${CHALLENGE_PREFIX}${bytes.toString('base64url')}`;
}

/** True when one TXT record, its chunks joined, is exactly the challenge. */
export function txtMatchesChallenge(
  records: readonly (readonly string[])[],
  challenge: string,
): boolean {
  return records.some((chunks) => chunks.join('') === challenge);
}
