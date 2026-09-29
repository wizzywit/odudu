-- Under row-level security an index on lower(username) cannot serve a
-- prefix search: lower() is not leakproof, so the planner keeps it out of
-- the index condition (docs/phases/p4d.md, "Prefix search as one range
-- scan"). A stored copy in the C collation is compared with plain,
-- leakproof operators, and its byte order is the code-point order the
-- caller's computed upper bound assumes.
ALTER TABLE users
  ADD COLUMN username_search text COLLATE "C" GENERATED ALWAYS AS (lower(username)) STORED,
  ADD COLUMN email_search text COLLATE "C" GENERATED ALWAYS AS (lower(email)) STORED;

CREATE INDEX users_username_search ON users (tenant_id, username_search, subject_id);
CREATE INDEX users_email_search ON users (tenant_id, email_search, subject_id)
  WHERE email_search IS NOT NULL;

CREATE INDEX subjects_disabled ON subjects (tenant_id, id) WHERE disabled_at IS NOT NULL;
CREATE INDEX subject_roles_by_role ON subject_roles (role_id, subject_id);
CREATE INDEX subject_groups_by_group ON subject_groups (group_id, subject_id);
