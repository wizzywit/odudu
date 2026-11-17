-- The address a subject has asked to change to and not yet proved: the mailed
-- link that proves it names the address, and completing the link swaps it in.
-- One row per subject, so a later request replaces an earlier one and the
-- table never holds more rows than the tenant has subjects. Found by the
-- primary key (tenant_id, subject_id); the link is found by its own digest in
-- action_tokens. Deleted with the subject.
CREATE TABLE IF NOT EXISTS pending_email_changes (
  tenant_id    uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  subject_id   uuid NOT NULL,
  email        text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, subject_id),
  CONSTRAINT pending_email_changes_subject_fk
    FOREIGN KEY (tenant_id, subject_id) REFERENCES subjects (tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE pending_email_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_email_changes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pending_email_changes_isolation ON pending_email_changes;
CREATE POLICY pending_email_changes_isolation ON pending_email_changes
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
