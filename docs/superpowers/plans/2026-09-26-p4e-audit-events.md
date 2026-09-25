# P4e — Authentication and Token Audit Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write authentication, second-factor, credential, session and token
events into `audit_events`, filterable by `event_type`, with refusals bounded
by the principal they name; close ADR 0036's refresh gap and the
cross-tenant issuer refusal.

**Architecture:** A new `@odudu/domain-audit` package owns the table's
Drizzle declaration, `auditRepository` and a closed vocabulary. Rows are
written in the transaction that did the work; `request_id` and `ip` reach
every row through transaction-local settings `withTenant` binds, the same
way `tenant_id` already does. Refusals that roll back are recorded in a
sibling transaction from the route's `catch`.

**Tech Stack:** TypeScript 6, Fastify, Drizzle over PostgreSQL, Vitest with
Testcontainers, pnpm + Turborepo.

**Spec:** `docs/superpowers/specs/2026-09-26-p4e-audit-events-design.md`

## Global Constraints

- CLAUDE.md applies in full: no `any`, no `void` statements, comment blocks
  of eight lines or fewer, no development-process references in comments,
  `SET LOCAL` semantics only (`set_config(…, true)`).
- Tests precede implementation. Integration tests run against real
  PostgreSQL via `startTestDatabase()` from `@odudu/testkit`.
- Every new repository method is probed with a foreign `tenant_id`
  (`expectCrossTenantMethodProbe` from `@odudu/db/testing`).
- A row never carries a password, client secret, authorization code,
  refresh or access token, client assertion, TOTP or recovery code,
  WebAuthn assertion, or attempted username (spec §6).
- A response is never changed by an audit write: a refusal's status, body
  and headers are identical with and without the row (spec §7).
- Refusal bounds exactly as spec §8's table. No row for an unregistered
  `client_id`, an admin `401`, or a forged foreign-issuer token.
