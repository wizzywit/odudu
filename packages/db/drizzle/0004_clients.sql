CREATE TABLE clients (
  id          uuid PRIMARY KEY,
  realm_id    uuid NOT NULL REFERENCES realms(id) ON DELETE CASCADE,
  client_id   text NOT NULL,
  name        text NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  type        text NOT NULL,
  secret_hash text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clients_client_id_unique UNIQUE (realm_id, client_id),
  -- Exists so that Task 11's client_oidc_config can carry a composite
  -- foreign key on (realm_id, client_id): that composite key is what stops a
  -- child row's denormalized realm_id from ever disagreeing with its
  -- parent's. Redundant-looking next to the primary key; it is not.
  CONSTRAINT clients_realm_id_unique UNIQUE (realm_id, id),
  CONSTRAINT clients_type_check CHECK (type IN ('public', 'confidential')),
  CONSTRAINT clients_secret_matches_type CHECK (
    (type = 'confidential' AND secret_hash IS NOT NULL) OR
    (type = 'public' AND secret_hash IS NULL)
  )
);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients FORCE ROW LEVEL SECURITY;

CREATE POLICY clients_isolation ON clients
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);
