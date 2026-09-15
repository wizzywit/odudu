# P2b Credentials, MFA and the Session Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An SSO session that is read as well as written — with idle and maximum lifespans, offline access and RP-initiated logout — behind a flow engine that authenticates with a password, a TOTP code, a passkey or a recovery code, protected by password policy and brute-force lockout, with expired state reaped on a stated retention window and mail sent off the request path.

**Architecture:** No new packages. `authn-flows` grows from one hardcoded step to a flat per-realm list of executions with `REQUIRED`/`ALTERNATIVE`/`CONDITIONAL`/`DISABLED` semantics and a required-action mechanism that runs after authentication and before the session is established. `domain-identity` grows the widened credential store and the password-policy service. `protocol-oidc` grows the cookie read at `/authorize`, `end_session_endpoint`, and the `sid` claim. `crypto` gains RFC 6238 TOTP, hand-built against the RFC's own vectors. `apps/server` gains a `reap` command, the scheduler that runs it, and the outbox sender riding the same scheduler.

**Tech Stack:** Node 24, TypeScript 6.0.3, Fastify 5.12.3, PostgreSQL 17, Drizzle ORM 0.45.2, Zod 4.6.1, Vitest 5.0.0, Testcontainers 12.1.0, jose 6.2.12, @node-rs/argon2 2.2.1. Two candidate additions, each gated by a spike: a WebAuthn server library (Task 17) and a QR encoder confined to the view layer (Task 16).

**Spec:** `docs/superpowers/specs/2026-09-15-p2b-credentials-mfa-sessions-design.md`

**Umbrella spec:** `docs/superpowers/specs/2026-09-10-odudu-design.md`

## Global Constraints

Everything in P0's, P1's and P2a's plans still binds. Repeated here because an implementer sees only their own task:

- Node `>=24.0.0`. TypeScript pinned to **6.0.3**, not 7.x (ADR 0012).
- ESM only. `"type": "module"`, `verbatimModuleSyntax` on.
- **Intra-package imports use Node subpath imports, never relative paths.** Each package declares `"imports": { "#/*": "./src/*.ts" }`; code imports as `#/service/totp`. Cross-package imports use the package name (`@odudu/kernel`) and resolve only through that package's `index.ts` (ADR 0013).
- Every dependency version is exact, no ranges.
- **`pnpm-workspace.yaml` sets `minimumReleaseAge: 1440`.** A version published in the last 24 hours will not install. If one in this plan is blocked, wait or add an entry to `minimumReleaseAgeExclude` **with a comment giving the reason** — never lower the global setting.
- **No `any`.** Not as an annotation, not as a cast, not leaked in from an untyped boundary such as `JSON.parse` or a `jsonb` column. Use `unknown` and narrow it with Zod. `tests/lint/no-any.test.ts` also fails the build on an inline `eslint-disable` of `no-explicit-any` or `no-unsafe-*`.
- **Call a function as `doThing()`, never `void doThing()`.** If a call trips `no-floating-promises`, `await` it, return it, or add it to `allowForKnownSafeCalls` in `eslint.config.js` with a comment saying why it is safe.
- **No comment block runs longer than eight lines.** `tests/lint/comment-block-length.test.ts` fails the build on one. Blank lines do not split a block; over-long lines are weighed by width. No allowlist, no inline waiver. An essay goes to an ADR or a `docs/protocols/` reading note with a one-line pointer back.
- **Never reference the development process from a comment** — no "Task 12", no "Step 3", no plan slot numbers. Name the thing instead: not "read by Task 14's grant" but "read by the client_credentials grant".
- **Commit messages contain no `Co-Authored-By` or tool-attribution trailers.** A repository hook rejects them; a commit that fails for this reason is re-committed with the trailer removed, not forced.
- Test-driven: the failing test is written and observed failing before implementation.
- **"Reuse the existing function" carries that function's preconditions, and they are load-bearing.** Where a task says to reuse something rather than duplicate it, read what the existing function assumes and check the new caller still satisfies it. This plan already shipped one Critical defect that way: `issueAuthorizationCode` derived a code's `expires_at` from `authTime` because on the form path `authTime` _is_ `now`, and the session-reuse caller passes a past `authTime`, so a reused login issued a code that had already expired. The P0 rule about `verified:` versus `assumption:` applies to first-party code too — a claim that an existing function is safe under a new caller is an assumption, not a fact, and its precondition belongs in the task text.
- **An injected clock cannot move the database's clock.** Anything enforced in SQL against `now()` — authorization-code expiry, session expiry, lockout windows — is untestable with a fake clock, and a test that advances one and passes has proved nothing. Back-date the row through the owner connection instead.
- **The integration-test harness is the package's existing one, not the one this plan's skeletons sketch.** `@odudu/testkit` exports exactly `startTestDatabase`, `createAppRole` and `TestDatabase` — there is no `testDatabase()` and no `seedRealm()`, and any skeleton below that calls them is shorthand, not a real API. Copy the setup from the nearest existing `*.int.test.ts` in the package you are working in; `packages/authn-flows/tests/session-lifespan.int.test.ts` is the freshest exemplar (`startTestDatabase` + `createAppRole` + `createDatabase` + `runMigrations`, with a hand-rolled realm seed). For a foreign-`realm_id` probe use **`expectCrossRealmMethodProbe` from `@odudu/db/testing`** rather than hand-writing the assertion.
- **How to run tests.** No package declares a `test` script — each package's `package.json` has only `typecheck`. Vitest is configured at the root (`vitest.config.ts`) with two projects, `unit` and `integration`, selected by path: `{packages,apps}/*/src/**/*.test.ts` for unit, `{packages,apps}/*/tests/**/*.int.test.ts` for integration. So run one file or one name fragment with `pnpm exec vitest run --project integration <fragment-or-path>`, and the whole suite with `pnpm test` from the root. `pnpm --filter @odudu/<pkg> test` fails with `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`.
- **Run tests in the foreground and read the output yourself.** Do not background a test run and wait to be notified — that stalls the task with the work uncommitted.
- Integration tests run against real PostgreSQL via Testcontainers, never a mock. They live in a package's `tests/` directory as `*.int.test.ts`. Unit tests sit beside the code as `*.test.ts`.
- **Every repository method is probed with a foreign `realm_id`.** `packages/db/tests/rls-policy.int.test.ts` catches a table shipped without a policy; it does not catch a method that leaks, and that probe is written per task.
- **`SET LOCAL`, never `SET`, for realm context.** Use `withRealm(db, realmId, fn)` from `@odudu/db`.
- Domain packages never import protocol packages. Protocol packages never import each other.
- Layer imports follow ADR 0010: `view` → own model and `shared/view`; `usecase` → repository, service, view models; `repository` → adapter, service; `adapter` → transport, service; `service` → nothing.
- Migrations are hand-authored SQL in `packages/db/drizzle/`, never generated, and each needs an entry appended to `packages/db/drizzle/meta/_journal.json` with the next `idx` and a `when` greater than the previous entry's. Every new tenant table needs `ENABLE` + `FORCE ROW LEVEL SECURITY` and a policy in the same migration.
- **`pnpm trace` runs strict.** A new MUST that is not `covered` fails the build. A new `deferred:` or `n/a:` row must move the count in `tools/trace/silenced-musts.json` in the same diff.
- **`README.md` and `docs/request-paths.md` are updated in the same commit as the code** that changes a request, response, branch, error code, endpoint, command or default. `tests/docs/` fails the build on drift — run it with `pnpm exec vitest run --project unit docs`, since it lives in the **unit** project despite the directory name — and every command in `docs/request-paths.md` has been run against a live stack with real output pasted back, never hand-aligned or annotated.
- **A behaviour change falsifies prose somewhere other than the section you are editing.** `docs/request-paths.md` carries a list of what the server does _not_ do yet, and a task that removes a limitation has to delete its bullet as well as document the new behaviour. Two bullets survived four commits past the work that falsified them because the task that changed the behaviour updated only the section it had added. Grep the file for the capability you just built before you commit.
- **`docs/NEXT.md` is updated at the end of every task**, not at phase close.
- Every task ends with **CI green on a pushed commit with the draft pull request open**. The draft PR opens in Task 1 and stays open for the phase. **No exceptions, including the three spikes and the unit-test-only tasks**: a commit CI has not seen is a commit whose state nobody has verified, and a branch with unpushed commits makes "green on the last push" a claim about something other than the current tree. A task is not finished until `gh pr checks --watch` has reported pass on its own pushed commit.

### P2b-specific constraints

- **`token_grants` already exists** (migration 0010, `packages/protocol-oidc/src/schema/token-grants.ts`) with `id`, `realm_id`, `client_id`, `subject_id`, `scope`, `audience`, `created_at`, `revoked_at`. This phase adds **one** column to it. Do not create a second grants table.
- **A grant with `session_id IS NULL` is an offline grant.** Offline is the absence of a session, never a boolean. Nothing may set `session_id` to null on an existing session-bound grant.
- **Nothing is deleted except by the reaper**, and the reaper never deletes a row a decision can still read. `DELETE … WHERE expires_at < now()` is the implementation this phase must not ship (ADR 0021).
- **Logout revokes grants and sessions, never access tokens.** Odudu's access tokens are self-contained `at+jwt` JWTs. Say so in prose; never imply otherwise.
- **The confirmation page on `end_session_endpoint` is a MUST, with two triggers** (RP-Initiated Logout §2): no `id_token_hint`, **or** a hint whose ID Token does not belong to the current OP session.
- **A locked account and a wrong password are indistinguishable to the submitter.** Telling a submitter an account is locked confirms it exists.
- **The constant-time password path survives.** `DUMMY_SUBJECT_ID` in `packages/authn-flows/src/usecase/executor.ts` and `DUMMY_HASH` in `packages/authn-flows/src/service/authenticators/password.ts` exist so an unknown username costs what a wrong password costs. No task removes either.
- **`advance()` keeps its signature.** The flow engine's requirements are invisible to `login-submission.ts`.
- **A conditional OTP step never runs after a passkey.** A passkey assertion is already two factors.
- **The relying-party ID for WebAuthn comes from `ODUDU_PUBLIC_BASE_URL`**, never from a request header — the same rule P2a's mailed links follow.
- **Password policy is evaluated by one service, called by every writer of a password**: registration, reset, the seed CLI, and the change-password required action. Four call sites, no exceptions.

## File structure

No new packages. Modified packages:

| Path                        | Change                                                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/drizzle/`      | migrations 0026–0034 and their journal entries                                                                              |
| `packages/db/src/schema/`   | `realms` gains session-lifespan, password-policy and lockout columns                                                        |
| `packages/authn-flows/`     | the execution schema and repository, the requirement evaluator, the authenticator registry, required actions, lockout       |
| `packages/domain-identity/` | widened credential store, per-type `secret_data` parsing, the password-policy service, `login_failures`                     |
| `packages/crypto/`          | RFC 6238 TOTP                                                                                                               |
| `packages/protocol-oidc/`   | `token_grants.session_id`, the cookie read at `/authorize`, `sid`, `offline_access`, `end_session_endpoint`, rotation rules |
| `packages/email/`           | the outbox port alongside the existing direct sender                                                                        |
| `packages/account/`         | password-policy enforcement at registration and reset; the reset endpoint moves to the outbox                               |
| `apps/server/src/cli/`      | the `reap` command                                                                                                          |
| `apps/server/src/`          | the scheduler, the IP throttle, route registration                                                                          |
| `docs/protocols/`           | four new clause tables and their reading notes                                                                              |

New files worth naming before the tasks, because they fix the decomposition:

| Path                                                          | Responsibility                                                               |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `packages/authn-flows/src/service/requirements.ts`            | the pure requirement evaluator. No `tx`, no repository, no clock.            |
| `packages/authn-flows/src/schema/execution.ts`                | the `authentication_executions` table and its record type                    |
| `packages/authn-flows/src/service/authenticators/totp.ts`     | the TOTP step. Verification gathered by the caller, like `password.ts`.      |
| `packages/authn-flows/src/service/authenticators/passkey.ts`  | the passkey step                                                             |
| `packages/authn-flows/src/service/authenticators/recovery.ts` | the recovery-code step                                                       |
| `packages/authn-flows/src/usecase/required-actions.ts`        | which actions are pending, and running them                                  |
| `packages/domain-identity/src/service/password-policy.ts`     | evaluate a candidate password against a realm policy; returns all violations |
| `packages/domain-identity/src/service/credential-secret.ts`   | the per-type `secret_data` discriminated union and its Zod schemas           |
| `packages/domain-identity/src/service/lockout.ts`             | the pure backoff arithmetic. No `tx`.                                        |
| `packages/crypto/src/service/totp.ts`                         | RFC 6238                                                                     |
| `packages/protocol-oidc/src/usecase/session-reuse.ts`         | resolve a cookie to a live session, and decide `prompt`/`max_age` against it |
| `packages/protocol-oidc/src/usecase/logout.ts`                | `end_session_endpoint`'s decisions                                           |
| `packages/protocol-oidc/src/view/logout-html.ts`              | the confirmation page                                                        |
| `apps/server/src/cli/reap.ts`                                 | the retention pass, as a command                                             |
| `apps/server/src/scheduler.ts`                                | interval, jitter, advisory lock, call. No logic.                             |
| `apps/server/src/throttle.ts`                                 | the in-process per-IP sliding window                                         |

## Task budget

| Task | Deliverable                                                               | Hours |
| ---- | ------------------------------------------------------------------------- | ----- |
| 1    | `token_grants.session_id`: migration 0026, rotation refuses a dead grant  | 5–7   |
| 2    | Session lifespans: migrations 0027–0028, `last_active_at`, the live read  | 3–4   |
| 3    | The cookie read at `/authorize`, and the verified-email gate it re-checks | 5–6   |
| 4    | The `sid` claim in access and ID tokens                                   | 2–3   |
| 5    | `end_session_endpoint`: migration 0029, confirmation, revocation          | 5–6   |
| 6    | `offline_access`: a grant with no session                                 | 3–4   |
| 7    | `authentication_executions`: migration 0030 and realm provisioning        | 3–4   |
| 8    | The requirement evaluator, as a pure function                             | 2–3   |
| 9    | The executor runs the registry, and a multi-step login resumes            | 4–5   |
| 10   | `acr` and `amr` from the executions that actually ran                     | 2–3   |
| 11   | **Spike:** converting `secret_data` to `jsonb` on a seeded database       | 1–2   |
| 12   | `user_credentials` widened: migration 0031, per-type secrets              | 4–5   |
| 13   | Password policy: migration 0032 columns, one service, four call sites     | 4–5   |
| 14   | Required actions: migration 0033, the flow gate, the page shell           | 4–5   |
| 15   | RFC 6238 TOTP in `@odudu/crypto`, against the RFC's vectors               | 3–4   |
| 16   | The TOTP step and `configure-totp`                                        | 4–5   |
| 17   | **Spike:** the WebAuthn library, and a usernameless assertion             | 2–3   |
| 18   | Passkey registration, and `configure-passkey`                             | 4–5   |
| 19   | Passkey authentication as a first factor, usernameless                    | 5–6   |
| 20   | Recovery codes: generation, single use, `generate-recovery-codes`         | 3–4   |
| 21   | `update-password`: expiry, history, and the change-password action        | 3–4   |
| 22   | Brute force: migration 0034, lockout, indistinguishable refusals          | 4–5   |
| 23   | The per-IP throttle, and a maximum password length                        | 2–3   |
| 24   | **Spike:** advisory locks inside `withRealm`                              | 1–2   |
| 25   | `odudu reap`: the retention rule, and the replay-after-pass tests         | 5–6   |
| 26   | The scheduler in `apps/server`                                            | 2–3   |
| 27   | The outbox, and the reset endpoint off the request path                   | 4–5   |
| 28   | Traceability: four clause tables, their rows, and the census              | 3–4   |
| 29   | Phase close: the whole-phase documentation pass                           | 3–4   |

Total: 95–125 hours, against the spec's 95–130.

**Spike gates.** Task 11 must complete before Task 12, Task 17 before Task 18, and Task 24 before Task 26. A spike's output is a recorded finding, not code that survives.

**Task 1 lands alone**, before anything else is built on it: it touches the refresh path, which carries reuse detection.

**The seven spec items map to tasks as:** session lifecycle 1–4, logout and offline 5–6, flow engine 7–10, credentials and required actions 11–21, brute force 22–23, reaping 24–26, outbox 27. Tasks 28 and 29 close the phase.

---

### Task 1: `token_grants.session_id` — migration 0026, and a rotation that refuses a dead grant

This task lands alone and is pushed alone. It changes the refresh path, which is where reuse detection lives.

**What already exists, verified by reading it:** `packages/protocol-oidc/src/schema/token-grants.ts` declares `token_grants` with `id`, `realmId`, `clientId`, `subjectId`, `scope`, `audience`, `createdAt`, `revokedAt`. `packages/protocol-oidc/src/repository/grants.ts` exposes `create`, `revoke(id, revokedAt)` and `byId`. `packages/protocol-oidc/src/usecase/refresh-rotation.ts` fetches the grant after a successful consume and throws if it is missing. None of that is rebuilt here.

**Files:**

- Create: `packages/db/drizzle/0026_token_grants_session.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/protocol-oidc/src/schema/token-grants.ts`
- Modify: `packages/protocol-oidc/src/repository/grants.ts`
- Modify: `packages/protocol-oidc/src/usecase/refresh-rotation.ts`
- Modify: `packages/protocol-oidc/tests/grants.int.test.ts`
- Create: `packages/protocol-oidc/tests/grant-session-link.int.test.ts`

**Interfaces:**

- Consumes: `tokenGrants` table and `TokenGrantRecord` from `#/schema/token-grants`; `sessions` from `@odudu/authn-flows`
- Produces:
  - `TokenGrantRecord.sessionId: string | null`
  - `NewTokenGrant.sessionId?: string | null`
  - `tokenGrantRepository(tx).revokeForSession(sessionId: string, revokedAt: Date): Promise<number>` — returns how many grants it revoked
  - `tokenGrantRepository(tx).bySession(sessionId: string): Promise<TokenGrantRecord[]>` — read by the retention pass, which refuses to delete a session a live grant still references. Like every repository method here it needs a happy-path test **and** a foreign-`realm_id` probe, even though its first caller arrives much later.
  - `RotationOutcome` gains `{ readonly kind: 'revoked' }`

- [ ] **Step 1: Write the migration**

```sql
-- packages/db/drizzle/0026_token_grants_session.sql
-- A grant belongs to the SSO session it was issued under, or to no session
-- at all, which is what offline access is: there is nothing to expire it
-- and nothing for a logout to end. The index is what lets logout revoke a
-- session's grants in one statement rather than a scan.
ALTER TABLE token_grants ADD COLUMN session_id uuid;

-- sessions has no unique constraint on (realm_id, id): its primary key is on
-- id alone, unlike subjects, clients and token_grants. A composite foreign
-- key needs one on exactly the referenced columns, so it is added here,
-- copying the idiom those tables already use.
ALTER TABLE sessions ADD CONSTRAINT sessions_realm_id_unique UNIQUE (realm_id, id);

-- ON DELETE SET NULL is a backstop against a future writer, not the
-- mechanism. Deleting a session a live grant still references would
-- otherwise silently promote a session-bound grant to an offline one, which
-- the retention pass is required to refuse outright.
ALTER TABLE token_grants ADD CONSTRAINT token_grants_session_fk
  FOREIGN KEY (realm_id, session_id) REFERENCES sessions (realm_id, id)
  ON DELETE SET NULL;

CREATE INDEX token_grants_by_session ON token_grants (realm_id, session_id);
```

