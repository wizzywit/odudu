CREATE ROLE odudu_app NOLOGIN;

GRANT USAGE ON SCHEMA public TO odudu_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO odudu_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO odudu_app;

ALTER TABLE realms ENABLE ROW LEVEL SECURITY;
ALTER TABLE realms FORCE ROW LEVEL SECURITY;

-- current_setting(name, true) returns NULL only the first time a backend
-- ever touches this GUC. Once set_config has run on a connection, the value
-- reverts to '' (not NULL) at transaction end for the rest of that
-- connection's life — verified against real Postgres, not assumed. Casting
-- '' straight to uuid raises 22P02 instead of filtering rows, so nullif
-- collapses both the "never touched" and "reverted" cases to NULL before
-- the cast, keeping the policy's failure mode "zero rows", not an error.
CREATE POLICY realms_isolation ON realms
  USING (id = nullif(current_setting('app.realm_id', true), '')::uuid);
