# Realm to Tenant Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every occurrence of `realm` in this repository becomes `tenant` — identifiers, database table and columns, the row-level-security GUC, the URL path, and all fifty-four documents — with no behaviour change.

**Architecture:** Five increments, bottom-up: schema, domain packages, protocol and wire, server and tooling, documentation. Each is one branch and one pull request into a phase branch, ending green. The rename is three case-preserving substitutions applied by tool; the four things a tool cannot do — the RLS policies, the transcripts, the conformance profiles and the ADR annotations — each get their own task.

**Tech Stack:** TypeScript, Fastify, Drizzle ORM, PostgreSQL with row-level security, Vitest with Testcontainers, hand-authored SQL migrations.

**Spec:** `docs/superpowers/specs/2026-09-22-realm-to-tenant-rename-design.md`

## Global Constraints

- **Three substitutions, applied in any order:** `realm`→`tenant`, `Realm`→`Tenant`, `REALM`→`TENANT`. Verified: these handle every compound including plurals and snake_case — `realms`→`tenants`, `realm_id`→`tenant_id`, `RealmScopedDatabase`→`TenantScopedDatabase`.
- **No English word contains `realm` as a substring**, so there are no false positives to guard against.
- **`tenant` already appears 76 times, all prose in comments.** No identifier collides; verified by grep before this plan was written.
- **The 56 existing migrations under `packages/db/drizzle/` are frozen — names and contents.** `meta/_journal.json` records each by `tag`, its filename stem, and a fresh database replays them in order to create `realms` and `realm_id` before the rename migration renames them. Editing them breaks the journal and leaves the rename migration with nothing to rename.
- **No behaviour changes.** If a test's expectations change beyond names, stop and report it.
- Every repository method is probed with a foreign tenant id. `SET LOCAL`, never `SET`.
- No `any`. Comments default to none; the repository baseline is ~24% comment lines and this work should not move it.
- No development-process reference in any committed file. Commit subject ≤72 chars, body ≤8 read-lines, no tool-attribution trailer.
- Run every command in the foreground. Never pass a background flag.
- Before committing, one at a time, `pnpm trace` **last**: the suites you touch, `pnpm typecheck`, `pnpm boundaries`, `npx prettier --check`, `npx eslint`, `npx vitest run tests/lint tests/docs`, then `pnpm trace`.

## Review Focus

1. **A row-level-security policy rewritten wrongly admits cross-tenant reads and nothing fails.** Task 2 pins it by updating `rls-policy.int.test.ts` before the migration. Each package's foreign-tenant probes run with that package, in Tasks 4 through 9, because they cannot compile before their package is renamed; Task 16 runs them all together as the final sweep.
2. **A missed URL string breaks a login flow the type checker cannot see.** Task 9's integration suites are the detector; Task 12's conformance run is the external proof.
3. **A transcript that was edited rather than re-captured asserts bytes never served.** Task 16 re-captures against a running stack; `tests/docs` compares documents to live output.
4. **A frozen migration edited by a tool run with too wide a scope.** Every task's substitution command excludes `packages/db/drizzle/0*.sql`; Task 3 asserts the journal still matches.
5. **The rename declared done while a name survives somewhere.** Task 16 makes completeness a test rather than a final grep somebody remembers.

---

## Increment 1 — Spike and schema

**Branch:** `rename/1-schema`, from the phase branch, with a pull request into it.

### Task 1: Spike — what Postgres does to policies under a rename

**Files:**

- Create: `docs/superpowers/rename-spike-postgres.md`

- [ ] **Step 1: Stand up a throwaway database and reproduce the shape**

```bash
docker run -d --name rename-spike -e POSTGRES_PASSWORD=x -p 55432:5432 postgres:18
sleep 3
psql postgresql://postgres:x@localhost:55432/postgres <<'SQL'
CREATE TABLE realms (id uuid PRIMARY KEY);
CREATE TABLE widgets (realm_id uuid NOT NULL REFERENCES realms(id));
ALTER TABLE widgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE widgets FORCE ROW LEVEL SECURITY;
CREATE POLICY widgets_isolation ON widgets
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);
SQL
```

