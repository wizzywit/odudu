-- The `claims` request parameter (OIDC Core §5.5), parsed once at
-- /authorize and stored the same way `resource` is (migration 0053): so
-- /token and /userinfo apply the same request that was validated at the
-- door, never one re-derived downstream. The default is the parsed shape
-- of an absent parameter — neither member requested anything, not "not
-- carried"; see claims-request.ts's own parseClaimsRequest for that rule
-- on the in-memory shape.
ALTER TABLE authorization_codes
  ADD COLUMN claims text NOT NULL DEFAULT '{"idToken":{},"userinfo":{}}';
