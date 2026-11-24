-- The admin API pages a tenant's agent instances in id order, alone, by owner
-- and by state, and its approvals newest first, alone and by state. Each
-- ordered read walks one index from the tenant, so a page reads a page and
-- not the tenant: an owner's instances in id order, the instances that are
-- revoked or not (live and lapsed both are not), and the approvals by state.
CREATE INDEX IF NOT EXISTS agent_instances_owner_id
  ON agent_instances (tenant_id, owner_subject_id, id);
CREATE INDEX IF NOT EXISTS agent_instances_unrevoked_id
  ON agent_instances (tenant_id, id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS agent_instances_revoked_id
  ON agent_instances (tenant_id, id) WHERE revoked_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_approvals_tenant_id ON agent_approvals (tenant_id, id);
CREATE INDEX IF NOT EXISTS agent_approvals_state_id ON agent_approvals (tenant_id, state, id);
