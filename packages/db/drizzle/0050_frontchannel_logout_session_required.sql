-- The front-channel twin of backchannel_logout_session_required, which
-- 0045 added while this one was missed. Front-Channel Logout §2: when true,
-- the logout URI must be called with iss and sid.
ALTER TABLE client_oidc_config
  ADD COLUMN frontchannel_logout_session_required boolean NOT NULL DEFAULT false;
