CREATE TABLE token_grants (
  id         uuid PRIMARY KEY,
  realm_id   uuid NOT NULL REFERENCES realms(id) ON DELETE CASCADE,
  client_id  uuid NOT NULL,
  subject_id uuid NOT NULL,
  scope      text NOT NULL,
  audience   text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT token_grants_realm_id_unique UNIQUE (realm_id, id),
  CONSTRAINT token_grants_client_fk FOREIGN KEY (realm_id, client_id)
    REFERENCES clients(realm_id, id) ON DELETE CASCADE,
  CONSTRAINT token_grants_subject_fk FOREIGN KEY (realm_id, subject_id)
    REFERENCES subjects(realm_id, id) ON DELETE CASCADE
);

ALTER TABLE token_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY token_grants_isolation ON token_grants
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);
