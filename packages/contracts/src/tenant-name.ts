// A tenant name is an RFC 1123 DNS label: it is minted straight into an
// issuer host segment, so a shape a resolver would reject is refused first.
// @odudu/domain-tenant re-exports these, and the CHECK in
// packages/db/drizzle/0072_tenant_name_rule.sql repeats the pattern; the
// console refuses a mistyped name with the same words before it asks.
export const TENANT_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export const TENANT_NAME_RULE =
  'a tenant name must be 1-63 lowercase letters, digits or hyphens, and must not start or end ' +
  'with a hyphen';

export function isTenantName(name: string): boolean {
  return TENANT_NAME_PATTERN.test(name);
}
