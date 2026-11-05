-- Two per-client limits on RFC 8693 token exchange, both off for every client
-- that exists. A public client holding the exchange grant needed no secret to
-- reach it, and an actor token was never tied to the client presenting it.
ALTER TABLE client_oidc_config
  ADD COLUMN IF NOT EXISTS token_exchange_allowed_for_public boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS token_exchange_actor_from_other_client boolean NOT NULL DEFAULT false;

-- A client's type never changes after creation, so a config row records once
-- whether its client is public. The boot-time warning about public clients
-- the upgrade stopped then reads an index holding exactly those clients: a
-- confidential client with the grant and the setting off is not in it.
ALTER TABLE client_oidc_config
  ADD COLUMN IF NOT EXISTS is_public_client boolean NOT NULL DEFAULT false;

UPDATE client_oidc_config o SET is_public_client = true
  FROM clients c WHERE c.id = o.client_id AND c.type = 'public';

CREATE OR REPLACE FUNCTION client_oidc_config_set_public() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.is_public_client := COALESCE(
    (SELECT c.type = 'public' FROM clients c WHERE c.id = NEW.client_id), false);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS client_oidc_config_set_public ON client_oidc_config;
CREATE TRIGGER client_oidc_config_set_public
  BEFORE INSERT ON client_oidc_config
  FOR EACH ROW EXECUTE FUNCTION client_oidc_config_set_public();

CREATE INDEX IF NOT EXISTS client_oidc_config_exchange_closed
  ON client_oidc_config (tenant_id, client_id)
  WHERE is_public_client
    AND token_exchange_allowed_for_public = false
    AND grant_types @> ARRAY['urn:ietf:params:oauth:grant-type:token-exchange']::text[];
