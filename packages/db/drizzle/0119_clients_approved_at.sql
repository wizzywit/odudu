-- The instant a person first approved a client. A consent row can be removed
-- (the person withdraws it) and a grant is reaped, so neither says that a
-- self-registered client was ever approved; this does, and keeps `odudu reap`
-- from deleting a client somebody once allowed. Backfilled from what exists.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- Both tables force row security. When the migrating role is neither SUPERUSER
-- nor BYPASSRLS, which a supported install never is (ADR 0009), the statement
-- would see no row, so it is lifted for it and put back, as in 0122.
DO $$
DECLARE
  plain_owner boolean;
BEGIN
  SELECT NOT (rolsuper OR rolbypassrls) INTO plain_owner FROM pg_roles WHERE rolname = current_user;
  IF plain_owner THEN
    ALTER TABLE clients NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE consents NO FORCE ROW LEVEL SECURITY;
  END IF;

  UPDATE clients c
     SET approved_at = k.first_at
    FROM (SELECT client_id, min(created_at) AS first_at FROM consents GROUP BY client_id) k
   WHERE k.client_id = c.id AND c.approved_at IS NULL;

  IF plain_owner THEN
    ALTER TABLE clients FORCE ROW LEVEL SECURITY;
    ALTER TABLE consents FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