- [ ] **Step 2: Rename and read the policy back**

```bash
psql postgresql://postgres:x@localhost:55432/postgres <<'SQL'
ALTER TABLE realms RENAME TO tenants;
ALTER TABLE widgets RENAME COLUMN realm_id TO tenant_id;
SELECT tablename, policyname, qual FROM pg_policies WHERE tablename = 'widgets';
SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'widgets';
SQL
```

- [ ] **Step 3: Record the answers**

Write `docs/superpowers/rename-spike-postgres.md` answering three questions, each with the command that produced the answer and its real output:

1. Does `ALTER TABLE RENAME COLUMN` rewrite the policy's `qual` expression?
2. Do `relrowsecurity` and `relforcerowsecurity` survive `ALTER TABLE RENAME TO`?
3. Does the `app.realm_id` string literal inside `current_setting(...)` change? (Expected: no — it is a literal. Confirm rather than assume.)

If the GUC literal does not change, the migration must `DROP POLICY` and `CREATE POLICY` for all 31 policies rather than relying on the rename. State which the migration will do.

- [ ] **Step 4: Tear down and commit**

```bash
docker rm -f rename-spike
git add docs/superpowers/rename-spike-postgres.md
git commit -m "Record what Postgres does to policies under a rename"
```

### Task 2: Change the isolation test's expectations first

**Files:**

- Modify: `packages/db/tests/rls-policy.int.test.ts`

**Interfaces:**

- Produces: a failing test that Task 3 makes pass. Nothing consumes this task.

- [ ] **Step 1: Update the expectations to the post-rename world**

In `packages/db/tests/rls-policy.int.test.ts`, change every expectation that names the old identifiers: the policy expression must reference `tenant_id` and `current_setting('app.tenant_id', true)`, and any table-name expectation becomes `tenants`. Change nothing else — this task adds no new assertions.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/db/tests/rls-policy.int.test.ts`
Expected: FAIL. The policies still say `realm_id`, so the assertions about `qual` do not match.

Paste the failure into the task report. This failure is the evidence that the test can tell the difference — without it, a wrong migration and a wrong expectation could agree.

- [ ] **Step 3: Commit the failing test**

```bash
git add packages/db/tests/rls-policy.int.test.ts
git commit -m "Expect tenant-named policies before renaming them"
```

### Task 3: The rename migration

**Files:**

- Create: `packages/db/drizzle/0057_rename_realm_to_tenant.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/db/src/schema/realms.ts` → renamed to `packages/db/src/schema/tenants.ts`
- Modify: `packages/db/src/tx.ts`

**Interfaces:**

- Consumes: the spike's answer about whether policies survive a column rename.
- Produces: the `tenants` table, `tenant_id` columns, `app.tenant_id` GUC, and `withTenant(db, tenantId, fn)` replacing `withRealm`.

- [ ] **Step 1: Write the migration**

Follow the shape of the recent hand-authored migrations. It must, in order: rename the table; rename all 30 `realm_id` columns; and bring every one of the 31 policies to the new GUC — by `DROP POLICY` then `CREATE POLICY` if the spike showed the literal does not change, which it will have.

Find the tables to cover mechanically rather than from memory:

```bash
grep -l "realm_id" packages/db/drizzle/0*.sql | xargs grep -ho "CREATE TABLE [a-z_]*" | sort -u
grep -hoE "CREATE POLICY [a-z_]+ ON [a-z_]+" packages/db/drizzle/0*.sql | sort -u
```

- [ ] **Step 2: Add the journal entry**

Append one entry to `packages/db/drizzle/meta/_journal.json` following the shape of the last one, with `tag` exactly `0057_rename_realm_to_tenant` and the next `idx`.

- [ ] **Step 3: Rename the Drizzle schema and the transaction helper**

```bash
git mv packages/db/src/schema/realms.ts packages/db/src/schema/tenants.ts
```

Apply the three substitutions to `packages/db/src/schema/tenants.ts` and `packages/db/src/tx.ts`. `tx.ts` carries two `set_config('app.realm_id', …)` calls; both become `app.tenant_id`.

- [ ] **Step 4: Run the migration and schema tests**

Run: `npx vitest run packages/db/tests/migrate.int.test.ts packages/db/tests/schema-drift.int.test.ts packages/db/tests/rls-policy.int.test.ts packages/db/tests/tx.int.test.ts`
Expected: PASS, including the test Task 2 left failing.

`schema-drift.int.test.ts` compares the Drizzle schema against what the migrations produce; if it fails, the schema and the migration disagree and one of them is wrong.

- [ ] **Step 5: Confirm the frozen migrations are untouched**

```bash
git diff --name-only HEAD -- packages/db/drizzle/ | grep -v '0057_rename_realm_to_tenant.sql\|meta/_journal.json'
```

Expected: empty. Any other file listed means a substitution ran too wide.

- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "Rename the realms table, its columns and its policies"
```

