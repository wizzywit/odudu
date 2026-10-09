-- The same shape as 0073_list_indexes_subjects.sql, for the same reason:
-- a prefix search is a range over a stored C-collation lower() copy,
-- compared with leakproof operators so row-level security leaves it in the
-- index condition. tenants carries no tenant_id — the collection is read
-- through the owner connection — so its indexes lead with the search key.
ALTER TABLE tenants
  ADD COLUMN name_search text COLLATE "C" GENERATED ALWAYS AS (lower(name)) STORED,
  ADD COLUMN display_name_search text COLLATE "C" GENERATED ALWAYS AS (lower(display_name)) STORED;

CREATE INDEX tenants_name_search ON tenants (name_search, id);
CREATE INDEX tenants_display_name_search ON tenants (display_name_search, id)
  WHERE display_name_search IS NOT NULL;

ALTER TABLE clients
  ADD COLUMN client_id_search text COLLATE "C" GENERATED ALWAYS AS (lower(client_id)) STORED,
  ADD COLUMN name_search text COLLATE "C" GENERATED ALWAYS AS (lower(name)) STORED;

CREATE INDEX clients_client_id_search ON clients (tenant_id, client_id_search, id);
CREATE INDEX clients_name_search ON clients (tenant_id, name_search, id);
