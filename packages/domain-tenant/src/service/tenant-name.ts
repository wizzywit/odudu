// A tenant name is an RFC 1123 DNS label: it is minted straight into an
// issuer host segment (packages/protocol-oidc's tenantIssuerFor), so a
// shape a resolver would reject is refused here first. The migration's
// CHECK (packages/db/drizzle/0072_tenant_name_rule.sql) repeats this
// pattern exactly, and tenant-name-check.int.test.ts proves the two agree.
const TENANT_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export const TENANT_NAME_RULE =
  'a tenant name must be 1-63 lowercase letters, digits or hyphens, and must not start or end ' +
  'with a hyphen';

export function isValidTenantName(name: string): boolean {
  return TENANT_NAME_PATTERN.test(name);
}

// `count` is reserved because GET /admin/tenants/count would otherwise be
// shadowed by GET /admin/tenants/{a tenant named count}.
export const RESERVED_TENANT_NAMES = ['system', 'count'] as const;

export function isReservedTenantName(name: string): boolean {
  return (RESERVED_TENANT_NAMES as readonly string[]).includes(name);
}
