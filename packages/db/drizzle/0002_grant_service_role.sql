-- Grants membership in odudu_app (created by 0001) to the container's
-- restricted serving role. This migration is now redundant, not load-
-- bearing, in both paths this repository actually exercises:
--   - compose (infra/docker/initdb/01-app-role.sql) creates odudu_svc AND
--     grants it odudu_app membership during cluster init, before this
--     migration or any other ever runs.
--   - integration tests (packages/testkit/src/postgres.ts createAppRole)
--     create odudu_svc and grant membership explicitly, after migrations.
--
-- It is kept, guarded, as a harmless no-op backstop rather than deleted,
-- because Drizzle has already recorded it applied and nothing about this
-- codebase forces the initdb-time grant to be the only provisioning path
-- forever.
--
-- What the IF EXISTS guard does NOT make safe: a third ordering — one this
-- repository's own tooling never produces, but a real deployment easily
-- could — where odudu_svc is created by infrastructure tooling *after*
-- migrations have already run once, with nothing playing the role of
-- initdb's script or createAppRole's explicit grant. Drizzle records this
-- migration as applied on that first run regardless of whether the IF
-- EXISTS branch fired, so no later redeploy, restart, or migration re-run
-- repairs the grant — the no-op is permanent, and /health/ready stays 200
-- throughout because it only runs `select 1`, not a query against a
-- tenant table. Anywhere this migration is the *only* provisioning
-- mechanism for odudu_svc, that ordering is a real risk. Do not rely on
-- "both orders are safe" — only the two orders this repo builds are.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'odudu_svc') THEN
    GRANT odudu_app TO odudu_svc;
  END IF;
END
$$;
