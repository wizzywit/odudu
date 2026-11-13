# P4f Self-service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the "me" API (the End-User's own token, own audience) and application-initiated actions, plus the rest of the P4f row of section 11, as 14 mergeable increments (7 and 13 each in three parts).

**Architecture:** A new package `@odudu/me` sits above `protocol-oidc` as `mcp` does (ADR 0051) and serves the "me" routes; a `/authorize` parameter names an action and the existing required-action pages carry it out; the "me" API's credential list is the authority for the outcome. Everything else (recovery bound, notice mail, authenticator policy, session device, lifecycle fixes) is per-increment work in the packages that already own the topic.

**Tech Stack:** TypeScript, Fastify 5, Drizzle on PostgreSQL with RLS, Zod 4, Vitest 5 with Testcontainers, pnpm and Turborepo.

**Spec:** `docs/superpowers/specs/2026-11-11-p4f-self-service-design.md` (sections cited as "spec §n"). Read it and the repository's `CLAUDE.md` first.

## Global Constraints

- Every implementer and reviewer runs on Sonnet 5.5; ask the owner before any higher model.
- Tests precede implementation; integration tests run against real PostgreSQL; every repository method is probed with a foreign `tenant_id`; `SET LOCAL` only.
- No `any`, no `void` statements, no `git stash`; heavy jobs (docker, e2e, int suites) go through the heavy-slot lock.
- Five layers; a usecase and a repository hold no logic, no phrasing, no formatting; each rule, message and mapping is a pure `service` function.
- A page is a `*-html.ts` in a `view` layer, its kind registered in `packages/kernel/src/page-kinds.ts`; every string is a catalogue entry with an Arabic twin; every origin comes from `TenantAddress`; headers come from `pageHeaders`.
- Comments carry only what code cannot say, never reference tasks, steps, plans or phases, and no block runs past eight lines.
- Commit subject at most 72 characters, body at most 8 lines, no tool-attribution trailer in a commit or a pull request description.
- Each path states its behaviour at 1,000,000 subjects, 10,000 clients, 100,000,000 audit events (ADR 0041): bounded under `MAX_LIMIT`, indexed, a constant number of queries.
- A new route owns a transcript re-run on a live stack; a new `ODUDU_*` variable owns its documentation; a user-visible change owns a line under `## [Unreleased]` in `CHANGELOG.md`.
- One pull request per increment into `p4f/self-service` (PR 193 stays the phase PR into `main`); push at the end of each increment; an increment ends when CI is green and the review it attracted is answered.
- Every migration begins with `ls packages/db/drizzle | tail -1`; take the next number (0125 at the time of writing) and check the table name is free with `git grep -n "<name>" -- packages/db`.

## Review Focus

Failure modes the spec implies that no single task's happy path exercises, most likely first. Each has its test in the task named.

1. A token whose session has ended, presented at a gated route: `401` with no `insufficient_user_authentication` challenge (Task 2.2).
2. A token carrying `act` at any "me" write or action request: refused; a human token for the same call succeeds (Tasks 2.1, 3.2).
3. Two concurrent removals of the last two sign-in methods: exactly one succeeds, the other gets the stable refusal; the subject row is locked as `onSecondFactorRemoved` does (Task 2.3).
4. `/authorize` with an unknown action, a repeated `action` parameter, an action the client may not start, or a client with allowed actions but no `me:read`: `invalid_request` to the validated redirect, never a silent ignore (Task 3.2).
5. Two simultaneous recovery re-issues within an hour: one wins, the other is refused with the retry time; neither double-spends the hour (Task 5.1).

## File Structure