### Task 3b: Rename the constraint and index names the catalogue kept

**Files:**

- Create: `packages/db/drizzle/0058_rename_realm_constraint_names.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/db/tests/migrate.int.test.ts`, `packages/db/tests/schema-drift.int.test.ts`

`0057` renamed the table, its columns and its policies. PostgreSQL does not
rename a constraint or an index when the table or column it belongs to is
renamed, so roughly 106 constraint names and at least one index name still
carry the old word: primary keys, foreign keys, unique constraints, check
constraints, the PG18 not-null constraint names, and the index
`roles_realm_name`. A constraint name reaches a user in the error text of a
violation, so these are not internal.

**Interfaces:**

- Consumes: the `tenants` table and `tenant_id` columns that `0057` produced.
- Produces: a catalogue in which no relation, constraint, index or policy name
  contains the old word.

- [ ] **Step 1: Enumerate from the catalogue, never by hand**

Replay every migration into a throwaway PostgreSQL and read the real names out
of `pg_constraint`, `pg_class` and `pg_indexes`. A hand-written list will be
wrong, and a `sed` over the migration files cannot produce this because the
frozen migrations must not change.

Use queries of this shape, and record both the count and the full list in the
report:

```sql
SELECT conrelid::regclass AS table_name, conname
FROM pg_constraint WHERE conname LIKE '%realm%' ORDER BY 1, 2;

SELECT indexname, tablename FROM pg_indexes
WHERE schemaname = 'public' AND indexname LIKE '%realm%' ORDER BY 1;
```

- [ ] **Step 2: Write the migration**

`0058_rename_realm_constraint_names.sql` renames each one, applying the same
three substitutions to the name itself: `realm`→`tenant`, `Realm`→`Tenant`,
`REALM`→`TENANT`.

```sql
ALTER TABLE <table> RENAME CONSTRAINT <old> TO <new>;
ALTER INDEX <old> RENAME TO <new>;
```

A constraint backing a primary key or a unique constraint is renamed by
`ALTER TABLE ... RENAME CONSTRAINT`, which carries its index with it; do not
also rename that index separately, or the second statement fails on a name
that no longer exists. Establish which of the two forms each name needs from
the catalogue rather than assuming: `pg_constraint` rows are constraints,
and an entry in `pg_indexes` with no matching `pg_constraint` row is a plain
index.

Generate the statements from the enumeration, then read every one of them.

- [ ] **Step 3: Add the journal entry**

Append one entry to `packages/db/drizzle/meta/_journal.json` following the
shape of the last one, with `tag` exactly `0058_rename_realm_constraint_names`
and the next `idx`.

