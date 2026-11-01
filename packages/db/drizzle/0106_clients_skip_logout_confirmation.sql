-- Whether /logout may end this client's session without the confirmation
-- page, for the client's own valid hint (ADR 0047). A constant default, so no
-- table rewrite. The console's own client has it on: its ID token is held
-- server side and its sign-out is a click in an authenticated page.
ALTER TABLE clients ADD COLUMN skip_logout_confirmation boolean NOT NULL DEFAULT false;

UPDATE clients SET skip_logout_confirmation = true WHERE builtin_admin;
