import { DOMAIN_CODES, type DomainCode } from '@odudu/domain-tenant';

// What `detail` says for each refusal a domain call can answer.
export const DOMAIN_DETAILS: Readonly<Record<DomainCode, string>> = {
  [DOMAIN_CODES.systemTenant]: 'the system tenant has no domain of its own',
  [DOMAIN_CODES.noBaseUrl]:
    'this server has no public base URL configured, so no domain can be served',
  [DOMAIN_CODES.limit]: 'the tenant holds as many domains as it may, so remove one first',
  [DOMAIN_CODES.alreadyRegistered]: 'the tenant has registered this host already',
  [DOMAIN_CODES.verifiedElsewhere]:
    'another tenant proved ownership of this host first, so it cannot be verified here',
  [DOMAIN_CODES.ipLiteral]: 'an IP address cannot be a domain',
  [DOMAIN_CODES.localhost]: 'localhost cannot be a domain',
  [DOMAIN_CODES.operatorHost]: 'the host is the one this server itself is served at',
  [DOMAIN_CODES.reservedName]: 'the name is reserved for tests and documentation',
  [DOMAIN_CODES.invalid]: 'the host is not a lowercase, punycode DNS name without a port',
};

export const DOMAIN_NOT_VERIFIED_DETAIL =
  'only a verified domain can become the tenant’s address; verify it first';
export const DOMAIN_FAILED_DETAIL =
  'a failed domain proves nothing and is never checked again; remove it and register it again';
export const DOMAIN_CANONICAL_DETAIL =
  'the domain is the tenant’s address; deactivate it before removing it';
export const DOMAIN_SWITCH_CONFLICT_DETAIL =
  'another change of the tenant’s address landed first; read the domains again and retry';
export const DOMAIN_VERIFY_THROTTLED_DETAIL =
  'this domain or this tenant was checked too recently; wait for the Retry-After interval';
export const DOMAIN_NO_BASE_URL_DETAIL = DOMAIN_DETAILS[DOMAIN_CODES.noBaseUrl];