- [ ] **Step 4: Move the two test expectations off the old names**

`packages/db/tests/migrate.int.test.ts` and
`packages/db/tests/schema-drift.int.test.ts` currently assert the old
constraint names as string literals, each with a one-line comment saying why
the old name survived. Those names are now new, and the comments describe a
state that no longer exists: update both the strings and remove the comments.

- [ ] **Step 5: Prove nothing was missed**

After the migration applies, the two queries in Step 1 must both return zero
rows. Paste both, with their real output, into the report. Then:

Run: `npx vitest run packages/db`
Expected: PASS.

```bash
git diff --name-only HEAD -- packages/db/drizzle/ | grep -v '0058_rename_realm_constraint_names.sql\|meta/_journal.json'
```

Expected: empty. Any other file listed means a substitution ran too wide.

- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "Rename the constraint and index names the rename left behind"
```

### Task 4: The rest of packages/db

**Files:**

- Modify: every remaining `.ts` under `packages/db/src` and `packages/db/tests`
- Rename: `packages/db/src/realm-probe.ts` → `tenant-probe.ts`, `packages/db/src/realm-probe.test.ts` → `tenant-probe.test.ts`

- [ ] **Step 1: Rename the probe files**

```bash
git mv packages/db/src/realm-probe.ts packages/db/src/tenant-probe.ts
git mv packages/db/src/realm-probe.test.ts packages/db/src/tenant-probe.test.ts
```

- [ ] **Step 2: Apply the substitutions across the package, excluding frozen migrations**

```bash
grep -rlI -E 'realm|Realm|REALM' packages/db --include='*.ts' --include='*.json' --include='*.md' \
  | xargs sed -i '' -e 's/realm/tenant/g' -e 's/Realm/Tenant/g' -e 's/REALM/TENANT/g'
```

- [ ] **Step 3: Run the package and confirm nothing survives**

Run: `npx vitest run packages/db`
Expected: PASS.

```bash
grep -rniI realm packages/db --include='*.ts' --include='*.json' --include='*.md'
```

Expected: empty.

- [ ] **Step 4: Run the checks and commit**

Run `pnpm typecheck`, `pnpm boundaries`, `npx prettier --check .`, `npx eslint .` — each in the foreground, one at a time. `pnpm typecheck` will fail elsewhere, because every consumer still calls `withRealm`; that is expected and is what Increment 2 fixes. Record the failure list in the report rather than fixing it here.

```bash
git add packages/db
git commit -m "Rename the rest of the database package"
```

---

## Increment 2 — Domain packages

**Branch:** `rename/2-domain`, from the phase branch, with a pull request into it.

### Task 5: domain-realm becomes domain-tenant

**Files:**

- Rename: `packages/domain-realm/` → `packages/domain-tenant/`
- Modify: every file within it, plus every `package.json` and `tsconfig.json` that references `@odudu/domain-realm`

- [ ] **Step 1: Rename the directory and the files that carry the name**

```bash
git mv packages/domain-realm packages/domain-tenant
git mv packages/domain-tenant/src/service/realm-settings.ts packages/domain-tenant/src/service/tenant-settings.ts
git mv packages/domain-tenant/src/service/realm-settings.test.ts packages/domain-tenant/src/service/tenant-settings.test.ts
```

- [ ] **Step 2: Substitute inside the package**

```bash
grep -rlI -E 'realm|Realm|REALM' packages/domain-tenant \
  | xargs sed -i '' -e 's/realm/tenant/g' -e 's/Realm/Tenant/g' -e 's/REALM/TENANT/g'
```

- [ ] **Step 3: Update every reference to the package name**

```bash
grep -rlI 'domain-realm' . --include='*.json' --include='*.ts' --include='*.js' --include='*.md' \
  | grep -v node_modules | xargs sed -i '' -e 's/domain-realm/domain-tenant/g'
