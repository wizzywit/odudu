-- The same shape as 0073_list_indexes_subjects.sql, for the same reason:
-- a prefix search is a range over a stored C-collation lower() copy,
-- compared with leakproof operators so row-level security leaves it in the
-- index condition. signing_keys gets none: a tenant holds a handful of
-- keys, so filtering them is never worth an index.
ALTER TABLE roles
  ADD COLUMN name_search text COLLATE "C" GENERATED ALWAYS AS (lower(name)) STORED;
ALTER TABLE groups
  ADD COLUMN name_search text COLLATE "C" GENERATED ALWAYS AS (lower(name)) STORED;
ALTER TABLE client_scopes
  ADD COLUMN name_search text COLLATE "C" GENERATED ALWAYS AS (lower(name)) STORED;

CREATE INDEX roles_name_search ON roles (tenant_id, name_search, id);
CREATE INDEX groups_name_search ON groups (tenant_id, name_search, id);
CREATE INDEX client_scopes_name_search ON client_scopes (tenant_id, name_search, id);
