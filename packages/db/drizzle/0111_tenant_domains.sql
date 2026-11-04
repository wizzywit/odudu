-- A host a tenant serves its sign-in from. A host is stored as the lowercase,
-- punycode, dot-separated name the resolver compares with: no port, no
-- trailing dot, at least two labels, a top label that starts with a letter so
-- an address literal cannot pass. packages/domain-tenant's host rule repeats
-- this shape.
CREATE TABLE tenant_domains (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  host            text NOT NULL,
  state           text NOT NULL DEFAULT 'pending',
  challenge       text NOT NULL,
  verified_at     timestamptz,
  last_checked_at timestamptz,
  failed_checks   integer NOT NULL DEFAULT 0,
  canonical       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_domains_state_check CHECK (state IN ('pending', 'verified', 'failed')),
  CONSTRAINT tenant_domains_host_shape CHECK (
    length(host) <= 253
    AND host ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$'
  ),
  CONSTRAINT tenant_domains_canonical_is_verified CHECK (NOT canonical OR state = 'verified'),
  CONSTRAINT tenant_domains_failed_checks_floor CHECK (failed_checks >= 0)
);

-- Serves the tenant's own list and the cascade from tenants; a tenant holds a
-- host once.
CREATE UNIQUE INDEX tenant_domains_by_tenant_host ON tenant_domains (tenant_id, host);

-- The lookup that runs before a tenant is known. Among verified rows a host
-- belongs to one tenant, while pending rows from several may wait for the
-- proof and a failed row holds nothing.
CREATE UNIQUE INDEX tenant_domains_one_verified_host ON tenant_domains (host)
  WHERE state = 'verified';
CREATE INDEX tenant_domains_by_host ON tenant_domains (host);

CREATE UNIQUE INDEX tenant_domains_one_canonical ON tenant_domains (tenant_id)
  WHERE canonical;

-- What reap deletes, per tenant: pending rows past their window.
CREATE INDEX tenant_domains_pending_by_created ON tenant_domains (tenant_id, created_at)
  WHERE state = 'pending';

ALTER TABLE tenant_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_domains FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_domains_isolation ON tenant_domains
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- An issuer a tenant stopped using and still accepts until expires_at.
CREATE TABLE tenant_issuer_retirements (
  tenant_id  uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  issuer     text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, issuer)
);

-- What reap deletes, per tenant: retirements past their window.
CREATE INDEX tenant_issuer_retirements_by_expiry
  ON tenant_issuer_retirements (tenant_id, expires_at);

ALTER TABLE tenant_issuer_retirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_issuer_retirements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_issuer_retirements_isolation ON tenant_issuer_retirements
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- The relying-party id a passkey was registered under. Null for every row
-- until the server's first start with a public base URL stamps the passkeys
-- that already exist with the base host's id; a deployment with no base URL
-- keeps null, which reads as "any relying party id".
ALTER TABLE user_credentials ADD COLUMN rp_id text;