pnpm install
```

- [ ] **Step 4: Run the package**

Run: `npx vitest run packages/domain-tenant`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Rename the domain-realm package to domain-tenant"
```

### Task 6: domain-identity and domain-authz

**Files:**

- Modify: every file under `packages/domain-identity` and `packages/domain-authz`

- [ ] **Step 1: Substitute**

```bash
grep -rlI -E 'realm|Realm|REALM' packages/domain-identity packages/domain-authz \
  | xargs sed -i '' -e 's/realm/tenant/g' -e 's/Realm/Tenant/g' -e 's/REALM/TENANT/g'
```

- [ ] **Step 2: Run both packages and confirm nothing survives**

Run: `npx vitest run packages/domain-identity packages/domain-authz`
Expected: PASS.

```bash
grep -rniI realm packages/domain-identity packages/domain-authz
```

Expected: empty.

- [ ] **Step 3: Commit**

```bash
git add packages/domain-identity packages/domain-authz
git commit -m "Rename realm to tenant in the identity and authz packages"
```

### Task 7: account and authn-flows

**Files:**

- Modify: every file under `packages/account` and `packages/authn-flows`
- Rename: `packages/account/src/repository/realm-settings.ts` and `packages/authn-flows/src/repository/realm-settings.ts`

- [ ] **Step 1: Rename the files that carry the name**

```bash
git mv packages/account/src/repository/realm-settings.ts packages/account/src/repository/tenant-settings.ts
git mv packages/authn-flows/src/repository/realm-settings.ts packages/authn-flows/src/repository/tenant-settings.ts
```

- [ ] **Step 2: Substitute**

```bash
grep -rlI -E 'realm|Realm|REALM' packages/account packages/authn-flows \
  | xargs sed -i '' -e 's/realm/tenant/g' -e 's/Realm/Tenant/g' -e 's/REALM/TENANT/g'
```

- [ ] **Step 3: Run both packages and confirm nothing survives**

Run: `npx vitest run packages/account packages/authn-flows`
Expected: PASS.

```bash
grep -rniI realm packages/account packages/authn-flows
```

Expected: empty.

- [ ] **Step 4: Commit**

```bash
git add packages/account packages/authn-flows
git commit -m "Rename realm to tenant in the account and flow packages"
```

---

## Increment 3 — Protocol packages and the wire

**Branch:** `rename/3-protocol`, from the phase branch, with a pull request into it.

### Task 8: contracts, crypto, kernel, email, testkit

**Files:**

- Modify: every file under `packages/contracts`, `packages/crypto`, `packages/kernel`, `packages/email`, `packages/testkit`

- [ ] **Step 1: Substitute**

```bash
grep -rlI -E 'realm|Realm|REALM' packages/contracts packages/crypto packages/kernel packages/email packages/testkit \
  | xargs sed -i '' -e 's/realm/tenant/g' -e 's/Realm/Tenant/g' -e 's/REALM/TENANT/g'
```

- [ ] **Step 2: Run them and confirm nothing survives**

Run: `npx vitest run packages/contracts packages/crypto packages/kernel packages/email packages/testkit`
Expected: PASS.

```bash
grep -rniI realm packages/contracts packages/crypto packages/kernel packages/email packages/testkit
```

Expected: empty.

- [ ] **Step 3: Commit**

```bash
git add packages/contracts packages/crypto packages/kernel packages/email packages/testkit
git commit -m "Rename realm to tenant in the shared packages"
```

### Task 9: protocol-oidc, including the routes and the pages

**Files:**

- Modify: every file under `packages/protocol-oidc`
- Rename: `packages/protocol-oidc/src/repository/realm-lookup.ts`, `tests/cross-realm.adversarial.int.test.ts`, `tests/realm-scopes.int.test.ts`

This task changes the URL path in 17 route literals and 19 form actions and fetch URLs inside rendered pages. A missed string is a broken flow that no type checker sees.

- [ ] **Step 1: Rename the files that carry the name**

