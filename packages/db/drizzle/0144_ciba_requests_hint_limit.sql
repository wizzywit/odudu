-- The limit on requests for one hint is counted per client and hint over the
-- live requests, resolved or not, so the index that served the count of
-- unresolved ones gives way to one that serves this.
DROP INDEX IF EXISTS ciba_requests_hint;
CREATE INDEX IF NOT EXISTS ciba_requests_client_hint
  ON ciba_requests (tenant_id, client_id, hint_digest, expires_at);
