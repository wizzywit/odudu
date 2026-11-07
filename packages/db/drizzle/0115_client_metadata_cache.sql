-- A Client ID Metadata Document fetched for a tenant, kept until its
-- Cache-Control lifetime ends (one minute to a day, set by the fetcher). The
-- URL is the client_id the document was fetched for, never a foreign key: the
-- client it names need not exist anywhere else. The body is the validated
-- projection of the document (strings and string lists only), never the raw
-- document. The CHECK on its text form is a backstop for that projection and
-- guarantees no more than that: a raw document is not bounded by it, since a
-- number such as 1e99999 prints far longer than it was written.
-- At most a fixed number of rows per tenant are kept, the
-- oldest fetched going first. Each statement writes only what is missing, so
-- the file can run again to no effect.
CREATE TABLE IF NOT EXISTS client_metadata_cache (
  tenant_id  uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  url        text NOT NULL,
  body       jsonb NOT NULL,
  fetched_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, url),
  CONSTRAINT client_metadata_cache_url_length CHECK (length(url) <= 2048),
  CONSTRAINT client_metadata_cache_body_size CHECK (length(body::text) <= 8192)
);

-- What reap deletes, per tenant: rows past their expiry.
CREATE INDEX IF NOT EXISTS client_metadata_cache_by_expiry ON client_metadata_cache (tenant_id, expires_at);

-- What trimming a tenant to its row ceiling reads: its newest fetches.
CREATE INDEX IF NOT EXISTS client_metadata_cache_by_fetch ON client_metadata_cache (tenant_id, fetched_at DESC);

ALTER TABLE client_metadata_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_metadata_cache FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_metadata_cache_isolation ON client_metadata_cache;
CREATE POLICY client_metadata_cache_isolation ON client_metadata_cache
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
