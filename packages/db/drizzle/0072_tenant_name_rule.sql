-- A tenant name is minted straight into an issuer host segment
-- (packages/protocol-oidc's tenantIssuerFor), so a shape a resolver would
-- reject is refused here rather than surfacing as a broken issuer URL.
-- packages/domain-tenant/src/service/tenant-name.ts's isValidTenantName
-- repeats this pattern exactly. No NOT VALID: on a database already
-- holding a non-conforming name this aborts naming
-- tenants_name_dns_label; find the rows with select id, name from tenants
-- where name !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$' and recreate them.
ALTER TABLE tenants
  ADD CONSTRAINT tenants_name_dns_label
  CHECK (name ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$');
