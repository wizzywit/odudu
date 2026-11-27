-- Auditors read the metadata of the console assistant's conversations by
-- default and its text only when a tenant chooses to let them. The default for
-- a tenant with no row is now off, and every row saved so far is set to off
-- too: nothing of the assistant has shipped, so no tenant holds a choice, only
-- the on that the old default wrote into whatever it saved.
ALTER TABLE assistant_settings ALTER COLUMN assistant_auditor_visible SET DEFAULT false;
UPDATE assistant_settings SET assistant_auditor_visible = false WHERE assistant_auditor_visible;
