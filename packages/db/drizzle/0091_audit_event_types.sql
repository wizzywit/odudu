-- Which event types a tenant's audit trail stores. A type left out is not
-- written from the moment the setting changes; rows already stored stay until
-- retention takes them. The admin trail is always stored: an attacker holding
-- an administrator's token must not be able to switch off the record of it.
ALTER TABLE tenants ADD COLUMN audit_event_types text[] NOT NULL
  DEFAULT ARRAY['admin_mutation', 'admin_access', 'authentication', 'session', 'token', 'credential'];
ALTER TABLE tenants ADD CONSTRAINT tenants_audit_event_types_check
  CHECK (
    audit_event_types @> ARRAY['admin_mutation', 'admin_access']
    AND audit_event_types <@ ARRAY['admin_mutation', 'admin_access', 'authentication', 'session', 'token', 'credential']
  );
