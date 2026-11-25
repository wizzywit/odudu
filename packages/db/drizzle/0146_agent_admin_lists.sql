-- The admin API pages a tenant's agent instances in id order, alone, by owner
-- and by state, and its approvals newest first, alone and by state. Each read
-- walks one index from the tenant in the order of the page, so a page reads a
-- page: the tenant's instances in id order whether or not they are revoked, an
-- owner's, and the approvals by state. A state filter on instances narrows the
-- partial indexes' rows further (live and lapsed are both unrevoked).
--
-- agent_instances_owner_id supersedes agent_instances_owner (0141), which stays
-- because 0141 has shipped; both are kept up on every mint. An owner's live
-- instances walk the owner's rows and filter the revoked ones, which the
-- tombstone retention bounds.
CREATE INDEX IF NOT EXISTS agent_instances_owner_id
  ON agent_instances (tenant_id, owner_subject_id, id);
CREATE INDEX IF NOT EXISTS agent_instances_unrevoked_id
  ON agent_instances (tenant_id, id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS agent_instances_revoked_id
  ON agent_instances (tenant_id, id) WHERE revoked_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_approvals_tenant_id_id ON agent_approvals (tenant_id, id);
CREATE INDEX IF NOT EXISTS agent_approvals_state_id ON agent_approvals (tenant_id, state, id);
