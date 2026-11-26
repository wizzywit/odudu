-- Auditors read the metadata of the console assistant's conversations by
-- default and its text only when a tenant chooses to let them. New tenants
-- start with the text hidden. A tenant that already saved a value keeps it, and
-- so does a tenant whose row was written before this: only the default for a
-- row that does not exist yet changes.
ALTER TABLE assistant_settings ALTER COLUMN assistant_auditor_visible SET DEFAULT false;
