-- Whether this tenant's login form accepts a verified email address in place
-- of a username (packages/authn-flows/src/usecase/executor.ts). Off by
-- default, so an upgraded tenant's sign-in is unchanged.
ALTER TABLE tenants ADD COLUMN login_with_email boolean NOT NULL DEFAULT false;
