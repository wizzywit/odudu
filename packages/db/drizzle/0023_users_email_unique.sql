-- Self-registration makes "is this address already taken?" a live question
-- for the first time. This index can fail on a database that already holds
-- duplicates; that failure is correct and the operator resolves it before
-- enabling registration. Partial, because email stays nullable.
CREATE UNIQUE INDEX users_email_unique ON users (realm_id, email) WHERE email IS NOT NULL;
