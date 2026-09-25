-- Binds a registered claim mapper (the catalogue stays code-defined, in
-- standardClaimMappers) to one tenant's scope. A scope with no rows here
-- uses the mappers that declare it — the fallback is per scope, never per
-- tenant, so binding one scope cannot strip the defaults from another.
CREATE TABLE client_scope_mappers (
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  client_scope_id uuid NOT NULL REFERENCES client_scopes (id) ON DELETE CASCADE,
  mapper_name     text NOT NULL,
  PRIMARY KEY (tenant_id, client_scope_id, mapper_name)
);

ALTER TABLE client_scope_mappers ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_scope_mappers FORCE ROW LEVEL SECURITY;

CREATE POLICY client_scope_mappers_isolation ON client_scope_mappers
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE INDEX client_scope_mappers_scope ON client_scope_mappers (client_scope_id);
