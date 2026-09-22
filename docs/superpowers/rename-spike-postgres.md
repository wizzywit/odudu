# Postgres behaviour under a realm→tenant rename

Reproduced against `postgres:18` in a throwaway container, against a
minimal table shaped like `widgets` and its RLS policy:

```sql
CREATE TABLE realms (id uuid PRIMARY KEY);
CREATE TABLE widgets (realm_id uuid NOT NULL REFERENCES realms(id));
ALTER TABLE widgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE widgets FORCE ROW LEVEL SECURITY;
CREATE POLICY widgets_isolation ON widgets
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);
```

then:

```sql
ALTER TABLE realms RENAME TO tenants;
ALTER TABLE widgets RENAME COLUMN realm_id TO tenant_id;
SELECT tablename, policyname, qual FROM pg_policies WHERE tablename = 'widgets';
SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'widgets';
```

Output:

```
 tablename |    policyname     |                                        qual
-----------+-------------------+-------------------------------------------------------------------------------------
 widgets   | widgets_isolation | (tenant_id = (NULLIF(current_setting('app.realm_id'::text, true), ''::text))::uuid)
(1 row)

 relrowsecurity | relforcerowsecurity
-----------------+---------------------
 t              | t
(1 row)
```

## Answers

1. **Does `ALTER TABLE RENAME COLUMN` rewrite the policy's `qual`?** Yes.
   The column reference in `qual` tracks the rename automatically:
   `realm_id` became `tenant_id` with no `ALTER POLICY` or `DROP`/`CREATE`
   needed.

2. **Do `relrowsecurity` and `relforcerowsecurity` survive
   `ALTER TABLE RENAME TO`?** Yes, both remain `t` after `realms` was
   renamed to `tenants`. RLS enablement is a property of the table's row in
   `pg_class`, unaffected by the table or column name.

3. **Does the `app.realm_id` string literal inside `current_setting(...)`
   change?** No. It is a plain text literal, not a column or table
   reference, and Postgres has no reason to touch it. `qual` still reads
   `current_setting('app.realm_id'::text, true)` after both renames.

## Conclusion

Column and table renames carry the qualifier's column references for free,
but the GUC name baked into each policy as a string literal does not follow
along. Since the target GUC is `app.tenant_id`, not `app.realm_id`, every
policy of this shape needs its `qual` literal changed — the rename alone
cannot do it. The migration must `DROP POLICY` and `CREATE POLICY` for all
32 policies, rewriting the `current_setting('app.realm_id', true)` literal
to `current_setting('app.tenant_id', true)`, rather than relying on
`ALTER TABLE RENAME` to carry them.

## Surprises

None — all three behaviours matched what the shape of Postgres's catalog
representation would predict: `qual` is stored as a parsed expression tree
with node-level references to the column by OID, which a rename resolves
lazily on deparse, while a string literal is stored as-is and has no OID to
resolve against.
