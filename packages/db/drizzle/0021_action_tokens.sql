CREATE TABLE action_tokens (
  id          uuid PRIMARY KEY,
  realm_id    uuid NOT NULL REFERENCES realms(id) ON DELETE CASCADE,
  subject_id  uuid NOT NULL,
  type        text NOT NULL,
  token_hash  text NOT NULL,
  -- The address the token was minted for. Changing it invalidates an
  -- outstanding verification rather than letting it verify a value the
  -- user no longer holds.
  email       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT action_tokens_type_check CHECK (type IN ('verify_email', 'reset_password')),
  CONSTRAINT action_tokens_hash_unique UNIQUE (token_hash),
  CONSTRAINT action_tokens_subject_fk FOREIGN KEY (realm_id, subject_id)
    REFERENCES subjects(realm_id, id) ON DELETE CASCADE
);

ALTER TABLE action_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY action_tokens_isolation ON action_tokens
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);
