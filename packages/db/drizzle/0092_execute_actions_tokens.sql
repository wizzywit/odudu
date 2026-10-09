-- A link an administrator mails to take a subject through named required
-- actions: the actions it carries, and the redirect URI, one the client
-- registered, its last page offers to go back to.
ALTER TABLE action_tokens DROP CONSTRAINT action_tokens_type_check;
ALTER TABLE action_tokens ADD CONSTRAINT action_tokens_type_check
  CHECK (type IN ('verify_email', 'reset_password', 'execute_actions'));
ALTER TABLE action_tokens
  ADD COLUMN actions text[],
  ADD COLUMN redirect_uri text;
ALTER TABLE action_tokens ADD CONSTRAINT action_tokens_actions_check
  CHECK ((type = 'execute_actions') = (actions IS NOT NULL AND cardinality(actions) > 0));
