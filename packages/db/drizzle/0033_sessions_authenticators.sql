-- What actually authenticated this session, in the order it ran. `amr` and
-- `acr` are statements about a specific login, so they are recorded when it
-- happens rather than re-derived later from what the subject could have used.
ALTER TABLE sessions ADD COLUMN authenticators text[] NOT NULL DEFAULT '{}';
