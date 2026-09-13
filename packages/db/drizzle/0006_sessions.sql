CREATE TABLE authentication_sessions (
  id              uuid PRIMARY KEY,
  realm_id        uuid NOT NULL REFERENCES realms(id) ON DELETE CASCADE,
  pending_request jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL
);

CREATE TABLE sessions (
  id          uuid PRIMARY KEY,
  realm_id    uuid NOT NULL REFERENCES realms(id) ON DELETE CASCADE,
  subject_id  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  CONSTRAINT sessions_subject_realm_fk FOREIGN KEY (realm_id, subject_id)
    REFERENCES subjects(realm_id, id) ON DELETE CASCADE
);

ALTER TABLE authentication_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE authentication_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY authentication_sessions_isolation ON authentication_sessions
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY sessions_isolation ON sessions
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);