- Each increment is pushed with the PR open, CI green, and the review it
  attracts answered before the next starts (CLAUDE.md, "CI runs on the
  branch").
- `docs/request-paths.md` and `README.md` change in the same commit as the
  behaviour they describe.

## Review Focus

1. **A wrong password, an unknown account and a locked account must still
   answer identically, in bytes and in the statements they run.** The audit
   insert and the client lookup run on every branch, success included —
   Task 3 pins it.
2. **A login submitted twice, concurrently, for the same authentication
   session.** One succeeds; the other must not write a `session.created`
   row for a session that was never created — Task 4 pins it.
3. **A `/token` refusal whose audit write throws** (database down between
   the rollback and the sibling transaction) must still answer the original
   `400`/`401`, not `500` — Task 6 pins it.
4. **An `X-Forwarded-For` spoofed while `ODUDU_TRUST_PROXY` is off** must not
   reach the `ip` column — `request.ip` is already right, so the risk is a
   writer reading a header directly. Task 2 pins it.
5. **A request id longer than any sane value** (`x-request-id` is caller
   supplied) must not fail the transaction or bloat the row — Task 2 pins a
   truncation at 128 characters.

---

## File structure

| Path                                                                   | Responsibility                                                             |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `packages/domain-audit/src/schema/audit-events.ts`                     | moved from `protocol-admin`, unchanged                                     |
| `packages/domain-audit/src/repository/audit.ts`                        | moved; `record` validates against the vocabulary; `list` gains `eventType` |
| `packages/domain-audit/src/service/vocabulary.ts`                      | event types, actions, reasons, per-action `detail` allowlist               |
| `packages/domain-audit/src/service/request-context.ts`                 | `RequestContext` and `requestContextFrom`                                  |
| `packages/db/src/tx.ts`                                                | `withTenant` takes an optional `RequestContext`                            |
| `packages/db/drizzle/0069_audit_request_context.sql`                   | `request_id`/`ip` default from the new settings                            |
| `packages/db/drizzle/0070_grant_userinfo_claims.sql`                   | the grant column and the session FK fix                                    |
| `packages/protocol-oidc/src/service/audit-refusal-budget.ts`           | the budget's interface, key and unlimited default                          |
| `packages/protocol-oidc/src/view/routes/record-refusal.ts`             | the sibling-transaction refusal recorder `/token` and `/revoke` share      |
| `packages/protocol-admin/src/view/routes/admin-tx.ts`                  | the admin routes' one way to open a tenant transaction with context        |
| `tests/lint/audit-vocabulary-coverage.test.ts`                         | every action has a production writer                                       |
| `docs/adr/0037-refusal-rows-are-bounded-by-the-principal-they-name.md` | spec §8                                                                    |

Request context lands first (Task 2, `0069`), so the grant migration is
`0070`; the spec was amended to match when this plan was written.

---

### Task 1: `@odudu/domain-audit`

**Files:**

- Create: `packages/domain-audit/package.json` (copy `packages/domain-authz/package.json`'s shape; name `@odudu/domain-audit`; deps `@odudu/db`, `@odudu/kernel`, `drizzle-orm`; dev `@odudu/testkit`, `vitest`)
- Create: `packages/domain-audit/tsconfig.json` (identical to `domain-authz`'s)
- Create: `packages/domain-audit/src/index.ts`, `src/schema/audit-events.ts`, `src/repository/audit.ts`, `src/service/vocabulary.ts`
- Create: `packages/domain-audit/src/service/vocabulary.test.ts`, `packages/domain-audit/tests/audit.int.test.ts`
- Delete: `packages/protocol-admin/src/schema/audit-events.ts`, `packages/protocol-admin/src/repository/audit.ts`
- Modify: `packages/protocol-admin/package.json`, `apps/server/package.json` (add `@odudu/domain-audit`), every `protocol-admin` import of the two deleted files
- Modify: `tests/boundaries/boundaries.test.ts` (one case: `domain-audit` importing a protocol package is rejected, mirroring the `domain-authz` case at line 24)

**Interfaces — Produces:**

```ts
// vocabulary.ts
export const AUDIT_ACTIONS: {
  readonly admin_access: readonly ['capability.refused', 'token.foreign_issuer'];
  readonly authentication: readonly [
    'login.password',
    'login.otp',
    'login.recovery_code',
    'login.passkey',
    'factor.offered',
    'lockout.tripped',
    'client.authenticate',
  ];
  readonly session: readonly ['session.created', 'session.ended'];
  readonly token: readonly [
    'token.issue',
    'token.refresh',
    'token.exchange',
    'token.revoke',
    'grant.revoked_on_reuse',
    'grant.revoked_on_code_replay',
  ];
  readonly credential: readonly [
    'account.registered',
    'email.verified',
    'password.reset',
    'password.changed',
    'otp.enrolled',
    'passkey.enrolled',
    'recovery_codes.issued',
  ];
};
export type AuditEventType = 'admin_mutation' | keyof typeof AUDIT_ACTIONS;
export const AUDIT_EVENT_TYPES: readonly AuditEventType[];
export type AuditReason =
  | 'unknown_subject'
  | 'bad_credential'
  | 'locked_out'
  | 'replayed'
  | 'already_used'
  | 'subject_mismatch'
  | 'invalid_grant'
  | 'invalid_scope'
  | 'invalid_target'
  | 'unauthorized_client'
  | 'rate_limited'
  | 'foreign_issuer'
  | 'missing_capability';
export type AuditOutcome = 'allowed' | 'refused' | 'failed';

// A discriminated union on `action`; `detail` is the per-action allowlist below.
export type AuditEventInput = AdminMutationInput | VocabularyEventInput;
export function assertDetailAllowed(action: string, detail: Record<string, unknown>): void;
```

The `detail` allowlist, exactly:

| action                             | `detail` keys                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| any `refused` row                  | `reason: AuditReason` (required), plus the keys below                                    |
| `login.*`, `factor.offered`        | `factor: string` (the authenticator name)                                                |
| `client.authenticate`              | `method: string` (the attempted auth method)                                             |
| `token.issue`                      | `grant_type: string`, `scope: string`                                                    |
| `token.refresh`                    | `scope: string`                                                                          |
| `token.exchange`                   | `mode: 'delegation' \| 'impersonation'`, `scope: string`, `requested_token_type: string` |
| `session.ended`                    | `via: 'logout' \| 'admin' \| 'evicted'`                                                  |
| `capability.refused`               | `capability: string`                                                                     |
| everything else in `AUDIT_ACTIONS` | none                                                                                     |
| `admin_mutation`                   | unchanged — P4c's `audit-detail.ts` allowlist owns it                                    |

`AuditEventInput` no longer carries `requestId` or `ip`: Task 2 moves both to
column defaults, so there is one source for each.

- [ ] **Step 1: Write the failing unit tests** in `vocabulary.test.ts`:
  - `assertDetailAllowed('token.issue', { grant_type: 'authorization_code', scope: 'openid' })` does not throw.
  - `assertDetailAllowed('token.issue', { grant_type: 'x', client_secret: 's' })` throws naming `client_secret`.
  - `assertDetailAllowed('login.password', { factor: 'password', reason: 'bad_credential' })` does not throw; with `username: 'alice'` it throws naming `username`.
  - `assertDetailAllowed('login.password', { reason: 'nonsense' })` throws naming the value.
  - `AUDIT_EVENT_TYPES` equals `['admin_mutation', 'admin_access', 'authentication', 'session', 'token', 'credential']`.
- [ ] **Step 2: Run** `pnpm vitest run --project unit packages/domain-audit` — expect FAIL (module missing).
- [ ] **Step 3: Implement `vocabulary.ts`.** `assertDetailAllowed` is a runtime check behind the type-level union, so a cast cannot smuggle a key through; it is a no-op for `admin_mutation`.
- [ ] **Step 4: Write the failing integration test** `tests/audit.int.test.ts`: `record` then `list` round-trips a `token`/`token.issue` row; `list({ eventType: 'token' })` returns it and `list({ eventType: 'session' })` does not; `record` with a disallowed `detail` key rejects and writes nothing; `expectCrossTenantMethodProbe` over `record` and `list`.
- [ ] **Step 5: Move the schema and repository**, call `assertDetailAllowed` at the top of `record`, add `eventType?: AuditEventType` to `AuditEventFilter` and an `eq` condition for it. Repoint `protocol-admin`. Run `pnpm install`.
- [ ] **Step 6: Run** `pnpm vitest run packages/domain-audit packages/protocol-admin packages/db` and `pnpm boundaries` — expect PASS, including `schema-drift.int.test.ts` finding the moved declaration on disk.
- [ ] **Step 7: Commit, push, open the draft PR** (`gh pr create --draft`, body with no tool-attribution line), then `gh pr checks <pr> --watch`.

---

### Task 2: Request context and the `event_type` filter

**Files:**

- Create: `packages/db/drizzle/0069_audit_request_context.sql`
- Create: `packages/domain-audit/src/service/request-context.ts`
- Modify: `packages/db/src/tx.ts` (`withTenant`), `packages/db/tests/tx.int.test.ts`
- Create: `packages/protocol-admin/src/view/routes/admin-tx.ts`; modify every `withTenant(` under `packages/protocol-admin/src/view/routes/` (57 sites: `grep -rn "withTenant(" packages/protocol-admin/src/view/routes | wc -l`)
- Modify: `packages/contracts/src/admin/audit.ts`, `packages/protocol-admin/src/usecase/audit.ts`, `packages/protocol-admin/src/view/routes/audit.ts`, `packages/protocol-admin/tests/audit-list.int.test.ts`
- Modify: `docs/admin-paths.md` (the audit section: the filter and a filled `request_id`/`ip`, re-run)

**Interfaces — Produces:**

```ts
// @odudu/db
export interface RequestContext {
  readonly requestId: string | null;
  readonly ip: string | null;
}
export function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: TenantScopedDatabase) => Promise<T>,
  context?: RequestContext,
): Promise<T>;
// @odudu/domain-audit — re-exports RequestContext, plus:
export function requestContextFrom(request: {
  readonly id: string;
  readonly ip: string;
}): RequestContext;
// @odudu/protocol-admin, view layer
export function adminTx<T>(
  db: Database,
  request: FastifyRequest,
  tenantId: string,
  fn: (tx: TenantScopedDatabase) => Promise<T>,
): Promise<T>;
```

`RequestContext` is declared in `@odudu/db`, because `withTenant` is; the
audit package re-exports it so writers import one name from one place.

Migration `0069`:

```sql
ALTER TABLE audit_events
  ALTER COLUMN request_id SET DEFAULT nullif(current_setting('app.request_id', true), ''),
  ALTER COLUMN ip SET DEFAULT nullif(current_setting('app.client_ip', true), '');
```

`withTenant` binds `app.request_id` and `app.client_ip` with `set_config(…,
true)` in the same statement as `app.tenant_id` when `context` is given.
`requestContextFrom` truncates `id` to 128 characters and takes `ip` from
`request.ip` only — never a header — so `ODUDU_TRUST_PROXY` stays the one
authority over which address is the client's.

- [ ] **Step 1: Write the failing tests.**
  - `tx.int.test.ts`: inside `withTenant(db, t, fn, { requestId: 'r-1', ip: '192.0.2.7' })`, `current_setting('app.request_id', true)` is `'r-1'`; in the **next** transaction on the same pooled connection (pool `max: 1`) it is `''` — proving the setting is transaction-local.
  - `audit-list.int.test.ts`: an admin mutation made with header `x-request-id: probe-123` lists with `request_id: 'probe-123'` and `ip: '127.0.0.1'`; the same request with `x-forwarded-for: 203.0.113.9` and trust-proxy off still lists `ip: '127.0.0.1'`; a 500-character `x-request-id` lists truncated to 128.
  - `audit-list.int.test.ts`: `?event_type=admin_mutation` returns the mutation; `?event_type=token` returns none; `?event_type=bogus` answers `400`.
  - A lint-style case in `packages/protocol-admin/src/view/routes/admin-tx.test.ts` reading every file under `view/routes/` and failing on any bare `withTenant(` outside `admin-tx.ts`, naming file and line — so a route added later cannot skip the context.
- [ ] **Step 2: Run** `pnpm vitest run packages/db packages/protocol-admin` — expect FAIL.
- [ ] **Step 3: Implement** the migration, `withTenant`'s parameter, `requestContextFrom`, `adminTx`, the 57 call-site replacements, and `event_type: z.enum(AUDIT_EVENT_TYPES)` on `listAuditQuerySchema` passed through `listAudit` to the repository filter.
- [ ] **Step 4: Run** `pnpm vitest run packages/db packages/protocol-admin` and `pnpm vitest run tests/docs/admin-paths.test.ts` — expect PASS.
- [ ] **Step 5: Re-run the `docs/admin-paths.md` audit transcript** against a running stack and paste the real output (no language tag on the response fence).
- [ ] **Step 6: Commit, push, watch CI, answer the review.**

---

### Task 3: Login and second-factor rows, and the lockout

**Files:**

- Modify: `packages/authn-flows/src/schema/authenticator.ts` (`AuthenticatorResult`'s failure arm)
- Modify: `packages/authn-flows/src/usecase/executor.ts` (`runPasswordStep`, `runOtpStep`, `runRecoveryStep`, `runPasskeyStep`, `advance`, `AdvanceOptions`)
- Modify: `packages/authn-flows/package.json` (add `@odudu/domain-audit`)
- Modify: `packages/protocol-oidc/src/view/routes/login.ts:147`, `packages/protocol-oidc/src/usecase/login-submission.ts` (`handleLoginSubmission` and its `advance` dep), `packages/protocol-oidc/src/index.ts:673-678`
- Create: `packages/protocol-oidc/tests/audit-login.int.test.ts`

**Interfaces:**

- Consumes: `auditRepository`, `RequestContext`, `AuditReason` (Task 1–2).
- Produces:

```ts
// AuthenticatorResult's failure arm gains:
| { kind: 'failure'; reason: string; audit?: { reason: AuditReason; subjectId: string | null; lockoutTripped?: boolean } }
// handleLoginSubmission's deps.advance gains a trailing `request: RequestContext`.
// AdvanceOptions is unchanged: advance opens no transaction, and the column
// defaults carry the context from the withTenant its caller opens.
```

Rules the implementation must keep:

- The context arrives through the `withTenant` `index.ts` opens: `deps.advance(tenantId, authSessionId, input, request)` passes it as `withTenant`'s fourth argument.
- `actor_client_id` is a uuid, and `record.pendingRequest.clientId` is the OAuth `client_id` (it is what `authorization-request.ts:439` spreads in; `index.ts:297`'s `resolveClientId` exists to map it). `advance` resolves it once with `clientRepository(tx).byClientId` from `@odudu/domain-tenant`, on every path alike.
- `advance` writes exactly one `authentication`/`login.<factor>` row per dispatched step, success or failure, with `resource_type: 'authentication_session'`, `resource_id: authSessionId`, `actor_client_id` from the pending request's client, and `actor_subject_id` from `result.subjectId` on success or `result.audit.subjectId` on failure. The factor-to-action map is `password → login.password`, `otp → login.otp`, `recovery-code → login.recovery_code`, `passkey → login.passkey` (verify the registry keys with `grep -n "PASSWORD =\|OTP =\|RECOVERY_CODE =\|PASSKEY =" packages/authn-flows/src` before writing it).
- `runPasswordStep` sets `audit.reason` to `unknown_subject` when `verification.subjectId === null`, `locked_out` when `isLockedOut(onRecord, now)`, otherwise `bad_credential`; it keeps `recordFailure`'s result and sets `lockoutTripped` when the returned state's `lockedUntil` is non-null and `onRecord.lockedUntil` was null or past. The response stays `invalid_credentials` for all three.
- `advance` writes `lockout.tripped` (`refused`, reason `locked_out`) after the step row when `lockoutTripped` is set.
- A `challenge` from the post-success `dispatchNext` writes `factor.offered`, `allowed`, `detail.factor` the challenged form.
- `SUBJECT_MISMATCH` and a failed `commit()` write the step row as `refused` with `subject_mismatch` and `replayed` respectively. A replayed TOTP (`recordTotpUse` false) is `replayed`; a recovery code the leaf reports `already_used` is `already_used`.

- [ ] **Step 1: Write the failing tests** in `audit-login.int.test.ts`, each driving `POST /tenants/:tenant/login-actions/authenticate` over `app.inject` with `x-request-id` set, and reading rows back through `auditRepository(tx).list({ eventType: 'authentication', limit: 50 })` inside `withTenant` — the same function `GET /audit` calls; `protocol-oidc` may not import `protocol-admin`, and Task 9's transcript drives `GET /audit` itself. Copy `claims-parameter.int.test.ts`'s tenant setup.
  - correct password: one `login.password` row, `allowed`, `actor_subject_id` alice, `request_id` the header's value, `ip` `127.0.0.1`.
  - wrong password: `refused`, `detail.reason: 'bad_credential'`, `actor_subject_id` alice.
  - unknown username `nobody`: `refused`, `unknown_subject`, `actor_subject_id` null, and `JSON.stringify(row)` contains neither `'nobody'` nor the submitted password.
  - failures to the tenant's threshold: exactly one `lockout.tripped` row, on the attempt that crossed it; a further correct-password attempt writes `login.password` `refused` `locked_out`.
  - **the three refusals' HTTP responses are byte-identical** (status, body, and every header except `date` and `x-request-id`), and each wrote exactly one `authentication` row — the insert runs on every branch, so it adds no timing difference between them.
  - OTP-required tenant: password success writes `factor.offered` `detail.factor: 'otp'`; a wrong code writes `login.otp` `refused` `bad_credential`; replaying the accepted code writes `replayed`.
  - recovery code spent twice: second writes `already_used`.
  - foreign-tenant: a row written for tenant A is invisible from tenant B's `withTenant`.
- [ ] **Step 2: Run** `pnpm vitest run packages/protocol-oidc/tests/audit-login.int.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** per the rules above.
- [ ] **Step 4: Run** the new file plus `packages/authn-flows` and `packages/protocol-oidc/tests/login.adversarial.int.test.ts` — expect PASS.
- [ ] **Step 5: Update `docs/request-paths.md`'s login section** with the row a failed login writes, captured against a running stack (a scoped `select … from audit_events where request_id = '<the header>'`, per CLAUDE.md's transcript rules).
- [ ] **Step 6: Commit, push, watch CI, answer the review.**

---

### Task 4: Session rows

**Files:**

- Modify: `packages/authn-flows/src/usecase/session-admission.ts` (eviction rows), `packages/authn-flows/src/repository/sessions.ts` if `endMany` must return the ids it ended
- Modify: `packages/protocol-oidc/src/index.ts` (`completeLogin`, `completeReuse`, the `endSession` dep — each `withTenant` takes the request context)
- Modify: `packages/protocol-oidc/src/usecase/end-session.ts`, `EndSessionInput`
- Modify: `packages/protocol-oidc/src/usecase/logout.ts`, the logout and login routes (thread `RequestContext` into the deps' calls)
- Modify: `packages/protocol-admin/src/usecase/sessions.ts:177` (pass `via: 'admin'`)
- Create: `packages/protocol-oidc/tests/audit-sessions.int.test.ts`

**Interfaces — Produces:**

```ts
// EndSessionInput gains:
readonly via: 'logout' | 'admin';
// CompleteLoginInput gains:
readonly request: RequestContext;
```

- `completeLogin` writes `session.created` (`resource_type: 'session'`, `actor_subject_id`, `actor_client_id` the requesting client) only on the branch that calls `admitSession`, after it returns. A reused session writes nothing — nothing was created.
- `admitSession` writes one `session.ended` `via: 'evicted'` row per session `chooseEvictions` selects, with that session's own subject as actor.
- `endSession` writes `session.ended` with `input.via` as its first statement after `sessionRepository(tx).end`.

- [ ] **Step 1: Write the failing tests:**
  - a login writes exactly one `session.created`, its `resource_id` the `sid` in the issued ID token.
  - a second `/authorize` reusing the session writes no second `session.created`.
  - **two concurrent submissions of the same authentication session** (`Promise.all` over two `app.inject` calls): exactly one `session.created` in total.
  - `max_sessions_per_browser: 1`, two logins in one browser: one `session.ended` `via: 'evicted'` naming the first session.
  - `/logout` with confirmation: one `session.ended` `via: 'logout'`.
  - admin `DELETE /subjects/{id}/sessions/{sid}`: its existing `admin_mutation` row **and** one `session.ended` `via: 'admin'` (in `packages/protocol-admin/tests/sessions.int.test.ts`).
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new file, `session-cap.int.test.ts`, `logout.int.test.ts`, `session-reuse.int.test.ts`, `packages/protocol-admin/tests/sessions.int.test.ts` — expect PASS.
- [ ] **Step 5: Update `docs/request-paths.md`'s logout section** with the row, re-run.
- [ ] **Step 6: Commit, push, watch CI, answer the review.**

---

### Task 5: `requested_userinfo_claims` on the grant, and token success rows

**Files:**

- Create: `packages/db/drizzle/0070_grant_userinfo_claims.sql`
- Modify: `packages/protocol-oidc/src/schema/token-grants.ts`, `packages/protocol-oidc/src/repository/grants.ts` (`create` input)
- Modify: `packages/protocol-oidc/src/usecase/token-issuance.ts` — `issueAuthorizationCodeTokens` (grant create ~572), `issueRefreshTokens` (mint ~711), `issueExchangedTokens` (both grant creates, ~1088 and ~1199), `issueClientCredentialsTokens` (~809)
- Modify: `packages/protocol-oidc/src/usecase/refresh-rotation.ts` (`token.refresh` row in the rotation transaction)
- Modify: `packages/protocol-oidc/src/view/routes/token.ts:77` (pass the request context to `withTenant`), and rotation's sibling `withTenant` (~665)
- Modify: `packages/protocol-oidc/tests/claims-parameter.int.test.ts`, `docs/adr/0036-userinfo-claims-narrowing.md` (amendment)
- Create: `packages/protocol-oidc/tests/audit-tokens.int.test.ts`

Migration `0070`:

```sql
ALTER TABLE token_grants ADD COLUMN requested_userinfo_claims text[];

ALTER TABLE token_grants DROP CONSTRAINT token_grants_session_fk;
-- The column list (PostgreSQL 15+) nulls session_id alone. Unrestricted, SET
-- NULL nulls tenant_id too, and the delete it exists to survive fails on NOT NULL.
ALTER TABLE token_grants ADD CONSTRAINT token_grants_session_fk
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions (tenant_id, id)
  ON DELETE SET NULL (session_id);
```

(Confirm the constraint's current columns first: `psql -c "\d token_grants"` against a migrated test database, since `0057` renamed `realm_id` to `tenant_id`.)

Rows: `token.issue` for `authorization_code` and `client_credentials`
(`detail.grant_type`, `detail.scope`, `resource_type: 'grant'`); `token.exchange`
(`detail.mode` is `impersonation` when no actor token was presented,
otherwise `delegation`); `token.refresh` inside rotation's transaction. All in
the transaction that minted, so a rolled-back mint leaves none.

- [ ] **Step 1: Write the failing tests.**
  - `claims-parameter.int.test.ts`: `[ODUDU-CLAIMS-USERINFO-01]` extended — `claims={"userinfo":{"sub":null}}` with `scope=openid email` gets `{ sub }` from `/userinfo` after the code redemption **and** `{ sub }` after a `refresh_token` redemption. The second assertion is ADR 0036's reproduction and must fail before the fix.
  - A token exchange from that grant's access token: `/userinfo` with the exchanged token also returns `{ sub }`.
  - A migration test in `packages/db/tests/migrate.int.test.ts`: deleting a session a grant references nulls the grant's `session_id` and keeps its `tenant_id` — and **fails against `0069`'s schema** (run it before adding `0070` to see it fail on `NOT NULL`).
  - `audit-tokens.int.test.ts`: code redemption writes one `token.issue` `grant_type: 'authorization_code'`; refresh writes one `token.refresh`; `client_credentials` writes `token.issue` with `actor_subject_id` null; delegation and impersonation exchanges write `token.exchange` with the right `mode`; **no row's JSON contains the issued access token, refresh token, code, or client secret** (the values come from the HTTP responses and requests, not from the rows).
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new file, `claims-parameter`, `refresh-tokens`, `refresh.adversarial`, `token-exchange`, `client-credentials`, `packages/db/tests` — expect PASS.
- [ ] **Step 5: Amend ADR 0036** — a dated "Amendment" section: the follow-up is closed by `0070`, and exchange inherits the value. Update `docs/request-paths.md`'s refresh section's `/userinfo` output, re-run. Remove NEXT.md's `token_grants_session_fk` table row.
- [ ] **Step 6: Commit, push, watch CI, answer the review.**

---

### Task 6: Token refusal rows and `auditRefusalBudget`

**Files:**

- Modify: `packages/protocol-oidc/src/service/errors.ts` (`TokenError`, `TokenRateLimited`)
- Create: `packages/protocol-oidc/src/service/audit-refusal-budget.ts`
- Create: `packages/protocol-oidc/src/view/routes/record-refusal.ts`
- Modify: `packages/protocol-oidc/src/usecase/client-authentication.ts`, `token-issuance.ts` (refusal sites), `refresh-rotation.ts` (reuse), `revocation.ts`
- Modify: `packages/protocol-oidc/src/view/routes/token.ts`, `revoke.ts` (the `catch`)
- Modify: `packages/protocol-oidc/src/index.ts` (`oidcRoutes` deps gain a required `auditRefusalBudget`), `apps/server/src/app.ts` (construct it with `slidingWindow`)
- Create: `packages/protocol-oidc/tests/audit-token-refusals.int.test.ts`

**Interfaces — Produces:**

```ts
export interface TokenRefusalAudit {
  readonly action:
    'client.authenticate' | 'token.issue' | 'token.refresh' | 'token.exchange' | 'token.revoke';
  readonly reason: AuditReason;
  readonly clientDbId: string;
  readonly subjectId?: string;
  readonly grantId?: string;
  readonly method?: string;
}
// TokenError's constructor gains an optional trailing `audit?: TokenRefusalAudit`;
// `withAudit(err: TokenError, audit: TokenRefusalAudit): TokenError` returns a copy carrying it.

export interface AuditRefusalBudget {
  take: (key: string) => 'row' | 'last_row' | 'log';
}
export function auditRefusalBudgetKey(tenantId: string, clientDbId: string): string;
export const UNLIMITED_AUDIT_REFUSAL_BUDGET: AuditRefusalBudget; // always 'row'

export async function recordRefusal(
  deps: { database: DatabaseHandle; logger: Logger; budget: AuditRefusalBudget },
  tenantId: string,
  request: RequestContext,
  audit: TokenRefusalAudit | undefined,
): Promise<void>;
```

`recordRefusal` never throws: an `undefined` audit is a no-op; a budget
answer of `log` is a `warn`; `last_row` writes one row with
`reason: 'rate_limited'`; a database error is caught and logged at `error`.
The production budget in `app.ts` wraps `slidingWindow` (60 s window, 20
rows per client — record both numbers as constants beside the client secret
limiter's): the call that exhausts the window answers `last_row`, later ones
`log` until it reopens.

Which sites attach an annotation (and only these): `verifyClientCredentials`'s
wrong-method and bad-secret branches (registered client, `method` the
attempted one) — **not** its unknown-client branch; `refusePrivateKeyJwt`
and `refuseTlsClientAuth` when the claimed client resolved; `TokenRateLimited`
from the secret limiter (reason `rate_limited`); after authentication:
`unauthorizedClient`, `invalid_grant` on code redemption (reason `replayed`
on replay — the replay's `grant.revoked_on_code_replay` row goes in the
existing sibling revoke transaction), `invalid_scope`, `invalid_target`,
reuse in `rotateRefreshToken` (`grant.revoked_on_reuse` in the rotation
transaction plus a `token.refresh` refusal row), `/revoke`'s
different-client `invalid_grant`. The unknown-client branch logs `warn`
with the tenant and the claimed `client_id`, which is not a secret.

- [ ] **Step 1: Write the failing tests** (budget injected through `oidcRoutes`' deps, never by waiting):
  - wrong secret for a registered client: `401` exactly as before (status, body, headers compared to a run with `UNLIMITED_AUDIT_REFUSAL_BUDGET` and the recorder disabled), plus one `client.authenticate` `refused` `bad_credential` `method: 'client_secret_basic'` row.
  - unregistered `client_id`: `401`, and **zero** rows in the tenant.
  - a budget answering `row, row, last_row, log, log`: five failures write three rows, the third `rate_limited`.
  - `private_key_jwt` with a bad assertion for a registered client: a row with `method: 'private_key_jwt'`, and the response is still `400`/`401`, not `429`.
  - a refused code redemption: its refusal row exists and **no `token.issue` row** exists for that request id.
  - code replay: `grant.revoked_on_code_replay` plus the refusal.
  - refresh reuse: `grant.revoked_on_reuse` and a `token.refresh` refusal `replayed`.
  - `/revoke` of another client's grant: a `token.revoke` refusal; a successful `/revoke` writes `token.revoke` `allowed`.
  - **the recorder's database call throws** (a `database` handle whose `db.transaction` rejects, passed only to `recordRefusal`'s deps): the response is byte-identical to the unaudited run.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new file, `token-client-limit`, `private-key-jwt`, `tls-client-auth`, `token-code.adversarial`, `refresh.adversarial`, `revoke` — expect PASS. `apps/server` tests for `app.ts` wiring — PASS.
- [ ] **Step 5: Write ADR 0037** (`docs/adr/0037-refusal-rows-are-bounded-by-the-principal-they-name.md`, in the repository's ADR shape: Context, Decision, Consequences, Alternatives rejected) from spec §8, citing OWASP, ASVS 5.0 V16 and Keycloak's `EventType.java`. Add it to `docs/adr/README.md`'s index.
- [ ] **Step 6: Update `docs/request-paths.md`'s `/token` refusal sections** with their rows, re-run.
- [ ] **Step 7: Commit, push, watch CI, answer the review.**

---

### Task 7: Admin access rows and the foreign issuer

**Files:**

- Modify: `packages/protocol-admin/src/view/routes/router.ts` (`handleRoute`: the `403` branch; the `401` branch logs)
- Modify: `packages/protocol-admin/src/usecase/authenticate-admin.ts` (`issuer_mismatch` branch), `AuthenticateAdminDeps`/`AdminAuthOutcome`
- Create: `packages/protocol-admin/tests/audit-access.int.test.ts`

**Interfaces — Produces:**

```ts
// AdminAuthOutcome's unauthenticated arm gains an optional
foreignIssuer?: { readonly issuerTenantId: string; readonly subjectId: string; readonly clientDbId: string | null };
// AuthenticateAdminInput gains:
readonly issuerBase: string; // issuerBaseFor(request), from @odudu/protocol-oidc
```

The `issuer_mismatch` branch: strip `issuerBase + '/tenants/'` from `iss`
(anything not of that shape, or a remainder containing `/`, is a plain
`issuer_mismatch`); `findTenant(name)`; skip if absent or disabled;
`listPublishableKeys(tenant.id)`; `verifyJwt` with `ADMIN_API_AUDIENCE` and
`typ: 'at+jwt'`; on success return `unauthenticated('issuer_mismatch')` with
`foreignIssuer` set, the client from `loadGrant(tenant.id, grant_id)` when
present. `handleRoute` records `admin_access`/`token.foreign_issuer`
`refused` (`actor_tenant_id` the issuing tenant) in `adminTx` for the
**target** tenant, catching and logging any throw, then sends the same
`401`. A `403` records `capability.refused` with `detail.capability`
`route.capability` the same way. Other `401`s log `warn` with the reason.

- [ ] **Step 1: Write the failing tests:**
  - a tenant-X admin token at `/admin/tenants/Y/subjects`: `401` identical to a garbage-token `401` (status, body, headers bar `date`/`x-request-id`), and one Y row `token.foreign_issuer` with `actor_tenant_id` X and `actor_subject_id` the token's `sub`; X's trail has none.
  - a token with X's issuer signed by a key X does not hold: `401`, no row anywhere.
  - an `iss` of `https://evil.example/tenants/Y`: `401`, no row.
  - a caller holding `view-audit` only, `POST /clients`: `403`, one `capability.refused` `detail.capability: 'manage-clients'`; the same for a `GET /clients` (reads are recorded too).
  - no bearer token: `401`, no row.
  - the capability matrix suite (`packages/protocol-admin/tests/*capability*`) stays green.
- [ ] **Step 2: Run** — expect FAIL. **Step 3: Implement.** **Step 4: Run** the new file and the whole `packages/protocol-admin` suite — expect PASS.
- [ ] **Step 5: Update `docs/admin-paths.md`** with the foreign-issuer transcript, re-run.
- [ ] **Step 6: Commit, push, watch CI, answer the review.**

---

### Task 8: Credential lifecycle rows

**Files:**

- Modify: `packages/account/src/usecase/register.ts`, `verify-email.ts` (`completeEmailVerification`), `reset-password.ts` (`completePasswordReset`) — their `deps` gain `request: RequestContext`, passed to the `withTenant` each already opens; each writes its row inside it. `packages/account/package.json` gains `@odudu/domain-audit` (`domain-*` is a permitted import for `account`; confirm with `pnpm boundaries`).
- Modify: `packages/authn-flows/src/usecase/update-password.ts`, `totp-enrolment.ts` (`completeTotpEnrolment`), `passkey-enrolment.ts` (`completePasskeyEnrolment`), `recovery-codes.ts` (`beginRecoveryCodes`) — each writes its row in the `tx` it is given; their callers' `withTenant`s take the request context.
- Modify: the routes that call them (`grep -rn "completePasswordReset\|completeEmailVerification\|register(\|completeUpdatePassword\|completeTotpEnrolment\|completePasskeyEnrolment\|beginRecoveryCodes" packages/*/src apps/server/src | grep -v test`)
- Create: `packages/protocol-oidc/tests/audit-credentials.int.test.ts`, `packages/account/tests/audit-account.int.test.ts`

Rows: `credential`/`<action>`, `allowed`, `resource_type: 'subject'`,
`resource_id` and `actor_subject_id` the subject. Only on success — a
refused reset (a bad token) writes nothing, since it names nobody the
caller has proven anything about, and a password-policy refusal is a form
error, not an authentication decision. `beginRecoveryCodes` writes on every
call, including the forced first set.

- [ ] **Step 1: Write the failing tests:** each flow driven over HTTP writes exactly one row of its action; a reset submitted with a known new password leaves no row whose JSON contains it; an expired reset token writes no row.
- [ ] **Step 2: Run** — expect FAIL. **Step 3: Implement.** **Step 4: Run** the new files, `packages/account`, `totp-enrolment`, `passkey-enrolment` — expect PASS.
- [ ] **Step 5: Update `docs/request-paths.md`'s registration and reset sections**, re-run.
- [ ] **Step 6: Commit, push, watch CI, answer the review.**

---

### Task 9: Coverage, documents and the phase-close pass

**Files:**

- Create: `tests/lint/audit-vocabulary-coverage.test.ts`
- Modify: `README.md`, `docs/request-paths.md`, `docs/superpowers/specs/2026-09-10-odudu-design.md` §11, `docs/NEXT.md`
- Create: `docs/phases/p4e.md`

- [ ] **Step 1: Write the coverage test.** For every action in `AUDIT_ACTIONS`, grep `packages/*/src/**/*.ts` excluding `*.test.ts`, `testing/` and `packages/domain-audit/` for the quoted literal; fail naming each action with no production writer. Negative control: a case that runs the same function over a fixture directory writing all but one action and asserts it names that one — so the test is shown able to fail.
- [ ] **Step 2: Run** `pnpm vitest run tests/lint/audit-vocabulary-coverage.test.ts` — PASS; delete one writer locally and see it FAIL naming the action, then restore.
- [ ] **Step 3: `README.md`**: the audit section lists the event types, states that refresh rows dominate growth and `audit_retention_days` bounds them, and that unbounded refusals go to logs (ADR 0037).
- [ ] **Step 4: One end-to-end transcript in `docs/request-paths.md`**: a login, a refresh and a logout, then `GET /admin/tenants/{t}/audit?event_type=token` and `?event_type=session`, executed against the stack the document builds.
- [ ] **Step 5: Umbrella §11**: P4e's row names credential events and 40–60 h; P10's criterion names an `EventListener` that receives a tenant's audit events; P11's names `auditRefusalBudget` among the per-process bounds.
- [ ] **Step 6: `docs/phases/p4e.md`** in `p4c.md`'s shape: what turned out wrong while building. `docs/NEXT.md`: position moves to P4d; remove the cross-tenant and `token_grants_session_fk` table rows and the "Only `POST /clients` and the capability ceilings record a refusal" section; what P4d inherits (events to show). `pnpm vitest run tests/docs` — PASS, including `next-budget`.
- [ ] **Step 7: The closing pass** from CLAUDE.md, in order: read "What is not implemented" in `request-paths.md` and check each marker is still true; grep every document for `P4e` and for any phase number moved; read NEXT.md's headings against closed phases; reconcile the roadmap against the not-implemented list both ways.
- [ ] **Step 8: Whole-branch review**, then `superpowers:finishing-a-development-branch`.
