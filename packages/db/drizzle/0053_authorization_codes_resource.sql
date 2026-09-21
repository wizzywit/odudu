-- The audience this code will mint a token for, resolved at /authorize
-- against the client's registered list. Stored rather than re-derived at
-- /token so that the two cannot disagree about what the user approved. A
-- client with no registered audience resolves to an empty array here, not
-- a refusal — every client in this repository has `audiences` `[]` today.
ALTER TABLE authorization_codes ADD COLUMN resource text[] NOT NULL DEFAULT '{}';
