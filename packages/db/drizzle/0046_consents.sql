-- What a subject authorized a client to do. Not wire-shaped and outliving
-- OIDC, which is why it sits with clients and client scopes rather than in
-- the protocol package: a protocol package may not import another, so
-- consent placed there would be unreadable to the agent identity layer and
-- to authorization services.
CREATE TABLE consents (
  id         uuid PRIMARY KEY,
  realm_id   uuid NOT NULL REFERENCES realms(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL,
  client_id  uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consents_subject_client_unique UNIQUE (realm_id, subject_id, client_id),
  CONSTRAINT consents_realm_id_unique UNIQUE (realm_id, id),
  CONSTRAINT consents_subject_fk FOREIGN KEY (realm_id, subject_id)
    REFERENCES subjects(realm_id, id) ON DELETE CASCADE,
  CONSTRAINT consents_client_fk FOREIGN KEY (realm_id, client_id)
    REFERENCES clients(realm_id, id) ON DELETE CASCADE
);

-- One row per granted scope, so withdrawing one is a delete rather than a
-- rewrite of the set.
CREATE TABLE consent_scopes (
  realm_id        uuid NOT NULL,
  consent_id      uuid NOT NULL,
  client_scope_id uuid NOT NULL,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consent_id, client_scope_id),
  CONSTRAINT consent_scopes_consent_fk FOREIGN KEY (realm_id, consent_id)
    REFERENCES consents(realm_id, id) ON DELETE CASCADE,
  CONSTRAINT consent_scopes_scope_fk FOREIGN KEY (realm_id, client_scope_id)
    REFERENCES client_scopes(realm_id, id) ON DELETE CASCADE
);

ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE consents FORCE ROW LEVEL SECURITY;
CREATE POLICY consents_isolation ON consents
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);

ALTER TABLE consent_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_scopes FORCE ROW LEVEL SECURITY;
CREATE POLICY consent_scopes_isolation ON consent_scopes
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);
