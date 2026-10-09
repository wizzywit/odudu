-- The client whose registered redirect URI an actions link offers, so the
-- link's last page offers it only while that client still registers it.
ALTER TABLE action_tokens ADD COLUMN redirect_client_id uuid;
