-- Symmetric with include_in_id_token (0016): a scope granted on the
-- request contributes to the access token only if its own definition says
-- so. Both columns default true, the same as each other — the posture
-- that keeps authorization claims (roles, groups) out of the access token
-- and identity claims (name, email) out of the ID token comes from the
-- values provision-defaults.ts seeds per scope, not from this column's
-- own default. A client scope created later with no explicit flags lands
-- in both the ID token and the access token.
ALTER TABLE client_scopes
  ADD COLUMN include_in_access_token boolean NOT NULL DEFAULT true;
