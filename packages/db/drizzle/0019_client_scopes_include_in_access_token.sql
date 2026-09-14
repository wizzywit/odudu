-- Symmetric with include_in_id_token (0016): a scope granted on the
-- request contributes to the access token only if its own definition says
-- so. Defaults true, opposite of include_in_id_token's default — an access
-- token goes to a resource server, not the browser, so it carries
-- authorization claims (roles, groups) by default and identity claims
-- (name, email) only when a realm opts a scope into it.
ALTER TABLE client_scopes
  ADD COLUMN include_in_access_token boolean NOT NULL DEFAULT true;
