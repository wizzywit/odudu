-- The languages a tenant's pages are offered in, and the one used before the
-- browser's preference when it has set one. A tenant that never set them keeps
-- English only and lets the browser decide.
ALTER TABLE tenants
  ADD COLUMN supported_locales text[] NOT NULL DEFAULT ARRAY['en'],
  ADD COLUMN default_locale text,
  ADD CONSTRAINT tenants_supported_locales_bounds
    CHECK (cardinality(supported_locales) BETWEEN 1 AND 32),
  ADD CONSTRAINT tenants_default_locale_supported
    CHECK (default_locale IS NULL OR default_locale = ANY (supported_locales));

-- A tenant's own text for one catalogue key in one locale. The count per
-- tenant is bounded by the repository, which serialises writers per tenant.
CREATE TABLE message_overrides (
  tenant_id  uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  locale     text NOT NULL,
  key        text NOT NULL,
  message    text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, locale, key),
  CONSTRAINT message_overrides_locale_shape
    CHECK (locale ~ '^[A-Za-z]{2,3}(-[A-Za-z]{4})?(-([A-Za-z]{2}|[0-9]{3}))?$'),
  CONSTRAINT message_overrides_key_length CHECK (char_length(key) BETWEEN 1 AND 128),
  CONSTRAINT message_overrides_message_length CHECK (char_length(message) BETWEEN 1 AND 2000)
);

ALTER TABLE message_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_overrides FORCE ROW LEVEL SECURITY;
CREATE POLICY message_overrides_isolation ON message_overrides
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
