-- A client created through the admin API door (POST
-- /admin/tenants/{t}/clients) is neither seeded via the CLI nor registered
-- dynamically — recording it as 'seeded' made the two indistinguishable,
-- the exact concern client-patch.ts's own refusal on this column exists to
-- guard against from the other end.
ALTER TABLE clients
  DROP CONSTRAINT clients_registration_origin_check;
ALTER TABLE clients
  ADD CONSTRAINT clients_registration_origin_check
  CHECK (registration_origin IN ('seeded', 'anonymous', 'token', 'operator'));
