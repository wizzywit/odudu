-- Off by default: a realm does not acquire a second factor because it was
-- upgraded. On, every subject without a TOTP credential gets the
-- configure-totp required action at their next login.
ALTER TABLE realms ADD COLUMN otp_required boolean NOT NULL DEFAULT false;