```bash
git mv packages/protocol-oidc/src/repository/realm-lookup.ts packages/protocol-oidc/src/repository/tenant-lookup.ts
git mv packages/protocol-oidc/tests/cross-realm.adversarial.int.test.ts packages/protocol-oidc/tests/cross-tenant.adversarial.int.test.ts
git mv packages/protocol-oidc/tests/realm-scopes.int.test.ts packages/protocol-oidc/tests/tenant-scopes.int.test.ts
```

- [ ] **Step 2: Substitute**

```bash
grep -rlI -E 'realm|Realm|REALM' packages/protocol-oidc \
  | xargs sed -i '' -e 's/realm/tenant/g' -e 's/Realm/Tenant/g' -e 's/REALM/TENANT/g'
```

- [ ] **Step 3: Confirm every route literal and page embedding moved**

```bash
grep -rn "/realms/" packages/protocol-oidc
grep -rc "/tenants/" packages/protocol-oidc | grep -v ':0' | wc -l
```

The first must be empty. The second counts the files now carrying the new path; record the number in the report so a later reader can see the surface was covered rather than assumed.

- [ ] **Step 4: Run the whole package**

Run: `npx vitest run packages/protocol-oidc`
Expected: PASS. This is the detector for a missed string literal — a broken form action fails an integration test even though it compiles.

- [ ] **Step 5: Confirm the issuer changed**

```bash
grep -n "tenants" packages/protocol-oidc/src/service/issuer.ts
```

Expected: the issuer is now `${issuerBase}/tenants/${tenantName}`. That single line is what changes `iss` in every token, the discovery document, the RFC 9207 response parameter, and the value `/userinfo` verifies against.

- [ ] **Step 6: Commit**

```bash
git add packages/protocol-oidc
git commit -m "Rename realm to tenant in the protocol package and its paths"
```

---

## Increment 4 — Server, tooling and conformance

**Branch:** `rename/4-server`, from the phase branch, with a pull request into it.

### Task 10: apps/server and the CLI

**Files:**

- Modify: every file under `apps/server`

- [ ] **Step 1: Substitute**

```bash
grep -rlI -E 'realm|Realm|REALM' apps/server \
  | xargs sed -i '' -e 's/realm/tenant/g' -e 's/Realm/Tenant/g' -e 's/REALM/TENANT/g'
```

- [ ] **Step 2: Check the environment variables that carry the name**

```bash
grep -rn "ODUDU_[A-Z_]*TENANT\|ODUDU_[A-Z_]*REALM" apps/server packages
```

Any `ODUDU_*REALM*` variable is now `ODUDU_*TENANT*`. Record every variable whose name changed, because a deployment's environment must change with it and Task 14 documents them.

- [ ] **Step 3: Run the server suites and confirm nothing survives**

Run: `npx vitest run apps/server`
Expected: PASS.

```bash
grep -rniI realm apps/server
```

Expected: empty.

- [ ] **Step 4: Commit**

```bash
git add apps/server
git commit -m "Rename realm to tenant in the server and its commands"
```

### Task 11: tools and the repository-level tests

**Files:**

- Modify: every file under `tools/` and `tests/`

- [ ] **Step 1: Substitute**

```bash
grep -rlI -E 'realm|Realm|REALM' tools tests \
  | xargs sed -i '' -e 's/realm/tenant/g' -e 's/Realm/Tenant/g' -e 's/REALM/TENANT/g'
```

- [ ] **Step 2: Run them and confirm nothing survives**

Run: `npx vitest run tests`
Expected: PASS.

```bash
grep -rniI realm tools tests
```

Expected: empty.

- [ ] **Step 3: Commit**

```bash
git add tools tests
git commit -m "Rename realm to tenant in the tooling and repository tests"
```

### Task 12: The conformance profiles, and proof they pass

**Files:**

- Modify: `infra/conformance/basic-op.json`, `config-op.json`, `dynamic-op.json`, and anything else under `infra/`

