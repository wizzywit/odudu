-- Persists what an exchanged grant's own access token carried at the
-- moment of exchange, so a later refresh rotation can reapply it instead
-- of silently dropping it: the full `act` chain (a nested delegation
-- cannot be rebuilt from actor_subject_id alone) and the expiry ceiling
-- mintAccessToken's own `expCeiling` applied.
ALTER TABLE token_grants ADD COLUMN act_chain jsonb;
ALTER TABLE token_grants ADD COLUMN exp_ceiling timestamptz;
