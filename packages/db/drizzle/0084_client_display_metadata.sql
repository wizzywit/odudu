-- What an administrator says a client is for, shown in the console only.
ALTER TABLE clients ADD COLUMN description text;
ALTER TABLE clients ADD CONSTRAINT clients_description_length
  CHECK (char_length(description) <= 1000);

-- RFC 7591 §2's pages about the client, which the consent screen links to so
-- the End-User can read them before granting anything. Held to https, or
-- http on loopback, by parseClientMetadata before they are written.
ALTER TABLE client_oidc_config
  ADD COLUMN client_uri text,
  ADD COLUMN policy_uri text,
  ADD COLUMN tos_uri text;
