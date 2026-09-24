-- Marks the client a tenant's administration roles hang from. The guard that
-- refuses to disable or delete it reads this, not the client_id, so a
-- renamed client cannot slip past it.
ALTER TABLE clients ADD COLUMN builtin_admin boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX clients_one_builtin_admin
  ON clients (tenant_id) WHERE builtin_admin;