- `packages/me/` (new): `src/{view,usecase,repository,adapter,service}`; `view` holds routes, `adapter` the wire shapes, `service` the freshness rule, removal rule and error mapping. Exports `registerMeRoutes`. Imported only by `apps/server`.
- `packages/contracts/src/me/` (new): request and response schemas shared with the docs generator.
- `packages/protocol-oidc/src/service/me-scopes.ts` (new): `ME_READ_SCOPE`, `ME_WRITE_SCOPE`, `scopeAllowedAt` extension, beside `mcp-scopes.ts`.
- `packages/kernel/src/address.ts`: `ME_RESOURCE_PATH`, `meAudienceOfIssuer`.
- `packages/protocol-oidc/src/usecase/authorization-request.ts` and `service/authorize-validation.ts`: the `action` parameter and `action_status`.
- Existing homes for the rest: `packages/authn-flows` (actions, recovery, policy, flows), `packages/account` (mail, links, verification), `packages/domain-identity` (credentials, reconcile), `packages/domain-tenant` (settings), `packages/protocol-admin` and `packages/contracts/src/admin` (admin surface), `apps/admin-console` (console), `apps/docs` (pages and transcripts).

## Spikes (run first, each a shell command; results go in `docs/phases/p4f.md`)

- [ ] **S1: `/authorize` forces a new login for an expired `max_age` and for `prompt=login`.**
      verified (by reading): `git grep -n "withinMaxAge\|reuseIsStale\|prompts.has('login')" -- packages/protocol-oidc/src/usecase/authorization-request.ts` shows the reuse check at lines 580 and 845. Run it live: write the integration test in Task 3.2's file first as `it.todo`-free spike `apps/server/tests/p4f-spike-maxage.int.test.ts`, delete it after recording the result.
- [ ] **S2: `acr` reflects a second factor.** verified: `packages/protocol-oidc/src/service/acr.ts` `acrFor` returns `'2'` when two factors ran (password plus otp counts 2; a passkey counts 2). Assert with `pnpm --filter @odudu/protocol-oidc test -- acr`.
- [ ] **S3: the access token carries `sid`.** verified (by reading): `token-issuance.ts:529` adds `sid` when `input.sessionId !== null`. A grant without a session (client_credentials) has none; the "me" API refuses such a token at gated routes with `401` and no challenge, which spec §10a already says.
- [ ] **S4: where tokens are verified.** The MCP door calls `deps.verifyAccessToken(tenantId, token, {issuers, audience})` (`packages/mcp/src/usecase/validate-mcp-token.ts:77`, wired at `apps/server/src/mcp-deps.ts:167`). assumption: the same dependency serves a third audience. Run `sed -n 150,200p apps/server/src/mcp-deps.ts` and confirm it takes the audience as an argument.
- [ ] **S5: the mailed link has no client today.** `git grep -n "client" -- packages/account/src/schema/action-tokens.ts packages/account/src/service/action-link.ts`; record whether a client column exists.
- [ ] **S6: the browser identifier.** `git grep -n "device" -- docs/adr/0033*.md packages/authn-flows/src/schema/sessions.ts` found no device column on `sessions` (`schema/sessions.ts` has no such field). Record what ADR 0033's text defers, for Increment 8.
- [ ] **S7: the next migration is 0125.** verified: `ls packages/db/drizzle | tail -1` printed `0124_agent_write_budget.sql`.

---

## Increment 1: The "me" audience, scopes, door, read endpoints (about 6 h)

### Task 1.1: ADR 0052, the package, the boundary rules

**Files:** Create `docs/adr/0052-the-me-package-sits-above-protocol-oidc.md`, `packages/me/{package.json,tsconfig.json,src/index.ts}`. Modify `.dependency-cruiser.cjs`, `tests/boundaries/boundaries.test.ts`, `docs/adr/README.md`, `pnpm-workspace` inclusion check.
**Interfaces:** Produces `@odudu/me` exporting `registerMeRoutes(app, deps: MeDeps): void` (stub for now).

