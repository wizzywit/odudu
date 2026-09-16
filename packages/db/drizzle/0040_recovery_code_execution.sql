-- BROWSER_FLOW_DEFAULT (provision-flow.ts in @odudu/authn-flows) gained a
-- fourth step, and a realm provisioned before this migration has only the
-- first three: without the row, a subject who lost their second factor has
-- nowhere to present a recovery code, however many they hold.
--
-- Appended rather than inserted between the existing steps, so no realm's
-- indexes shift: the step is applicable only to a submission carrying a
-- code, so its position after the OTP step is what the evaluator expects.
INSERT INTO authentication_executions (id, realm_id, index, authenticator, requirement)
SELECT gen_random_uuid(), existing.realm_id, max(existing.index) + 1, 'recovery-code', 'conditional'
FROM authentication_executions AS existing
WHERE NOT EXISTS (
  SELECT 1 FROM authentication_executions AS already
  WHERE already.realm_id = existing.realm_id AND already.authenticator = 'recovery-code'
)
GROUP BY existing.realm_id;
