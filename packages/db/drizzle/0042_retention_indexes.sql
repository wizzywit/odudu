-- A retention pass scans by age. Without these it is a sequential scan over
-- the largest tables in the schema, which is how a retention pass becomes
-- the reason a deployment falls over at 3am. Each index below names the
-- scan it serves in apps/server/src/cli/reap.ts; ADR 0021 has why the
-- predicates are what they are.

-- Expired or consumed, plus a grace: two disjuncts, one index each.
CREATE INDEX authentication_sessions_by_expiry ON authentication_sessions (realm_id, expires_at);
CREATE INDEX authentication_sessions_by_consumption ON authentication_sessions (realm_id, consumed_at);

-- The grant family's age is what decides a refresh token's fate, so this
-- table is reached through refresh_tokens_by_grant (0011) rather than by
-- expiry. Expiry is still scanned, by the "is a live token still
-- outstanding" clause that stops a family being reaped under a client
-- holding a usable token.
CREATE INDEX refresh_tokens_by_expiry ON refresh_tokens (realm_id, expires_at);

CREATE INDEX token_grants_by_created ON token_grants (realm_id, created_at);

-- Only a code that never produced a grant is reaped by its own age; one
-- that did is reaped with the family, found through its grant_id.
CREATE INDEX authorization_codes_by_expiry ON authorization_codes (realm_id, expires_at);
CREATE INDEX authorization_codes_by_grant ON authorization_codes (realm_id, grant_id);

CREATE INDEX sessions_by_expiry ON sessions (realm_id, expires_at);
CREATE INDEX action_tokens_by_expiry ON action_tokens (realm_id, expires_at);
CREATE INDEX action_tokens_by_consumption ON action_tokens (realm_id, consumed_at);

-- The quiet period is measured from the most recent failure; the lockout
-- the row still holds is read from locked_until, which is the second bound
-- and not implied by the first.
CREATE INDEX login_failures_by_last_failure ON login_failures (realm_id, last_failure_at);
