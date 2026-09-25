-- A tenant's own SMTP configuration, resolved ahead of the deployment's
-- ODUDU_SMTP_* sender and the capturing adapter (apps/server/src/email.ts).
-- One row per tenant: tenant_id is the primary key, the same singleton
-- shape tenant_settings uses. password_encrypted wraps through the same
-- envelope a signing key's private half does (wrapSecret/unwrapSecret,
-- @odudu/crypto) — ADR 0015 is unaffected, since this is a per-tenant
-- credential the deployment itself never holds.
CREATE TABLE tenant_smtp (
  tenant_id          uuid PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  host               text NOT NULL,
  port               integer NOT NULL,
  from_address       text NOT NULL,
  username           text,
  password_encrypted text,
  starttls           boolean NOT NULL
);

ALTER TABLE tenant_smtp ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_smtp FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_smtp_isolation ON tenant_smtp
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
