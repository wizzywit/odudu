-- Mirrors tenant_id's own default (0067): a row's request_id/ip default to
-- the transaction's own context rather than requiring every caller through
-- withTenant to state values it may not have collected itself.
ALTER TABLE audit_events
  ALTER COLUMN request_id SET DEFAULT nullif(current_setting('app.request_id', true), ''),
  ALTER COLUMN ip SET DEFAULT nullif(current_setting('app.client_ip', true), '');
