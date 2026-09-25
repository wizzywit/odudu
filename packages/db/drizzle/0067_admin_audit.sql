-- tenant_id is the tenant the event happened *to*. A system admin acting on
-- another tenant writes a row that tenant's own administrators can read;
-- keying on the actor's tenant would hide it from exactly those people.
CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  -- Defaults to the transaction's own RLS context (the same session
  -- variable every policy here reads), so a caller inside `withTenant`
  -- never has to state the tenant its own transaction is already bound to.
  tenant_id uuid NOT NULL
    DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid
    REFERENCES tenants (id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  event_type text NOT NULL,
  action text NOT NULL,
  outcome text NOT NULL,
  actor_tenant_id uuid,
  actor_subject_id uuid,
  actor_client_id uuid,
  resource_type text,
  resource_id text,
  request_id text,
  ip text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT audit_events_outcome CHECK (outcome IN ('allowed', 'refused', 'failed'))
);

-- Nullable actor: an authentication event has no administrator behind it,
-- and those rows land in this table rather than in a second one.
CREATE INDEX audit_events_tenant_time ON audit_events (tenant_id, occurred_at DESC, id DESC);
CREATE INDEX audit_events_resource ON audit_events (tenant_id, resource_type, resource_id);

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_events_isolation ON audit_events
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
