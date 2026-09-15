-- What a subject must do before a login completes. This is what makes a
-- realm-level requirement expressible at all: without it, "this realm
-- requires OTP" could only mean "OTP is offered to whoever already has one".
CREATE TABLE user_required_actions (
  realm_id uuid NOT NULL REFERENCES realms (id) ON DELETE CASCADE,
  subject_id uuid NOT NULL,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (realm_id, subject_id, action),
  CONSTRAINT user_required_actions_action CHECK (
    action IN ('configure-totp', 'configure-passkey', 'update-password',
               'generate-recovery-codes')
  ),
  CONSTRAINT user_required_actions_subject_fk
    FOREIGN KEY (realm_id, subject_id) REFERENCES subjects (realm_id, id) ON DELETE CASCADE
);

ALTER TABLE user_required_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_required_actions FORCE ROW LEVEL SECURITY;

CREATE POLICY user_required_actions_isolation ON user_required_actions
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);
