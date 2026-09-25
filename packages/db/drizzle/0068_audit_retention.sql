-- Bounds audit_events per tenant: without a window of its own it would grow
-- forever, which is exactly what P4e's authentication events would make
-- worse. 90 days is `login_failures`'s own reset ceiling's order of
-- magnitude and keeps an upgraded tenant's behaviour unsurprising.
ALTER TABLE tenants ADD COLUMN audit_retention_days integer NOT NULL DEFAULT 90;

ALTER TABLE tenants ADD CONSTRAINT tenants_audit_retention_days_range
  CHECK (audit_retention_days >= 1 AND audit_retention_days <= 3650);
