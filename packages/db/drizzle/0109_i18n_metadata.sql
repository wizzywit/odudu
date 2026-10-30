-- Per-language text beside the base column, keyed by language tag. The base
-- column is what a language with no entry falls back to. At most 32 entries
-- and each value's length are held by the application, which also checks the
-- keys against the tenant's languages; the database holds the shape and a size
-- ceiling.
ALTER TABLE clients
  ADD COLUMN name_i18n jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN description_i18n jsonb NOT NULL DEFAULT '{}',
  ADD CONSTRAINT clients_name_i18n_shape
    CHECK (jsonb_typeof(name_i18n) = 'object' AND octet_length(name_i18n::text) <= 131072),
  ADD CONSTRAINT clients_description_i18n_shape
    CHECK (jsonb_typeof(description_i18n) = 'object' AND octet_length(description_i18n::text) <= 131072);

ALTER TABLE client_scopes
  ADD COLUMN description_i18n jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN consent_text_i18n jsonb NOT NULL DEFAULT '{}',
  ADD CONSTRAINT client_scopes_description_i18n_shape
    CHECK (jsonb_typeof(description_i18n) = 'object' AND octet_length(description_i18n::text) <= 131072),
  ADD CONSTRAINT client_scopes_consent_text_i18n_shape
    CHECK (jsonb_typeof(consent_text_i18n) = 'object' AND octet_length(consent_text_i18n::text) <= 131072);