- [ ] **Step 2: Append the journal entry**

Read the last entry in `packages/db/drizzle/meta/_journal.json`, then append one with `idx` one higher, `tag` `0026_token_grants_session`, and a `when` greater than the previous entry's.

Run: `node -e "const j=require('./packages/db/drizzle/meta/_journal.json'); console.log(j.entries.at(-1))"`
Expected: the 0025 entry, whose `idx` and `when` the new one must exceed.

- [ ] **Step 3: Write the failing integration test for the link and its isolation**

```ts
// packages/protocol-oidc/tests/grant-session-link.int.test.ts
import { beforeAll, describe, expect, it } from 'vitest';
import { withRealm } from '@odudu/db';
import { sessionRepository } from '@odudu/authn-flows';
import { tokenGrantRepository } from '@odudu/protocol-oidc';
import { newId } from '@odudu/kernel';
// Setup shorthand — use the package's real harness (see Global Constraints).

describe('a grant and the session it belongs to', () => {
  let db: Awaited<ReturnType<typeof testDatabase>>;
  beforeAll(async () => {
    db = await testDatabase();
  });

  it('revokes every grant of one session and leaves an offline grant alone', async () => {
    const realm = await seedRealm(db);
    const sessionId = newId();
    await withRealm(db, realm.id, async (tx) => {
      await sessionRepository(tx).create({
        id: sessionId,
        realmId: realm.id,
        subjectId: realm.subjectId,
        expiresAt: new Date(Date.now() + 3_600_000),
      });
    });

    const [bound, offline] = await withRealm(db, realm.id, async (tx) => {
      const repository = tokenGrantRepository(tx);
      return [
        await repository.create({
          realmId: realm.id,
          clientId: realm.clientId,
          subjectId: realm.subjectId,
          scope: 'openid',
          audience: [],
          sessionId,
        }),
        await repository.create({
          realmId: realm.id,
          clientId: realm.clientId,
          subjectId: realm.subjectId,
          scope: 'openid offline_access',
          audience: [],
          sessionId: null,
        }),
      ];
    });

    const revoked = await withRealm(db, realm.id, async (tx) =>
      tokenGrantRepository(tx).revokeForSession(sessionId, new Date()),
    );
    expect(revoked).toBe(1);

    await withRealm(db, realm.id, async (tx) => {
      const repository = tokenGrantRepository(tx);
      expect((await repository.byId(bound.id))?.revokedAt).not.toBeNull();
      expect((await repository.byId(offline.id))?.revokedAt).toBeNull();
      expect((await repository.byId(offline.id))?.sessionId).toBeNull();
    });
  });

  it('cannot revoke a foreign realm’s session grants', async () => {
    const mine = await seedRealm(db);
    const theirs = await seedRealm(db);
    const sessionId = newId();
    await withRealm(db, theirs.id, async (tx) => {
      await sessionRepository(tx).create({
        id: sessionId,
        realmId: theirs.id,
        subjectId: theirs.subjectId,
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      await tokenGrantRepository(tx).create({
        realmId: theirs.id,
        clientId: theirs.clientId,
        subjectId: theirs.subjectId,
        scope: 'openid',
        audience: [],
        sessionId,
      });
    });

    const revoked = await withRealm(db, mine.id, async (tx) =>
      tokenGrantRepository(tx).revokeForSession(sessionId, new Date()),
    );
    expect(revoked).toBe(0);
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `pnpm exec vitest run --project integration grant-session-link`
Expected: FAIL — `revokeForSession is not a function`, and `sessionId` is not accepted by `create`.

- [ ] **Step 5: Widen the schema and the repository**

In `packages/protocol-oidc/src/schema/token-grants.ts`, add `sessionId: uuid('session_id')` to the table and `sessionId: string | null` to `TokenGrantRecord`. In `packages/protocol-oidc/src/repository/grants.ts`, carry it through `toRecord`, add `sessionId?: string | null` to `NewTokenGrant`, and add the two methods:

```ts
    // Logout's whole write. Returns the number revoked so a caller can tell
    // "ended a session that had grants" from "ended one that had none"
    // without a second query; an already-revoked grant is matched again and
    // simply re-stamped, which keeps this idempotent.
    async revokeForSession(sessionId: string, revokedAt: Date): Promise<number> {
      const rows = await tx
        .update(tokenGrants)
        .set({ revokedAt })
        .where(eq(tokenGrants.sessionId, sessionId))
        .returning({ id: tokenGrants.id });
      return rows.length;
    },

    async bySession(sessionId: string): Promise<TokenGrantRecord[]> {
      const rows = await tx.select().from(tokenGrants).where(eq(tokenGrants.sessionId, sessionId));
      return rows.map(toRecord);
    },
```

- [ ] **Step 6: Write the failing test for rotation refusing a revoked grant**

Add to `packages/protocol-oidc/tests/grants.int.test.ts`:

```ts
it('refuses to rotate a refresh token whose grant has been revoked', async () => {
  const realm = await seedRealm(db);
  const { grant, token } = await issueRefreshToken(db, realm);

  await withRealm(db, realm.id, async (tx) => {
    await tokenGrantRepository(tx).revoke(grant.id, new Date());
  });

  const outcome = await withRealm(db, realm.id, async (tx) =>
    rotateRefreshToken(tx, hashRefreshToken(token), new Date(), 600),
  );
  expect(outcome.kind).toBe('revoked');
});
```

`issueRefreshToken` is the existing helper in this file; if it does not yet return the grant alongside the token, widen it to do so rather than duplicating it.

- [ ] **Step 7: Run it and watch it fail**

Run: `pnpm exec vitest run --project integration grants`
Expected: FAIL — the outcome is `rotated`, because rotation does not look at `revokedAt`.

- [ ] **Step 8: Add the condition to rotation**

In `packages/protocol-oidc/src/usecase/refresh-rotation.ts`, widen `RotationOutcome` with `{ readonly kind: 'revoked' }` and, after the grant is fetched, refuse a revoked one before minting a replacement:

```ts
const grant = await tokenGrantRepository(tx).byId(consumed.grantId);
if (grant === null) {
  throw new Error(`refresh token ${presentedHash} references a nonexistent grant`);
}
// A revoked family issues nothing further. The presented token was
// consumed above and stays consumed: a logout or a detected reuse ends
// the family, and rotating one more token out of it would undo that.
if (grant.revokedAt !== null) {
  return { kind: 'revoked' };
}
```

Then handle `'revoked'` where `RotationOutcome` is consumed in `packages/protocol-oidc/src/usecase/token-issuance.ts`, answering it with the same `invalid_grant` a reused token gets — the client must not learn which happened.

- [ ] **Step 9: Run the package's whole suite**

Run: `pnpm test`
Expected: PASS. A non-exhaustive switch over `RotationOutcome` is a typecheck error, which is the point of adding a variant rather than a boolean.

- [ ] **Step 10: Open the draft pull request and push**

```bash
git add -A
git commit -m "Link a token grant to the SSO session it was issued under"
git push -u origin p2b-credentials-mfa-sessions
gh pr create --draft --title "P2b: credentials, MFA and the session lifecycle" \
  --body "Implements docs/superpowers/specs/2026-09-15-p2b-credentials-mfa-sessions-design.md. Draft for the phase; CI runs per increment.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 11: Wait for CI, then update `docs/NEXT.md`**

Run: `gh pr checks --watch`
Expected: `verify`, `container` and `commit-messages` all pass. A red build is fixed before Task 2 starts.

Then add a line to `docs/NEXT.md` recording that `token_grants.session_id` exists and what null means, and commit it.

---

### Task 2: Session lifespans — migrations 0027 and 0028, `last_active_at`, and the live-session read

**Files:**

- Create: `packages/db/drizzle/0027_sessions_last_active.sql`
- Create: `packages/db/drizzle/0028_realm_session_lifespans.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/db/src/schema/realms.ts`
- Modify: `packages/authn-flows/src/schema/sessions.ts`
- Modify: `packages/authn-flows/src/repository/sessions.ts`
- Modify: `packages/authn-flows/src/usecase/executor.ts`
- Create: `packages/authn-flows/src/service/session-liveness.ts`
- Create: `packages/authn-flows/src/service/session-liveness.test.ts`
- Create: `packages/authn-flows/tests/session-lifespan.int.test.ts`

**Interfaces:**

- Consumes: `sessions`, `SessionRecord`, `sessionRepository` from `#/schema/sessions` and `#/repository/sessions`
- Produces:
  - `SessionRecord.lastActiveAt: Date`
  - `isSessionLive(session: SessionRecord, idleSeconds: number, now: Date): boolean`
  - `sessionRepository(tx).liveById(id: string, idleSeconds: number, now: Date): Promise<SessionRecord | null>`
  - `sessionRepository(tx).touch(id: string, now: Date): Promise<void>`
  - `RealmRecord.ssoSessionIdleSeconds: number`, `RealmRecord.ssoSessionMaxSeconds: number`
  - `establishSession(tx, realmId, subjectId, maxSeconds, clock?)` — the fixed `SESSION_TTL_MS` becomes a parameter

- [ ] **Step 1: Write both migrations**

```sql
-- packages/db/drizzle/0027_sessions_last_active.sql
-- expires_at is the hard ceiling: created_at plus the realm's maximum
-- lifespan. last_active_at is the idle clock, touched on use. They are two
-- columns rather than one sliding expiry so that "idled out" and "hit its
-- ceiling" stay distinguishable after the fact, and so a session list has a
-- last-use time to show.
ALTER TABLE sessions ADD COLUMN last_active_at timestamptz;
UPDATE sessions SET last_active_at = created_at WHERE last_active_at IS NULL;
ALTER TABLE sessions ALTER COLUMN last_active_at SET NOT NULL;
ALTER TABLE sessions ALTER COLUMN last_active_at SET DEFAULT now();
```

```sql
-- packages/db/drizzle/0028_realm_session_lifespans.sql
-- Bounds are constraints rather than clamps at the point of use, for the
-- reason 0013 gives: a constraint is true of every writer there will ever
-- be, including an admin API this repository does not have yet.
ALTER TABLE realms ADD COLUMN sso_session_idle_seconds integer NOT NULL DEFAULT 1800;
ALTER TABLE realms ADD COLUMN sso_session_max_seconds integer NOT NULL DEFAULT 36000;

ALTER TABLE realms ADD CONSTRAINT realms_sso_idle_bounds
  CHECK (sso_session_idle_seconds BETWEEN 60 AND 2592000);
ALTER TABLE realms ADD CONSTRAINT realms_sso_max_bounds
  CHECK (sso_session_max_seconds BETWEEN 60 AND 2592000);

-- An idle timeout longer than the ceiling is not a lenient configuration,
-- it is a meaningless one: the ceiling would always win and the idle number
-- would never be consulted.
ALTER TABLE realms ADD CONSTRAINT realms_sso_idle_within_max
  CHECK (sso_session_idle_seconds <= sso_session_max_seconds);
```

Append two journal entries, as in Task 1 Step 2.

- [ ] **Step 2: Write the failing unit test for liveness**

```ts
// packages/authn-flows/src/service/session-liveness.test.ts
import { describe, expect, it } from 'vitest';
import { isSessionLive } from '#/service/session-liveness';

const at = (iso: string) => new Date(iso);
const session = (createdAt: string, lastActiveAt: string, expiresAt: string) => ({
  id: 's',
  realmId: 'r',
  subjectId: 'u',
  createdAt: at(createdAt),
  lastActiveAt: at(lastActiveAt),
  expiresAt: at(expiresAt),
});

describe('isSessionLive', () => {
  const idle = 1800;

  it('is live inside both windows', () => {
    const s = session('2026-09-15T10:00:00Z', '2026-09-15T11:50:00Z', '2026-09-15T20:00:00Z');
    expect(isSessionLive(s, idle, at('2026-09-15T12:00:00Z'))).toBe(true);
  });

  it('is dead once idle is exceeded, even well inside the ceiling', () => {
    const s = session('2026-09-15T10:00:00Z', '2026-09-15T10:05:00Z', '2026-09-15T20:00:00Z');
    expect(isSessionLive(s, idle, at('2026-09-15T12:00:00Z'))).toBe(false);
  });

  it('is dead past the ceiling, however recently it was used', () => {
    const s = session('2026-09-15T10:00:00Z', '2026-09-15T19:59:59Z', '2026-09-15T20:00:00Z');
    expect(isSessionLive(s, idle, at('2026-09-15T20:00:01Z'))).toBe(false);
  });

  it('treats the exact boundary as dead on both clocks', () => {
    const ceiling = session('2026-09-15T10:00:00Z', '2026-09-15T12:00:00Z', '2026-09-15T12:00:00Z');
    expect(isSessionLive(ceiling, idle, at('2026-09-15T12:00:00Z'))).toBe(false);
    const idled = session('2026-09-15T10:00:00Z', '2026-09-15T11:30:00Z', '2026-09-15T20:00:00Z');
    expect(isSessionLive(idled, idle, at('2026-09-15T12:00:00Z'))).toBe(false);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm exec vitest run --project unit session-liveness`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the evaluator**

```ts
// packages/authn-flows/src/service/session-liveness.ts
import { type SessionRecord } from '#/schema/sessions';

// Both boundaries are exclusive: a session whose ceiling is exactly now, or
// whose idle window closes exactly now, is dead. Read-time enforcement is
// what makes an expired row unredeemable regardless of whether anything has
// reaped it (ADR 0021).
export function isSessionLive(
  session: Pick<SessionRecord, 'expiresAt' | 'lastActiveAt'>,
  idleSeconds: number,
  now: Date,
): boolean {
  if (now.getTime() >= session.expiresAt.getTime()) return false;
  return now.getTime() - session.lastActiveAt.getTime() < idleSeconds * 1000;
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm exec vitest run --project unit session-liveness`
Expected: PASS, four tests.

- [ ] **Step 6: Write the failing integration test for `liveById` and `touch`**

```ts
// packages/authn-flows/tests/session-lifespan.int.test.ts
import { beforeAll, describe, expect, it } from 'vitest';
import { withRealm } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { sessionRepository } from '@odudu/authn-flows';
// Setup shorthand — use the package's real harness (see Global Constraints).

describe('session lifespans', () => {
  let db: Awaited<ReturnType<typeof testDatabase>>;
  beforeAll(async () => {
    db = await testDatabase();
  });

  const create = async (realmId: string, subjectId: string, lastActiveAt: Date) => {
    const id = newId();
    await withRealm(db, realmId, async (tx) => {
      await sessionRepository(tx).create({
        id,
        realmId,
        subjectId,
        expiresAt: new Date(Date.now() + 36_000_000),
      });
      await sessionRepository(tx).touch(id, lastActiveAt);
    });
    return id;
  };

  it('does not return an idled-out session from liveById', async () => {
    const realm = await seedRealm(db);
    const id = await create(realm.id, realm.subjectId, new Date(Date.now() - 3_600_000));
    await withRealm(db, realm.id, async (tx) => {
      expect(await sessionRepository(tx).liveById(id, 1800, new Date())).toBeNull();
      expect(await sessionRepository(tx).byId(id)).not.toBeNull();
    });
  });

  it('returns a recently used session and moves last_active_at on touch', async () => {
    const realm = await seedRealm(db);
    const id = await create(realm.id, realm.subjectId, new Date(Date.now() - 60_000));
    await withRealm(db, realm.id, async (tx) => {
      const live = await sessionRepository(tx).liveById(id, 1800, new Date());
      expect(live).not.toBeNull();
      const now = new Date();
      await sessionRepository(tx).touch(id, now);
      const after = await sessionRepository(tx).byId(id);
      expect(after?.lastActiveAt.getTime()).toBe(now.getTime());
    });
  });

  it('cannot touch or read a foreign realm’s session', async () => {
    const mine = await seedRealm(db);
    const theirs = await seedRealm(db);
    const id = await create(theirs.id, theirs.subjectId, new Date());
    await withRealm(db, mine.id, async (tx) => {
      expect(await sessionRepository(tx).liveById(id, 1800, new Date())).toBeNull();
      expect(await sessionRepository(tx).byId(id)).toBeNull();
      await sessionRepository(tx).touch(id, new Date());
    });
    await withRealm(db, theirs.id, async (tx) => {
      const untouched = await sessionRepository(tx).byId(id);
      expect(Date.now() - (untouched?.lastActiveAt.getTime() ?? 0)).toBeLessThan(60_000);
    });
  });
});
```

Note what the third test asserts: a foreign `touch` is a no-op, not an error. RLS matches zero rows, which is the same answer every other write in this package gives.

- [ ] **Step 7: Run it and watch it fail**

Run: `pnpm exec vitest run --project integration session-lifespan`
Expected: FAIL — `touch` and `liveById` do not exist.

- [ ] **Step 8: Widen the schema, the record and the repository**

Add `lastActiveAt` to `sessions` in `packages/authn-flows/src/schema/sessions.ts` and to `SessionRecord`. In `packages/authn-flows/src/repository/sessions.ts`, carry it through `toRecord` and add:

```ts
    // The read every session consumer uses. `byId` still exists and still
    // ignores liveness, because the reaper and a future session list need to
    // see a dead row; nothing that authenticates should call it.
    async liveById(id: string, idleSeconds: number, now: Date): Promise<SessionRecord | null> {
      const record = await this.byId(id);
      if (record === null) return null;
      return isSessionLive(record, idleSeconds, now) ? record : null;
    },

    async touch(id: string, now: Date): Promise<void> {
      await tx.update(sessions).set({ lastActiveAt: now }).where(eq(sessions.id, id));
    },
```

- [ ] **Step 9: Make the session lifespan a parameter**

In `packages/authn-flows/src/usecase/executor.ts`, delete the `SESSION_TTL_MS` constant and take the ceiling as an argument:

```ts
export async function establishSession(
  tx: RealmScopedDatabase,
  realmId: string,
  subjectId: string,
  maxSeconds: number,
  clock: Clock = systemClock,
): Promise<{ sessionId: string }> {
```

Add `ssoSessionIdleSeconds` and `ssoSessionMaxSeconds` to `realms` in `packages/db/src/schema/realms.ts` and to whatever record type the realm lookup produces, then pass the realm's value at the one call site in `protocol-oidc`'s login wiring. The comment explaining that a fresh id closes session fixation stays exactly as it is.

- [ ] **Step 10: Run the affected suites**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 11: Check schema drift and RLS, then commit and push**

Run: `pnpm exec vitest run --project integration`
Expected: PASS — `schema-drift.int.test.ts` is what catches a typed view that disagrees with the migration.

```bash
git add -A
git commit -m "Give a session an idle clock and a realm-configured ceiling"
git push
gh pr checks --watch
```

Then record the two new realm columns and their defaults in `docs/NEXT.md` and commit.

---

### Task 3: The cookie read at `/authorize`, and the verified-email gate it re-checks

The behaviour change a relying party can observe, and the task that closes four deferred clause rows. **The gate in Step 6 is the whole reason this task is one task and not two:** the email-verified check currently lives on the form-POST path only, and a cookie that can complete an authorization request is a second door into the same decision.

**Files:**

- Create: `packages/protocol-oidc/src/usecase/session-reuse.ts`
- Create: `packages/protocol-oidc/src/usecase/session-reuse.test.ts`
- Modify: `packages/protocol-oidc/src/usecase/authorization-request.ts`
- Modify: `packages/protocol-oidc/src/usecase/login-submission.ts`
- Modify: `packages/protocol-oidc/src/view/routes/authorize.ts`
- Modify: `packages/protocol-oidc/src/index.ts`
- Create: `packages/protocol-oidc/tests/session-reuse.int.test.ts`
- Modify: `docs/protocols/oidc-core.md`
- Modify: `docs/request-paths.md`

