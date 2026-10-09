-- The name claims a subject is searched by, stored as search keys in the C
-- collation for the reason 0073_list_indexes_subjects.sql gives: an index on
-- lower(name) cannot serve a prefix search under row-level security.
ALTER TABLE users
  ADD COLUMN name_search text COLLATE "C" GENERATED ALWAYS AS (lower(name)) STORED,
  ADD COLUMN given_name_search text COLLATE "C" GENERATED ALWAYS AS (lower(given_name)) STORED,
  ADD COLUMN family_name_search text COLLATE "C" GENERATED ALWAYS AS (lower(family_name)) STORED;

CREATE INDEX users_name_search ON users (tenant_id, name_search, subject_id)
  WHERE name_search IS NOT NULL;
CREATE INDEX users_given_name_search ON users (tenant_id, given_name_search, subject_id)
  WHERE given_name_search IS NOT NULL;
CREATE INDEX users_family_name_search ON users (tenant_id, family_name_search, subject_id)
  WHERE family_name_search IS NOT NULL;

-- A listing filtered by type, in id order: service and agent subjects are few
-- among many users, and without this a page of them scans every user first.
CREATE INDEX subjects_by_type ON subjects (tenant_id, type, id);
