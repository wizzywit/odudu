-- The `claims` request parameter (OIDC Core §5.5), stored the same way
-- `resource` is (migration 0053) — see claims-request.ts's own
-- `EMPTY_CLAIMS_REQUEST` for what the default value means.
ALTER TABLE authorization_codes
  ADD COLUMN claims text NOT NULL DEFAULT '{"idToken":{},"userinfo":{}}';