**Interfaces:**

- Consumes: `sessionRepository(tx).liveById` and `.touch` (Task 2); `sessionCookieName(realm, tls)` from `@odudu/authn-flows`; `handleAuthorizationRequest` and its `AuthorizeUsecaseDeps`
- Produces:
  - `decideReuse(input: ReuseInput): ReuseDecision` where `ReuseDecision` is `{ kind: 'reuse'; subjectId: string; authTime: Date } | { kind: 'authenticate' } | { kind: 'refuse'; error: string }`
  - `AuthorizeUsecaseDeps.resolveSession(realm: RealmLookup, cookieValue: string | undefined): Promise<ResolvedSession | null>` — takes the resolved realm, not its id: the caller already holds the `RealmLookup` including `ssoSessionIdleSeconds`, so passing the id alone forces a second realm read on the RLS-bypassing owner connection for every request carrying a cookie. Guard a non-UUID cookie value before it reaches the query, or a garbage cookie is a 500 rather than "no session".
  - `AuthorizationRequestOutcome` gains `{ kind: 'reused'; code: string; redirectUri: string; state: string | null }`

- [ ] **Step 1: Write the failing unit tests for the decision**

The decision is pure: given a resolved session (or none), the requested prompts and `max_age`, what happens? Every branch in the spec's behaviour table gets a case.

```ts
// packages/protocol-oidc/src/usecase/session-reuse.test.ts
import { describe, expect, it } from 'vitest';
import { decideReuse } from '#/usecase/session-reuse';

const now = new Date('2026-09-15T12:00:00Z');
const session = { subjectId: 'u1', authTime: new Date('2026-09-15T11:00:00Z') };

describe('decideReuse', () => {
  it('reuses a live session when no prompt constrains it', () => {
    expect(decideReuse({ session, prompts: new Set(), maxAge: null, now })).toEqual({
      kind: 'reuse',
      subjectId: 'u1',
      authTime: session.authTime,
    });
  });

  it('reuses under prompt=none, which is the whole point of prompt=none', () => {
    expect(decideReuse({ session, prompts: new Set(['none']), maxAge: null, now }).kind).toBe(
      'reuse',
    );
  });

  it('refuses prompt=none with no session', () => {
    expect(decideReuse({ session: null, prompts: new Set(['none']), maxAge: null, now })).toEqual({
      kind: 'refuse',
      error: 'login_required',
    });
  });

  it('authenticates afresh under prompt=login even with a live session', () => {
    expect(decideReuse({ session, prompts: new Set(['login']), maxAge: null, now }).kind).toBe(
      'authenticate',
    );
  });

  it('refuses prompt=none and prompt=login together rather than choosing one', () => {
    expect(
      decideReuse({ session, prompts: new Set(['none', 'login']), maxAge: null, now }),
    ).toEqual({ kind: 'refuse', error: 'login_required' });
  });

  it('reuses when the session is younger than max_age', () => {
    expect(decideReuse({ session, prompts: new Set(), maxAge: 7200, now }).kind).toBe('reuse');
  });

  it('reauthenticates when max_age is exceeded', () => {
    expect(decideReuse({ session, prompts: new Set(), maxAge: 1800, now }).kind).toBe(
      'authenticate',
    );
  });

  it('refuses when max_age is exceeded and prompt=none forbids the page', () => {
    expect(decideReuse({ session, prompts: new Set(['none']), maxAge: 1800, now })).toEqual({
      kind: 'refuse',
      error: 'login_required',
    });
  });

  it('treats max_age=0 as a demand to reauthenticate now', () => {
    expect(decideReuse({ session, prompts: new Set(), maxAge: 0, now }).kind).toBe('authenticate');
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm exec vitest run --project unit session-reuse`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the decision**

```ts
// packages/protocol-oidc/src/usecase/session-reuse.ts
import { type PromptValue } from '#/service/prompt';

export interface ResolvedSession {
  readonly subjectId: string;
  readonly authTime: Date;
}

export interface ReuseInput {
  readonly session: ResolvedSession | null;
  readonly prompts: ReadonlySet<PromptValue>;
  readonly maxAge: number | null;
  readonly now: Date;
}

export type ReuseDecision =
  | { readonly kind: 'reuse'; readonly subjectId: string; readonly authTime: Date }
  | { readonly kind: 'authenticate' }
  | { readonly kind: 'refuse'; readonly error: string };

// OIDC Core §3.1.2.1 and §3.1.2.3. `prompt=none` forbids any user
// interface, so whenever this would otherwise authenticate, it refuses
// instead — which is why the two are checked together rather than in
// sequence.
export function decideReuse(input: ReuseInput): ReuseDecision {
  const silent = input.prompts.has('none');
  const mustReauthenticate =
    input.prompts.has('login') ||
    (input.session !== null &&
      input.maxAge !== null &&
      input.now.getTime() - input.session.authTime.getTime() >= input.maxAge * 1000);

  if (input.session === null || mustReauthenticate) {
    return silent ? { kind: 'refuse', error: 'login_required' } : { kind: 'authenticate' };
  }
  return { kind: 'reuse', subjectId: input.session.subjectId, authTime: input.session.authTime };
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `pnpm exec vitest run --project unit session-reuse`
Expected: PASS, nine tests.

- [ ] **Step 5: Write the failing integration test, including the gate**

```ts
// packages/protocol-oidc/tests/session-reuse.int.test.ts
// Two assertions matter here beyond the happy path: an authorization code is
// issued with no page rendered, and an unverified account holding a live
// cookie is refused. The second is the one no existing test covers, because
// every existing test drives the form POST.
```

Write cases for: a live cookie producing a 302 to the client's `redirect_uri` carrying `code` and `iss`; the same request with `prompt=none` also succeeding; a realm with `verify_email` on and an unverified subject holding a live cookie being refused rather than redirected with a code; and the session's `last_active_at` having moved after a successful reuse.

- [ ] **Step 6: Move the verified-email gate so both doors call it**

`checkEmailVerification` is today reached only from `handleLoginSubmission` in `packages/protocol-oidc/src/usecase/login-submission.ts`. Extract the decision to a function both paths call, and call it from the reuse path before any code is issued:

```ts
// The gate is a property of completing a login, not of submitting a form.
// A realm requiring a verified address refuses a cookie-borne login for an
// unverified subject exactly as it refuses a password one; an unverified
// account that happens to hold a live session would otherwise sign in
// without ever passing the check.
export async function refusedForUnverifiedEmail(
  deps: Pick<LoginSubmissionDeps, 'checkEmailVerification'>,
  realm: { id: string; verifyEmail: boolean },
  subjectId: string,
): Promise<{ hasEmail: boolean } | null> {
  if (!realm.verifyEmail) return null;
  const status = await deps.checkEmailVerification(realm.id, subjectId);
  return status.verified ? null : { hasEmail: status.hasEmail };
}
```

- [ ] **Step 7: Wire the cookie read into `/authorize`**

In `packages/protocol-oidc/src/usecase/authorization-request.ts`, replace the unconditional `if (outcome.prompts.has('none')) return reject('login_required');` with the decision, keeping every constraint the reading note in `docs/protocols/oidc-core.md` records: a refusal is still a redirect, still below the §4.1.2.1 boundary, and still starts no authentication session and writes no cookie. On `reuse`, issue the code through the same `issueAuthorizationCode` the form path uses, touch the session, and return the new `reused` outcome; on `authenticate`, park the request exactly as today.

The route in `packages/protocol-oidc/src/view/routes/authorize.ts` reads the cookie by `sessionCookieName(realm, tls)` and passes its value in. It must not trust the cookie for anything but a lookup.

- [ ] **Step 8: Run the whole package suite**

Run: `pnpm test`
Expected: PASS. Existing `prompt=none` tests will need their expectations updated where they asserted the unconditional refusal — check each one is being updated because the behaviour deliberately changed, not because it broke.

- [ ] **Step 9: Close the clause rows**

In `docs/protocols/oidc-core.md`, move **three** rows from `deferred: P2` to `covered` with the test ids from this task: §2's `auth_time` MUST, §3.1.2.1's `max_age` MUST, and §15.1's `max_age` MUST.

**§3.1.2.1's `prompt=login` MUST is not closable here** and stays `deferred: P2`. "An error is returned if reauthentication cannot be performed" still has no reachable branch: this server can always render a login form, and a hint mismatch after a forced reauthentication is the `id_token_hint` rule, already held by its own row. The state where reauthentication genuinely cannot be performed arrives with the flow engine, where a realm's flow can have no applicable execution at all.

Every test id must name a test that actually exercises its clause. A test that establishes a session and then never presents it to `/authorize` is not exercising session reuse, whatever its fixture does. Give the reuse tests their own ids rather than reusing ids already carried by tests asserting the opposite outcome — `pnpm trace` requires all carriers of an id to pass, so a shared id lets a deleted test hide behind a surviving one that proves something different. Then rewrite the reading note that says "always return `login_required`" is the whole of `prompt=none` — it is now a decision, and the note should say what replaced it.

Run: `pnpm test && pnpm trace`
Expected: `pnpm trace` exits 0 with four fewer `deferred` and four more `covered`.

- [ ] **Step 10: Update the request-paths transcript**

Add a "Signing in again from an existing session" section to `docs/request-paths.md`, with every command executed against a running stack and real output pasted back — the first `/authorize` with a login, the cookie, the second `/authorize` returning a code with no page, and a `prompt=none` request succeeding.

- [ ] **Step 11: Commit, push, wait**

```bash
git add -A
git commit -m "Complete an authorization request from a live session cookie"
git push
gh pr checks --watch
```

Then update `docs/NEXT.md`.

---

### Task 4: Carry the session into the grant, and emit `sid`

**Scope corrected before implementation.** This task was written as "emit one claim from data that already exists". The data does not exist. `token_grants.session_id` is a column and `tokenGrantRepository.create` accepts it, but **nothing in the real flow ever supplies it**: the grant is created at `/token` from the `authorization_codes` row, and that table has no `session_id`, so the session id is dropped at login and gone by the time the grant exists. Both of this task's integration cases were unreachable, not only the offline one.

Threading the session through is therefore this task's work rather than a side effect of offline access — `sid` is meaningless without it, and so is a logout that revokes a session's grants. Offline access then only has to choose null over the session, which is a one-line branch on top.

**Files:**

- Create: `packages/db/drizzle/0029_authorization_codes_session.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/protocol-oidc/src/schema/authorization-codes.ts`
- Modify: `packages/protocol-oidc/src/repository/codes.ts`
- Modify: `packages/protocol-oidc/src/usecase/login-submission.ts`
- Modify: `packages/protocol-oidc/src/index.ts`
- Modify: `packages/protocol-oidc/src/usecase/token-issuance.ts`
- Modify: `packages/protocol-oidc/src/service/token-claims.ts`
- Create: `packages/protocol-oidc/tests/sid-claim.int.test.ts`
- Modify: `docs/protocols/oidc-backchannel.md` (created in Task 28; if this task runs first, create the file with this one row and let Task 28 fill it out)

**Interfaces:**

- Consumes: `TokenGrantRecord.sessionId`, and the session id that `completeLogin` and `completeReuse` both already hold
- Produces:
  - `authorization_codes.session_id`, nullable, carried from the login that minted the code to the grant redeemed from it
  - `AuthorizationCodeRecord.sessionId: string | null` and `IssueAuthorizationCodeInput.sessionId`
  - `tokenGrantRepository.create` actually receiving a `sessionId` on the `authorization_code` path
  - `sid` present in both tokens for a session-bound grant, absent for an offline one

- [ ] **Step 0: Write the migration that lets the session reach the grant**

```sql
-- packages/db/drizzle/0029_authorization_codes_session.sql
-- A grant is created when a code is redeemed, so the session the login
-- established has to travel on the code or it is lost in between. Nullable
-- because a code issued for an offline grant belongs to no session, and
-- because any code in flight when this ships has none.
ALTER TABLE authorization_codes ADD COLUMN session_id uuid;
```

No foreign key: a code references a session only as a label to copy forward, and a code redeemed after its session was reaped must still redeem. Append the journal entry.

- [ ] **Step 1: Write the failing integration test**

```ts
// packages/protocol-oidc/tests/sid-claim.int.test.ts
import { describe, expect, it } from 'vitest';
import { decodeJwt } from 'jose';

describe('the sid claim', () => {
  it('carries the session id in both the access token and the ID token', async () => {
    const { accessToken, idToken, sessionId } = await completeAuthorizationCodeFlow();
    expect(decodeJwt(accessToken).sid).toBe(sessionId);
    expect(decodeJwt(idToken).sid).toBe(sessionId);
  });

  it('omits sid entirely for an offline grant, which has no session', async () => {
    const { accessToken } = await completeOfflineFlow();
    expect(decodeJwt(accessToken)).not.toHaveProperty('sid');
  });

  it('keeps sid stable across a refresh', async () => {
    const first = await completeAuthorizationCodeFlow();
    const refreshed = await refresh(first.refreshToken);
    expect(decodeJwt(refreshed.accessToken).sid).toBe(first.sessionId);
  });
});
```

The second case depends on Task 6 and may be written as a skipped test here and unskipped there — say so in the commit message rather than leaving a silent `it.skip`.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm exec vitest run --project integration sid-claim`
Expected: FAIL — `sid` is undefined.

- [ ] **Step 3: Emit it**

`sid` is not a scope-gated identity claim and does not go through `ClaimMapperRegistry`: it is a property of the grant, like `aud`. Add it to the envelope both tokens are assembled from in `packages/protocol-oidc/src/usecase/token-issuance.ts`, sourced from `grant.sessionId`, omitted when null.

```ts
// OpenID Connect Back-Channel Logout 1.0 §2.1: an opaque identifier for the
// End-User's session at this OP. Emitted so a resource server's
// introspection and, later, a logout addressed to a client can both name the
// session; absent on an offline grant, which by definition has none.
...(grant.sessionId !== null ? { sid: grant.sessionId } : {}),
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm exec vitest run --project integration sid-claim`
Expected: PASS (the offline case skipped until Task 6).

- [ ] **Step 5: Check the registered-claims precedence rule still holds**

`withRegisteredClaimsWinning` in `packages/protocol-oidc/src/service/token-claims.ts` exists so a mapper cannot overwrite an envelope claim. Add a unit test that a mapper emitting `sid` cannot displace the grant's value.

Run: `pnpm exec vitest run --project unit token-claims`
Expected: PASS.

- [ ] **Step 6: Commit and push**

```bash
git add -A
git commit -m "Emit sid so a session can be named by a token"
git push
gh pr checks --watch
```

Then update `docs/NEXT.md`.

---

### Task 5: `end_session_endpoint` — migration 0029, the confirmation page, the revocation

**Files:**

- Create: `packages/db/drizzle/0029_client_post_logout_redirect_uris.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/protocol-oidc/src/schema/client-oidc-config.ts`
- Modify: `packages/protocol-oidc/src/repository/client-oidc-config.ts`
- Create: `packages/protocol-oidc/src/usecase/logout.ts`
- Create: `packages/protocol-oidc/src/usecase/logout.test.ts`
- Create: `packages/protocol-oidc/src/view/logout-html.ts`
- Create: `packages/protocol-oidc/src/view/routes/logout.ts`
- Modify: `packages/protocol-oidc/src/usecase/discovery.ts`
- Create: `packages/protocol-oidc/tests/logout.int.test.ts`
- Modify: `docs/request-paths.md`, `README.md`

**Interfaces:**

- Consumes: `tokenGrantRepository(tx).revokeForSession` (Task 1); `sessionRepository(tx).liveById` (Task 2); `subjectOfIdTokenHint`'s validation approach in `#/usecase/authorization-request.ts`
- Produces:
  - `decideLogout(input: LogoutInput): LogoutDecision` — `{ kind: 'confirm' } | { kind: 'end'; redirectTo: string | null } | { kind: 'render'; error: string }`
  - `clientOidcConfigRepository(tx).postLogoutRedirectUris(clientId: string): Promise<readonly string[]>`
  - `end_session_endpoint` in the discovery document

- [ ] **Step 1: Write the migration**

```sql
-- packages/db/drizzle/0029_client_post_logout_redirect_uris.sql
-- RP-Initiated Logout §3: the OP MUST NOT perform post-logout redirection if
-- the supplied post_logout_redirect_uri does not exactly match one of the
-- registered values. An endpoint that redirects where it cannot validate is
-- an open redirector, so the registration lands with the endpoint that reads
-- it rather than with the rest of the client metadata.
ALTER TABLE client_oidc_config
  ADD COLUMN post_logout_redirect_uris text[] NOT NULL DEFAULT '{}';
```

Append the journal entry.

- [ ] **Step 2: Write the failing unit tests for the decision**

```ts
// packages/protocol-oidc/src/usecase/logout.test.ts
import { describe, expect, it } from 'vitest';
import { decideLogout } from '#/usecase/logout';

const registered = ['https://app.example/after-logout'];

describe('decideLogout', () => {
  it('confirms when there is no id_token_hint', () => {
    expect(
      decideLogout({ hintSubject: null, sessionSubject: 'u1', requested: null, registered }),
    ).toEqual({ kind: 'confirm' });
  });

  it('confirms when the hint names somebody other than the current session', () => {
    expect(
      decideLogout({ hintSubject: 'u2', sessionSubject: 'u1', requested: null, registered }),
    ).toEqual({ kind: 'confirm' });
  });

  it('ends without confirmation when the hint matches the session', () => {
    expect(
      decideLogout({ hintSubject: 'u1', sessionSubject: 'u1', requested: null, registered }),
    ).toEqual({ kind: 'end', redirectTo: null });
  });

  it('redirects to an exactly matching registered uri', () => {
    expect(
      decideLogout({
        hintSubject: 'u1',
        sessionSubject: 'u1',
        requested: 'https://app.example/after-logout',
        registered,
      }),
    ).toEqual({ kind: 'end', redirectTo: 'https://app.example/after-logout' });
  });

  it.each([
    ['https://app.example/after-logout/'],
    ['https://app.example/after-logout?x=1'],
    ['https://APP.example/after-logout'],
    ['https://evil.example/after-logout'],
  ])('renders rather than redirecting to %s', (requested) => {
    expect(
      decideLogout({ hintSubject: 'u1', sessionSubject: 'u1', requested, registered }),
    ).toEqual({ kind: 'render', error: 'invalid_request' });
  });

  it('still ends the session when the requested uri is unusable', () => {
    // The session ends either way; only the redirect is refused. A logout
    // that silently kept the session alive because the return URL was wrong
    // would be the worse failure.
    const decision = decideLogout({
      hintSubject: 'u1',
      sessionSubject: 'u1',
      requested: 'https://evil.example/x',
      registered,
    });
    expect(decision.kind).toBe('render');
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm exec vitest run --project unit logout`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the decision and the page**

`decideLogout` is exact string comparison against the registered list — no normalization, no case folding, because §3 says _exactly match_. The confirmation page in `view/logout-html.ts` follows the framing defence ADR 0018 already established for rendered pages and carries the same single-use hidden field the login form uses; its POST target is the same endpoint.

Where the decision is `render` with an unusable redirect, the session is still ended and the page says so.

- [ ] **Step 5: Write the failing integration test**

Cases: a `GET` with a matching hint and a registered URI ends the session and 302s there; the session row is no longer live afterwards; `token_grants` rows for that session carry `revoked_at`; an offline grant for the same subject does **not**; a refresh of a revoked session-bound token is refused with `invalid_grant`; a `GET` with no hint renders a confirmation page and ends nothing until the form is posted; and a `GET` from a different realm's session id ends nothing.

