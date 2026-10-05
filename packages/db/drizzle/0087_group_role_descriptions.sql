-- What an administrator says a group or a role is for, shown in the console
-- only. Bounded as a client's description is
-- (0084_client_display_metadata.sql).
ALTER TABLE groups ADD COLUMN description text;
ALTER TABLE groups ADD CONSTRAINT groups_description_length
  CHECK (char_length(description) <= 1000);
ALTER TABLE roles ADD CONSTRAINT roles_description_length
  CHECK (char_length(description) <= 1000);
