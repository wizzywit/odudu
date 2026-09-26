-- The claims parameter's userinfo member, carried on the grant so a
-- refresh_token redemption narrows /userinfo exactly as the code's did
-- (ADR 0036). Null when the request named no userinfo member.
ALTER TABLE token_grants ADD COLUMN requested_userinfo_claims text[];

ALTER TABLE token_grants DROP CONSTRAINT token_grants_session_fk;
-- The column list (PostgreSQL 15+) nulls session_id alone. Unrestricted, SET
-- NULL nulls tenant_id too, and the delete it exists to survive fails on NOT NULL.
ALTER TABLE token_grants ADD CONSTRAINT token_grants_session_fk
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions (tenant_id, id)
  ON DELETE SET NULL (session_id);
