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
- **Result:** (to be filled in by the increment that adds cascade revocation)
