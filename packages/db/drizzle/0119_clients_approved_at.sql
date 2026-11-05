-- The instant a person first approved a client. A consent row can be removed
-- (the person withdraws it) and a grant is reaped, so neither says that a
-- self-registered client was ever approved; this does, and keeps `odudu reap`
-- from deleting a client somebody once allowed. Backfilled from what exists.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS approved_at timestamptz;

UPDATE clients c
   SET approved_at = k.first_at
  FROM (SELECT client_id, min(created_at) AS first_at FROM consents GROUP BY client_id) k
 WHERE k.client_id = c.id AND c.approved_at IS NULL;
