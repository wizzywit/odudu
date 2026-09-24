-- `required` and `conditional` used to behave alike (`requirements.ts`
-- treated an inapplicable step of either as satisfied); now `required` fails
-- the flow for a subject it does not apply to. Every `required` row for a
-- subject-dependent authenticator is rewritten to `conditional` here, so a
-- tenant already carrying one keeps today's behaviour rather than starting
-- to lock subjects out the moment this migration runs. `password` is never
-- subject-dependent in this sense — it applies to everybody — so it is left
-- as `required` wherever it already is.
--
-- Matched on the authenticator name, not on which flow produced the row:
-- nothing can customise a flow yet (executionRepository exposes only
-- `forTenant` and `create`) and nothing is deployed, so the two sets are
-- identical today, and matching on the condition is what keeps a
-- hand-authored row from becoming a silent lockout later.
UPDATE authentication_executions
SET requirement = 'conditional'
WHERE requirement = 'required'
  AND authenticator IN ('otp', 'passkey', 'recovery-code');
