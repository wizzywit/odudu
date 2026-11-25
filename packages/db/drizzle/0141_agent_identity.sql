-- The agent identity layer: an instance is a subject of type agent_instance
-- that exists as `act.sub`, a node in a delegation lineage and the holder of
-- a budget slice; an approval authorises one action by its digest; a
-- delegation names the client allowed to act for a subject.
ALTER TABLE token_grants ADD COLUMN IF NOT EXISTS may_act jsonb;
ALTER TABLE client_oidc_config ADD COLUMN IF NOT EXISTS agent_type boolean NOT NULL DEFAULT false;
-- Client ids allowed to act for subjects who use this client: the
-- operator-configured source of a grant's may_act.
ALTER TABLE client_oidc_config
  ADD COLUMN IF NOT EXISTS delegated_actors text[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS agent_instances (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  id uuid PRIMARY KEY,
  owner_subject_id uuid NOT NULL,
  agent_client_id uuid NOT NULL,
  parent_instance_id uuid,
  root_grant_id uuid NOT NULL,
  depth smallint NOT NULL,
  scope text NOT NULL,
  expires_at timestamptz NOT NULL,
  idle_expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_instances_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT agent_instances_depth_range CHECK (depth BETWEEN 1 AND 8),
  CONSTRAINT agent_instances_subject_fk FOREIGN KEY (tenant_id, id)
    REFERENCES subjects (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT agent_instances_owner_fk FOREIGN KEY (tenant_id, owner_subject_id)
    REFERENCES subjects (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT agent_instances_client_fk FOREIGN KEY (tenant_id, agent_client_id)
    REFERENCES clients (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT agent_instances_root_grant_fk FOREIGN KEY (tenant_id, root_grant_id)
    REFERENCES token_grants (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT agent_instances_parent_fk FOREIGN KEY (tenant_id, parent_instance_id)
    REFERENCES agent_instances (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS agent_instances_owner_live
  ON agent_instances (tenant_id, owner_subject_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS agent_instances_owner ON agent_instances (tenant_id, owner_subject_id);
CREATE INDEX IF NOT EXISTS agent_instances_client ON agent_instances (tenant_id, agent_client_id);
CREATE INDEX IF NOT EXISTS agent_instances_parent ON agent_instances (tenant_id, parent_instance_id);
CREATE INDEX IF NOT EXISTS agent_instances_root_grant ON agent_instances (root_grant_id);
CREATE INDEX IF NOT EXISTS agent_instances_expires_at ON agent_instances (expires_at);
CREATE INDEX IF NOT EXISTS agent_instances_revoked_at
  ON agent_instances (revoked_at) WHERE revoked_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_delegations (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  id uuid PRIMARY KEY,
  subject_id uuid NOT NULL,
  client_id uuid NOT NULL,
  actor_client_id uuid NOT NULL,
  scope_ceiling text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_delegations_subject_fk FOREIGN KEY (tenant_id, subject_id)
    REFERENCES subjects (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT agent_delegations_client_fk FOREIGN KEY (tenant_id, client_id)
    REFERENCES clients (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT agent_delegations_actor_fk FOREIGN KEY (tenant_id, actor_client_id)
    REFERENCES clients (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS agent_delegations_subject
  ON agent_delegations (tenant_id, subject_id, client_id);
CREATE INDEX IF NOT EXISTS agent_delegations_client ON agent_delegations (tenant_id, client_id);
CREATE INDEX IF NOT EXISTS agent_delegations_actor ON agent_delegations (tenant_id, actor_client_id);
CREATE INDEX IF NOT EXISTS agent_delegations_expires_at ON agent_delegations (expires_at);
CREATE INDEX IF NOT EXISTS agent_delegations_revoked_at
  ON agent_delegations (revoked_at) WHERE revoked_at IS NOT NULL;

-- instance_id names an instance without a foreign key: an approval outlives
-- the instance's tombstone, and must keep naming it.
CREATE TABLE IF NOT EXISTS agent_approvals (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  id uuid PRIMARY KEY,
  subject_id uuid NOT NULL,
  requesting_client_id uuid NOT NULL,
  instance_id uuid,
  kind text NOT NULL,
  summary text NOT NULL,
  action_digest text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  decided_at timestamptz,
  decided_via text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_approvals_state_check
    CHECK (state IN ('pending', 'approved', 'denied', 'expired', 'consumed')),
  CONSTRAINT agent_approvals_decided_via_check
    CHECK (decided_via IS NULL OR decided_via IN ('ciba_page', 'console')),
  CONSTRAINT agent_approvals_subject_fk FOREIGN KEY (tenant_id, subject_id)
    REFERENCES subjects (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT agent_approvals_client_fk FOREIGN KEY (tenant_id, requesting_client_id)
    REFERENCES clients (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS agent_approvals_subject ON agent_approvals (tenant_id, subject_id);
CREATE INDEX IF NOT EXISTS agent_approvals_client ON agent_approvals (tenant_id, requesting_client_id);
CREATE INDEX IF NOT EXISTS agent_approvals_subject_pending
  ON agent_approvals (tenant_id, subject_id) WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS agent_approvals_expires_at ON agent_approvals (expires_at);

CREATE TABLE IF NOT EXISTS agent_budget_windows (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  owner_subject_id uuid NOT NULL,
  agent_client_id uuid NOT NULL,
  window_start timestamptz NOT NULL,
  writes smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, owner_subject_id, agent_client_id, window_start),
  CONSTRAINT agent_budget_windows_owner_fk FOREIGN KEY (tenant_id, owner_subject_id)
    REFERENCES subjects (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT agent_budget_windows_client_fk FOREIGN KEY (tenant_id, agent_client_id)
    REFERENCES clients (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS agent_budget_windows_client
  ON agent_budget_windows (tenant_id, agent_client_id);
CREATE INDEX IF NOT EXISTS agent_budget_windows_window_start ON agent_budget_windows (window_start);

ALTER TABLE agent_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_instances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_instances_isolation ON agent_instances;
CREATE POLICY agent_instances_isolation ON agent_instances
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE agent_delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_delegations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_delegations_isolation ON agent_delegations;
CREATE POLICY agent_delegations_isolation ON agent_delegations
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE agent_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_approvals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_approvals_isolation ON agent_approvals;
CREATE POLICY agent_approvals_isolation ON agent_approvals
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE agent_budget_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_budget_windows FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_budget_windows_isolation ON agent_budget_windows;
CREATE POLICY agent_budget_windows_isolation ON agent_budget_windows
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
