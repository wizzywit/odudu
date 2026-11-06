-- A service account now exists only while its client holds the
-- client_credentials grant. For a confidential client that exists today
-- without the grant, the account is deleted when nothing names it: no token
-- grant, role, group membership, consent, session or audit actor in its own
-- tenant. An account something does name stays, and `service_account_idle`
-- marks it so the boot check can list it; changing the client's grant_types
-- retires it. The referencing tables are read from the foreign keys on
-- subjects, so a table added later is checked too. Audit events are read for
-- the account's own tenant only: no index leads with the actor, so a probe of
-- every tenant per account would cost accounts times tenants. An event filed
-- under another tenant that names a retired account keeps the actor's id and
-- tenant, and loses only the subject row. When the migrating role is neither
-- SUPERUSER nor BYPASSRLS, which a supported install never is (ADR 0009),
-- FORCE ROW LEVEL SECURITY is lifted on clients and client_oidc_config to find
-- the candidates across tenants; every other table is read and written under
-- the candidate's own tenant context. Each statement writes only what is
-- missing, so the file can run again to no effect.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS service_account_idle boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS clients_idle_service_account
  ON clients (tenant_id, id) WHERE service_account_idle;

DO $$
DECLARE
  pair record;
  tid uuid;
  plain_owner boolean;
BEGIN
  SELECT NOT (rolsuper OR rolbypassrls) INTO plain_owner FROM pg_roles WHERE rolname = current_user;
  CREATE TEMP TABLE IF NOT EXISTS sa_referenced (subject_id uuid PRIMARY KEY);

  IF plain_owner THEN
    ALTER TABLE clients NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE client_oidc_config NO FORCE ROW LEVEL SECURITY;
  END IF;

  UPDATE clients c SET service_account_idle = true
    FROM client_oidc_config o
   WHERE o.client_id = c.id
     AND c.service_subject_id IS NOT NULL
     AND NOT c.service_account_idle
     AND NOT (o.grant_types @> ARRAY['client_credentials']::text[]);

  FOR tid IN SELECT DISTINCT tenant_id FROM clients WHERE service_account_idle LOOP
    PERFORM set_config('app.tenant_id', tid::text, true);
    TRUNCATE sa_referenced;

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
        || ' WHERE %1$I IN (SELECT service_subject_id FROM clients'
        || ' WHERE service_account_idle AND tenant_id = %3$L)'
        || ' ON CONFLICT DO NOTHING', pair.col, pair.tbl, tid);
    END LOOP;

    INSERT INTO sa_referenced
    SELECT DISTINCT a.actor_subject_id FROM audit_events a
     WHERE a.tenant_id = tid
       AND a.actor_subject_id IN (SELECT service_subject_id FROM clients
                                   WHERE service_account_idle AND tenant_id = tid)
    ON CONFLICT DO NOTHING;

    DELETE FROM subjects s USING clients c
     WHERE c.tenant_id = tid
       AND c.service_subject_id = s.id
       AND c.service_account_idle
       AND s.type = 'service'
       AND NOT EXISTS (SELECT 1 FROM sa_referenced r WHERE r.subject_id = s.id);
  END LOOP;

  PERFORM set_config('app.tenant_id', '', true);

  UPDATE clients SET service_account_idle = false
   WHERE service_account_idle AND service_subject_id IS NULL;

  IF plain_owner THEN
    ALTER TABLE clients FORCE ROW LEVEL SECURITY;
    ALTER TABLE client_oidc_config FORCE ROW LEVEL SECURITY;
  END IF;
  DROP TABLE sa_referenced;
END $$;
