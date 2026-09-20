-- A delivery deduplicates on (realm_id, session_id, client_id): the same
-- relying party can hold grants under several sessions, and one session's
-- logout must not be refused as a duplicate of another's. No foreign key
-- to sessions, unlike token_grants_session_fk
-- (0026_token_grants_session.sql) — a delivery must keep retrying long
-- after the session itself is reaped, so this column names the session
-- without depending on its row surviving; a delivery may outlive the
-- session it names.
ALTER TABLE backchannel_logout_deliveries ADD COLUMN session_id uuid NOT NULL;

ALTER TABLE backchannel_logout_deliveries
  ADD CONSTRAINT backchannel_logout_deliveries_dedupe
  UNIQUE (realm_id, session_id, client_id);
