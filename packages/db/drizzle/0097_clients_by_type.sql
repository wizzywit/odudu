-- The clients list filters by type, and nothing indexed it: a page of
-- confidential clients read every client of the tenant to find fifty.
CREATE INDEX clients_by_type ON clients (tenant_id, type, id);
