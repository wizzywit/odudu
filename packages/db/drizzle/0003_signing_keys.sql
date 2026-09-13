CREATE TABLE signing_keys (
  id                    uuid PRIMARY KEY,
  realm_id              uuid NOT NULL REFERENCES realms(id) ON DELETE CASCADE,
  kid                   text NOT NULL,
  alg                   text NOT NULL,
  status                text NOT NULL,
  public_jwk            jsonb NOT NULL,
  private_jwk_encrypted text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  not_after             timestamptz,
  CONSTRAINT signing_keys_kid_unique UNIQUE (realm_id, kid),
  CONSTRAINT signing_keys_status_check CHECK (status IN ('active', 'rotating', 'retired')),
  CONSTRAINT signing_keys_alg_check CHECK (alg IN ('RS256', 'ES256'))
);

ALTER TABLE signing_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE signing_keys FORCE ROW LEVEL SECURITY;

CREATE POLICY signing_keys_isolation ON signing_keys
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);

-- "At most one active key per realm" written where a race cannot violate it.
CREATE UNIQUE INDEX signing_keys_one_active
  ON signing_keys (realm_id) WHERE status = 'active';
