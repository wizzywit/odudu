-- What the consent screen says a scope asks for, in place of its bare name,
-- and where it stands in the list: by display_order, then by name. One
-- string; a translated text per locale belongs with the translated pages.
ALTER TABLE client_scopes
  ADD COLUMN consent_text text,
  ADD COLUMN display_order integer NOT NULL DEFAULT 0;
ALTER TABLE client_scopes ADD CONSTRAINT client_scopes_consent_text_length
  CHECK (char_length(consent_text) BETWEEN 1 AND 500);
ALTER TABLE client_scopes ADD CONSTRAINT client_scopes_display_order_floor
  CHECK (display_order >= 0);
