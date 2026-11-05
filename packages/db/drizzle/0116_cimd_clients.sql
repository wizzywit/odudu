-- Client ID Metadata Documents. A tenant turns them on with cimd_enabled
-- (off by default, so an existing tenant is unchanged). A client that
-- arrives that way is an ordinary client row with registration_origin
-- 'cimd', rewritten from its document each time the document is resolved;
-- metadata_used_at is the last such resolution, and the row is dropped by
-- `odudu reap` once it has not been used for thirty days. The column is set
-- exactly for those rows. Each statement writes only what is missing, so the
-- file can run again to no effect.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS cimd_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE clients ADD COLUMN IF NOT EXISTS metadata_used_at timestamptz;

ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_registration_origin_check;
ALTER TABLE clients ADD CONSTRAINT clients_registration_origin_check
  CHECK (registration_origin IN ('seeded', 'anonymous', 'token', 'operator', 'cimd'));

ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_metadata_used_for_cimd;
ALTER TABLE clients ADD CONSTRAINT clients_metadata_used_for_cimd
  CHECK ((registration_origin = 'cimd') = (metadata_used_at IS NOT NULL));

-- What reap reads, per tenant, and what the per-tenant ceiling counts.
CREATE INDEX IF NOT EXISTS clients_cimd_by_use ON clients (tenant_id, metadata_used_at)
  WHERE registration_origin = 'cimd';