- [ ] **Step 6: Implement the route and the revocation**

One transaction: end the session, then `revokeForSession`. Order matters only for readability — both are in the same `withRealm` call, so a failure rolls both back.

- [ ] **Step 7: Advertise it in discovery**

Add `end_session_endpoint` to `packages/protocol-oidc/src/usecase/discovery.ts` and a `tests/docs/` assertion that the document advertises it, so the README claim and the served document cannot drift.

- [ ] **Step 8: Run everything**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 9: Document it, in the words the spec fixes**

`docs/request-paths.md` gains a logout transcript, run live. `README.md` gains a logout section stating plainly that logout revokes grants and sessions and **not** access tokens, that an access token stays valid until its `exp`, and that a deployment needing revocation inside that window uses introspection when P3 ships it.

- [ ] **Step 10: Commit, push, wait**

```bash
git add -A
git commit -m "End an SSO session through end_session_endpoint"
git push
gh pr checks --watch
```

Then update `docs/NEXT.md`.

---

### Task 6: `offline_access` — a grant with no session

**Files:**

- Modify: `packages/domain-realm/src/usecase/provision-defaults.ts`
- Modify: `packages/protocol-oidc/src/usecase/token-issuance.ts`
- Modify: `packages/protocol-oidc/src/usecase/refresh-rotation.ts`
- Create: `packages/protocol-oidc/tests/offline-access.int.test.ts`
- Modify: `packages/protocol-oidc/tests/sid-claim.int.test.ts`
- Modify: `docs/protocols/oidc-core.md`, `docs/request-paths.md`

**Interfaces:**

- Consumes: `DEFAULT_SCOPES` and `REALM_DEFAULT_SCOPE_NAMES` from `provision-defaults.ts`; `TokenGrantRecord.sessionId`
- Produces: `offline_access` in a realm's default scope vocabulary; a grant whose `sessionId` is null when it is requested and granted

- [ ] **Step 1: Write the failing integration test**

```ts
// packages/protocol-oidc/tests/offline-access.int.test.ts
describe('offline access', () => {
  it('issues a grant with no session when offline_access is requested and assigned', async () => {
    const { grant } = await completeFlow({ scope: 'openid offline_access' });
    expect(grant.sessionId).toBeNull();
  });

  it('leaves the offline grant refreshable after the session is logged out', async () => {
    const { offlineRefreshToken, boundRefreshToken, sessionId } = await completeBothFlows();
    await logout(sessionId);
    await expect(refresh(boundRefreshToken)).rejects.toMatchObject({ error: 'invalid_grant' });
    await expect(refresh(offlineRefreshToken)).resolves.toMatchObject({ token_type: 'Bearer' });
  });

  it('leaves the offline grant refreshable after the session idles out', async () => {
    const { offlineRefreshToken } = await completeFlow({ scope: 'openid offline_access' });
    await idleOutEverySession();
    await expect(refresh(offlineRefreshToken)).resolves.toMatchObject({ token_type: 'Bearer' });
  });

  it('refuses a session-bound refresh once the session is no longer live', async () => {
    const { refreshToken } = await completeFlow({ scope: 'openid' });
    await idleOutEverySession();
    await expect(refresh(refreshToken)).rejects.toMatchObject({ error: 'invalid_grant' });
  });

  it('does not issue an offline grant when the client was never assigned the scope', async () => {
    const { grant, scope } = await completeFlow({
      scope: 'openid offline_access',
      assign: ['openid'],
    });
    expect(scope).toBe('openid');
    expect(grant.sessionId).not.toBeNull();
  });
});
```

The fourth case is the one that makes the third meaningful: if a session-bound refresh also survived, the offline test would be asserting nothing.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm exec vitest run --project integration offline-access`
Expected: FAIL — `offline_access` is not a scope the realm defines, so `resolveScope` drops it.

- [ ] **Step 3: Seed the scope**

Add `{ name: 'offline_access', includeInAccessToken: false, includeInIdToken: false }` to `DEFAULT_SCOPES`. It maps no claims — it is a request for a grant shape, not for data — so no claim mapper is registered for it, and the comment above `DEFAULT_SCOPES` (which says a scope is seeded only once a mapper can answer for it) needs one added sentence saying why this one is the exception.

- [ ] **Step 4: Issue the grant without a session**

The session is already carried from the login onto the code and into the grant. So this step is the branch that overrides it: when the resolved scope contains `offline_access`, create the grant with `sessionId: null` whatever the code carries; otherwise pass the code's `session_id` through unchanged. The resolved scope is the authority — never the raw request.

- [ ] **Step 5: Refuse a session-bound refresh whose session has died**

In `refresh-rotation.ts`, after the revoked check from Task 1, add the liveness condition:

```ts
// A session-bound family lives exactly as long as its session: an idle
// timeout that a refresh could out-live would not be an idle timeout. An
// offline family has no session and is therefore bounded only by its own
// TTL and by retention.
if (grant.sessionId !== null) {
  const session = await sessionRepository(tx).liveById(grant.sessionId, idleSeconds, now);
  if (session === null) return { kind: 'revoked' };
  await sessionRepository(tx).touch(grant.sessionId, now);
}
```

`idleSeconds` becomes a parameter of `rotateRefreshToken`, sourced from the realm. Note the `touch`: a refresh is session activity, which is the spec's §3.1 rule and the reason a client refreshing every five minutes keeps a session alive.

- [ ] **Step 6: Unskip the offline `sid` case**

Remove the skip from the second test in `sid-claim.int.test.ts` and confirm it passes: an offline grant has no `sid`.

- [ ] **Step 7: Run everything**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 8: Close the scope row and document it**

`docs/protocols/oidc-core.md` has an `offline_access` row; close it with the test id. Add a `docs/request-paths.md` section showing an offline grant surviving a logout, run live.

- [ ] **Step 9: Commit, push, wait**

```bash
git add -A
git commit -m "Grant offline access as a session-less grant"
git push
gh pr checks --watch
```

Then update `docs/NEXT.md`.

---

### Task 7: `authentication_executions` — migration 0030 and realm provisioning

**Files:**

- Create: `packages/db/drizzle/0030_authentication_executions.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Create: `packages/authn-flows/src/schema/execution.ts`
- Create: `packages/authn-flows/src/repository/executions.ts`
- Modify: `packages/authn-flows/src/index.ts`
- Modify: `packages/domain-realm/src/usecase/provision-defaults.ts`
- Create: `packages/authn-flows/tests/executions.int.test.ts`

**Interfaces:**

- Produces:
  - `AuthenticationExecutionRecord { id, realmId, index, authenticator, requirement }`
  - `Requirement = 'required' | 'alternative' | 'conditional' | 'disabled'`
  - `executionRepository(tx).forRealm(realmId): Promise<AuthenticationExecutionRecord[]>` — ordered by `index`
  - `executionRepository(tx).create(input): Promise<void>`
  - `provisionBrowserFlow(tx, realmId): Promise<void>`
  - `BROWSER_FLOW_DEFAULT: readonly { authenticator: string; requirement: Requirement }[]`

- [ ] **Step 1: Write the migration**

```sql
-- packages/db/drizzle/0030_authentication_executions.sql
-- One flat, ordered list of executions per realm. Alternatives at adjacent
-- indexes form one group, which is how a single level expresses "passkey or
-- password" without a tree; nesting is not modelled because nothing can
-- author it until there is an admin surface.
CREATE TABLE authentication_executions (
  id uuid PRIMARY KEY,
  realm_id uuid NOT NULL REFERENCES realms (id) ON DELETE CASCADE,
  index integer NOT NULL,
  authenticator text NOT NULL,
  requirement text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT authentication_executions_requirement CHECK (
    requirement IN ('required', 'alternative', 'conditional', 'disabled')
  ),
  CONSTRAINT authentication_executions_order UNIQUE (realm_id, index)
);

ALTER TABLE authentication_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE authentication_executions FORCE ROW LEVEL SECURITY;

CREATE POLICY authentication_executions_isolation ON authentication_executions
  USING (realm_id = current_setting('odudu.realm_id', true)::uuid)
  WITH CHECK (realm_id = current_setting('odudu.realm_id', true)::uuid);
```

Copy the exact `current_setting` spelling from an existing migration rather than from this plan — `packages/db/drizzle/0006_sessions.sql` is the nearest model — so the policy matches what `withRealm` sets.

Append the journal entry.

- [ ] **Step 2: Write the failing integration test**

Cases: a freshly provisioned realm has exactly the three default executions in index order; a foreign realm's executions are invisible to `forRealm`; a duplicate `(realm_id, index)` is refused; and an unknown `requirement` value is refused by the CHECK.

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm exec vitest run --project integration executions`
Expected: FAIL — table does not exist.

- [ ] **Step 4: Write the schema, the record and the repository**

`index` is a reserved-ish word in some dialects but legal in Postgres as an unquoted column name; if Drizzle's builder objects, name the column `index` in SQL and the property `index` in TypeScript with an explicit `integer('index')`, which is the existing convention for every other column.

- [ ] **Step 5: Provision the default flow**

```ts
// packages/authn-flows/src/usecase/provision-flow.ts
// A passkey or a password gets a user through the first group; the OTP step
// applies only where the subject has enrolled one or the realm demands it,
// and never after a passkey, which is already two factors.
export const BROWSER_FLOW_DEFAULT = [
  { authenticator: 'passkey', requirement: 'alternative' },
  { authenticator: 'password', requirement: 'alternative' },
  { authenticator: 'otp', requirement: 'conditional' },
] as const satisfies readonly { authenticator: string; requirement: Requirement }[];
```

Call it from `provisionRealmDefaults`, beside the client-scope seeding, so a realm is never left without a flow — the same argument that comment already makes about a scope vocabulary.

- [ ] **Step 6: Run it and watch it pass**

Run: `pnpm exec vitest run --project integration executions && pnpm exec vitest run --project integration`
Expected: PASS, including `rls-policy.int.test.ts` finding the new table has a policy.

- [ ] **Step 7: Commit, push, wait**

```bash
git add -A
git commit -m "Give a realm an ordered list of authentication executions"
git push
gh pr checks --watch
```

Then update `docs/NEXT.md`.

---

### Task 8: The requirement evaluator, as a pure function

The part most likely to be subtly wrong and the cheapest to test in isolation. No `tx`, no repository, no clock, no authenticator.

**Files:**

- Create: `packages/authn-flows/src/service/requirements.ts`
- Create: `packages/authn-flows/src/service/requirements.test.ts`

**Interfaces:**

- Consumes: `Requirement` from `#/schema/execution`
- Produces:
  - `nextStep(executions: readonly Step[], state: FlowState): NextStep`
  - `Step { authenticator: string; requirement: Requirement; applicable: boolean }`
  - `FlowState { satisfied: ReadonlySet<string> }`
  - `NextStep = { kind: 'run'; authenticator: string } | { kind: 'complete' } | { kind: 'fail' }`

- [ ] **Step 1: Write the failing unit tests**

```ts
// packages/authn-flows/src/service/requirements.test.ts
import { describe, expect, it } from 'vitest';
import { nextStep } from '#/service/requirements';

const step = (authenticator: string, requirement: string, applicable = true) =>
  ({ authenticator, requirement, applicable }) as Parameters<typeof nextStep>[0][number];

const flow = [
  step('passkey', 'alternative'),
  step('password', 'alternative'),
  step('otp', 'conditional'),
];

const state = (...satisfied: string[]) => ({ satisfied: new Set(satisfied) });

describe('nextStep', () => {
  it('offers the first alternative of a fresh flow', () => {
    expect(nextStep(flow, state())).toEqual({ kind: 'run', authenticator: 'passkey' });
  });

  it('treats one satisfied alternative as satisfying the whole group', () => {
    expect(nextStep(flow, state('password'))).toEqual({ kind: 'run', authenticator: 'otp' });
  });

  it('completes when the conditional step is not applicable', () => {
    const noOtp = [flow[0], flow[1], step('otp', 'conditional', false)];
    expect(nextStep(noOtp, state('password'))).toEqual({ kind: 'complete' });
  });

  it('completes once every group and applicable step is satisfied', () => {
    expect(nextStep(flow, state('password', 'otp'))).toEqual({ kind: 'complete' });
  });

  it('skips a disabled step entirely', () => {
    const disabled = [step('passkey', 'disabled'), step('password', 'alternative')];
    expect(nextStep(disabled, state())).toEqual({ kind: 'run', authenticator: 'password' });
  });

  it('requires every required step, with no grouping', () => {
    const required = [step('password', 'required'), step('otp', 'required')];
    expect(nextStep(required, state('password'))).toEqual({ kind: 'run', authenticator: 'otp' });
    expect(nextStep(required, state('password', 'otp'))).toEqual({ kind: 'complete' });
  });

  it('groups only adjacent alternatives, so a required step between them splits the group', () => {
    const split = [
      step('passkey', 'alternative'),
      step('password', 'required'),
      step('recovery-code', 'alternative'),
    ];
    // Satisfying the first group does not satisfy the second.
    expect(nextStep(split, state('passkey'))).toEqual({ kind: 'run', authenticator: 'password' });
    expect(nextStep(split, state('passkey', 'password'))).toEqual({
      kind: 'run',
      authenticator: 'recovery-code',
    });
  });

  it('fails a flow with no applicable step at all rather than completing it', () => {
    const none = [step('passkey', 'alternative', false), step('password', 'alternative', false)];
    expect(nextStep(none, state())).toEqual({ kind: 'fail' });
  });

  it('fails an empty flow', () => {
    expect(nextStep([], state())).toEqual({ kind: 'fail' });
  });
});
```

The last two cases are the ones that stop a misconfigured realm from logging everybody in with no credential at all — an empty or wholly inapplicable flow must fail, never complete.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm exec vitest run --project unit requirements`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the evaluator**

Walk the list once, partitioning it into groups: a run of adjacent `alternative` steps is one group, and every other step is a group of its own. A group is satisfied when any member is satisfied (alternatives) or when its single member is satisfied or inapplicable. Return the first unsatisfied group's first applicable member; `complete` when every group is satisfied; `fail` when a group has no applicable member left to offer, and when there are no groups at all.

- [ ] **Step 4: Run them and watch them pass**

Run: `pnpm exec vitest run --project unit requirements`
Expected: PASS, nine tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Decide the next authentication step from a flat list of requirements"
git push
gh pr checks --watch
```

---

### Task 9: The executor runs the registry, and a multi-step login resumes

**Files:**

- Modify: `packages/authn-flows/src/usecase/executor.ts`
- Modify: `packages/authn-flows/src/schema/authenticator.ts`
- Modify: `packages/authn-flows/src/schema/authentication-sessions.ts`
- Modify: `packages/authn-flows/src/repository/authentication-sessions.ts`
- Create: `packages/db/drizzle/0031_authentication_sessions_progress.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/protocol-oidc/src/view/authorize-html.ts`
- Create: `packages/authn-flows/tests/multi-step.int.test.ts`

**Interfaces:**

- Consumes: `nextStep` (Task 8), `executionRepository(tx).forRealm` (Task 7)
- Produces:
  - `AuthenticatorResult`'s challenge widens: `{ kind: 'challenge'; form: string }`
  - `AuthenticationSessionRecord.satisfied: string[]`
  - `authenticationSessionRepository(tx).recordSatisfied(id, authenticator): Promise<void>`
  - `AUTHENTICATORS: Record<string, AuthenticatorFn>` keyed by the `authenticator` column, with an unknown name failing at startup

- [ ] **Step 1: Write the migration for progress**

```sql
-- packages/db/drizzle/0031_authentication_sessions_progress.sql
-- Which executions this authentication has already satisfied. A multi-step
-- login has to resume rather than restart: a correct password followed by a
-- wrong OTP code must not ask for the password again.
ALTER TABLE authentication_sessions
  ADD COLUMN satisfied text[] NOT NULL DEFAULT '{}';
```

- [ ] **Step 2: Write the failing integration test**

Cases: a password success on a realm whose subject has TOTP enrolled returns a `challenge` for the OTP form rather than a success; the satisfied list then contains `password`; a wrong OTP code leaves `password` satisfied and re-challenges OTP only; a correct OTP code returns success; and an expired authentication session still returns `authentication_session_expired` unchanged.

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm exec vitest run --project integration multi-step`
Expected: FAIL — `advance` runs `STEPS[0]` and nothing else.

- [ ] **Step 4: Replace `STEPS` with the registry**

Delete the `STEPS` constant and the `StepName` type. `AUTHENTICATORS` becomes keyed by string, and `advance` loads the realm's executions, asks each authenticator whether it is applicable to this subject, calls `nextStep`, and dispatches. Every authenticator name in a row must resolve in the registry; an unresolvable one throws at startup when the flow is provisioned, not at login.

`advance()`'s signature does not change. The P1 comment promising that P2 replaces the list "without changing what a caller of `advance` sees" is now fulfilled and should be deleted rather than left describing a future that has arrived.

- [ ] **Step 5: Widen the challenge form and render it**

`form: 'password'` becomes `form: string`, and `authorize-html.ts` renders the form the challenge names. The hidden `auth_session_id` field — the login form's whole CSRF defence — is on every form, not just the password one.

- [ ] **Step 6: Close §3.1.2.1's `prompt=login` MUST, which now has a reachable branch**

A realm whose flow has no applicable execution is the state in which reauthentication cannot be performed: `nextStep` returns `fail` for it. Under `prompt=login` that must be answered `login_required` at the `redirect_uri` — not a rendered page, and nothing persisted. Write that test, move `OIDC-CORE-3.1.2.1-11` from `deferred: P2` to `covered` against it, and drop the `oidc-core.md` count in `tools/trace/silenced-musts.json` by one.

Run: `pnpm trace`
Expected: exit 0, one fewer `deferred`, one more `covered`.

- [ ] **Step 7: Run the suites**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 8: Commit, push, wait**

```bash
git add -A
git commit -m "Run a realm's authentication executions in order, resuming across steps"
git push
gh pr checks --watch
```

Then update `docs/NEXT.md`.

---

### Task 10: `acr` and `amr` from the executions that actually ran

**Files:**

- Modify: `packages/authn-flows/src/usecase/executor.ts`
- Modify: `packages/authn-flows/src/schema/sessions.ts`
- Create: `packages/db/drizzle/0032_sessions_authenticators.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/protocol-oidc/src/usecase/token-issuance.ts`
- Create: `packages/protocol-oidc/src/service/acr.ts`
- Create: `packages/protocol-oidc/src/service/acr.test.ts`
- Create: `packages/protocol-oidc/tests/amr-claim.int.test.ts`
- Modify: `docs/protocols/oidc-core.md`

**Interfaces:**

- Produces:
  - `SessionRecord.authenticators: string[]` — what satisfied the flow, in the order it ran
  - `amrFor(authenticators: readonly string[]): string[]` — IANA Authentication Method Reference values
  - `acrFor(authenticators: readonly string[]): string` — `'1'` for a single factor, `'2'` for two

- [ ] **Step 1: Write the migration**

```sql
-- packages/db/drizzle/0032_sessions_authenticators.sql
-- What actually authenticated this session, in the order it ran. `amr` and
-- `acr` are statements about a specific login, so they are recorded when it
-- happens rather than re-derived later from what the subject could have used.
ALTER TABLE sessions ADD COLUMN authenticators text[] NOT NULL DEFAULT '{}';
```

- [ ] **Step 2: Write the failing unit tests for the mapping**

```ts
// packages/protocol-oidc/src/service/acr.test.ts
import { describe, expect, it } from 'vitest';
import { acrFor, amrFor } from '#/service/acr';

