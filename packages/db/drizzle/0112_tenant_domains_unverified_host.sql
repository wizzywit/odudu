-- A request on a host nobody verified has to tell a host a tenant registered
-- (refused) from one nobody did (left alone). The verified rows have their own
-- index; this one covers the pending and failed rest, so neither read scans.
CREATE INDEX tenant_domains_unverified_by_host ON tenant_domains (host)
  WHERE state <> 'verified';
