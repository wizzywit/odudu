-- A group every subject created afterwards joins, as roles.default_for_new_subjects
-- (0017_roles.sql) hands a role to each. Nothing a default group reaches may
-- be an admin capability; that guard is the admin API's, as it is for roles.
ALTER TABLE groups ADD COLUMN default_for_new_subjects boolean NOT NULL DEFAULT false;