- [ ] **Step 1:** Write the ADR (status Accepted, today's date) stating the allowlist and the imported-only-by-server rule, copied in shape from ADR 0051; cite it.
- [ ] **Step 2:** Add fixtures to `tests/boundaries/boundaries.test.ts` asserting `me-allowlist` (kernel, contracts, domain packages, protocol-oidc only) and `me-imported-only-by-server` fail on a violating import. Run `pnpm vitest run tests/boundaries` and see them fail.
- [ ] **Step 3:** Add the two rules to `.dependency-cruiser.cjs` modelled on `mcp-allowlist` and `mcp-imported-only-by-server` (`git grep -n "mcp-allowlist" .dependency-cruiser.cjs`). Declare dependencies in `package.json` explicitly.
- [ ] **Step 4:** Run the boundary tests green; `pnpm --filter @odudu/me typecheck`.
- [ ] **Step 5:** Commit `docs(p4f): add ADR 0052 and the me package boundary`.

### Task 1.2: Audience and scopes

**Files:** Modify `packages/kernel/src/address.ts`, `packages/kernel/src/index.ts`, `packages/domain-tenant/src` (where `MCP_SCOPES` lives: `git grep -n "MCP_SCOPES =" packages/domain-tenant`), `packages/protocol-oidc/src/service/mcp-scopes.ts` (extend `scopeAllowedAt` and `scopesCoherentWithAudience`), `packages/protocol-oidc/src/usecase/authorization-request.ts` (audience selection beside line 416). Create `packages/protocol-oidc/src/service/me-scopes.ts`. Tests beside each.
**Interfaces:** Produces `meAudienceOfIssuer(issuer: string): string` returning `${issuer}/me`; `ME_READ_SCOPE = 'me:read'`, `ME_WRITE_SCOPE = 'me:write'`, `ME_SCOPES`; `scopeAllowedAt` allows an ME scope only at the me audience.

- [ ] **Step 1:** Tests: `meAudienceOfIssuer('https://a.test/t')` equals `'https://a.test/t/me'`; `scopeAllowedAt('me:read', mcpAud, ...)` is false; at the me audience true; `me:write` with only `me:read`-less request is refused at registration (client may hold `me:write` only with `me:read`); a built-in scope name collision is refused as `mcp:*` is (`git grep -n "built-in scope" packages/protocol-oidc/src`).
- [ ] **Step 2:** Run, see them fail. **Step 3:** Implement the signatures above; tenant registration policy governs Dynamic Registration exactly as `mcp:*` (reuse the same ceiling check, ADR 0040). **Step 4:** Run green. **Step 5:** Commit `feat(oidc): add the me audience and its two scopes`.

### Task 1.3: The door

**Files:** Create `packages/me/src/usecase/validate-me-token.ts`, `packages/me/src/service/me-token.ts`; test beside.
**Interfaces:** Consumes `deps.verifyAccessToken` (S4). Produces `validateMeToken(deps, input): Promise<MeAuthOutcome>` where success is `{kind:'ok', subjectId, tenantId, clientId, sessionId: string|null, scopes: string[], isAgent: boolean}` (`isAgent` true when the payload has an `act` claim: assumption: the agent token's marker is the RFC 8693 `act` claim per ADR 0050; confirm with `git grep -n "act:" packages/protocol-oidc/src/usecase/mint-agent-token.ts` or the file `git grep -ln mintAgentToken` names).

- [ ] **Step 1:** Tests, one per refusal: missing credentials; wrong audience (an MCP-audience token, an admin-audience token, a `/userinfo` token); token for another tenant's issuer; expired; `sub` missing; session ended (`sid` present, row gone) is `401` with no challenge.
- [ ] **Step 2:** Implement modelled on `validateMcpToken`, audience `meAudienceOfIssuer(accepted issuer)` plus the reverse check: add the me audience to the refusals in `validateMcpToken`, the admin door (`authenticate-admin.ts`) and `/userinfo` (`git grep -n "audience" packages/protocol-oidc/src/usecase/userinfo.ts`), each with a test.
- [ ] **Step 3:** Run green; commit `feat(me): authenticate the person's own token`.

### Task 1.4: Read endpoints

**Files:** Create `packages/contracts/src/me/{profile,credentials,sessions,consents}.ts`, `packages/me/src/{view/routes.ts,usecase/reads.ts,repository/reads.ts,adapter/dto.ts,service/credential-view.ts}`, `packages/me/src/index.ts`; modify `apps/server/src/*` where `registerMcpRoutes` is wired (`git grep -n "mcp" apps/server/src/app.ts`).
**Interfaces:** Produces `GET {issuer}/me/profile`, `/me/credentials` (type, label, created, lastUsed, plus `recovery_codes_left: number`), `/me/sessions` (with `device` null until Increment 8), `/me/consents`; each requires `me:read`, takes `limit`/`cursor` bounded by `MAX_LIMIT`, returns `{items, next_cursor}`. No route accepts a subject id.

- [ ] **Step 1:** Integration tests on real PostgreSQL: each endpoint returns only the token's subject's rows; a foreign-tenant probe of each repository method returns nothing; a person with `MAX_LIMIT + 1` sessions gets a bounded page and a cursor; secrets (`secret_data`, seeds, keys) appear in no response (assert by key scan); `me:write`-only token is refused on reads; an `act` token is allowed on reads (spec §5.9 bars writes only).
- [ ] **Step 2:** Implement repositories reading `user_credentials`, `sessions`, consents via `domain-identity` repositories where they exist (`git grep -n "consent" packages/domain-identity/src/repository`), adding only the missing list-by-subject methods, each indexed on `(tenant_id, subject_id)`; confirm the index exists: `git grep -n "subject_id" packages/db/drizzle/*sessions*.sql`.
- [ ] **Step 3:** Add the query-plan check for each new query in `apps/server/tests/query-plans.plan.test.ts` (follow its existing entries).
- [ ] **Step 4:** Route tests plus `tests/lint` green; run `pnpm verify`.
- [ ] **Step 5:** Add the coverage test `apps/server/tests/me-door-coverage.int.test.ts`: read the "me" route table and the MCP route table; every pair refuses the other's token. Commit `feat(me): read the person's profile, credentials, sessions, consents`.

### Task 1.5: Docs, transcript, push

- [ ] Transcript `apps/docs/content/en/reference/transcripts/request-paths/` page for `/me/credentials` re-run on a live stack (see `apps/docs/content/en/contributing/transcripts.md`); `CHANGELOG.md` Added line; `docs/phases/p4f.md` start; push, watch `gh pr checks`, answer review threads. Rebuild `odudu-try:3090` and give the try-list.

---

## Increment 2: The freshness gate and writes (about 6 h)

### Task 2.1: Write routes without the gate

**Files:** `packages/me/src/{view/routes.ts,usecase/writes.ts,repository/writes.ts}`, contracts.
**Interfaces:** `PATCH /me/profile` (fields the tenant lets a person edit: `git grep -n "editable" packages/domain-tenant/src` to find the existing setting, else add `profile_editable_fields` tenant setting in this task), `DELETE /me/sessions/{id}`, `DELETE /me/sessions` (all others), `DELETE /me/consents/{client_id}`, `PATCH /me/credentials/{id}` (label), `DELETE /me/credentials/{id}`; all need `me:write`.

- [ ] **Step 1:** Tests per route: effect and audit row (existing kinds, `git grep -n "admin-mutation-actions" packages/domain-audit`); `act` token refused with `403 insufficient_scope`-style problem code `agent_not_permitted`; foreign-tenant probe; deleting the caller's own session succeeds and the response says the token's session ended (spec §10a).
- [ ] **Step 2:** Implement; ending sessions reuses the existing revocation usecase (`git grep -n "revokeSession\|endSession" packages/authn-flows packages/protocol-oidc`).
- [ ] **Step 3:** Run green; commit `feat(me): amend profile and end sessions and consents`.

### Task 2.2: The gate

**Files:** `packages/me/src/service/freshness.ts`, `usecase/freshness-gate.ts`, tenant setting migration (`session_freshness_seconds`, default 300, bound 30 to 3600) in `packages/db/drizzle/<next>` and `packages/domain-tenant`.
**Interfaces:** `isFresh(authTime: Date, now: Date, windowSeconds: number): boolean` (pure); `freshnessChallenge(windowSeconds: number, acrValues: string | null): string` returns the `WWW-Authenticate` value `Bearer error="insufficient_user_authentication", error_description="…", max_age="<n>"` plus `acr_values="2"` when given (RFC 9470 §3; verified from the RFC text read 2026-11-10, spec §3).

- [ ] **Step 1:** Unit tests: boundary exactly at the window; challenge string for both forms. Integration tests: a gated route with an old session answers `401` with the header; a fresh one proceeds; ended session answers `401` with no challenge (Review Focus 1); `auth_time` is `sessions.created_at` (S1: `authorization-request.ts:296` takes `session.createdAt`).
- [ ] **Step 3:** Gate removal, bulk end, consent revoke and address or username edit (spec §5.2); the gate reads the session row named by `sid`, once, on gated requests only.
- [ ] **Step 4:** Tenant setting exposed in admin API, console, and docs config page where tenant settings are (`git grep -n "agent_write" packages/contracts/src/admin` for a recent sibling to copy). Commit `feat(me): gate sensitive changes on a fresh sign-in`.

### Task 2.3: The removal rule

**Files:** `packages/me/src/service/removal-rule.ts`, `usecase/remove-credential.ts`, message catalogue entry `me.error.lastSignInMethod` (+ Arabic).
**Interfaces:** `canRemove(held: CredentialSummary[], target: CredentialSummary, tenantRequiresSecondFactor: boolean): {ok: true} | {ok: false, code: 'last_sign_in_method' | 'last_second_factor'}` (spec §10b). Remove inside one transaction with the subject row locked, then call `onSecondFactorRemoved` (`packages/authn-flows/src/usecase/second-factor-removed.ts`).

- [ ] **Step 1:** Unit table tests for `canRemove` covering: password plus one passkey (passkey may go), only passkey (refused), tenant requires second factor and last TOTP (refused), last passkey with password (allowed). Integration: concurrent removal race (Review Focus 3) with `Promise.all`, one `204`, one `409 last_sign_in_method`.
- [ ] **Step 2:** Implement; gated and `acr_values="2"` in the challenge where the subject holds a second factor.
- [ ] **Step 3:** Commit `feat(me): refuse removing the last way to sign in`. Then docs, transcript, CHANGELOG, push as Task 1.5.

---

## Increment 3: Application-initiated actions (about 6 h)

### Task 3.1: Client allowance

**Files:** migration adding `allowed_actions text[] NOT NULL DEFAULT '{}'` on the client's OIDC config (`packages/protocol-oidc/src/schema/client-oidc-config.ts`), contracts `packages/contracts/src/admin/clients.ts`, admin usecase `packages/protocol-admin/src/usecase/clients.ts`, console client page, CLI and seed command (`git grep -n "web-origin" packages apps tools` finds the flag pattern to copy).
**Interfaces:** `requiredActionSchema` values are the only legal entries; a client with any entry must hold `me:read` (refused otherwise, `allowed_actions_need_me_read`).

- [ ] **Step 1:** Tests: admin PUT with an unknown action, and with an action but no `me:read`, is refused; default empty; audit detail lists the change. **Step 2:** Implement across the five surfaces; `pnpm docs:screenshots` for the console. **Step 3:** Commit `feat(clients): choose which actions a client may start`.

### Task 3.2: The `/authorize` parameter and `action_status`

**Files:** `packages/protocol-oidc/src/service/authorize-validation.ts` (parse `action`), `usecase/authorization-request.ts` (decide), `service/oauth-errors.ts`, `packages/authn-flows` pages reuse, `packages/kernel/src/page-kinds.ts` (a "cancel" control needs no new kind if the existing page has a way back: check `required-actions-html.ts`).
**Interfaces:** `parseAction(params): {kind:'none'} | {kind:'action', action: RequiredAction} | {kind:'invalid'}` (pure, rejects repeats and unknown names); the redirect gains `action_status=success|cancelled|error`; the action runs through the existing required-action executor (`packages/authn-flows/src/usecase/executor.ts`).

- [ ] **Step 1:** Tests (Review Focus 4): unknown value, repeated parameter, not-allowed action, no `me:read` all return `invalid_request` to the validated `redirect_uri` (never before the redirect URI is validated); allowed action issues a normal code response plus `action_status`; `action_status` is absent when no action asked; a session older than the window forces login first (spec §5.3) and the `update-password` page asks for the current password regardless; an `act` token cannot start one (the request is a browser flow with no bearer, so test that the agent-marked grant is refused: assumption: confirm how an agent session is marked with `git grep -n "agent" packages/authn-flows/src/schema`).
- [ ] **Step 2:** Implement; every outcome writes the audit row (requested, completed, cancelled, failed) naming the client.
- [ ] **Step 3:** Docs: guide `apps/docs/content/en/guides/` page "Send a person to change a credential" stating that `action_status` is a hint and the credential list is the authority (spec §5.3); transcript. CHANGELOG. Commit `feat(oidc): let a client start a credential action`.
- [ ] **Step 4:** Push, CI, try-list.

---

## Increment 4: A place to return to for an administrator-issued link (about 3 h)

- [ ] **Task 4.1:** S5 result decides the column. Migration adding nullable `client_id` to the action-token table (`packages/account/src/schema/action-tokens.ts`); admin API issue-link request gains optional `client_id` (`packages/contracts/src/admin/subjects.ts`); the link's finishing page redirects to the client's registered `redirect_uri` with `action_status`, else the tenant account page. Tests: a client not in the tenant is refused (cross-tenant probe); absent client keeps today's behaviour byte-identically. Transcript for the admin route. Commit `feat(account): return an issued link to a named client`.

---

## Increment 5: Recovery codes (about 4 h)

### Task 5.1: Early re-issue and the bound

**Files:** migration adding `last_issued_at timestamptz` to the recovery set (assumption: recovery codes are rows in `user_credentials` with `type='recovery-code'`, per `credentials.ts:269`; a set marker needs a home: spike `git grep -n "recovery" packages/db/drizzle | head` and add the column to `subject` or a `recovery_sets` table in the migration, the choice recorded in the phase note). `packages/authn-flows/src/usecase/recovery-codes.ts`.
**Interfaces:** `reissueAllowed(lastIssuedAt: Date | null, spentAll: boolean, now: Date): {ok: true} | {ok: false, retryAt: Date}` (pure; first generation and a used-up set are exempt, spec §10a); the issue is one conditional `UPDATE … WHERE last_issued_at IS NULL OR last_issued_at <= now - interval '1 hour'` so concurrent calls cannot both pass (Review Focus 5).

- [ ] Tests first: concurrent pair (one wins); retry time in refusal; audit row; foreign-tenant probe. Implement; commit.

### Task 5.2: The warning

- [ ] Tenant threshold setting `recovery_code_warn_below` (admin, console, docs); pure `recoveryWarning(unspent: number, threshold: number): boolean`; shown on the page after sign-in, never mid-login (assert by test that the login flow's step list is unchanged); `/me/credentials` returns `recovery_codes_low: boolean`. Catalogue entries + Arabic. Docs, transcript, CHANGELOG, push.

---

## Increment 6: Notice mail on a factor change (about 4 h)

- [ ] **Task 6.1:** Pure `noticeRecipient(address: string | null, verified: boolean): {send: true, to: string} | {send: false, reason: 'unverified' | 'none'}`. On a subject's own enrolment, removal or new recovery set, queue the mail in the same transaction through the outbox the admin removal already uses (`git grep -n "second-factor\|removal.*mail" packages/account packages/protocol-admin`), branded through `resolveMailBranding` (`packages/domain-theme/src/usecase/resolve-branding.ts:97`). Unverified: the change is allowed, nothing is sent, the audit row carries `notice: 'skipped_unverified'`.
- [ ] **Task 6.2:** Catalogue entries and Arabic twins; mail template in `packages/email`; tests: sent once per change, verified only, text lint `tests/lint/server-page-literals.test.ts` green. CHANGELOG (Security). Push.

---

## Increment 7: Authenticator policy, in three parts (about 4 h each)

- [ ] **7a, TOTP, WebAuthn, recovery count.** Migration adding to the enrolment rows the parameters they were made under (assumption: TOTP rows' `secret_data` JSON may already hold algorithm, digits, period: `git grep -n "digits\|period" packages/authn-flows/src/service/authenticators`; add what is missing, backfilling existing rows with today's defaults in the same migration, idempotent as 0124 is). Tenant settings: `totp_algorithm` (`SHA1|SHA256|SHA512`), `totp_digits` (6 or 8), `totp_period` (30 or 60), `webauthn_user_verification`, `webauthn_resident_key`, `recovery_code_count`. Verification reads the row's own parameters, never the tenant's current ones. Test: change policy, an old enrolment still verifies, a new one uses the new values. Admin API, console, docs.
- [ ] **7b, the passkey switch.** Tenant `require_passkey` boolean; on sign-in a subject without a passkey is given `configure-passkey` through `requiredActionRepository(tx).add`; test that existing sessions are untouched and the action appears at the next sign-in only.
- [ ] **7c, per-step configuration.** The same settings applied per sign-in step in the flow configuration (depends on 13a's model: if the flow model is not yet present, the settings live on the tenant and 13b moves them; record the choice). Docs, CHANGELOG, push each part.

---

## Increment 8: Session device identity and ADR 0033 (about 5 h)

- [ ] **Task 8.1:** Measurement first: write `apps/server/tests/session-cap-k.int.test.ts` running `k` concurrent logins against the cap and recording the admitted count and the orphan (ADR 0033 text, `docs/adr/0033-admitting-a-session-locks-the-tenant-row.md`); the result decides exact or bounded. Amend ADR 0033 stating the identifier and the decision with the measurement.
- [ ] **Task 8.2:** Migration adding `device_id text` to `sessions` (nullable, backfilled null); derive a stable identifier from a long-lived, HttpOnly, same-site cookie set at first login (pure `newDeviceId(random: () => Uint8Array): string`); `/me/sessions` returns it as `device` (an opaque id plus the existing user-agent summary if one is stored: check `git grep -n "user_agent" packages/db/drizzle`). Console session lists show the grouping. Tests: same browser, two sessions, one device; foreign tenant probe; index on `(tenant_id, subject_id)` unchanged (query-plan check). Docs, CHANGELOG, push.

---

## Increment 9: Password change (about 4 h)

- [ ] **Task 9.1:** After a change or reset the page offers "End my other sessions", default checked (ASVS 3.3.3, spec §5.3 table); a form field `end_other_sessions`; usecase calls the existing revoke-others path; test both values, and that the session in use survives. Catalogue + Arabic.
- [ ] **Task 9.2:** `BreachedPasswordSource` interface `{isBreached(password: string): Promise<boolean>}`; two implementations: operator-loaded dataset (`odudu breached-passwords load <file>` command, table of truncated SHA-1 prefix and suffix, chunked load) and the remote k-anonymity lookup bounded as ADR 0028 bounds a fetch (fixed host, timeout, size, per-tenant concurrency). Tenant settings `breached_check` (`off|dataset|remote`) and `breached_on_error` (`open|closed`). Tests: no password and no full hash leaves the process on either path (assert request body with a capturing fake), timeout honours the setting, concurrency bound. Docs for the new variables and command; transcript; CHANGELOG (Security). Push.

---

## Increment 10: Verification resend and a confirmation that asks more than a click (about 4 h)

- [ ] **Task 10.1:** `POST` route that sends a fresh verification mail when the link expired or was used, bounded by the per-address limiter (`git grep -n "limiter\|throttle" packages/account/src`); the existing expired-link page gains the control; response identical for unknown addresses.
- [ ] **Task 10.2:** Registration confirmation page that names the address and the tenant and needs a submitted form (CSRF field as the other pages do); the GET alone completes nothing: test that a GET leaves the account unverified and the POST verifies it. New page kind in `page-kinds.ts`, catalogue and Arabic, themed. Screenshots (`pnpm --filter @odudu/docs page-shots`). Transcripts, CHANGELOG, push.

---

## Increment 11: Same-address accounts and the unique index (about 4 h)

- [ ] **Task 11.1:** Command `odudu reconcile-accounts [--dry-run]`: usecase `reconcileDuplicateAccounts(tx, now)` takes no timer; per pair one transaction moving credentials, sessions, grants and consents to the survivor (verified address first, then the oldest, spec §10a), refusing a pair where both have sign-ins; audit trail untouched; chunked. Tests: survivor choice table, refusal, idempotent second run, foreign-tenant probe.
- [ ] **Task 11.2:** The partial unique index on `(tenant_id, email_search)` ships in the migration of the later release (record the rollout order in `docs/NEXT.md` and `RELEASING.md`'s notes); build it `CONCURRENTLY` only if the migration runner allows it (assumption: check `git grep -n "CONCURRENTLY" packages/db/drizzle`; if the runner wraps migrations in a transaction, record that and do the simple `CREATE UNIQUE INDEX` with the table-size note the spec §8 asks for). Query-plan check. Docs, CHANGELOG, push.

---

## Increment 12: More required actions (about 4 h)

- [ ] Add `verify-email`, `update-profile`, `accept-terms` to `requiredActionSchema` (`packages/contracts/src/admin/subjects.ts`), `packages/authn-flows/src/schema/required-action.ts`, `service/required-actions.ts`, the executor, a page each (kinds, catalogue, Arabic, themes), the admin and console surfaces, and the allowed-action list of Task 3.1. Tests: each completes and clears its row; an unknown name stays refused; the pages render under the default template snapshot (`default-template-output.test.ts`). Docs, CHANGELOG, push.

---

## Increment 13: Several sign-in flows, in three parts (about 4 h each)

- [ ] **13a, the model.** Migration: `flows` table (tenant, name, steps jsonb) with one default row per tenant created by backfill; pure `resolveFlow(tenantFlows, clientOverride): Flow`. The executor reads the flow rather than a hard-coded sequence; the default flow reproduces today's order byte-for-byte (test with the existing login integration suite unchanged).
- [ ] **13b, admin surface.** Admin API CRUD, console page, CLI, audit, docs; a step list validated by a Zod schema; at most a bounded number of flows per tenant (state the bound; list reads bounded).
- [ ] **13c, the override.** Client setting `flow_id`; `/authorize` resolves it; test two clients in one tenant get different step sequences; deleting a flow in use is refused. Docs, transcripts, CHANGELOG, push each part.

---

## Increment 14: Close (about 5 h)

- [ ] **Task 14.1:** The six checks of CLAUDE.md "The pass that closes a phase", each with its command in the phase note: read the "What is not implemented" markers; `git grep -n '\bP4f\b' -- ':!docs/archive'`; read `docs/NEXT.md` headings; reconcile the roadmap and section 11 both ways (`pnpm vitest run tests/docs/roadmap-section-11.test.ts`); `git grep -n -i -E 'planned|self-service|me api' -- apps/docs README.md` and fix every hit; write the phase into `CHANGELOG.md` under `## [Unreleased]`.
- [ ] **Task 14.2:** Re-run every transcript the phase added or changed on a live stack; `pnpm docs:screenshots`; regenerate the page shots.
- [ ] **Task 14.3:** Whole-branch review (spec compliance and quality, fix loop to clean); `docs/phases/p4f.md` finished; `docs/NEXT.md` updated; move the spec and this plan with `git mv` to `docs/archive/specs/` and `docs/archive/plans/`; finish via `superpowers:finishing-a-development-branch` (merge into `main` needs the owner's explicit yes).

If budget runs short, increments 12 and 13 split into their own phase by a deliberate re-plan with `tests/docs/roadmap-section-11.test.ts` updated.
