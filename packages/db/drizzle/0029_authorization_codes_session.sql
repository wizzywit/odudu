-- A grant is created when a code is redeemed, so the session the login
-- established has to travel on the code or it is lost in between. Nullable
-- because a code issued for an offline grant belongs to no session, and
-- because any code in flight when this ships has none.
--
-- No foreign key: a code references a session only as a label to copy
-- forward, and a code redeemed after its session was reaped must still
-- redeem.
ALTER TABLE authorization_codes ADD COLUMN session_id uuid;
