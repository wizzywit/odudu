// The same `<base>/tenants/<name>` shape `@odudu/protocol-oidc`'s own
// issuer.ts defines, duplicated rather than imported: that module is not
// part of protocol-oidc's package exports, and this base is not the same
// value. protocol-oidc derives its base from each request's Host; the
// admin API's is a fixed deployment value (docs/superpowers/specs/2026-09-24-
// p4c-admin-api-design.md §7 step 1 forbids deriving it from the request).
export function tenantIssuer(issuerBase: string, tenantName: string): string {
  return `${issuerBase}/tenants/${tenantName}`;
}
