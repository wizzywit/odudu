-- A tenant name is minted straight into an issuer host segment
-- (packages/protocol-oidc's tenantIssuerFor), so a shape a resolver would
-- reject is refused here rather than surfacing as a broken issuer URL.
-- packages/domain-tenant/src/service/tenant-name.ts's isValidTenantName
-- repeats this pattern exactly.
ALTER TABLE tenants
  ADD CONSTRAINT tenants_name_dns_label
  CHECK (name ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$');
