-- Nothing reads the redirect an actions link once offered; the page has no way back.
ALTER TABLE action_tokens
  DROP COLUMN redirect_uri,
  DROP COLUMN redirect_client_id;
