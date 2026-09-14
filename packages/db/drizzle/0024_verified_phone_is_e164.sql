-- OIDC Core §5.1's E.164 (optionally RFC 3966-extended) shape is only
-- REQUIRED once phone_number_verified is true; migration 0020 left the
-- column itself unconstrained because an unconditional CHECK would refuse
-- a conformant unverified value. This fires only in the verified case.
ALTER TABLE users ADD CONSTRAINT users_verified_phone_is_e164
  CHECK (
    NOT phone_number_verified
    OR phone_number ~ '^\+[1-9][0-9]{1,14}(;ext=[0-9]+)?$'
  );
