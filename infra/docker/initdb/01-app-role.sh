#!/usr/bin/env bash
set -euo pipefail

# Runs once, at Postgres cluster init, before the odudu container (and
# therefore before any migration) ever starts. odudu_app is created here,
# not left for migration 0001, so that odudu_svc's membership can be
# granted before migrations run rather than racing them: membership is
# independent of whether odudu_app already holds privileges, so granting
# it here and having 0001 grant privileges to odudu_app afterwards gives
# odudu_svc those privileges by inheritance regardless of order. This is
# what makes RLS enforcement in the compose stack not depend on a
# migration executing a GRANT against a role that may or may not exist
# yet (see packages/db/drizzle/0002_grant_service_role.sql for the
# migration-time fallback this makes largely redundant for this
# environment, and its comment for the ordering this still does not
# cover).
#
# The password is passed in as a psql variable (-v) rather than
# interpolated into the SQL text; :'svc_password' has psql apply SQL
# string-literal quoting to it, so it is never string-concatenated in.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v svc_password="$ODUDU_SVC_PASSWORD" <<'SQL'
CREATE ROLE odudu_app NOLOGIN;
CREATE USER odudu_svc LOGIN PASSWORD :'svc_password';
GRANT odudu_app TO odudu_svc;
SQL
