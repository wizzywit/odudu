-- audit_events_resource (0067) ordered on (tenant_id, resource_type,
-- resource_id) alone, so a per-resource read still needed a Sort after
-- the index bound it — cheap when a resource holds a handful of rows, but
-- resource_type='grant' rows accumulate per grant id across refresh
-- rotation, token issuance and revocation, so a busy grant's trail does
-- not stay small. Ordering the index itself by the listing's own
-- (occurred_at DESC, id DESC) lets a keyset page stop at LIMIT instead of
-- sorting whatever the resource condition leaves.
DROP INDEX audit_events_resource;
CREATE INDEX audit_events_resource
  ON audit_events (tenant_id, resource_type, resource_id, occurred_at DESC, id DESC);
