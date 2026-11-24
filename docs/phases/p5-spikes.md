# P5: spikes

The three assumptions of the P5 spec, section 13. Each is a command and a
result field; a task that depends on one cites its result here.

## 1. A CIBA poll plan in the OIDF conformance suite

- **Claim:** the OIDF conformance suite has a CIBA poll plan the existing
  `conformance` job can run.
- **Command:** list the plans of the suite release the `conformance` job
  builds (`.github/workflows/verify.yml`, the `conformance` job) and look for
  one named for CIBA poll mode; then run it against a stack with the CIBA
  endpoint enabled, through `.superpowers/sdd/tools/heavy-slot -p e2e --`.
- **Result:** (to be filled in by the increment that adds the CIBA endpoint)

## 2. A `subjects` row of type `agent_instance` with no credentials

- **Claim:** `subjects` accepts an `agent_instance` row with no credentials.
- **Commands:**
  `git grep -n -E "subjects_type_check|ALTER TABLE subjects" -- packages/db/drizzle`,
  `git grep -n -E "agent_instance" -- packages apps`,
  `git grep -n "REFERENCES subjects" -- packages/db/drizzle`.
- **Result (2026-11-24): yes.**
  - The only CHECK on `subjects` is
    `CHECK (type IN ('user', 'service', 'agent_instance'))`
    (`packages/db/drizzle/0005_subjects.sql:7`); no later migration adds a
    constraint, only the nullable column `recovery_codes_issued_at`
    (`0130_recovery_codes_issued_at.sql`). No column requires a credential.
  - Credentials, usernames and emails live in `users` and `user_credentials`,
    which reference `subjects(id)` from their side
    (`0005_subjects.sql:11-30`); the subject row needs none of them.
  - `subjectRepository(tx).create` inserts `{ id, tenantId, type }` and
    nothing else (`packages/domain-identity/src/repository/subjects.ts:84-88`);
    a `service` subject is already created without credentials by the same call
    (`packages/protocol-oidc/src/usecase/service-account.ts:34`).
  - Readers: the admin contract already allows the value and documents a
    subject with no `users` row (`packages/contracts/src/admin/subjects.ts:18`,
    `:77-79`), and the console type lists it
    (`apps/admin-console/src/entities/subject/types/subject.ts:3`).
  - Caveat: `0122_service_accounts_by_grant.sql:76` reads `s.type = 'service'`
    only, so it never touches an `agent_instance` row.

## 3. A recursive CTE under row-level security

- **Claim:** a recursive CTE over `exchanged_from_grant_id` stays one bounded
  statement under row-level security with the 0095 index.
- **Command:** `EXPLAIN (ANALYZE, BUFFERS)` of the cascade statement on the
  `query-plans` fixture, as the application role with `app.tenant_id` set by
  `SET LOCAL`, through `.superpowers/sdd/tools/heavy-slot -p int --`.
- **Result (2026-11-24): yes, with one change to how the statement is
  written; no new index.**
  - The plans project drives the cascade on the large-volume fixture
    (`apps/server/src/testing/plan-background-drives.ts`, "grants: a revoked
    grant takes everything exchanged from it") and through every admin and
    console path that revokes. Its recursive step reads
    `token_grants_by_exchanged_from`, the partial index of
    `0095_lookup_indexes.sql`, one index scan for each level; the seeds and
    the grants it revokes are found by `token_grants_tenant_id_unique` and
    `token_grants_pkey`; the clients lookup by `clients_pkey`. The
    row-level-security predicate sits on every scan and none is a sequential
    scan of `token_grants`, so a composite `(tenant_id, exchanged_from_grant_id)`
    index would add nothing and none was made.
  - The first version, with `id in (select id from picked)` in the two
    `update`s and the seed lookup, was planned as a semi-join that scanned the
    tenant's whole `token_grants` (about 301,000 rows estimated) and failed
    the plans test's wide-scan check. `id = any(array(select ...))` cannot be
    planned as a join, so each id is an index lookup, and that is what the
    statement uses.
  - `agent_instances` is read by a sequential scan in this fixture because it
    holds no rows there; the table is not large, so the check does not flag
    it. Its lookups by `root_grant_id` and `parent_instance_id` are served by
    the indexes `0141_agent_identity.sql` and its foreign-key repair create.
  - One statement: the cascade test counts the statements a transaction
    sends for a root with 1,000 grants exchanged from it and finds one.
  - The `agent.instance_revoked` row of a cascade is written inside the grants
    repository, not by each caller: at least twelve callers revoke, and a hook
    would be forgotten at one of them. This bends the rule that a repository
    writes no audit rows, on purpose. Its actor is the instance's owner and
    agent client, not the party that triggered the revoke.
  - A chain of any length is revoked: each pass walks to the structural depth
    and the next starts from the grants it left at that depth, and a revoke
    ends with a pass in a new statement that must find nothing, so a child
    committed while an earlier pass waited on a lock is found. The exchange
    takes the parent `for share` and refuses `invalid_grant` if it was revoked.
