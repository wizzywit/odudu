-- The secret a rotation replaced, kept valid until previous_secret_expires_at
-- so a client's deployments can move to the new one without an outage. Only
-- its hash is stored, as for the current secret. `odudu reap` clears it once
-- the window has passed (apps/server/src/cli/reap.ts); verification already
-- refuses it from that instant, whether or not the pass has run.
ALTER TABLE clients
  ADD COLUMN previous_secret_hash text,
  ADD COLUMN previous_secret_expires_at timestamptz;

ALTER TABLE clients ADD CONSTRAINT clients_previous_secret_pair
  CHECK ((previous_secret_hash IS NULL) = (previous_secret_expires_at IS NULL));
ALTER TABLE clients ADD CONSTRAINT clients_previous_secret_confidential
  CHECK (previous_secret_hash IS NULL OR type = 'confidential');
