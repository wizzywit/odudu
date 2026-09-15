-- A grant belongs to the SSO session it was issued under, or to no session
-- at all, which is what offline access is: there is nothing to expire it
-- and nothing for a logout to end. The index is what lets logout revoke a
-- session's grants in one statement rather than a scan.
ALTER TABLE token_grants ADD COLUMN session_id uuid;

-- sessions had no unique constraint on (realm_id, id) before this: its
-- primary key is on id alone. A composite foreign key needs one on exactly
-- the referenced columns, the same idiom token_grants_realm_id_unique
-- already gives token_grants.
ALTER TABLE sessions ADD CONSTRAINT sessions_realm_id_unique UNIQUE (realm_id, id);

-- ON DELETE SET NULL is a backstop, not the mechanism. Deleting a session
-- a live grant still references would otherwise silently promote a
-- session-bound grant to an offline one; whatever reaps sessions must
-- refuse to delete one a live grant still points at, rather than rely on
-- this clause to catch it.
ALTER TABLE token_grants ADD CONSTRAINT token_grants_session_fk
  FOREIGN KEY (realm_id, session_id) REFERENCES sessions (realm_id, id)
  ON DELETE SET NULL;

CREATE INDEX token_grants_by_session ON token_grants (realm_id, session_id);
