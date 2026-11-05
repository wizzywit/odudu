-- What `odudu reap` reads to remove a public client that registered itself and
-- never signed anybody in: per tenant, oldest first. Only anonymous public
-- rows are in it, so it stays small whatever else a tenant holds.
CREATE INDEX IF NOT EXISTS clients_anonymous_public_by_created ON clients (tenant_id, created_at)
  WHERE registration_origin = 'anonymous' AND type = 'public';
