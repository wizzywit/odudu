-- BROWSER_FLOW_DEFAULT (provision-flow.ts in @odudu/authn-flows) gained a
-- fourth step, and a realm provisioned before this migration has only the
-- first three: without the row, a subject who lost their second factor has
-- nowhere to present a recovery code, however many they hold.
--
-- Appended rather than inserted between the existing steps, so no realm's
-- indexes shift: the step is applicable only to a submission carrying a
-- code, so its position after the OTP step is what the evaluator expects.

-- FORCE ROW LEVEL SECURITY (0031) removes the owner's exemption, so under a
-- schema owner that is not SUPERUSER or BYPASSRLS — the role README.md's
-- instructions actually produce — the SELECT below would match zero rows,
-- the INSERT would write nothing, and no error would be raised. Lifting
-- FORCE for the statement restores that exemption without touching the
-- policy, so every other role stays subject to it; the ALTER holds ACCESS
-- EXCLUSIVE, so nothing can read the table while it is lifted, and DDL is
-- transactional, so a failure here restores FORCE with the rollback.
--
-- Setting app.realm_id per realm instead cannot work: enumerating the
-- realms to loop over is itself behind the same policy, on whichever table
-- the list comes from.
ALTER TABLE authentication_executions NO FORCE ROW LEVEL SECURITY;

INSERT INTO authentication_executions (id, realm_id, index, authenticator, requirement)
SELECT gen_random_uuid(), existing.realm_id, max(existing.index) + 1, 'recovery-code', 'conditional'
FROM authentication_executions AS existing
WHERE NOT EXISTS (
  SELECT 1 FROM authentication_executions AS already
  WHERE already.realm_id = existing.realm_id AND already.authenticator = 'recovery-code'
)
GROUP BY existing.realm_id;

ALTER TABLE authentication_executions FORCE ROW LEVEL SECURITY;
