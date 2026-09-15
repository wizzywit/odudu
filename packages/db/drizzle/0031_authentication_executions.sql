-- One flat, ordered list of executions per realm. Alternatives at adjacent
-- indexes form one group, which is how a single level expresses "passkey or
-- password" without a tree; nesting is not modelled because nothing can
-- author it until there is an admin surface.
CREATE TABLE authentication_executions (
  id uuid PRIMARY KEY,
  realm_id uuid NOT NULL REFERENCES realms (id) ON DELETE CASCADE,
  index integer NOT NULL,
  authenticator text NOT NULL,
  requirement text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT authentication_executions_requirement CHECK (
    requirement IN ('required', 'alternative', 'conditional', 'disabled')
  ),
  CONSTRAINT authentication_executions_order UNIQUE (realm_id, index)
);

ALTER TABLE authentication_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE authentication_executions FORCE ROW LEVEL SECURITY;
CREATE POLICY authentication_executions_isolation ON authentication_executions
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);