- [ ] **Step 1: Substitute across infra**

```bash
grep -rlI -E 'realm|Realm|REALM' infra \
  | xargs sed -i '' -e 's/realm/tenant/g' -e 's/Realm/Tenant/g' -e 's/REALM/TENANT/g'
```

- [ ] **Step 2: Confirm the discovery URLs moved**

```bash
grep -rn "discoveryUrl" infra/conformance/*.json
```

Expected: each now reads `https://proxy/tenants/conformance/.well-known/openid-configuration`.

- [ ] **Step 3: Run the conformance suite**

Run the suite the way CI's `conformance` job does — read `.github/workflows/verify.yml` for the exact invocation and use it unchanged.

Expected: PASS. This is the external proof that the wire change is correct by the OIDF's own tests rather than by our reading of them. If it fails, the failure is the finding: report what it says rather than adjusting the profile to match the server.

- [ ] **Step 4: Commit**

```bash
git add infra
git commit -m "Point the conformance profiles at the tenant paths"
```

---

## Increment 5 — Documentation

**Branch:** `rename/5-docs`, from the phase branch, with a pull request into it.

### Task 13: The living documents

**Files:**

- Modify: `README.md`, `CLAUDE.md`, `SECURITY.md`, `docs/NEXT.md`, all 14 files under `docs/protocols/`, `packages/db/README.md`, `infra/conformance/README.md`

Not `docs/request-paths.md` — Task 15 re-captures it. Not `docs/adr/`, `docs/phases/` or `docs/superpowers/` — Task 14 handles those with their annotations.

- [ ] **Step 1: Substitute**

```bash
grep -rlI -E 'realm|Realm|REALM' README.md CLAUDE.md SECURITY.md docs/NEXT.md docs/protocols packages/db/README.md infra/conformance/README.md \
  | xargs sed -i '' -e 's/realm/tenant/g' -e 's/Realm/Tenant/g' -e 's/REALM/TENANT/g'
```

- [ ] **Step 2: Add the renamed environment variables to the deployment section**

`README.md`'s deployment section lists the environment variables a deployment sets. Any variable Task 10 renamed must appear under its new name. Read Task 10's report for the list.

- [ ] **Step 3: Run the documentation tests**

Run: `npx vitest run tests/docs`
Expected: PASS. These compare what the documents assert against what the server serves.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md SECURITY.md docs/NEXT.md docs/protocols packages/db/README.md infra/conformance/README.md
git commit -m "Rename realm to tenant in the living documents"
```

### Task 14: The historical documents, annotated

**Files:**

- Modify: all 13 files under `docs/adr/`, 4 under `docs/phases/`, 6 specs and 6 plans under `docs/superpowers/`
- Rename: `docs/adr/0026-client-registration-is-a-realm-policy-closed-by-default.md`, `docs/adr/0033-admitting-a-session-locks-the-realm-row.md`

- [ ] **Step 1: Rename the two ADR files**

```bash
git mv docs/adr/0026-client-registration-is-a-realm-policy-closed-by-default.md docs/adr/0026-client-registration-is-a-tenant-policy-closed-by-default.md
git mv docs/adr/0033-admitting-a-session-locks-the-realm-row.md docs/adr/0033-admitting-a-session-locks-the-tenant-row.md
```

- [ ] **Step 2: Substitute across the historical documents**

```bash
grep -rlI -E 'realm|Realm|REALM' docs/adr docs/phases docs/superpowers \
  | xargs sed -i '' -e 's/realm/tenant/g' -e 's/Realm/Tenant/g' -e 's/REALM/TENANT/g'
