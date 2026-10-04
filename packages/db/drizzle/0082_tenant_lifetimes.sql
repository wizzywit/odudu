-- The lifetimes a tenant issues with, where until now each was a constant in
-- the code that minted it. Every default is the value that constant held, so
-- an upgraded tenant issues exactly what it issued before.
--
-- The three token lifetimes are defaults a client's own value overrides
-- (client_oidc_config below), bounded the way the client columns already
-- are: one hour for a self-contained token
-- (0013_access_token_ttl_ceiling.sql), and only a floor for a refresh token
-- (0014_refresh_token_ttl_floor.sql gives the reason it has no ceiling).
ALTER TABLE tenants
  ADD COLUMN access_token_ttl_seconds integer NOT NULL DEFAULT 300,
  ADD COLUMN id_token_ttl_seconds integer NOT NULL DEFAULT 300,
  ADD COLUMN refresh_token_ttl_seconds integer NOT NULL DEFAULT 1209600,
  ADD COLUMN authorization_code_ttl_seconds integer NOT NULL DEFAULT 60,
  ADD COLUMN login_ttl_seconds integer NOT NULL DEFAULT 1800,
  ADD COLUMN verify_email_ttl_seconds integer NOT NULL DEFAULT 43200,
  ADD COLUMN reset_password_ttl_seconds integer NOT NULL DEFAULT 300;

ALTER TABLE tenants ADD CONSTRAINT tenants_access_token_ttl_range
  CHECK (access_token_ttl_seconds >= 1 AND access_token_ttl_seconds <= 3600);
ALTER TABLE tenants ADD CONSTRAINT tenants_id_token_ttl_range
  CHECK (id_token_ttl_seconds >= 1 AND id_token_ttl_seconds <= 3600);
ALTER TABLE tenants ADD CONSTRAINT tenants_refresh_token_ttl_floor
  CHECK (refresh_token_ttl_seconds >= 1);
-- RFC 6749 §4.1.2 recommends ten minutes at most.
ALTER TABLE tenants ADD CONSTRAINT tenants_authorization_code_ttl_range
  CHECK (authorization_code_ttl_seconds >= 1 AND authorization_code_ttl_seconds <= 600);
-- How long a login page may be left open before its submission is refused.
ALTER TABLE tenants ADD CONSTRAINT tenants_login_ttl_range
  CHECK (login_ttl_seconds >= 60 AND login_ttl_seconds <= 86400);
ALTER TABLE tenants ADD CONSTRAINT tenants_verify_email_ttl_range
  CHECK (verify_email_ttl_seconds >= 60 AND verify_email_ttl_seconds <= 604800);
-- A live reset link is an account-takeover window, so it is held to a day.
ALTER TABLE tenants ADD CONSTRAINT tenants_reset_password_ttl_range
  CHECK (reset_password_ttl_seconds >= 60 AND reset_password_ttl_seconds <= 86400);

-- NULL now means "the tenant's lifetime". A client still at the old column
-- default never chose its value, so it inherits from here on; one that chose
-- another keeps it. An ID token used to share the access token's expiry, so
-- a client with its own access lifetime keeps that as its ID token lifetime.
-- The built-in admin client keeps its own: no administrator may amend it, so
-- a tenant raising its default must not lengthen the admin API's tokens.
ALTER TABLE client_oidc_config
  ALTER COLUMN access_token_ttl_seconds DROP NOT NULL,
  ALTER COLUMN access_token_ttl_seconds DROP DEFAULT,
  ALTER COLUMN refresh_token_ttl_seconds DROP NOT NULL,
  ALTER COLUMN refresh_token_ttl_seconds DROP DEFAULT,
  ADD COLUMN id_token_ttl_seconds integer;

ALTER TABLE client_oidc_config ADD CONSTRAINT client_oidc_config_id_token_ttl_ceiling
  CHECK (id_token_ttl_seconds >= 1 AND id_token_ttl_seconds <= 3600);

-- FORCE ROW LEVEL SECURITY removes the schema owner's exemption, so under an
-- owner that is not SUPERUSER or BYPASSRLS these UPDATEs would match nothing
-- and raise nothing. Lifted for the rewrite and restored after it, as
-- 0040_recovery_code_execution.sql does and gives the reasons for.
ALTER TABLE client_oidc_config NO FORCE ROW LEVEL SECURITY;
ALTER TABLE clients NO FORCE ROW LEVEL SECURITY;

UPDATE client_oidc_config SET id_token_ttl_seconds = access_token_ttl_seconds
 WHERE access_token_ttl_seconds <> 300
    OR client_id IN (SELECT id FROM clients WHERE builtin_admin);
UPDATE client_oidc_config SET access_token_ttl_seconds = NULL
 WHERE access_token_ttl_seconds = 300
   AND client_id NOT IN (SELECT id FROM clients WHERE builtin_admin);
UPDATE client_oidc_config SET refresh_token_ttl_seconds = NULL
 WHERE refresh_token_ttl_seconds = 1209600
   AND client_id NOT IN (SELECT id FROM clients WHERE builtin_admin);

ALTER TABLE clients FORCE ROW LEVEL SECURITY;
ALTER TABLE client_oidc_config FORCE ROW LEVEL SECURITY;
