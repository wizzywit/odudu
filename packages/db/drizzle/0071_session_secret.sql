-- The session cookie carries `<id>:<secret>`, and only the secret
-- authenticates: the id is also the `sid` claim every relying party holds.
-- Hex sha256, as every other stored token hash here. Nullable because rows
-- created before this column have no secret to hash; such a row is never
-- live, so those sessions end rather than being trusted on their id alone.
ALTER TABLE sessions ADD COLUMN secret_hash text;
