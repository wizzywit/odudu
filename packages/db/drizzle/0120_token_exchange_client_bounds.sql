-- Two per-client limits on RFC 8693 token exchange, both off for every client
-- that exists. A public client holding the exchange grant needed no secret to
-- reach it, and an actor token was never tied to the client presenting it.
ALTER TABLE client_oidc_config
  ADD COLUMN IF NOT EXISTS token_exchange_allowed_for_public boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS token_exchange_actor_from_other_client boolean NOT NULL DEFAULT false;

-- What the boot-time warning about public clients the upgrade stopped reads:
-- only a public client holding the grant with the setting off is in it.
CREATE INDEX IF NOT EXISTS client_oidc_config_exchange_closed
  ON client_oidc_config (tenant_id, client_id)
  WHERE token_exchange_allowed_for_public = false
    AND grant_types @> ARRAY['urn:ietf:params:oauth:grant-type:token-exchange']::text[];
