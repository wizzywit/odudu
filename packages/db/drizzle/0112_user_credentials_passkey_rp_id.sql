-- Counting the passkeys a change of address would hide asks for those under
-- any relying party ID but one. Ordered by that ID, the two ranges either side
-- of it are read without touching the passkeys that stay usable.
CREATE INDEX user_credentials_passkeys_by_rp_id ON user_credentials (tenant_id, rp_id)
  WHERE type = 'webauthn' AND lookup_key IS NOT NULL AND rp_id IS NOT NULL;
