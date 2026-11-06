-- A service account now exists only while its client holds the
-- client_credentials grant. For a confidential client that exists today
-- without the grant, the account is deleted when nothing names it: no token
-- grant, role, group membership, consent, session or audit actor. An account
-- something does name stays, and `service_account_idle` marks it so the boot
-- check can list it; changing the client's grant_types retires it. The
-- referencing tables are read from the foreign keys on subjects, so a table
-- added later is checked too. FORCE ROW LEVEL SECURITY is lifted on what is
-- read and restored after, as 0114_builtin_mcp_client.sql does. Each
-- statement writes only what is missing, so the file can run again to no
-- effect.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS service_account_idle boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS clients_idle_service_account
  ON clients (tenant_id, id) WHERE service_account_idle;

DO $$
DECLARE
  pair record;
  lifted regclass[] := ARRAY[]::regclass[];
  rel regclass;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS sa_referenced (subject_id uuid PRIMARY KEY);
  TRUNCATE sa_referenced;

  FOR rel IN
    SELECT c.oid::regclass
      FROM pg_class c
     WHERE c.relforcerowsecurity
       AND (c.oid IN ('clients'::regclass, 'subjects'::regclass,
                      'client_oidc_config'::regclass, 'audit_events'::regclass)
            OR c.oid IN (SELECT k.conrelid FROM pg_constraint k
                          WHERE k.contype = 'f' AND k.confrelid = 'subjects'::regclass))
  LOOP
    EXECUTE format('ALTER TABLE %s NO FORCE ROW LEVEL SECURITY', rel);
    lifted := lifted || rel;
  END LOOP;

  UPDATE clients c SET service_account_idle = true
    FROM client_oidc_config o
   WHERE o.client_id = c.id
     AND c.service_subject_id IS NOT NULL
     AND NOT c.service_account_idle
     AND NOT (o.grant_types @> ARRAY['client_credentials']::text[]);

  FOR pair IN
    SELECT k.conrelid::regclass AS tbl, a.attname AS col
      FROM pg_constraint k
     CROSS JOIN LATERAL unnest(k.conkey, k.confkey) AS m (local_att, foreign_att)
      JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = m.local_att
      JOIN pg_attribute f ON f.attrelid = k.confrelid AND f.attnum = m.foreign_att
                         AND f.attname = 'id'
     WHERE k.contype = 'f' AND k.confrelid = 'subjects'::regclass
       AND k.conrelid <> 'clients'::regclass
  LOOP
    EXECUTE format(
      'INSERT INTO sa_referenced SELECT DISTINCT %1$I FROM %2$s'
      || ' WHERE %1$I IN (SELECT service_subject_id FROM clients WHERE service_account_idle)'
      || ' ON CONFLICT DO NOTHING', pair.col, pair.tbl);
  END LOOP;

  INSERT INTO sa_referenced
  SELECT DISTINCT a.actor_subject_id
    FROM audit_events a
    JOIN clients c ON c.tenant_id = a.tenant_id
                  AND c.service_subject_id = a.actor_subject_id
                  AND c.service_account_idle
  ON CONFLICT DO NOTHING;

  DELETE FROM subjects s USING clients c
   WHERE c.service_subject_id = s.id
     AND c.service_account_idle
     AND s.type = 'service'
     AND NOT EXISTS (SELECT 1 FROM sa_referenced r WHERE r.subject_id = s.id);

  UPDATE clients SET service_account_idle = false
   WHERE service_account_idle AND service_subject_id IS NULL;

  FOREACH rel IN ARRAY lifted LOOP
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', rel);
  END LOOP;
  DROP TABLE sa_referenced;
END $$;