```

- [ ] **Step 3: Annotate each ADR once**

Add one line to each of the 13 ADRs, immediately under its `**Status:**` line, in this form:

```markdown
**Renamed 2026-09-22:** written when a tenant was called a realm; the decision is unchanged.
```

Write it by hand in each file. It is 13 lines, and a generated one would be the only thing in the repository nobody had read.

- [ ] **Step 4: Confirm any cross-reference still resolves**

```bash
grep -rn "0026-client-registration\|0033-admitting-a-session" . --include='*.md' --include='*.ts' | grep -v node_modules
```

Every hit must name the new filename. A code comment citing a renamed ADR is a pointer to nothing.

- [ ] **Step 5: Commit**

```bash
git add docs/adr docs/phases docs/superpowers
git commit -m "Rename realm to tenant in the historical documents"
```

### Task 15: Re-capture the transcripts

**Files:**

- Modify: `docs/request-paths.md`

This document contains 262 lines with `realms/`, and its standing promise is that every command in it was executed and every response is real output. A find-replace would make it assert bytes that were never served.

- [ ] **Step 1: Bring up a clean stack**

```bash
docker compose -f infra/docker/compose.yaml down -v
docker compose -f infra/docker/compose.yaml up -d
```

- [ ] **Step 2: Replay the document from the top**

Run every command in order, in the foreground, and paste what the terminal printed. Where a response block already carries a language tag, keep it — `tests/docs/markdown.ts`'s `blockAfter` selects blocks by language and an untagged block is invisible to the checks that read them.

- [ ] **Step 3: Report every place the document and the server disagree**

A discrepancy is a finding, not something to smooth into matching the prose. Two re-captures during the previous phase each turned up real defects this way.

- [ ] **Step 4: Run the documentation tests**

Run: `npx vitest run tests/docs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/request-paths.md
git commit -m "Re-capture the request transcripts against tenant paths"
```

### Task 16: Make completeness a test

**Files:**

- Create: `tests/lint/no-realm.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: the check that the rename is complete and stays complete.

- [ ] **Step 1: Write the test**

```ts
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../docs/markdown.js';

// The 56 migrations that predate the rename are frozen: `meta/_journal.json`
// records each by its filename stem, and a fresh database replays them in
// order to create `realms` before 0057 renames it. The annotation lines in
// docs/adr say the word once, on purpose.
const ALLOWED = /^(packages\/db\/drizzle\/0(?!057)|docs\/adr\/.*: \*\*Renamed )/u;

describe('the rename left no realm behind', () => {
  it('finds the word only where it is deliberate', () => {
    const found = execFileSync(
      'git',
      ['grep', '-niI', '-e', 'realm', '--', '.', ':(exclude)node_modules'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
      .split('\n')
      .filter((line) => line.length > 0)
      .filter((line) => !ALLOWED.test(line));

    expect(found, `these still say realm:\n${found.join('\n')}`).toEqual([]);
  });
});
```

`git grep` exits non-zero when it finds nothing, so wrap the call in a try/catch that treats an empty result as success — write that explicitly rather than letting the throw surface as a test error.

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/lint/no-realm.test.ts`
Expected: PASS.

- [ ] **Step 3: Prove it can fail**

Add the word to a source file, run the test, watch it fail, then revert:

```bash
echo "// realm" >> packages/kernel/src/page.ts
npx vitest run tests/lint/no-realm.test.ts   # expect FAIL naming page.ts
git checkout packages/kernel/src/page.ts
```

Paste both outputs into the report. A completeness test that cannot fail is the one thing worse than no completeness test.

- [ ] **Step 4: Run every foreign-tenant probe together**

The spec's proof list requires that isolation is intact, and each package's
probes have so far only run with their own package. Run them as one sweep:

```bash
npx vitest run packages apps tests
```

Expected: PASS, with every `expectCrossTenantMethodProbe` case among them. If a
probe fails here having passed in its own package's task, the cause is a policy
that isolates differently once another package's data is present — report it
rather than adjusting the probe.

- [ ] **Step 5: Commit**

```bash
git add tests/lint/no-realm.test.ts
git commit -m "Fail the build if the old name comes back"
```
