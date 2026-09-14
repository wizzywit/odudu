CREATE TABLE client_scopes (
  id                     uuid PRIMARY KEY,
  realm_id               uuid NOT NULL REFERENCES realms(id) ON DELETE CASCADE,
  name                   text NOT NULL,
  description            text,
  -- Whether the scope's own name appears in the issued `scope` claim. A
  -- scope that exists only to carry claims need not advertise itself back.
  include_in_token_scope boolean NOT NULL DEFAULT true,
  -- Section 3.4 of the phase design: a scope is granted per request, so the
  -- ID token is distinguished from the access token by data, not by the ask.
  include_in_id_token    boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_scopes_name_unique UNIQUE (realm_id, name),
  CONSTRAINT client_scopes_realm_id_unique UNIQUE (realm_id, id),
  -- RFC 6749 section 3.3 scope-token: %x21 / %x23-5B / %x5D-7E, one or more.
  CONSTRAINT client_scopes_name_is_scope_token
    CHECK (name ~ '^[\x21\x23-\x5B\x5D-\x7E]+$')
);

CREATE TABLE client_scope_assignments (
  realm_id        uuid NOT NULL,
  client_id       uuid NOT NULL,
  client_scope_id uuid NOT NULL,
  assignment      text NOT NULL,
  PRIMARY KEY (client_id, client_scope_id),
  CONSTRAINT client_scope_assignments_assignment_check
    CHECK (assignment IN ('default', 'optional')),
  CONSTRAINT client_scope_assignments_client_fk
    FOREIGN KEY (realm_id, client_id) REFERENCES clients(realm_id, id) ON DELETE CASCADE,
  CONSTRAINT client_scope_assignments_scope_fk
    FOREIGN KEY (realm_id, client_scope_id) REFERENCES client_scopes(realm_id, id) ON DELETE CASCADE
);

ALTER TABLE client_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_scopes FORCE ROW LEVEL SECURITY;
CREATE POLICY client_scopes_isolation ON client_scopes
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);

ALTER TABLE client_scope_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_scope_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY client_scope_assignments_isolation ON client_scope_assignments
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);
