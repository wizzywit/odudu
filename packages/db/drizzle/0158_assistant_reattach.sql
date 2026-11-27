-- Why a grant was revoked, where the revoking path knows it is the person ending
-- their own sign-in: a console sign-out, a session lapsing through the console
-- gateway, or the person ending their own sessions. Null means any other cause
-- (a reused refresh token, an administrator ending a session, a recovered
-- account, a removed client) and so every grant revoked before this column.
-- A conversation of the console assistant is carried on after a sign-in only
-- when its sign-in ended in the first way; see packages/protocol-oidc
-- `reattachDecision`. 'reattached' marks the conversation grant a newer one
-- replaced.
ALTER TABLE token_grants ADD COLUMN IF NOT EXISTS revoked_cause text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'token_grants_revoked_cause_known'
  ) THEN
    ALTER TABLE token_grants
      ADD CONSTRAINT token_grants_revoked_cause_known
      CHECK (revoked_cause IS NULL OR (revoked_at IS NOT NULL AND revoked_cause IN ('sign_out', 'reattached')))
      NOT VALID;
    ALTER TABLE token_grants VALIDATE CONSTRAINT token_grants_revoked_cause_known;
  END IF;
END $$;

-- The grant a conversation acts under now, once it is not the conversation's
-- own id: a conversation made before this column, and one never carried on after
-- a sign-in, has null and its grant is the one stored under its id. No foreign
-- key on purpose: a grant removed with its sign-in leaves a name that matches
-- nothing, which a message to the conversation answers as a refusal.
ALTER TABLE assistant_conversations ADD COLUMN IF NOT EXISTS grant_id uuid;
