CREATE TABLE roles (
  id                       uuid PRIMARY KEY,
  realm_id                 uuid NOT NULL REFERENCES realms(id) ON DELETE CASCADE,
  client_id                uuid,
  name                     text NOT NULL,
  description              text,
  default_for_new_subjects boolean NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roles_realm_id_unique UNIQUE (realm_id, id),
  -- What makes `clientId:roleName` unambiguous. Enforced here rather than in
  -- the code that formats the claim, so no ambiguous role can exist at all.
  CONSTRAINT roles_name_has_no_colon CHECK (name !~ ':' AND name <> ''),
  CONSTRAINT roles_client_fk FOREIGN KEY (realm_id, client_id)
    REFERENCES clients(realm_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX roles_realm_name ON roles (realm_id, name) WHERE client_id IS NULL;
CREATE UNIQUE INDEX roles_client_name ON roles (client_id, name) WHERE client_id IS NOT NULL;

CREATE TABLE role_composites (
  realm_id       uuid NOT NULL,
  parent_role_id uuid NOT NULL,
  child_role_id  uuid NOT NULL,
  PRIMARY KEY (parent_role_id, child_role_id),
  CONSTRAINT role_composites_not_self CHECK (parent_role_id <> child_role_id),
  CONSTRAINT role_composites_parent_fk FOREIGN KEY (realm_id, parent_role_id)
    REFERENCES roles(realm_id, id) ON DELETE CASCADE,
  CONSTRAINT role_composites_child_fk FOREIGN KEY (realm_id, child_role_id)
    REFERENCES roles(realm_id, id) ON DELETE CASCADE
);

CREATE TABLE subject_roles (
  realm_id   uuid NOT NULL,
  subject_id uuid NOT NULL,
  role_id    uuid NOT NULL,
  PRIMARY KEY (subject_id, role_id),
  CONSTRAINT subject_roles_subject_fk FOREIGN KEY (realm_id, subject_id)
    REFERENCES subjects(realm_id, id) ON DELETE CASCADE,
  CONSTRAINT subject_roles_role_fk FOREIGN KEY (realm_id, role_id)
    REFERENCES roles(realm_id, id) ON DELETE CASCADE
);

CREATE TABLE client_scope_roles (
  realm_id        uuid NOT NULL,
  client_scope_id uuid NOT NULL,
  role_id         uuid NOT NULL,
  PRIMARY KEY (client_scope_id, role_id),
  CONSTRAINT client_scope_roles_scope_fk FOREIGN KEY (realm_id, client_scope_id)
    REFERENCES client_scopes(realm_id, id) ON DELETE CASCADE,
  CONSTRAINT client_scope_roles_role_fk FOREIGN KEY (realm_id, role_id)
    REFERENCES roles(realm_id, id) ON DELETE CASCADE
);

-- Bypasses the scope-mapping intersection. It belongs in this migration
-- rather than with client scopes because there are no roles to intersect
-- until now. Off by default: a new client's tokens carry no roles until an
-- operator maps them.
ALTER TABLE clients ADD COLUMN full_scope_allowed boolean NOT NULL DEFAULT false;

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
CREATE POLICY roles_isolation ON roles
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);

ALTER TABLE role_composites ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_composites FORCE ROW LEVEL SECURITY;
CREATE POLICY role_composites_isolation ON role_composites
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);

ALTER TABLE subject_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE subject_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY subject_roles_isolation ON subject_roles
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);

ALTER TABLE client_scope_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_scope_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY client_scope_roles_isolation ON client_scope_roles
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);
