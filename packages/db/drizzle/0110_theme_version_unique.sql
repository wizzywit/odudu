-- A version number is used once in a scope. The repository's per-scope lock
-- already keeps publish, restore and reset from numbering two versions alike;
-- this index makes the database refuse the second if the lock is ever missed.
-- A violation would surface as a 500, and cannot occur while every writer holds
-- the lock (themeRepository's lockScope).
-- A draft is version 0 and is left out.
CREATE UNIQUE INDEX theme_versions_one_version
  ON theme_versions (tenant_id, coalesce(client_id, '00000000-0000-0000-0000-000000000000'), version)
  WHERE state <> 'draft';
