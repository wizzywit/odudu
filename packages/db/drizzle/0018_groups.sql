CREATE TABLE groups (
  id         uuid PRIMARY KEY,
  realm_id   uuid NOT NULL REFERENCES realms(id) ON DELETE CASCADE,
  parent_id  uuid,
  name       text NOT NULL,
  path       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT groups_realm_id_unique UNIQUE (realm_id, id),
  CONSTRAINT groups_path_unique UNIQUE (realm_id, path),
  -- `/` separates path segments, so it cannot appear inside one.
  CONSTRAINT groups_name_has_no_slash CHECK (name !~ '/' AND name <> ''),
  CONSTRAINT groups_path_is_absolute CHECK (path LIKE '/%'),
  CONSTRAINT groups_parent_fk FOREIGN KEY (realm_id, parent_id)
    REFERENCES groups(realm_id, id) ON DELETE CASCADE
);

CREATE TABLE group_roles (
  realm_id uuid NOT NULL,
  group_id uuid NOT NULL,
  role_id  uuid NOT NULL,
  PRIMARY KEY (group_id, role_id),
  CONSTRAINT group_roles_group_fk FOREIGN KEY (realm_id, group_id)
    REFERENCES groups(realm_id, id) ON DELETE CASCADE,
  CONSTRAINT group_roles_role_fk FOREIGN KEY (realm_id, role_id)
    REFERENCES roles(realm_id, id) ON DELETE CASCADE
);

CREATE TABLE subject_groups (
  realm_id   uuid NOT NULL,
  subject_id uuid NOT NULL,
  group_id   uuid NOT NULL,
  PRIMARY KEY (subject_id, group_id),
  CONSTRAINT subject_groups_subject_fk FOREIGN KEY (realm_id, subject_id)
    REFERENCES subjects(realm_id, id) ON DELETE CASCADE,
  CONSTRAINT subject_groups_group_fk FOREIGN KEY (realm_id, group_id)
    REFERENCES groups(realm_id, id) ON DELETE CASCADE
);

ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups FORCE ROW LEVEL SECURITY;
CREATE POLICY groups_isolation ON groups
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);

ALTER TABLE group_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY group_roles_isolation ON group_roles
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);

ALTER TABLE subject_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE subject_groups FORCE ROW LEVEL SECURITY;
CREATE POLICY subject_groups_isolation ON subject_groups
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);
