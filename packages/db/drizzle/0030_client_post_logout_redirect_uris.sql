-- RP-Initiated Logout §3: the OP MUST NOT perform post-logout redirection if
-- the supplied post_logout_redirect_uri does not exactly match one of the
-- registered values. An endpoint that redirects where it cannot validate is
-- an open redirector, so the registration lands with the endpoint that reads
-- it rather than with the rest of the client metadata.
ALTER TABLE client_oidc_config
  ADD COLUMN post_logout_redirect_uris text[] NOT NULL DEFAULT '{}';
