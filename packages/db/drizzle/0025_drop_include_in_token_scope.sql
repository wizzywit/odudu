-- include_in_token_scope let a scope carry claims while hiding its own
-- name from the issued `scope` claim. But /userinfo receives only the
-- access token and reconstructs granted scope from that token's `scope`
-- claim, so hiding a name there also hides that scope's claims and its
-- reachable roles at /userinfo. The two behaviours cannot both hold while
-- the access token is the only record of granted scope, so the column is
-- dropped rather than fixed.
ALTER TABLE client_scopes DROP COLUMN include_in_token_scope;
