-- Two per-client limits on RFC 8693 token exchange, both off for every client
-- that exists. A public client holding the exchange grant needed no secret to
-- reach it, and an actor token was never tied to the client presenting it.
ALTER TABLE client_oidc_config
  ADD COLUMN IF NOT EXISTS token_exchange_allowed_for_public boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS token_exchange_actor_from_other_client boolean NOT NULL DEFAULT false;
