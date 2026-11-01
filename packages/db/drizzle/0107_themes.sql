-- A theme at one scope: a tenant's (client_id null) or one client's. A scope
-- holds at most one draft and one published row, and the published row's
-- predecessors as archived rows; the repository prunes them to a bound.
CREATE TABLE theme_versions (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  client_id    uuid REFERENCES clients (id) ON DELETE CASCADE,
  state        text NOT NULL,
  version      integer NOT NULL,
  body         jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CONSTRAINT theme_versions_state_check CHECK (state IN ('draft', 'published', 'archived'))
);

-- Serves the foreign key to tenants and the lookup of a scope's rows by state.
CREATE INDEX theme_versions_by_scope ON theme_versions (tenant_id, client_id, state);
CREATE INDEX theme_versions_by_client ON theme_versions (client_id) WHERE client_id IS NOT NULL;

CREATE UNIQUE INDEX theme_versions_one_draft
  ON theme_versions (tenant_id, coalesce(client_id, '00000000-0000-0000-0000-000000000000'))
  WHERE state = 'draft';
CREATE UNIQUE INDEX theme_versions_one_published
  ON theme_versions (tenant_id, coalesce(client_id, '00000000-0000-0000-0000-000000000000'))
  WHERE state = 'published';

ALTER TABLE theme_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE theme_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY theme_versions_isolation ON theme_versions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- The images a version names, so that the versions using one are found by a
-- btree lookup: row-level security keeps a jsonb containment test, whose
-- operators are not leakproof, from using an index. Kept for archived versions
-- too, which the join to theme_versions filters out.
CREATE TABLE theme_version_assets (
  version_id uuid NOT NULL REFERENCES theme_versions (id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  asset_id   uuid NOT NULL,
  PRIMARY KEY (version_id, asset_id)
);

CREATE INDEX theme_version_assets_by_asset ON theme_version_assets (tenant_id, asset_id);

ALTER TABLE theme_version_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE theme_version_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY theme_version_assets_isolation ON theme_version_assets
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Uploaded images, apart from the rows that describe a theme so that no list
-- or page render reads their bytes. Content-addressed within a tenant.
CREATE TABLE theme_assets (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  sha256     text NOT NULL,
  mime       text NOT NULL,
  width      integer NOT NULL,
  height     integer NOT NULL,
  bytes      bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT theme_assets_content_unique UNIQUE (tenant_id, sha256)
);

ALTER TABLE theme_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE theme_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY theme_assets_isolation ON theme_assets
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