describe('amrFor', () => {
  it('maps each authenticator to its registered RFC 8176 value', () => {
    expect(amrFor(['password'])).toEqual(['pwd']);
    expect(amrFor(['otp'])).toEqual(['otp']);
    expect(amrFor(['passkey'])).toEqual(['hwk', 'user']);
    expect(amrFor(['recovery-code'])).toEqual(['otp']);
  });

  it('de-duplicates and keeps a stable order for a multi-factor login', () => {
    expect(amrFor(['password', 'otp'])).toEqual(['otp', 'pwd']);
  });

  it('omits an authenticator with no registered value rather than inventing one', () => {
    expect(amrFor(['password', 'something-local'])).toEqual(['pwd']);
  });
});

describe('acrFor', () => {
  it('is 1 for one factor and 2 for two', () => {
    expect(acrFor(['password'])).toBe('1');
    expect(acrFor(['password', 'otp'])).toBe('2');
  });

  it('is 2 for a passkey alone, which is already two factors', () => {
    expect(acrFor(['passkey'])).toBe('2');
  });
});
```

The third `amrFor` case is the clause row talking: §2's MUST is that a registered name is not used with a different meaning, and the way to hold it is to emit nothing rather than guess.

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm exec vitest run --project unit acr`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the mapping**

Values come from the IANA Authentication Method Reference Values registry (RFC 8176). Record the exact registry entries consulted in a `docs/protocols/` reading note, with the date, because "these are the registered names" is a claim about a registry rather than about this code.

- [ ] **Step 5: Record the authenticators and emit the claims**

`establishSession` takes the satisfied list and stores it. `token-issuance.ts` reads the session behind the grant and emits `amr` and `acr` on the ID token; `acr` also goes on the access token only if a row in the clause table says it should, which it does not — check before adding it.

- [ ] **Step 6: Write and run the integration test**

A password-only login yields `"amr": ["pwd"], "acr": "1"`; a password-plus-OTP login yields `["otp","pwd"]` and `"2"`; a passkey login yields `["hwk","user"]` and `"2"`.

Run: `pnpm exec vitest run --project integration amr-claim`
Expected: PASS.

- [ ] **Step 7: Close the three clause rows**

§2's `acr` SHOULD, §2's `acr` MUST and §2's `amr` SHOULD move from `deferred: P2` to `covered`.

Run: `pnpm test && pnpm trace`
Expected: exit 0, three fewer `deferred`.

- [ ] **Step 8: Commit, push, wait**

```bash
git add -A
git commit -m "State acr and amr from the authenticators that ran"
git push
gh pr checks --watch
```

Then update `docs/NEXT.md`. At this point **every one of the eight `deferred: P2` rows except RFC 6749 §2.3.1 is closed** — record that in `docs/NEXT.md` explicitly, because it is the phase's traceability midpoint.

---

### Task 11: Spike — converting `secret_data` to `jsonb` on a seeded database

A spike's output is an answer, not code you keep. Anything built here is throwaway; the deliverable is a recorded finding.

**The assumption under test:** that `ALTER TABLE user_credentials ALTER COLUMN secret_data TYPE jsonb USING …` converts existing Argon2id PHC strings into `{"hash": "<string>"}` without mangling them, and that a login against a pre-existing password still succeeds afterwards. A PHC string contains `$`, `+`, `/` and `=`; `to_jsonb(text)` produces a JSON _string_ rather than an object, so the `USING` expression has to build the object explicitly. Getting this wrong silently destroys every password in a deployment.

**Files:**

- Create: `docs/superpowers/p2b-spike-log.md`
- Create (throwaway): `/tmp/jsonb-spike/` — outside the repository

**Interfaces:**

- Produces: a finding under `## user_credentials.secret_data to jsonb`, stating either `verified: <the exact USING expression>` or the failure and what it cost.

- [ ] **Step 1: Stand up a database with a real password row**

```bash
mkdir -p /tmp/jsonb-spike && cd /tmp/jsonb-spike
docker run -d --name jsonb-spike -e POSTGRES_PASSWORD=spike -p 55432:5432 postgres:17
sleep 3
```

- [ ] **Step 2: Create the table as migration 0005 leaves it, with three awkward rows**

```bash
docker exec -i jsonb-spike psql -U postgres <<'SQL'
CREATE TABLE user_credentials (
  id uuid PRIMARY KEY,
  type text NOT NULL,
  secret_data text NOT NULL
);
INSERT INTO user_credentials VALUES
  (gen_random_uuid(), 'password',
   '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQrLy8=$aGFzaHZhbHVlL3dpdGgrc2xhc2hlcw=='),
  (gen_random_uuid(), 'password', '$argon2id$v=19$m=19456,t=2,p=1$YQ==$"quoted"\backslash'),
  (gen_random_uuid(), 'password', '$argon2id$v=19$m=1$Yg==$ends-with-brace}');
SQL
```

- [ ] **Step 3: Run the conversion and read the rows back**

```bash
docker exec -i jsonb-spike psql -U postgres <<'SQL'
ALTER TABLE user_credentials
  ALTER COLUMN secret_data TYPE jsonb
  USING jsonb_build_object('hash', secret_data);
SELECT secret_data, secret_data->>'hash' AS extracted FROM user_credentials;
SQL
```

The answer is **yes** if `extracted` is byte-identical to each original string for all three rows. Compare them character by character, not by eye: add a query that asserts it.

```bash
docker exec -i jsonb-spike psql -U postgres -c \
  "SELECT count(*) FROM user_credentials WHERE secret_data->>'hash' LIKE '\$argon2id\$%';"
```

Expected: `3`.

- [ ] **Step 4: Record the finding**

Create `docs/superpowers/p2b-spike-log.md` with a `## user_credentials.secret_data to jsonb` section giving the exact commands, the output verbatim, and the one-sentence conclusion — including the `USING` expression Task 12 must use. Write what happened, not what was hoped for.

- [ ] **Step 5: Tear the probe down**

```bash
docker rm -f jsonb-spike && rm -rf /tmp/jsonb-spike
```

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/p2b-spike-log.md
git commit -m "Establish how secret_data converts to jsonb without mangling a PHC string"
git push
gh pr checks --watch
```

---

### Task 12: `user_credentials` widened — migration 0033 and per-type secrets

**Gated by Task 11.** Use the `USING` expression the spike recorded, not the one in this plan, if they differ.

**Files:**

- Create: `packages/db/drizzle/0033_user_credentials_types.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/domain-identity/src/schema/user-credentials.ts`
- Modify: `packages/domain-identity/src/repository/credentials.ts`
- Create: `packages/domain-identity/src/service/credential-secret.ts`
- Create: `packages/domain-identity/src/service/credential-secret.test.ts`
- Create: `packages/domain-identity/tests/credential-types.int.test.ts`

**Interfaces:**

- Produces:
  - `CredentialType = 'password' | 'totp' | 'webauthn' | 'recovery-code' | 'password-history'`
  - `CredentialSecret` — a discriminated union, with `parseCredentialSecret(type, value: unknown): CredentialSecret`
  - `CredentialRecord { id, realmId, subjectId, type, secret, label, lastUsedAt, lookupKey, createdAt }`
  - `credentialRepository(tx)` gains `listFor(subjectId, type)`, `byLookupKey(lookupKey)`, `insert(input)`, `markUsed(id, at)`, `deleteOne(id)`
  - `passwordFor(subjectId)` keeps its exact current signature, returning the PHC string or null

- [ ] **Step 1: Write the migration**

```sql
-- packages/db/drizzle/0033_user_credentials_types.sql
-- A password and a TOTP secret are one per subject; passkeys and recovery
-- codes are many, which is why the old UNIQUE (subject_id, type) has to go
-- rather than be widened. password-history rows are retired hashes kept for
-- the realm's history depth and are never verified against for login.
ALTER TABLE user_credentials
  DROP CONSTRAINT IF EXISTS user_credentials_one_password;
ALTER TABLE user_credentials
  DROP CONSTRAINT IF EXISTS user_credentials_subject_id_type_unique;

ALTER TABLE user_credentials DROP CONSTRAINT user_credentials_type_check;
ALTER TABLE user_credentials ADD CONSTRAINT user_credentials_type_check CHECK (
  type IN ('password', 'totp', 'webauthn', 'recovery-code', 'password-history')
);

ALTER TABLE user_credentials
  ALTER COLUMN secret_data TYPE jsonb
  USING jsonb_build_object('hash', secret_data);

ALTER TABLE user_credentials ADD COLUMN label text;
ALTER TABLE user_credentials ADD COLUMN last_used_at timestamptz;
ALTER TABLE user_credentials ADD COLUMN lookup_key text;

CREATE UNIQUE INDEX user_credentials_one_password
  ON user_credentials (subject_id) WHERE type = 'password';
CREATE UNIQUE INDEX user_credentials_one_totp
  ON user_credentials (subject_id) WHERE type = 'totp';

-- A passwordless assertion arrives naming a credential, not a user, so the
-- subject is resolved through this index rather than by scanning jsonb.
CREATE UNIQUE INDEX user_credentials_lookup_key
  ON user_credentials (realm_id, lookup_key) WHERE lookup_key IS NOT NULL;
```

Check the real constraint names first — `\d user_credentials` against a migrated database — rather than trusting the `DROP CONSTRAINT` names in this plan. Migration 0005 is the file that created them.

- [ ] **Step 2: Write the failing unit tests for per-type parsing**

```ts
// packages/domain-identity/src/service/credential-secret.test.ts
import { describe, expect, it } from 'vitest';
import { parseCredentialSecret } from '#/service/credential-secret';

describe('parseCredentialSecret', () => {
  it('reads a password secret', () => {
    expect(parseCredentialSecret('password', { hash: '$argon2id$v=19$x' })).toEqual({
      kind: 'password',
      hash: '$argon2id$v=19$x',
    });
  });

  it('reads a totp secret with its last accepted step', () => {
    expect(
      parseCredentialSecret('totp', {
        secret: 'JBSWY3DPEHPK3PXP',
        digits: 6,
        lastStep: 57_000_000,
      }),
    ).toEqual({ kind: 'totp', secret: 'JBSWY3DPEHPK3PXP', digits: 6, lastStep: 57_000_000 });
  });

  it('reads a webauthn secret with its counter', () => {
    expect(
      parseCredentialSecret('webauthn', {
        publicKey: 'pQECAyY',
        counter: 7,
        transports: ['internal'],
      }),
    ).toEqual({ kind: 'webauthn', publicKey: 'pQECAyY', counter: 7, transports: ['internal'] });
  });

  it('throws on a secret whose shape does not match its type', () => {
    expect(() => parseCredentialSecret('totp', { hash: 'x' })).toThrow(/totp/);
  });

  it('throws rather than narrowing an unknown from the database loosely', () => {
    expect(() => parseCredentialSecret('password', null)).toThrow();
    expect(() => parseCredentialSecret('password', 'a raw string')).toThrow();
  });
});
```

- [ ] **Step 3: Run them and watch them fail, then implement**

Run: `pnpm exec vitest run --project unit credential-secret`

One Zod schema per type, a `parse` at the repository boundary, and `unknown` in and a narrowed union out. No `any`, no cast — a `jsonb` column is exactly the untyped boundary the ban exists for.

- [ ] **Step 4: Write the failing integration test**

Cases: an existing password row survives the migration and `passwordFor` still returns its PHC string unchanged; two passkeys for one subject both insert; a second password for one subject is refused by the partial index; a second TOTP is refused; two passkeys with the same `lookup_key` in one realm are refused; the _same_ `lookup_key` in two different realms is accepted; and every new method is probed with a foreign `realm_id`.

The first case is the one the spike exists for — assert the exact string, not that a row exists.

- [ ] **Step 5: Run it, implement the repository, run it again**

Run: `pnpm exec vitest run --project integration credential-types`
Expected: PASS.

`setPassword`'s existing comment refers to `user_credentials_one_password` as a constraint that "would refuse anyway" — it is now a partial index with the same name, and the comment stays accurate only if it says so.

- [ ] **Step 6: Run the full suite — this migration touches every existing login test**

Run: `pnpm test`
Expected: PASS. Any failure here is the conversion, not the test.

- [ ] **Step 7: Commit, push, wait**

```bash
git add -A
git commit -m "Widen the credential store to hold TOTP secrets, passkeys and recovery codes"
git push
gh pr checks --watch
```

Then update `docs/NEXT.md`, recording that `user_credentials.type` is no longer password-only — which closes the item `docs/NEXT.md` has carried since P2a.

---

### Task 13: Password policy — migration 0034 columns, one service, four call sites

**Files:**

- Create: `packages/db/drizzle/0034_realm_password_policy.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/db/src/schema/realms.ts`
- Create: `packages/domain-identity/src/service/password-policy.ts`
- Create: `packages/domain-identity/src/service/password-policy.test.ts`
- Modify: `packages/account/src/usecase/register.ts`
- Modify: `packages/account/src/usecase/reset-password.ts`
- Modify: `packages/account/src/view/registration-html.ts`, `reset-html.ts`
- Modify: `apps/server/src/cli/` — the seed command's password path
- Create: `packages/account/tests/password-policy.int.test.ts`

**Interfaces:**

- Produces:
  - `PasswordPolicy { minLength, requireDigit, requireUppercase, requireLowercase, requireSpecial, notUsername, notEmail, historyDepth, maxAgeDays }`
  - `PolicyViolation = { rule: string; message: string }`
  - `evaluatePassword(candidate: string, policy: PasswordPolicy, subject: { username: string; email: string | null }): PolicyViolation[]`

- [ ] **Step 1: Write the migration**

```sql
-- packages/db/drizzle/0034_realm_password_policy.sql
-- The weakest configuration this server is willing to call a policy: eight
-- characters and no class requirements. Every bound is a constraint rather
-- than a clamp, for the reason 0013 gives.
ALTER TABLE realms ADD COLUMN password_min_length integer NOT NULL DEFAULT 8;
ALTER TABLE realms ADD COLUMN password_require_digit boolean NOT NULL DEFAULT false;
ALTER TABLE realms ADD COLUMN password_require_uppercase boolean NOT NULL DEFAULT false;
ALTER TABLE realms ADD COLUMN password_require_lowercase boolean NOT NULL DEFAULT false;
ALTER TABLE realms ADD COLUMN password_require_special boolean NOT NULL DEFAULT false;
ALTER TABLE realms ADD COLUMN password_not_username boolean NOT NULL DEFAULT true;
ALTER TABLE realms ADD COLUMN password_not_email boolean NOT NULL DEFAULT true;
ALTER TABLE realms ADD COLUMN password_history_depth integer NOT NULL DEFAULT 0;
ALTER TABLE realms ADD COLUMN password_max_age_days integer NOT NULL DEFAULT 0;

ALTER TABLE realms ADD CONSTRAINT realms_password_min_length_bounds
  CHECK (password_min_length BETWEEN 8 AND 256);
ALTER TABLE realms ADD CONSTRAINT realms_password_history_bounds
  CHECK (password_history_depth BETWEEN 0 AND 24);
ALTER TABLE realms ADD CONSTRAINT realms_password_max_age_bounds
  CHECK (password_max_age_days BETWEEN 0 AND 3650);
```

`password_min_length`'s floor is 8, not 1: a realm cannot configure its way below the weakest policy this server ships.

- [ ] **Step 2: Write the failing unit tests**

```ts
// packages/domain-identity/src/service/password-policy.test.ts
import { describe, expect, it } from 'vitest';
import { evaluatePassword, type PasswordPolicy } from '#/service/password-policy';

const base: PasswordPolicy = {
  minLength: 8,
  requireDigit: false,
  requireUppercase: false,
  requireLowercase: false,
  requireSpecial: false,
  notUsername: true,
  notEmail: true,
  historyDepth: 0,
  maxAgeDays: 0,
};
const ada = { username: 'ada', email: 'ada@example.com' };

describe('evaluatePassword', () => {
  it('accepts a password that satisfies the policy', () => {
    expect(evaluatePassword('correct horse battery', base, ada)).toEqual([]);
  });

  it('reports every violation at once, not the first', () => {
    const strict = {
      ...base,
      minLength: 12,
      requireDigit: true,
      requireUppercase: true,
      requireSpecial: true,
    };
    const violations = evaluatePassword('short', strict, ada);
    expect(violations.map((v) => v.rule).sort()).toEqual([
      'min-length',
      'require-digit',
      'require-special',
      'require-uppercase',
    ]);
  });

  it('refuses a password containing the username, case-insensitively', () => {
    expect(evaluatePassword('myADApassword', base, ada).map((v) => v.rule)).toEqual([
      'not-username',
    ]);
  });

  it('refuses a password containing the local part of the email address', () => {
    expect(evaluatePassword('ada@example.com!', base, ada).map((v) => v.rule)).toContain(
      'not-email',
    );
  });

  it('counts characters, not UTF-16 code units', () => {
    // Eight emoji are eight characters. A length check on .length would
    // count sixteen and wrongly accept a seven-character password.
    expect(evaluatePassword('🔑🔑🔑🔑🔑🔑🔑', base, ada).map((v) => v.rule)).toEqual([
      'min-length',
    ]);
    expect(evaluatePassword('🔑🔑🔑🔑🔑🔑🔑🔑', base, ada)).toEqual([]);
  });

  it('applies no email rule to a subject with no address', () => {
    expect(evaluatePassword('a-fine-password', base, { username: 'ada', email: null })).toEqual([]);
  });
});
```

The grapheme-counting case is not pedantry: `'🔑'.length` is 2, so a naive minimum-length check is wrong in the direction that accepts weak passwords.

- [ ] **Step 3: Run them, implement, run them again**

Run: `pnpm exec vitest run --project unit password-policy`

Count with `[...candidate].length`. Return every violation. The service takes no `tx` and no clock — it is a leaf.

- [ ] **Step 4: Write the failing integration test across all four call sites**

```ts
// packages/account/tests/password-policy.int.test.ts
// The point of this file is the fourth case. A policy enforced at three of
// four writers is a policy with a bypass, and nothing else in the suite
// would notice.
describe('the password policy binds every writer', () => {
  it('refuses a weak password at registration', async () => {
    /* 400, violations listed */
  });
  it('refuses a weak password at reset redemption', async () => {
    /* 400 */
  });
  it('refuses a weak password from the seed CLI', async () => {
    /* non-zero exit */
  });
  it('refuses a weak password at the change-password action', async () => {
    /* 400 */
  });
});
```

The fourth case depends on Task 21 and is written here as a failing test that Task 21 turns green — recorded in the commit message, not left as a silent `it.skip`.

- [ ] **Step 5: Wire the three call sites that exist now**

Registration, reset redemption and the seed CLI. Each renders or prints **every** violation: a form that rejects one rule at a time takes four attempts to satisfy.

- [ ] **Step 6: Run, commit, push, wait**

Run: `pnpm test`

```bash
git add -A
git commit -m "Enforce a realm password policy at every writer of a password"
git push
gh pr checks --watch
```

Then update `docs/NEXT.md` and `README.md` — the registration and reset sections now have rules worth stating.

---

### Task 14: Required actions — migration 0035, the flow gate, the page shell

**Files:**

- Create: `packages/db/drizzle/0035_user_required_actions.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Create: `packages/authn-flows/src/schema/required-action.ts`
- Create: `packages/authn-flows/src/repository/required-actions.ts`
- Create: `packages/authn-flows/src/usecase/required-actions.ts`
- Create: `packages/authn-flows/src/usecase/required-actions.test.ts`
- Create: `packages/authn-flows/src/view/required-action-html.ts`
- Modify: `packages/protocol-oidc/src/usecase/login-submission.ts`
- Modify: `packages/protocol-oidc/src/view/routes/login.ts`
- Create: `packages/authn-flows/tests/required-actions.int.test.ts`

