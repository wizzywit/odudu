-- The exchange grant's URN joins the registrable list. The constraint is
-- replaced rather than widened in place because a CHECK has no ALTER form;
-- the redirect-uri exemption beside it (0007) is deliberately untouched, so
-- a client registering token-exchange alone must still supply a redirect
-- URI. Narrowing that is a decision for whoever needs such a client.
ALTER TABLE client_oidc_config DROP CONSTRAINT client_oidc_config_grant_types_check;
ALTER TABLE client_oidc_config ADD CONSTRAINT client_oidc_config_grant_types_check
  CHECK (grant_types <@ ARRAY[
    'authorization_code',
    'refresh_token',
    'client_credentials',
    'urn:ietf:params:oauth:grant-type:token-exchange'
  ]);

ALTER TABLE client_oidc_config
  ADD COLUMN token_exchange_impersonation_allowed boolean NOT NULL DEFAULT false;

ALTER TABLE token_grants ADD COLUMN actor_subject_id uuid;
ALTER TABLE token_grants ADD COLUMN exchanged_from_grant_id uuid;

-- Deleting a subject a delegated grant names as its actor silently drops
-- the actor: introspection stops reproducing that grant's `act` claim.
-- The column list on SET NULL (PostgreSQL 15+) nulls only actor_subject_id;
-- an unrestricted SET NULL would null tenant_id too and the delete would
-- fail its NOT NULL constraint instead of detaching the actor.
ALTER TABLE token_grants ADD CONSTRAINT token_grants_actor_subject_fk
  FOREIGN KEY (tenant_id, actor_subject_id) REFERENCES subjects (tenant_id, id)
  ON DELETE SET NULL (actor_subject_id);

-- Lineage only, so losing the parent row loses only the pointer to it, not
-- the child grant itself. Same column-list reasoning as the FK above.
ALTER TABLE token_grants ADD CONSTRAINT token_grants_exchanged_from_grant_fk
  FOREIGN KEY (tenant_id, exchanged_from_grant_id) REFERENCES token_grants (tenant_id, id)
  ON DELETE SET NULL (exchanged_from_grant_id);
