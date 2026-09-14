ALTER TABLE users
  ADD COLUMN name                  text,
  ADD COLUMN given_name            text,
  ADD COLUMN family_name           text,
  ADD COLUMN middle_name           text,
  ADD COLUMN nickname              text,
  ADD COLUMN preferred_username    text,
  ADD COLUMN profile               text,
  ADD COLUMN picture               text,
  ADD COLUMN website               text,
  ADD COLUMN gender                text,
  ADD COLUMN birthdate             text,
  ADD COLUMN zoneinfo              text,
  ADD COLUMN locale                text,
  ADD COLUMN phone_number          text,
  ADD COLUMN phone_number_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN profile_updated_at    timestamptz,
  ADD COLUMN address_formatted     text,
  ADD COLUMN address_street        text,
  ADD COLUMN address_locality      text,
  ADD COLUMN address_region        text,
  ADD COLUMN address_postal_code   text,
  ADD COLUMN address_country       text;

-- OIDC Core section 5.1: YYYY-MM-DD, or YYYY alone when only the year is
-- known. 0000 is the permitted year for an address that withholds it, so
-- the pattern must not require a plausible year.
ALTER TABLE users ADD CONSTRAINT users_birthdate_shape
  CHECK (birthdate IS NULL OR birthdate ~ '^[0-9]{4}(-[0-9]{2}-[0-9]{2})?$');

ALTER TABLE users ADD CONSTRAINT users_zoneinfo_shape
  CHECK (zoneinfo IS NULL OR zoneinfo ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$');

ALTER TABLE users ADD CONSTRAINT users_locale_shape
  CHECK (locale IS NULL OR locale ~ '^[A-Za-z]{2,3}(-[A-Za-z]{4})?(-([A-Za-z]{2}|[0-9]{3}))?$');

ALTER TABLE users ADD CONSTRAINT users_profile_urls_are_http
  CHECK (
    (profile IS NULL OR profile ~ '^https?://')
    AND (picture IS NULL OR picture ~ '^https?://')
    AND (website IS NULL OR website ~ '^https?://')
  );

-- phone_number carries no CHECK. OIDC Core §5.1 says E.164 is RECOMMENDED
-- for this claim, not required; a constraint enforcing it would refuse a
-- conformant value.

-- users_lookup stays (realm_id, username) INCLUDE (subject_id, email,
-- email_verified): it covers the username lookup on every token issuance.
-- Profile claims are read by subject_id, the primary key, which needs no
-- covering index — widening INCLUDE here would only enlarge every leaf page
-- to serve a query that never uses these columns.