**Interfaces:**

- Produces:
  - `RequiredAction = 'configure-totp' | 'configure-passkey' | 'update-password' | 'generate-recovery-codes'`
  - `requiredActionRepository(tx)` with `pendingFor(subjectId)`, `add(subjectId, action)`, `complete(subjectId, action)`
  - `nextRequiredAction(pending: readonly RequiredAction[]): RequiredAction | null`
  - `LoginSubmissionOutcome` gains `{ kind: 'required_action'; authSessionId: string; action: RequiredAction }`

- [ ] **Step 1: Write the migration**

```sql
-- packages/db/drizzle/0035_user_required_actions.sql
-- What a subject must do before a login completes. This is what makes a
-- realm-level requirement expressible at all: without it, "this realm
-- requires OTP" could only mean "OTP is offered to whoever already has one".
CREATE TABLE user_required_actions (
  realm_id uuid NOT NULL REFERENCES realms (id) ON DELETE CASCADE,
  subject_id uuid NOT NULL,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (realm_id, subject_id, action),
  CONSTRAINT user_required_actions_action CHECK (
    action IN ('configure-totp', 'configure-passkey', 'update-password',
               'generate-recovery-codes')
  ),
  CONSTRAINT user_required_actions_subject_fk
    FOREIGN KEY (realm_id, subject_id) REFERENCES subjects (realm_id, id) ON DELETE CASCADE
);

ALTER TABLE user_required_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_required_actions FORCE ROW LEVEL SECURITY;

CREATE POLICY user_required_actions_isolation ON user_required_actions
  USING (realm_id = current_setting('odudu.realm_id', true)::uuid)
  WITH CHECK (realm_id = current_setting('odudu.realm_id', true)::uuid);
```

Copy the `current_setting` spelling from an existing migration.

- [ ] **Step 2: Write the failing integration test — the gate is the assertion**

Cases: a subject with a pending action authenticates correctly and **no session is established and no code issued**; the authentication session is left unconsumed so the action can be completed against it; completing the action then completes the login and issues the code; a second pending action is run before the login completes; and a foreign realm's pending actions are invisible.

The first case is the one that matters. A required action that runs _after_ the session is established is not a required action.

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm exec vitest run --project integration required-actions`
Expected: FAIL — table does not exist and the outcome variant does not exist.

- [ ] **Step 4: Implement the repository, the ordering and the page shell**

`nextRequiredAction` imposes a stable order so two pending actions are always run in the same sequence: `update-password`, `configure-totp`, `configure-passkey`, `generate-recovery-codes`. Password first, because an expired password should not be usable to enrol a second factor.

The page shell follows `packages/account/src/view`'s existing pattern and ADR 0018's framing defence, and carries the `auth_session_id` hidden field.

- [ ] **Step 5: Insert the gate into the login submission**

In `handleLoginSubmission`, after the email-verified gate and **before** `completeLogin`:

```ts
// A pending action blocks completion: nothing is established and nothing
// is issued until it is done. The authentication session is deliberately
// left unconsumed, exactly as the unverified-address outcome leaves it,
// so the same parked request survives the detour.
const action = nextRequiredAction(await deps.pendingActions(realm.id, result.subjectId));
if (action !== null) {
  return { kind: 'required_action', authSessionId, action };
}
```

- [ ] **Step 6: Run the suites, commit, push, wait**

Run: `pnpm test`

```bash
git add -A
git commit -m "Block a login on a pending required action"
git push
gh pr checks --watch
```

Then update `docs/NEXT.md`.

---

### Task 15: RFC 6238 TOTP in `@odudu/crypto`, against the RFC's own vectors

No dependency. Twenty lines of HMAC, truncation and a time step, checked against the specification's published vectors rather than against a library's agreement with itself — and under Stryker, which is why it lives in this package.

**Files:**

- Create: `packages/crypto/src/service/totp.ts`
- Create: `packages/crypto/src/service/totp.test.ts`
- Modify: `packages/crypto/src/index.ts`
- Modify: `packages/crypto/stryker.config.json`
- Create: `docs/protocols/rfc6238.md`

**Interfaces:**

- Produces:
  - `generateTotpSecret(): string` — base32, no padding
  - `totpCode(secret: string, counter: number, digits?: number, algorithm?: 'SHA-1' | 'SHA-256' | 'SHA-512'): string`
  - `totpCounter(now: Date, stepSeconds?: number): number`
  - `verifyTotp(input: { secret: string; code: string; now: Date; lastStep: number | null }): { ok: false } | { ok: true; step: number }`

- [ ] **Step 1: Write the failing tests from RFC 6238's appendix B vectors**

```ts
// packages/crypto/src/service/totp.test.ts
import { describe, expect, it } from 'vitest';
import { totpCode, totpCounter, verifyTotp } from '#/service/totp';

// RFC 6238 appendix B. The seeds are the ASCII strings "12345678901234567890"
// (SHA-1), repeated to 32 bytes for SHA-256 and to 64 for SHA-512, base32
// encoded. The RFC tabulates them as hex; the conversion is done in this
// file so a reader can check it against the document.
const SEED_SHA1 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const SEED_SHA256 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('RFC 6238 appendix B, SHA-1, 8 digits', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('at unix time %i produces %s', (seconds, expected) => {
    const counter = totpCounter(new Date(seconds * 1000));
    expect(totpCode(SEED_SHA1, counter, 8, 'SHA-1')).toBe(expected);
  });
});

describe('RFC 6238 appendix B, SHA-256, 8 digits', () => {
  it.each([
    [59, '46119246'],
    [1111111109, '68084774'],
    [2000000000, '90698825'],
  ])('at unix time %i produces %s', (seconds, expected) => {
    expect(totpCode(SEED_SHA256, totpCounter(new Date(seconds * 1000)), 8, 'SHA-256')).toBe(
      expected,
    );
  });
});

describe('verifyTotp', () => {
  const secret = SEED_SHA1;
  const now = new Date(59_000);

  it('accepts the current step', () => {
    const code = totpCode(secret, totpCounter(now), 6);
    expect(verifyTotp({ secret, code, now, lastStep: null })).toEqual({ ok: true, step: 1 });
  });

  it('accepts one step either side, and no further', () => {
    for (const offset of [-1, 1]) {
      const code = totpCode(secret, totpCounter(now) + offset, 6);
      expect(verifyTotp({ secret, code, now, lastStep: null }).ok).toBe(true);
    }
    for (const offset of [-2, 2]) {
      const code = totpCode(secret, totpCounter(now) + offset, 6);
      expect(verifyTotp({ secret, code, now, lastStep: null }).ok).toBe(false);
    }
  });

  it('refuses a code from a step at or below the last accepted one', () => {
    const step = totpCounter(now);
    const code = totpCode(secret, step, 6);
    expect(verifyTotp({ secret, code, now, lastStep: step })).toEqual({ ok: false });
  });

  it('refuses a code of the wrong length without comparing it', () => {
    expect(verifyTotp({ secret, code: '1234', now, lastStep: null })).toEqual({ ok: false });
  });
});
```

The replay test is the one that earns the `lastStep` column: without it a code works for its whole 30-to-90-second window, however many times it is presented.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm exec vitest run --project unit totp`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement it over `node:crypto`**

`createHmac`, big-endian 8-byte counter, dynamic truncation per RFC 4226 §5.3, modulo `10 ** digits`, left-padded. Compare with `crypto.timingSafeEqual` over equal-length buffers after the length check.

- [ ] **Step 4: Run them and watch them pass**

Run: `pnpm exec vitest run --project unit totp`
Expected: PASS. A vector that does not match is a bug in this code, not in the RFC — do not adjust an expected value.

- [ ] **Step 5: Bring it under mutation testing**

Run: `pnpm mutate:crypto`
Expected: no surviving mutants in `totp.ts`. A surviving mutant in the truncation or the modulo means the vectors are not pinning what they look like they pin; add the case that kills it.

- [ ] **Step 6: Write the clause table**

`docs/protocols/rfc6238.md`, with a row per MUST and SHOULD and a reading note recording that the vectors are the RFC's own and where they are.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Implement RFC 6238 TOTP against the specification's own vectors"
git push
gh pr checks --watch
```

---

### Task 16: The TOTP step and `configure-totp`

**Files:**

- Create: `packages/authn-flows/src/service/authenticators/totp.ts`
- Create: `packages/authn-flows/src/service/authenticators/totp.test.ts`
- Modify: `packages/authn-flows/src/usecase/executor.ts`
- Create: `packages/authn-flows/src/view/totp-enrolment-html.ts`
- Create: `packages/authn-flows/tests/totp-login.int.test.ts`
- Modify: `packages/db/src/schema/realms.ts` — `otp_required`
- Create: `packages/db/drizzle/0036_realm_otp_required.sql`
- Modify: `docs/request-paths.md`

**Interfaces:**

- Consumes: `verifyTotp`, `generateTotpSecret`, `totpCode` from `@odudu/crypto`; `credentialRepository(tx).listFor` and `.insert` (Task 12); the required-action mechanism (Task 14)
- Produces:
  - `totpStep(input: { code?: string }, verification: TotpVerification): Promise<AuthenticatorResult>`
  - `TotpVerification { subjectId: string | null; secret: TotpSecret | null }`
  - `otpApplicable(subject: { hasTotp: boolean }, realm: { otpRequired: boolean }): boolean`

- [ ] **Step 1: Write the migration for the realm switch**

```sql
-- packages/db/drizzle/0036_realm_otp_required.sql
-- Off by default: a realm does not acquire a second factor because it was
-- upgraded. On, every subject without a TOTP credential gets the
-- configure-totp required action at their next login.
ALTER TABLE realms ADD COLUMN otp_required boolean NOT NULL DEFAULT false;
```

- [ ] **Step 2: Write the failing unit tests for the step and its applicability**

The step follows `password.ts`'s contract exactly: no `tx`, no repository, verification gathered by the caller. Cases: a correct code succeeds; a wrong code fails with `invalid_credentials`; a missing code challenges with `form: 'otp'`; and a null secret (no credential) fails rather than succeeding.

`otpApplicable` is four cases: enrolled and required, enrolled and not required (applicable — an enrolled factor is used), not enrolled and required (applicable, via the required action), not enrolled and not required (not applicable).

- [ ] **Step 3: Run them, implement, run them again**

Run: `pnpm exec vitest run --project unit totp`

- [ ] **Step 4: Write the failing integration test for the whole journey**

Cases: a realm with `otp_required` on and a subject with no TOTP credential gets `configure-totp` and cannot complete a login until enrolled; enrolment stores a `totp` credential and the same login then completes; a subsequent login asks for a code after the password; the same code cannot be used twice; and a subject who enrolled while the realm did not require OTP is still asked for a code.

- [ ] **Step 5: Implement enrolment**

The enrolment page renders the `otpauth://totp/...` URI **as text and as a QR code**. The QR encoder is a dependency — add it to `packages/authn-flows`'s manifest, exact version, confined to the view layer. Verify a code before storing the credential: an enrolment that stores an unverified secret locks the user out of their own account.

- [ ] **Step 6: Register the authenticator and run everything**

Add `otp` to `AUTHENTICATORS` in the executor with its applicability function.

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 7: Document and push**

`docs/request-paths.md` gains a TOTP enrolment and a TOTP login, run live against a real code generated at the time.

```bash
git add -A
git commit -m "Authenticate with a TOTP code, and enrol one through the flow"
git push
gh pr checks --watch
```

Then update `docs/NEXT.md` and `README.md`.

---

### Task 17: Spike — the WebAuthn library, and a usernameless assertion

Two questions against one library, so one probe. A spike's output is an answer; the code is thrown away.

**The assumptions under test.** First, that `@simplewebauthn/server`'s API at the version we pin is the API its documentation describes — the P0 rule exists because a version-drifted API read from a README has burned this repository before. Second, and load-bearing for the whole first-factor design: that a **discoverable-credential assertion can be completed with no username** — that `generateAuthenticationOptions` can be called with no `allowCredentials`, and that the resulting assertion identifies the credential well enough to resolve a subject from `lookup_key` alone.

If the second answer is no, the spec's default flow degrades to a passkey second factor, and that is a spec change made visibly — not a quiet retreat inside Task 19.

**Files:**

- Modify: `docs/superpowers/p2b-spike-log.md`
- Create (throwaway): `/tmp/webauthn-spike/`

- [ ] **Step 1: Install the candidate at an exact version**

```bash
mkdir -p /tmp/webauthn-spike && cd /tmp/webauthn-spike
npm init -y >/dev/null
npm i @simplewebauthn/server
node -e "console.log(require('./package.json').dependencies)"
```

Record the resolved version. It is the version Task 18 pins.

- [ ] **Step 2: Probe the API surface actually exported**

```bash
node --input-type=module -e "
import * as s from '@simplewebauthn/server';
console.log(Object.keys(s).sort().join('\n'));
"
```

Expected, and to be confirmed rather than assumed: `generateRegistrationOptions`, `verifyRegistrationResponse`, `generateAuthenticationOptions`, `verifyAuthenticationResponse`. Record what is actually there, including anything the documentation implied that is missing.

- [ ] **Step 3: Probe the usernameless option shape**

```bash
node --input-type=module -e "
import { generateAuthenticationOptions } from '@simplewebauthn/server';
const options = await generateAuthenticationOptions({ rpID: 'localhost' });
console.log(JSON.stringify(options, null, 2));
"
```

The answer is **yes** to the second question if this call succeeds with no `allowCredentials` and the returned options omit `allowCredentials` or return it empty — which is what tells a browser to offer every discoverable credential it holds. A thrown error, or a required `allowCredentials`, is a **no**.

- [ ] **Step 4: Probe what a verified assertion hands back**

Read `verifyAuthenticationResponse`'s TypeScript declaration for the shape of its result — specifically whether the credential ID and the new signature counter are both available, since Task 19 needs the first to resolve a subject and the second to detect a cloned authenticator:

```bash
node -e "console.log(require('fs').readFileSync('node_modules/@simplewebauthn/server/dist/index.d.ts','utf8'))" | grep -A 30 "verifyAuthenticationResponse"
```

- [ ] **Step 5: Record both findings**

Append to `docs/superpowers/p2b-spike-log.md` under `## @simplewebauthn/server: API surface and usernameless assertions`: the resolved version, the exact commands, the output verbatim, and two explicit conclusions — one per question. If the second is `no`, say what Task 19 must do instead and flag that section 5.2 of the spec needs amending before Task 19 starts.

- [ ] **Step 6: Tear it down and commit**

```bash
rm -rf /tmp/webauthn-spike
git add docs/superpowers/p2b-spike-log.md
git commit -m "Establish the WebAuthn library's surface and whether a usernameless assertion resolves"
git push
gh pr checks --watch
```

---

### Task 18: Passkey registration, and `configure-passkey`

**Gated by Task 17.** Pin the version the spike resolved.

**Files:**

- Modify: `packages/authn-flows/package.json` — the pinned dependency
- Create: `packages/authn-flows/src/service/webauthn.ts`
- Create: `packages/authn-flows/src/service/webauthn.test.ts`
- Create: `packages/authn-flows/src/usecase/passkey-enrolment.ts`
- Create: `packages/authn-flows/src/view/passkey-enrolment-html.ts`
- Create: `packages/authn-flows/tests/passkey-enrolment.int.test.ts`
- Modify: `apps/server/src/config-guard.ts` — the RP ID derivation
- Modify: `README.md`

**Interfaces:**

- Produces:
  - `relyingPartyId(publicBaseUrl: string): string` — the host, never a request header
  - `beginPasskeyEnrolment(input): Promise<{ options: PublicKeyCredentialCreationOptionsJSON; challenge: string }>`
  - `completePasskeyEnrolment(input): Promise<{ lookupKey: string; secret: WebauthnSecret; label: string }>`

- [ ] **Step 1: Write the failing unit test for the RP ID**

```ts
// packages/authn-flows/src/service/webauthn.test.ts
import { describe, expect, it } from 'vitest';
import { relyingPartyId } from '#/service/webauthn';

describe('relyingPartyId', () => {
  it('is the host of the configured public base URL, without the port', () => {
    expect(relyingPartyId('https://id.example.com')).toBe('id.example.com');
    expect(relyingPartyId('https://id.example.com:8443')).toBe('id.example.com');
    expect(relyingPartyId('http://localhost:8080')).toBe('localhost');
  });

  it('throws on a base URL that is not one, rather than defaulting', () => {
    expect(() => relyingPartyId('')).toThrow();
    expect(() => relyingPartyId('not a url')).toThrow();
  });
});
```

A passkey registered against the wrong RP ID is unusable, and silently: the browser simply never offers it. Failing closed at boot is the only honest behaviour, which is why `assertProductionTls`'s neighbour in `config-guard.ts` is the right place for the check.

- [ ] **Step 2: Run it, implement, run it again**

Run: `pnpm exec vitest run --project unit webauthn`

The RP ID comes from `ODUDU_PUBLIC_BASE_URL` and from nowhere else — never `Host`, never `X-Forwarded-Host`, which are client-controlled. Boot fails when a realm can register a passkey and this is unset, the same way P2a's mailed links fail closed.

- [ ] **Step 3: Write the failing integration test for enrolment**

Cases: a subject with `configure-passkey` pending gets options carrying a challenge; the challenge is stored against the authentication session, not the browser; completing enrolment stores a `webauthn` credential whose `lookup_key` is the credential ID; a second passkey for the same subject enrols alongside the first; replaying the same challenge is refused; a response whose challenge does not match is refused; and the required action is cleared only on success.

- [ ] **Step 4: Implement it and run the suite**

Verification is the library's; storage is ours. The counter from the verified registration goes into `secret_data` as the baseline Task 19 compares against.

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit, push, wait**

```bash
git add -A
git commit -m "Enrol a passkey through the flow"
git push
gh pr checks --watch
```

Then update `docs/NEXT.md` and `README.md`, including the `ODUDU_PUBLIC_BASE_URL` requirement.

---

### Task 19: Passkey authentication as a first factor, usernameless

**Read the Task 17 finding before starting.** If a usernameless assertion could not be resolved, stop and amend the spec rather than improvising a fallback here.

**Files:**

- Create: `packages/authn-flows/src/service/authenticators/passkey.ts`
- Create: `packages/authn-flows/src/service/authenticators/passkey.test.ts`
- Modify: `packages/authn-flows/src/usecase/executor.ts`
- Modify: `packages/protocol-oidc/src/view/authorize-html.ts`
- Create: `packages/authn-flows/tests/passkey-login.int.test.ts`
- Modify: `docs/request-paths.md`

**Interfaces:**

- Produces:
  - `passkeyStep(input: { assertion?: unknown }, verification: PasskeyVerification): Promise<AuthenticatorResult>`
  - `PasskeyVerification { credential: { subjectId: string; secret: WebauthnSecret } | null; expectedChallenge: string | null }`

- [ ] **Step 1: Write the failing unit tests for the step**

Cases: no assertion challenges with `form: 'passkey'`; an assertion for an unknown `lookup_key` fails with `invalid_credentials`; a valid assertion succeeds and returns the subject; **a counter that did not increase fails**; and a counter of zero from an authenticator that reports zero is accepted (some authenticators legitimately never increment, and refusing them would be refusing a conformant device).

