-- Grants membership in odudu_app (created by 0001) to the container's
-- restricted serving role, so it inherits the RLS-scoped privileges without
-- either role needing to know about the other's creation order.
--
-- This role is provisioned two different ways depending on environment:
--   - compose (infra/docker/initdb/01-app-role.sql) creates odudu_svc via
--     postgres's docker-entrypoint-initdb.d, which runs once, before this
--     migration ever executes.
--   - integration tests (packages/testkit/src/postgres.ts createAppRole)
--     create the same-shaped role, but only *after* migrations have run.
--
-- The IF EXISTS guard makes both orders safe: compose grants immediately;
-- tests no-op here and get the grant explicitly from createAppRole once the
-- role exists. Without the guard, GRANT against a role that does not exist
-- yet would fail migrations outright in the test path.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'odudu_svc') THEN
    GRANT odudu_app TO odudu_svc;
  END IF;
END
$$;
