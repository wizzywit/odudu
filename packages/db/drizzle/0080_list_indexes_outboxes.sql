-- The admin API lists a tenant's outgoing mail, and one client's Back-Channel
-- Logout deliveries, most recent first and keyset-paged on (created_at, id);
-- each index serves that order as one backward range scan.
CREATE INDEX email_outbox_recent ON email_outbox (tenant_id, created_at, id);
CREATE INDEX backchannel_logout_deliveries_recent
  ON backchannel_logout_deliveries (tenant_id, client_id, created_at, id);