The last two together are the whole point of storing the counter: refuse a clone, without refusing a device that is allowed not to count.

- [ ] **Step 2: Run them and watch them fail, then implement**

Run: `pnpm exec vitest run --project unit passkey`

- [ ] **Step 3: Write the failing integration test for the usernameless journey**

Cases: `/authorize` renders a page offering a passkey with **no username field required**; an assertion resolves the subject through `lookup_key` and issues a code; the session's `authenticators` records `passkey` alone; **the conditional OTP step does not run** after a passkey, even on a realm with `otp_required` on; and the stored counter has advanced after the login.

The fourth case is a constraint from the spec stated as a test: a passkey assertion is already two factors.

- [ ] **Step 4: Implement the resolution and the counter write**

Resolve through `credentialRepository(tx).byLookupKey`, which is realm-scoped by RLS — a credential ID from another realm resolves to nothing rather than to somebody else's subject. Write the new counter and `last_used_at` in the same transaction as the success.

- [ ] **Step 5: Make the conditional OTP step skip a passkey login**

`otpApplicable` grows a third input: what has already satisfied the flow. If `passkey` is in it, the step is not applicable. Add the unit case to Task 16's test file.

- [ ] **Step 6: Run everything**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 7: Document and push**

`docs/request-paths.md` gains a passwordless login. A WebAuthn ceremony cannot be driven by `curl`, so this transcript is the Playwright test's recorded steps and the server-side responses — and the document says that is what it is, rather than showing a `curl` nobody could run.

```bash
git add -A
git commit -m "Sign in with a passkey and no username"
git push
gh pr checks --watch
```

Then update `docs/NEXT.md`.

---

### Task 20: Recovery codes — generation, single use, `generate-recovery-codes`

**Files:**

- Create: `packages/authn-flows/src/service/authenticators/recovery.ts`
- Create: `packages/authn-flows/src/service/authenticators/recovery.test.ts`
- Create: `packages/authn-flows/src/usecase/recovery-codes.ts`
- Create: `packages/authn-flows/src/view/recovery-codes-html.ts`
- Modify: `packages/authn-flows/src/usecase/executor.ts`
- Create: `packages/authn-flows/tests/recovery-codes.int.test.ts`
- Modify: `packages/db/drizzle/` — no migration needed; the type is already in 0033's CHECK

**Interfaces:**

- Produces:
  - `generateRecoveryCodes(count?: number): string[]` — ten by default
  - `recoveryStep(input: { code?: string }, verification: RecoveryVerification): Promise<AuthenticatorResult>`
  - `consumeRecoveryCode(tx, subjectId, code): Promise<boolean>`

- [ ] **Step 1: Write the failing unit tests**

Cases: ten codes are generated; they are distinct; each has enough entropy to be worth calling a credential (assert the alphabet and the length, not a vague property); and `recoveryStep` fails on an unknown code and succeeds on a known one.

- [ ] **Step 2: Run, implement, run**

Run: `pnpm exec vitest run --project unit recovery`

Codes are hashed with the same Argon2id parameters as a password — `hashPassword` from `@odudu/domain-identity` — and stored one row per code.

- [ ] **Step 3: Write the failing integration test — single use is the assertion**

