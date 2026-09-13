CREATE TABLE subjects (
  id          uuid PRIMARY KEY,
  realm_id    uuid NOT NULL REFERENCES realms(id) ON DELETE CASCADE,
  type        text NOT NULL,
  disabled_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subjects_type_check CHECK (type IN ('user', 'service', 'agent_instance')),
  CONSTRAINT subjects_realm_id_unique UNIQUE (realm_id, id)
);

CREATE TABLE users (
  subject_id     uuid PRIMARY KEY REFERENCES subjects(id) ON DELETE CASCADE,
  realm_id       uuid NOT NULL,
  username       text NOT NULL,
  email          text,
  email_verified boolean NOT NULL DEFAULT false,
  CONSTRAINT users_username_unique UNIQUE (realm_id, username),
  CONSTRAINT users_subject_realm_fk FOREIGN KEY (realm_id, subject_id)
    REFERENCES subjects(realm_id, id) ON DELETE CASCADE
);

CREATE TABLE user_credentials (
  id          uuid PRIMARY KEY,
  realm_id    uuid NOT NULL,
  subject_id  uuid NOT NULL,
  type        text NOT NULL,
  secret_data text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_credentials_type_check CHECK (type IN ('password')),
  CONSTRAINT user_credentials_one_password UNIQUE (subject_id, type),
  CONSTRAINT user_credentials_subject_realm_fk FOREIGN KEY (realm_id, subject_id)
    REFERENCES subjects(realm_id, id) ON DELETE CASCADE
);

-- The covering index the umbrella spec section 5 calls for: class-table
-- inheritance puts this join in the hot path of every token issuance.
CREATE INDEX users_lookup ON users (realm_id, username) INCLUDE (subject_id, email, email_verified);

ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects FORCE ROW LEVEL SECURITY;
CREATE POLICY subjects_isolation ON subjects
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_isolation ON users
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);

ALTER TABLE user_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY user_credentials_isolation ON user_credentials
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);

-- The client_credentials grant issues a token whose `sub` is the client's own
-- service-account subject, and token_grants.subject_id is NOT NULL with a
-- foreign key — so every confidential client needs a subject to point at.
-- This column cannot live in 0004_clients.sql: subjects did not exist yet.
-- Nullable because a public client has no service account.
ALTER TABLE clients ADD COLUMN service_subject_id uuid;
ALTER TABLE clients ADD CONSTRAINT clients_service_subject_fk
  FOREIGN KEY (realm_id, service_subject_id) REFERENCES subjects(realm_id, id) ON DELETE SET NULL;