Cases: a code works once; **the same code presented again is refused, and is refused as a used code rather than as an unknown one**; the used row is still present (marked used, not deleted — ADR 0021's reasoning applies to every single-use credential); nine remain usable; regenerating replaces all ten and invalidates the old set; and a code from another subject in the same realm does not authenticate this subject.

- [ ] **Step 4: Implement consumption and run the suite**

Consumption marks `last_used_at` and sets a `usedAt` inside the secret, in the same transaction as the login's success.

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Offer them where they are needed**

A subject completing `configure-totp` gets `generate-recovery-codes` added, because a second factor with no recovery path is the lockout this task exists to prevent. Codes are displayed exactly once, on that page, with the page saying so.

- [ ] **Step 6: Commit, push, wait**

```bash
git add -A
git commit -m "Issue single-use recovery codes and authenticate with one"
git push
gh pr checks --watch
```

Then update `docs/NEXT.md` and `README.md`.

---

### Task 21: `update-password` — expiry, history, and the change-password action

This task turns Task 13's fourth test green.

**Files:**

- Create: `packages/authn-flows/src/usecase/update-password.ts`
- Create: `packages/authn-flows/src/view/update-password-html.ts`
- Create: `packages/domain-identity/src/service/password-age.ts`
- Create: `packages/domain-identity/src/service/password-age.test.ts`
- Modify: `packages/domain-identity/src/repository/credentials.ts`
- Modify: `packages/account/tests/password-policy.int.test.ts`
- Create: `packages/authn-flows/tests/update-password.int.test.ts`

**Interfaces:**

- Produces:
  - `passwordExpired(credential: { createdAt: Date }, maxAgeDays: number, now: Date): boolean`
  - `credentialRepository(tx).rotatePassword(subjectId, newHash, historyDepth): Promise<void>`
  - `credentialRepository(tx).passwordHistory(subjectId): Promise<string[]>`

- [ ] **Step 1: Write the failing unit tests for expiry**

Cases: `maxAgeDays` of 0 means never expires, whatever the age; a password younger than the limit has not expired; one exactly at the limit has; and the arithmetic is in days, not milliseconds misread as days.

- [ ] **Step 2: Run, implement, run**

Run: `pnpm exec vitest run --project unit password-age`

- [ ] **Step 3: Write the failing integration test**

Cases: a subject whose password is past `password_max_age_days` gets `update-password` and **is not locked out** — they can still authenticate, they simply must change it before the login completes; changing it clears the action; reusing one of the last `password_history_depth` passwords is refused; reusing one older than the depth is accepted; the retired hash is stored as a `password-history` row; history rows never authenticate a login; and the new password is evaluated against the realm policy.

The last case is Task 13's fourth test, now reachable.

- [ ] **Step 4: Implement rotation with history**

`rotatePassword` writes the new hash, inserts the old one as a `password-history` row, and trims history rows beyond the depth — the one place in this phase where a `DELETE` is correct, because a history row past the depth is not something any decision can read. Say so in a comment, since the codebase's default is that nothing is deleted.

- [ ] **Step 5: Run everything**

Run: `pnpm test`
Expected: PASS, including Task 13's previously-failing fourth case.

- [ ] **Step 6: Commit, push, wait**

```bash
git add -A
git commit -m "Require a password change on expiry, and refuse a reused one"
git push
gh pr checks --watch
```

Then update `docs/NEXT.md`.

---

### Task 22: Brute force — migration 0037, lockout, and indistinguishable refusals

**Files:**

- Create: `packages/db/drizzle/0037_login_failures.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/db/src/schema/realms.ts`
- Create: `packages/domain-identity/src/schema/login-failures.ts`
- Create: `packages/domain-identity/src/repository/login-failures.ts`
- Create: `packages/domain-identity/src/service/lockout.ts`
- Create: `packages/domain-identity/src/service/lockout.test.ts`
- Modify: `packages/authn-flows/src/usecase/executor.ts`
- Create: `packages/authn-flows/tests/lockout.int.test.ts`
- Modify: `docs/protocols/rfc6749.md`

**Interfaces:**

- Produces:
  - `nextLockout(state: { failureCount: number; lastFailureAt: Date | null }, policy: LockoutPolicy, now: Date): { failureCount: number; lockedUntil: Date | null }`
  - `loginFailureRepository(tx)` with `forSubject`, `recordFailure`, `clear`
  - `LockoutPolicy { maxFailures, lockoutSeconds, maxLockoutSeconds, failureResetSeconds }`

- [ ] **Step 1: Write the migration**

```sql
-- packages/db/drizzle/0037_login_failures.sql
-- Keyed by subject, not by username: a lockout that followed a username
-- would let an attacker lock an account out of existence by guessing at a
-- name it no longer uses, and would miss an attacker arriving by email.
CREATE TABLE login_failures (
  realm_id uuid NOT NULL REFERENCES realms (id) ON DELETE CASCADE,
  subject_id uuid NOT NULL,
  failure_count integer NOT NULL DEFAULT 0,
  first_failure_at timestamptz,
  last_failure_at timestamptz,
  locked_until timestamptz,
  PRIMARY KEY (realm_id, subject_id),
  CONSTRAINT login_failures_subject_fk
    FOREIGN KEY (realm_id, subject_id) REFERENCES subjects (realm_id, id) ON DELETE CASCADE
);

ALTER TABLE login_failures ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_failures FORCE ROW LEVEL SECURITY;

CREATE POLICY login_failures_isolation ON login_failures
  USING (realm_id = current_setting('odudu.realm_id', true)::uuid)
  WITH CHECK (realm_id = current_setting('odudu.realm_id', true)::uuid);

ALTER TABLE realms ADD COLUMN brute_force_max_failures integer NOT NULL DEFAULT 5;
ALTER TABLE realms ADD COLUMN brute_force_lockout_seconds integer NOT NULL DEFAULT 60;
ALTER TABLE realms ADD COLUMN brute_force_max_lockout_seconds integer NOT NULL DEFAULT 900;
ALTER TABLE realms ADD COLUMN brute_force_failure_reset_seconds integer NOT NULL DEFAULT 43200;

ALTER TABLE realms ADD CONSTRAINT realms_brute_force_bounds CHECK (
  brute_force_max_failures BETWEEN 1 AND 100
  AND brute_force_lockout_seconds BETWEEN 1 AND 86400
  AND brute_force_max_lockout_seconds >= brute_force_lockout_seconds
  AND brute_force_failure_reset_seconds BETWEEN 60 AND 2592000
);
```

Lockout is **on by default**, unlike every other realm setting this phase adds. RFC 6749 §2.3.1's protection is a MUST, and a MUST that ships off is not held.

- [ ] **Step 2: Write the failing unit tests for the arithmetic**

```ts
// packages/domain-identity/src/service/lockout.test.ts
import { describe, expect, it } from 'vitest';
import { nextLockout } from '#/service/lockout';

const policy = {
  maxFailures: 3,
  lockoutSeconds: 60,
  maxLockoutSeconds: 240,
  failureResetSeconds: 3600,
};
const now = new Date('2026-09-15T12:00:00Z');

describe('nextLockout', () => {
  it('counts up without locking below the threshold', () => {
    expect(nextLockout({ failureCount: 1, lastFailureAt: now }, policy, now)).toEqual({
      failureCount: 2,
      lockedUntil: null,
    });
  });

  it('locks for the base duration at the threshold', () => {
    const result = nextLockout({ failureCount: 2, lastFailureAt: now }, policy, now);
    expect(result.failureCount).toBe(3);
    expect(result.lockedUntil).toEqual(new Date('2026-09-15T12:01:00Z'));
  });

  it('doubles each further failure', () => {
    expect(nextLockout({ failureCount: 3, lastFailureAt: now }, policy, now).lockedUntil).toEqual(
      new Date('2026-09-15T12:02:00Z'),
    );
    expect(nextLockout({ failureCount: 4, lastFailureAt: now }, policy, now).lockedUntil).toEqual(
      new Date('2026-09-15T12:04:00Z'),
    );
  });

  it('stops doubling at the ceiling', () => {
    expect(nextLockout({ failureCount: 9, lastFailureAt: now }, policy, now).lockedUntil).toEqual(
      new Date('2026-09-15T12:04:00Z'),
    );
  });

  it('starts again from one after a quiet period', () => {
    const old = new Date('2026-09-15T10:00:00Z');
    expect(nextLockout({ failureCount: 7, lastFailureAt: old }, policy, now)).toEqual({
      failureCount: 1,
      lockedUntil: null,
    });
  });
});
```

- [ ] **Step 3: Run, implement, run**

Run: `pnpm exec vitest run --project unit lockout`

- [ ] **Step 4: Write the failing integration test — indistinguishability is the assertion**

```ts
// packages/authn-flows/tests/lockout.int.test.ts
// The security property is not "a locked account is refused" but "a locked
// account is refused in a way that tells the submitter nothing". A test that
// only asserts the refusal would pass an implementation that renders
// "account locked", which is an existence oracle.
```

Cases: three wrong passwords lock the account; the fourth attempt is refused **with a response byte-identical to a wrong-password response** — same status, same body, same headers; the _correct_ password is also refused while locked; the account unlocks after `locked_until`; a successful login clears the counter; the lockout survives a fresh database connection (it is a row, not memory); and the counter for one subject does not affect another.

- [ ] **Step 5: Implement, keeping the constant-time path intact**

The failure is recorded for the resolved subject. For an **unknown** username there is no subject and therefore no row — and the response must still cost the same, which is what `DUMMY_SUBJECT_ID` and `DUMMY_HASH` already arrange. Do not add a lockout lookup that runs only when the user exists; that is a timing oracle replacing the one P1 closed.

- [ ] **Step 6: Run everything and close the row**

Run: `pnpm test && pnpm trace`

Move RFC 6749 §2.3.1's MUST from `deferred: P2` to `covered`. **This is the last of the eight `deferred: P2` rows.**

- [ ] **Step 7: Commit, push, wait**

```bash
git add -A
git commit -m "Lock an account out after repeated failures, indistinguishably"
git push
gh pr checks --watch
```

Then update `docs/NEXT.md` and `README.md`.

---

### Task 23: The per-IP throttle, and a maximum password length

**Files:**

- Create: `apps/server/src/throttle.ts`
- Create: `apps/server/src/throttle.test.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `packages/contracts/src/` — the password field's maximum
- Create: `apps/server/tests/throttle.int.test.ts`
- Modify: `README.md`
- Create: `docs/adr/0023-brute-force-authority-is-split.md`

**Interfaces:**

- Produces:
  - `slidingWindow(options: { limit: number; windowSeconds: number; now: () => Date })` with `check(key: string): { allowed: boolean; retryAfterSeconds: number }`
  - a `preHandler` registered on the login POST, registration and reset-request routes only

- [ ] **Step 1: Write the failing unit tests for the window**

Cases: requests under the limit pass; the one over is refused with a positive `retryAfterSeconds`; the window slides, so a request passes again once the oldest falls out; two keys are independent; and memory does not grow without bound — old keys are evicted, asserted by size after many distinct keys.

The last case is the one that stops a throttle being a memory-exhaustion vector of its own.

- [ ] **Step 2: Run, implement, run**

Run: `pnpm exec vitest run --project unit throttle`

- [ ] **Step 3: Write the failing integration test**

Cases: eleven rapid registration attempts from one IP see the eleventh refused with `429` and a `Retry-After`; `/token` is **not** throttled (assert a burst succeeds); and a refusal does not reveal whether the account existed.

- [ ] **Step 4: Register it on exactly three routes, and cap the password length**

The login POST, registration and the reset request. Not `/token`, which is client-authenticated and hot. Add a maximum password length to the contract — "no maximum" and "19 MiB of Argon2id per attempt" are one defect stated twice.

- [ ] **Step 5: Write the ADR**

`docs/adr/0023-brute-force-authority-is-split.md`: why lockout is in Postgres and the throttle is in process, what the per-instance limit means for N instances behind a load balancer, and why that is accepted — the throttle protects this process's CPU, which is this process's business, while the property that must be globally true is the one in the database. Record the rejected alternative (both in Postgres) and its cost: a write on every request to a throttled route, at the moment the database is least able to absorb it.

- [ ] **Step 6: Document the limitation honestly**

`README.md` states the throttle is per-instance and what that implies. This is the case the spec names where a document must say a property **cannot** be demonstrated here rather than show output nobody produced — there is no load balancer in this repository to prove it against.

- [ ] **Step 7: Commit, push, wait**

```bash
git add -A
git commit -m "Throttle the unauthenticated routes that cost CPU"
git push
gh pr checks --watch
```

Then update `docs/NEXT.md`.

---

### Task 24: Spike — advisory locks inside `withRealm`

**The assumption under test:** that a Postgres advisory lock behaves as the scheduler needs it to when taken inside the transaction `withRealm` opens. `packages/db/src/tx.ts` sets realm context with `set_config(..., true)` — the bindable form of `SET LOCAL` — on a **pooled** connection. Two things follow that documentation will not settle: whether a _session_-scoped lock (`pg_advisory_lock`) outlives the transaction and therefore leaks across pooled requests, and whether the _transaction_-scoped variant (`pg_try_advisory_xact_lock`) is the one the reaper should use.

Getting this wrong gives a lock that is either never released — and the reaper runs once, ever — or never held, and two instances reap concurrently.

**Files:**

- Modify: `docs/superpowers/p2b-spike-log.md`
- Create (throwaway): a scratch integration test, deleted in Step 5

- [ ] **Step 1: Write the probe as a throwaway integration test**

Use the existing Testcontainers helper so it runs against the same Postgres version the suite does.

```ts
// packages/db/tests/advisory-lock-spike.int.test.ts   (throwaway)
import { beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { withRealm } from '@odudu/db';
// Setup shorthand — use the package's real harness (see Global Constraints).

it('reports how each advisory lock variant behaves inside withRealm', async () => {
  const db = await testDatabase();
  const realm = await seedRealm(db);

  const taken = await withRealm(db, realm.id, async (tx) =>
    tx.execute(sql`SELECT pg_try_advisory_xact_lock(42) AS got`),
  );
  const again = await withRealm(db, realm.id, async (tx) =>
    tx.execute(sql`SELECT pg_try_advisory_xact_lock(42) AS got`),
  );
  const held = await withRealm(db, realm.id, async (tx) =>
    tx.execute(sql`SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory'`),
  );

  console.log({ taken: taken.rows, again: again.rows, heldAfter: held.rows });
  expect(true).toBe(true);
});
```

- [ ] **Step 2: Add the same probe for the session-scoped variant**

A second block calling `pg_advisory_lock(43)` inside `withRealm`, then counting `pg_locks` **after** that transaction has returned. A non-zero count is the leak: the lock survived the transaction and is now attached to a connection the pool will hand to somebody else.

- [ ] **Step 3: Run it and read the output**

Run: `pnpm exec vitest run --project integration advisory-lock-spike`

The expected answer, to be confirmed rather than assumed: `pg_try_advisory_xact_lock` returns `true` the first time, `true` again in a _separate_ transaction (because the first released at commit), and leaves zero advisory locks behind; `pg_advisory_lock` leaves one behind. If so, the reaper uses the `xact` variant and takes it inside its own transaction.

- [ ] **Step 4: Record the finding**

Append to `docs/superpowers/p2b-spike-log.md` under `## Advisory locks inside withRealm`: the exact test, the logged output verbatim, and the conclusion naming the function Task 26 must call.

- [ ] **Step 5: Delete the probe and commit**

```bash
rm packages/db/tests/advisory-lock-spike.int.test.ts
git add -A
git commit -m "Establish which advisory lock variant is safe inside a pooled realm transaction"
git push
gh pr checks --watch
```

---

### Task 25: `odudu reap` — the retention rule, and the replay-after-pass tests

The headline test of the phase. **Read ADR 0021 before starting.**

**Files:**

- Create: `apps/server/src/cli/reap.ts`
- Create: `apps/server/src/cli/reap.test.ts`
- Modify: `apps/server/src/main.ts`
- Create: `packages/db/drizzle/0038_retention_indexes.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Create: `apps/server/tests/reap.int.test.ts`
- Create: `apps/server/tests/reap-preserves-detection.int.test.ts`
- Modify: `docs/adr/0021-retention-is-bounded-by-the-detection-window.md`
- Modify: `README.md`, `docs/request-paths.md`

**Interfaces:**

- Produces:
  - `reap(db: DatabaseHandle, now: Date, policy: RetentionPolicy): Promise<ReapReport>`
  - `ReapReport = Record<TableName, number>` — rows deleted per table
  - `RetentionPolicy` — one window per table, from the environment with stated defaults

- [ ] **Step 1: Write the migration for the indexes the pass needs**

```sql
-- packages/db/drizzle/0038_retention_indexes.sql
-- A reaping pass scans by age. Without these it is a sequential scan over
-- the largest tables in the schema, which is how a retention pass becomes
-- the reason a deployment falls over at 3am.
CREATE INDEX authentication_sessions_by_expiry ON authentication_sessions (realm_id, expires_at);
CREATE INDEX refresh_tokens_by_expiry ON refresh_tokens (realm_id, expires_at);
CREATE INDEX token_grants_by_created ON token_grants (realm_id, created_at);
CREATE INDEX sessions_by_expiry ON sessions (realm_id, expires_at);
CREATE INDEX action_tokens_by_expiry ON action_tokens (realm_id, expires_at);
```

- [ ] **Step 2: Write the failing test that the phase is judged on**

This file comes **before** the ordinary reaping tests, because it is the one that fails on the wrong implementation while everything else passes.

```ts
// apps/server/tests/reap-preserves-detection.int.test.ts
// `DELETE … WHERE expires_at < now()` passes every test that asserts a
// replayed credential was refused: the broken implementation refuses it too,
// with the same invalid_grant, having simply failed to notice it was a
// replay. These two cases assert the consequence instead — that the family
// was revoked — which is the only thing that distinguishes the two.
import { beforeAll, describe, expect, it } from 'vitest';

describe('reaping does not break reuse detection', () => {
  it('still detects a replayed refresh token and revokes its family', async () => {
    const { refreshToken, grantId, nextToken } = await issueAndRotateOnce();

    await reapEverythingEligible();

    const outcome = await presentRefreshToken(refreshToken);
    expect(outcome.kind).toBe('reused');

    const grant = await readGrant(grantId);
    expect(grant.revokedAt).not.toBeNull();

    // The replacement must be dead too, which is what "revokes the family"
    // means and what a bare refusal would not have achieved.
    await expect(presentRefreshToken(nextToken)).rejects.toMatchObject({
      error: 'invalid_grant',
    });
  });

  it('still revokes the grant behind a replayed authorization code', async () => {
    const { code, grantId } = await redeemCodeOnce();

    await reapEverythingEligible();

    await expect(redeemCode(code)).rejects.toMatchObject({ error: 'invalid_grant' });
    expect((await readGrant(grantId)).revokedAt).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm exec vitest run --project integration reap-preserves-detection`
Expected: FAIL — `reap` does not exist.

- [ ] **Step 4: Write the retention rule**

One rule, applied per table: **a row is deletable once no decision can read it.**

| Table                     | Deletable when                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `authentication_sessions` | expired or consumed, plus a short grace                                                               |
| `authorization_codes`     | the grant family it produced is past its retention — **not** when the code expires                    |
| `refresh_tokens`          | the grant family is past its retention                                                                |
| `token_grants`            | `created_at` plus the detection window: the family's maximum life, longer for an offline family       |
| `sessions`                | past `expires_at` plus a grace, **and no live grant references it**                                   |
| `action_tokens`           | consumed or expired, plus a stated window                                                             |
| `email_outbox`            | sent, plus a stated window; a permanently failed message is kept until an operator could have seen it |

Order matters: grants are considered before the tokens that reference them, and sessions last, because a session is only deletable once nothing references it. The `ON DELETE SET NULL` on `token_grants.session_id` is a backstop — the pass must never rely on it, because relying on it would silently promote a session-bound grant to an offline one.

- [ ] **Step 5: Run the detection tests and watch them pass**

Run: `pnpm exec vitest run --project integration reap-preserves-detection`
Expected: PASS. If they pass with a naive `expires_at` delete, the tests are wrong, not the implementation — re-read Step 2's comment.

- [ ] **Step 6: Write the ordinary reaping tests**

Cases: each table's eligible rows go; each table's ineligible rows stay; the report counts what was deleted; a second pass deletes nothing; the pass is realm-agnostic but respects RLS per realm; and a session with a live grant is **not** deleted.

- [ ] **Step 7: Wire the command**

`process.argv[2] === 'reap'` in `main.ts`, beside `seed`, printing the report and exiting non-zero on failure.

Run: `node apps/server/dist/main.js reap`
Expected: a per-table report of rows deleted.

- [ ] **Step 8: Amend ADR 0021**

Append the window numbers, the `token_grants.created_at` derivation, and the ordering constraint. Amend rather than rewrite: the decision has not changed, its arithmetic is newly expressible.

- [ ] **Step 9: Document and push**

`README.md` and `docs/request-paths.md` gain the command and a real report. Run it against a live stack.

```bash
git add -A
git commit -m "Reap expired state without breaking reuse detection"
git push
gh pr checks --watch
```

Then update `docs/NEXT.md`.

---

### Task 26: The scheduler in `apps/server`

**Gated by Task 24.** Use the lock variant the spike named.

**Files:**

- Create: `apps/server/src/scheduler.ts`
- Create: `apps/server/src/scheduler.test.ts`
- Modify: `apps/server/src/app.ts`, `apps/server/src/main.ts`
- Modify: `apps/server/src/config-guard.ts`
- Create: `apps/server/tests/scheduler.int.test.ts`
- Modify: `docs/adr/` — a new ADR for the loop
- Modify: `CLAUDE.md`
- Modify: `README.md`

**Interfaces:**

- Produces:
  - `startScheduler(options: { intervalMs: number; jitterMs: number; run: () => Promise<void>; log: Logger }): { stop: () => Promise<void> }`
  - `ODUDU_REAP_INTERVAL_SECONDS` (default 3600), `ODUDU_REAP_ENABLED` (default on)

- [ ] **Step 1: Write the failing unit tests with fake timers**

Cases: the run fires after the interval; it does not fire before; jitter keeps it inside the stated band; a throwing run is logged and does **not** stop the loop; `stop()` prevents a further run; and `stop()` awaits a run already in flight rather than abandoning it.

The fourth case is the one that matters for a background loop: a reaping pass that throws once must not silently end reaping for the life of the process.

- [ ] **Step 2: Run, implement, run**

Run: `pnpm exec vitest run --project unit scheduler`

The loop holds no logic — interval, jitter, lock, call. That is the whole file.

- [ ] **Step 3: Write the failing integration test for the lock**

Two schedulers against one database: exactly one pass runs per tick. Assert it by counting deletions or by a sentinel row, not by inspecting `pg_locks` — the property is "the work happened once", not "a lock was taken".

- [ ] **Step 4: Wire it into the server, and make it switchable off**

Registered in `app.ts`, stopped on shutdown. `ODUDU_REAP_ENABLED=false` turns it off for a deployment that schedules `odudu reap` externally — which is the documented alternative, not a hidden one.

- [ ] **Step 5: Write the ADR and update `CLAUDE.md`**

This is the codebase's **first background loop**, so the convention it establishes goes in `CLAUDE.md`: a scheduled pass is a usecase with no timer in it, exposed as a command, with the loop a separate thin file that holds no logic, and it is tested with fake timers rather than by waiting. `CLAUDE.md` currently has no rule about this because there was nothing to have a rule about.

- [ ] **Step 6: Commit, push, wait**

```bash
git add -A
git commit -m "Run the retention pass on a jittered interval behind one lock"
git push
gh pr checks --watch
```

Then update `docs/NEXT.md` and `README.md`.

---

### Task 27: The outbox, and the reset endpoint off the request path

Closes the limitation P2a recorded and P2b was amended to own.

**Files:**

- Create: `packages/db/drizzle/0039_email_outbox.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Create: `packages/email/src/schema/outbox.ts`
- Create: `packages/email/src/repository/outbox.ts`
- Create: `packages/email/src/usecase/send-pending.ts`
- Create: `packages/email/src/usecase/send-pending.test.ts`
- Modify: `packages/email/src/index.ts`
- Modify: `packages/account/src/usecase/reset-password.ts`, `verify-email.ts`, `register.ts`
- Modify: `apps/server/src/app.ts` — the sender joins the scheduler
- Create: `packages/account/tests/reset-timing.int.test.ts`
- Create: `packages/email/tests/outbox.int.test.ts`
- Modify: `README.md`, `docs/request-paths.md`

**Interfaces:**

- Produces:
  - `outboxRepository(tx)` with `enqueue(message)`, `claimBatch(limit, now)`, `markSent(id, at)`, `markFailed(id, error, nextAttemptAt)`
  - `sendPending(db, sender, now, options): Promise<{ sent: number; failed: number }>`

- [ ] **Step 1: Write the migration**

```sql
-- packages/db/drizzle/0039_email_outbox.sql
-- Mail leaves the request path entirely: the request enqueues and answers,
-- and the sender runs on the scheduler. This is what closes the password
-- reset timing oracle, where an address that existed was measurably slower
-- to answer than one that did not because the SMTP round trip happened
-- inside the response.
CREATE TABLE email_outbox (
  id uuid PRIMARY KEY,
  realm_id uuid NOT NULL REFERENCES realms (id) ON DELETE CASCADE,
  to_address text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text
);

ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_outbox FORCE ROW LEVEL SECURITY;

CREATE POLICY email_outbox_isolation ON email_outbox
  USING (realm_id = current_setting('odudu.realm_id', true)::uuid)
  WITH CHECK (realm_id = current_setting('odudu.realm_id', true)::uuid);

CREATE INDEX email_outbox_pending ON email_outbox (next_attempt_at) WHERE sent_at IS NULL;
```

- [ ] **Step 2: Write the failing timing test — the oracle is the assertion**

```ts
// packages/account/tests/reset-timing.int.test.ts
// The visible channel was already closed in P2a: the body and status are
// identical for a known and an unknown address. This asserts the invisible
// one. The SMTP adapter is made deliberately slow, so an implementation that
// still awaits delivery inside the request fails loudly rather than by a few
// milliseconds nobody can measure reliably in CI.
it('answers a known and an unknown address in the same time', async () => {
  const sender = slowSender({ delayMs: 2000 });
  const known = await time(() => requestReset('ada@example.com'));
  const unknown = await time(() => requestReset('nobody@example.com'));

  expect(Math.abs(known - unknown)).toBeLessThan(500);
  expect(known).toBeLessThan(1000);
  expect(sender.sent).toBe(0); // nothing was sent during the request
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm exec vitest run --project integration reset-timing`
Expected: FAIL — the known address takes roughly two seconds longer, which is the oracle.

- [ ] **Step 4: Write the outbox and the sender**

`claimBatch` uses `FOR UPDATE SKIP LOCKED` so two schedulers never send one message twice. A failed send increments `attempts`, records `last_error` and backs `next_attempt_at` off; nothing is deleted here — the reaper owns that.

- [ ] **Step 5: Move all three mailing flows onto it**

Reset, verification and registration all enqueue. None of them awaits a send.

- [ ] **Step 6: Join the scheduler**

The sender runs on the same loop as the reaper, at its own interval.

- [ ] **Step 7: Run everything**

Run: `pnpm test`
Expected: PASS, including the timing test.

- [ ] **Step 8: Delete the README's known limitation**

`README.md`'s password-reset timing-oracle paragraph, and its "P2b owns closing it" note, both go — this is the increment they said they would go in. Replace them with a sentence describing the outbox.

- [ ] **Step 9: Commit, push, wait**

```bash
git add -A
git commit -m "Send mail off the request path, closing the reset timing oracle"
git push
gh pr checks --watch
```

Then update `docs/NEXT.md`.

---

### Task 28: Traceability — four clause tables, their rows, and the census

**Files:**

- Create: `docs/protocols/oidc-rpinitiated.md`
- Create: `docs/protocols/oidc-backchannel.md`
- Create: `docs/protocols/webauthn2.md`
- Modify: `docs/protocols/rfc6238.md` (created in Task 15)
- Modify: `tools/trace/silenced-musts.json`
- Modify: `docs/protocols/oidc-core.md`, `rfc6749.md`

**Interfaces:**

- Produces: every MUST and SHOULD this phase introduced carrying a status, and a census that matches

- [ ] **Step 1: Write the RP-Initiated Logout table**

Every MUST and SHOULD, with these three closed by the test ids from Task 5: §2's confirmation MUST (both triggers — no hint, **or** a hint not belonging to the current session), §3's exact-match MUST, and the `end_session_endpoint` advertisement.

- [ ] **Step 2: Write the Back-Channel Logout table**

Created here even though the feature is P3's, because this phase implements two of its clauses. §2.7's refresh-token rule gets **two** test ids — a session grant revoked and an offline grant surviving are separate assertions. §2.1's `sid` gets Task 4's. Every other row is `deferred: P3` with a reason.

- [ ] **Step 3: Raise the census**

Run: `pnpm test && pnpm trace`
Expected: the tool names the mismatch between `silenced-musts.json` and the MUSTs the new `deferred: P3` rows silence. Raise the recorded count to match, in this commit, so a reviewer sees it.

- [ ] **Step 4: Write the WebAuthn table**

Scoped to the ceremonies a relying party performs — not a browser's or an authenticator's obligations, which are not this server's to hold. A clause about client-side behaviour is `n/a:` with that reason, not `gap`.

- [ ] **Step 5: Verify every row resolves**

Run: `pnpm trace`
Expected: exit 0. No `gap` MUST anywhere, and every `accepted:` row citing a heading the tool confirms still exists.

- [ ] **Step 6: Commit, push, wait**

```bash
git add -A
git commit -m "Trace every clause this phase introduced to a test or a reason"
git push
gh pr checks --watch
```

---

### Task 29: Phase close — the whole-phase documentation pass

**Files:**

- Modify: `README.md`, `docs/request-paths.md`, `docs/NEXT.md`
- Modify: `docs/superpowers/specs/2026-09-10-odudu-design.md`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-09-15-p2b-credentials-mfa-sessions-design.md`

- [ ] **Step 1: Re-run every transcript in `docs/request-paths.md`**

Not the ones this phase added — **all** of them. A phase that changed the session, the flow and the token claims has changed responses in sections written three phases ago. Any command that cannot be run says so instead of showing output.

Run: `pnpm exec vitest run --project unit docs`
Expected: PASS. `tests/docs/` lives in the **unit** project, not integration — `vitest.config.ts` includes `tests/**/*.test.ts` under `unit`, and only `*.int.test.ts` under `integration`, so asking the integration project for it reports "No test files found" rather than failing. It checks only the claims that can be checked mechanically; the rest is read.

- [ ] **Step 2: Check the exit criterion clause by clause against a running stack**

The practice P2a's closing note established. For each clause in the amended criterion — password, TOTP, passkey and recovery-code login; password policies; brute-force protection; the session read with both lifespans; RP-initiated logout; offline access; mail off the request path; reaping on a stated window with the detection test — run it and record what was observed, not what the code suggests.

- [ ] **Step 3: Append the phase-close note to section 11**

In the umbrella spec, following the shape of "P2a closed against its own exit criterion": what was verified, how, and — separately — what P2b leaves for P3 that its criterion never asked for. A phase closing cleanly must not read as a phase closing completely.

- [ ] **Step 4: Rewrite `docs/NEXT.md`'s "Start here" for P3**

What P3 inherits: the session model P2b ships and its single-account-per-browser limitation, the three `select_account` rows now waiting on P3, the `sid` claim it can address a session by, and the introspection that would make revocation real inside an access token's lifetime.

- [ ] **Step 5: Fold this phase's conventions into `CLAUDE.md`**

The background-loop rule from Task 26, and where a server-rendered flow page lives. Both are now precedent; `CLAUDE.md` is where precedent becomes a rule.

- [ ] **Step 6: Mark the spec accepted-and-delivered, with its corrections visible**

The spec already carries two corrections made during planning — the `token_grants` table and logout's confirmation MUST. Add a closing note listing every correction the phase made to its own spec, so the next phase's brainstorm can see what kind of claim went wrong here.

- [ ] **Step 7: Final verification**

Run: `pnpm verify`
Expected: green — format, typecheck, lint, boundaries, build, test, trace.

```bash
git add -A
git commit -m "Close P2b: the phase-wide documentation pass"
git push
```

Run: `gh pr checks --watch`
Expected: `verify`, `container`, `conformance` and `commit-messages` all pass.

- [ ] **Step 8: Take the pull request out of draft and merge**

```bash
gh pr ready
gh pr merge --squash
```

Then use the `superpowers:finishing-a-development-branch` skill for the branch close.

---

## Migration numbering

The spec's section 4 numbered its migrations 0026–0034 before the task order existed, and this plan's order supersedes it. The authoritative sequence:

| Migration | Task | Content                                        |
| --------- | ---- | ---------------------------------------------- |
| 0026      | 1    | `token_grants.session_id`                      |
| 0027      | 2    | `sessions.last_active_at`                      |
| 0028      | 2    | realm session lifespans                        |
| 0029      | 4    | `authorization_codes.session_id`               |
| 0030      | 5    | `client_oidc_config.post_logout_redirect_uris` |
| 0031      | 7    | `authentication_executions`                    |
| 0032      | 9    | `authentication_sessions.satisfied`            |
| 0033      | 10   | `sessions.authenticators`                      |
| 0034      | 12   | `user_credentials` widening                    |
| 0035      | 13   | realm password policy                          |
| 0036      | 14   | `user_required_actions`                        |
| 0037      | 16   | `realms.otp_required`                          |
| 0038      | 22   | `login_failures` and realm lockout settings    |
| 0039      | 25   | retention indexes                              |
| 0040      | 27   | `email_outbox`                                 |

Fifteen migrations, not the nine section 4 sketched. The difference is three the spec folded into prose rather than numbering (`satisfied`, `authenticators`, `otp_required`) and three it did not foresee: the retention indexes, splitting the session columns from the realm columns because they land in different tables, and `authorization_codes.session_id` — without which the session a login establishes never reaches the grant redeemed from its code. If a task runs out of order, the numbering follows what is already in `packages/db/drizzle/`, not this table.

## Self-review notes

**Spec coverage.** Each of the spec's sixteen sections maps to tasks: §3 the session read → 2, 3; §4 the data model → every migration above; §5 the flow engine → 7, 8, 9; §6 credentials → 12–21; §7 logout and offline → 5, 6; §8 reaping → 24, 25, 26; §9 brute force → 22, 23; §10 spikes → 11, 17, 24; §11 testing → distributed, with the four named tests at 3, 15, 22, 25; §12 traceability → 28, with rows closed as they are earned at 3, 6, 10, 22; §13 amendments → landed before this plan; §14 documentation → every task's last step, and 29; §15 risk → the spike gates; §16 exit criteria → 29.

**One spec item deliberately not its own task:** §7.2's statement that logout does not revoke access tokens is documentation, delivered in Task 5 Step 9. There is nothing to implement — the whole point is that no mechanism exists — so a task would have had no test.

**Two tests are written failing in one task and turned green in another**, which is unusual enough to name: Task 13's fourth password-policy case (green in Task 21) and Task 4's offline `sid` case (green in Task 6). Both are recorded in their commit messages rather than left as silent skips, because a skipped test that nobody unskips is indistinguishable from a missing one.

**Type consistency checked across tasks:** `Requirement` (Task 7) is used by `nextStep` (Task 8) and the registry (Task 9); `CredentialSecret` (Task 12) is consumed by Tasks 15–21; `TokenGrantRecord.sessionId` (Task 1) by Tasks 4, 5, 6 and 25; `RetentionPolicy` (Task 25) by Task 26; `AuthenticatorResult.form` widens once (Task 9) and every later authenticator relies on the widened type.
