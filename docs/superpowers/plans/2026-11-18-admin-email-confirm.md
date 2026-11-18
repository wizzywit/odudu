# Admin email confirmation and verified-only reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An administrator's email change is stored as a pending change the person confirms by mailed link, and a password-reset link goes only to a verified address on a tenant with `verify_email` on.

**Architecture:** `PATCH /subjects/:id` plans one of three outcomes with a pure function (clear, cancel, confirm). Confirm stores the pending address with `pendingEmailRepository(tx).set`, queues the verification link to the new address through the existing `sendLink`, and tells a verified old address through `queueOwnChangeNotice`. Completion is the existing `completeEmailVerification`/`swapAddress`. Reset gating is a pure decision in `@odudu/account` fed by two injected reads.

**Tech Stack:** TypeScript, Fastify 5, Drizzle on PostgreSQL with RLS, Zod 4, Vitest with Testcontainers, React console (Feature-Sliced layers).

**Spec:** `docs/superpowers/specs/2026-11-18-admin-email-confirm-design.md`

## Global Constraints

- No `any`, no `void doThing()`, no inline `eslint-disable`. Tests precede implementation. Integration tests use real PostgreSQL via Testcontainers. Heavy jobs (docker, e2e, int suites) go through the heavy-slot lock.
- Comments carry only what the code cannot say; no block over 8 lines; never name a task, step or plan.
- Layering (CLAUDE.md "Layering"): view renders, usecase orchestrates and decides nothing, rules and wording are pure `service` functions. `@odudu/account` imports neither `@odudu/domain-identity` nor `@odudu/domain-tenant`; `packages/me` and `protocol-admin` do not import each other. In the console a usecase holds no logic and imports carry no `.ts`/`.tsx` extension.
- Scale: no list gains a query; `pending_email` is read only by `GET /subjects/:id` and the PATCH response.
- User-facing server strings are entries in a flat record (`messages.ts`); no new mail text is added (the existing `address_change_requested` notice is reused).
- Commit subject at most 72 characters, body at most 8 lines, no tool-attribution trailer. No `git stash`.
- Reset answers identically ("requested", 200) whatever the lookup finds, and a skipped request does not call `mailGate`.

## Review Focus

- A refused `confirm` (no relay, no public base URL) leaves `enabled` and `username` in the same request unchanged.
- An email-only PATCH to the person's current address, differing only in case, cancels a pending change and writes nothing else.
- A pending address that another subject takes before the link is used: the swap re-checks the holder (existing behaviour) and the link is spent.
- Reset for an unverified address with `verify_email` on sends no mail and answers byte-identically to an unknown address.
- An administrator PATCH on a subject with no `users` row and an `email` still returns the existing `invalid_value`.

---

### Task 1: Reset goes only to a verified address where the tenant asks for proof

**Files:**
- Modify: `packages/account/src/usecase/reset-password.ts` (`requestPasswordReset`, `RequestPasswordResetDeps`)
- Create: `packages/account/src/service/reset-target.ts`, `packages/account/src/service/reset-target.test.ts`
- Modify: `packages/account/src/view/routes/reset-password.ts` (pass the two new deps through), `apps/server/src/app.ts` (the `findByEmail` wiring near `registerResetPasswordRoute`)
- Modify: `packages/domain-identity/src/repository/users.ts` (the comment above `byEmail`, which says unverified does not gate)
- Test: `apps/server/tests/reset-password.int.test.ts`, `apps/server/tests/reset-ends-access.int.test.ts`

**Interfaces:**
- Consumes: `deps.findByEmail`, `deps.mailGate`, `enqueueResetLink` (all existing in `reset-password.ts`).
- Produces: `resetTarget(input: { readonly verified: boolean; readonly requireVerified: boolean }): 'send' | 'skip'` in `reset-target.ts`; `findByEmail` now also returns `emailVerified: boolean`; new dep `requiresVerifiedAddress: (tx: TenantScopedDatabase, tenantId: string) => Promise<boolean>`.

- [ ] **Step 1: Write the failing unit test** `reset-target.test.ts`: `resetTarget({verified:false, requireVerified:true})` is `'skip'`; `{verified:false, requireVerified:false}`, `{verified:true, requireVerified:true}` and `{verified:true, requireVerified:false}` are `'send'`.
- [ ] **Step 2: Run it to see it fail.** Run: `pnpm --filter @odudu/account exec vitest run src/service/reset-target.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `resetTarget`** as the pure function above.
- [ ] **Step 4: Write failing integration tests** in `reset-password.int.test.ts`: with `verify_email` on, a reset request for an unverified address queues no mail and answers the same status and body as for an unknown address; for a verified address it queues one; with `verify_email` off an unverified address queues one. In each skipped case `mailGate` is not consulted (assert the address's mail budget is untouched by a following verified request).
- [ ] **Step 5: Implement.** `requestPasswordReset` reads `requiresVerifiedAddress(tx, deps.tenantId)` inside its existing transaction before the lookup (so the read is no part of what separates a known address from an unknown one), then skips when the user is null or `resetTarget(...)` is `'skip'`, before `mailGate`. In `app.ts` wire `requiresVerifiedAddress` as `(tx, tenantId) => tenantSettingsRepository(tx).byId(tenantId)` mapped to `settings?.verify_email === true`, and add `emailVerified: user.emailVerified` to `findByEmail`. Correct the `byEmail` comment to say reset reads the tenant's `verify_email` through the composition root.
- [ ] **Step 6: Keep the self-registered case reachable.** In `reset-ends-access.int.test.ts` the case that exercises `account.address_proved` now sets `verify_email` off for its tenant, with a one-line comment saying why.
- [ ] **Step 7: Run** `pnpm --filter @odudu/account test` and `pnpm --filter @odudu/server exec vitest run tests/reset-password.int.test.ts tests/reset-ends-access.int.test.ts` (through the heavy-slot lock). Expected: PASS.
- [ ] **Step 8: Commit** `feat(account): mail a reset link only to a verified address when asked`.

### Task 2: An administrator's email change is confirmed by the person

**Files:**
- Create: `packages/protocol-admin/src/service/admin-email-plan.ts`, `packages/protocol-admin/src/service/admin-email-plan.test.ts`
- Modify: `packages/protocol-admin/src/usecase/subjects.ts` (`AmendSubjectDeps`, `AmendSubjectOutcome`, `amendSubjectUnguarded`, `readSubject` consumers), `packages/protocol-admin/src/view/routes/subjects.ts` (`amendSubjectHandler`, `readSubjectHandler`, `amendmentProblem`, `SubjectsRouteDeps`), `packages/protocol-admin/src/index.ts` (pass `sendLink`, `deploymentSmtp` to the subjects deps; the account-email deps at ~line 737 already carry both)
- Modify: `packages/contracts/src/admin/subjects.ts` (add `subjectDetailSchema`), `packages/contracts/src/admin/docs.ts`, the admin route table entries for `GET`/`PATCH /subjects/:id` so their 200 response is the detail schema
- Test: `packages/protocol-admin/tests/subjects.int.test.ts` (or a new `subject-email-confirm.int.test.ts` beside it), `packages/contracts/src/admin/docs.test.ts` if descriptions are pinned

**Interfaces:**
- Consumes: `pendingEmailRepository(tx).set/forSubject/clear` (`@odudu/domain-identity`), `lockEmailForCreation`, `userRepository(tx).holderOfEmail`, `SendAccountLink` and the relay check from `account-email.ts` (`tenantSmtpRepository(tx).byTenantId`), `queueOwnChangeNotice` and `noticeAddressOf` from `@odudu/email`.
- Produces: `planAdminEmailChange(input: { readonly asked: string | null; readonly holder: string | null; readonly subjectId: string }): { kind: 'clear' } | { kind: 'cancel' } | { kind: 'confirm'; address: string }`; `AmendSubjectDeps` gains `sendLink: SendAccountLink`, `deploymentSmtp: boolean`, `resolveMailLook: MailLookResolver`, `now: () => Date`; `AmendSubjectOutcome` gains `{ kind: 'no_mail_relay' }`; a thrown `MailUnavailableError` (like `EmailTakenError`, so the transaction rolls back) mapped to 503 by the handler; `subjectDetailSchema = subjectSchema.extend({ pending_email: z.string().nullable().optional() })`.

- [ ] **Step 1: Write the failing planner test**: `asked: null` is `clear`; `holder === subjectId` is `cancel`; `holder === null` is `confirm` with the address; a holder that is another subject is not the planner's case (the usecase throws `EmailTakenError` first), so it is not tested here.
- [ ] **Step 2: Implement `planAdminEmailChange`**; run its test (PASS).
- [ ] **Step 3: Write the failing integration tests** (Testcontainers, the existing admin fixture; `me-email-change.int.test.ts` shows how a link is completed): (a) a new address on a person with a verified address leaves `email` and `email_verified` untouched, stores the pending row, queues one mail to the new address and one `address_change_requested` notice to the old, and `GET /subjects/:id` returns `pending_email`; (b) the old address still signs in by email and completing the link swaps the address as verified; (c) a second PATCH replaces the pending address; (d) a PATCH with the current address, differing only in case, clears it and queues nothing; (e) `email: null` clears the address and any pending row immediately; (f) an address held by another subject is 409 and writes nothing; (g) no tenant relay and no deployment sender gives 409 `about:blank#no-mail-relay` and a request that also sets `enabled:false` leaves `enabled` true; (h) an unset public base URL gives 503 and rolls everything back; (i) an unverified or absent old address gets no notice and the audit detail says `skipped_unverified` or `skipped_none`; (j) a foreign-tenant probe of the pending read returns nothing; (k) an email-only PATCH still needs no `If-Match`; (l) the list response carries no `pending_email`.
- [ ] **Step 4: Implement the usecase.** In the validation phase (before any write) take the address lock, refuse a holder other than the subject with `EmailTakenError`, call the planner, and for `confirm` return `no_mail_relay` when the tenant has no relay and `deps.deploymentSmtp` is false. In the write phase: `clear` drops the pending row then `updateEmail(null)`; `cancel` drops the pending row only; `confirm` calls `pendingEmailRepository(tx).set`, then `deps.sendLink` with `{ kind: 'verify_email', email: <new address>, ... }` as `sendAccountEmail` builds it, throwing `MailUnavailableError` when it answers `unavailable`, then `queueOwnChangeNotice`. The existing `updateEmail`-and-replace branch is removed. The `subject.amend` audit detail gains `{ email_change: 'requested', pending_email, notice }` for `confirm`.
- [ ] **Step 5: Implement the route and contract.** `amendSubjectHandler` and `readSubjectHandler` compute the ETag from `subjectWireShape` as now and send `{ ...wire, pending_email }` where `pending_email` comes from `pendingEmailRepository(tx).forSubject(id)` read in the same transaction; `amendmentProblem` maps `no_mail_relay` to the same problem `account-email.ts` gives; the PATCH catch maps `MailUnavailableError` to 503 as `account-email.ts` does. Add `pending_email` descriptions to `docs.ts` (`describeFields`; the fingerprint is the sorted field-name set, so check the new shape does not overwrite another entry, as `docs.test.ts` pins).
- [ ] **Step 6: Run** the admin and contracts suites touching subjects, `tests/docs/endpoints.test.ts`, `admin-paths.test.ts` and the OpenAPI size test; fix drift they report. Expected: PASS.
- [ ] **Step 7: Commit** `feat(admin): confirm an administrator's email change by mail`.

### Task 3: The console shows and cancels a pending change

**Files:**
- Modify: `apps/admin-console/src/pages/subjects/adapter/subjects.ts` (the subject DTO and its fixtures), `repository/useSubjectRecord.ts`, `ui/SubjectRecordPage/ProfileTab.tsx` and its test, the slice's `services` wording file, `use-cases` for the Account section
- Test: `ProfileTab.test.tsx`, the adapter test, a service test for the wording and the cancel decision

**Interfaces:**
- Consumes: `pending_email` on the subject response (Task 2); the email field's existing save.
- Produces: `SubjectAccount` gains `pendingEmail: string | null` and `cancelPending: () => void`; wording constants in the slice's services (a pure `pendingChangeText(address)` and `PENDING_ACCOUNT_DESCRIPTION`).

- [ ] **Step 1: Write failing tests**: with `pending_email` set the Account section shows "Change pending: x@y. The current address stays until they confirm it." and a "Cancel the change" button; pressing it sends the PATCH with the person's current address; with none set neither shows; the section description no longer says a changed email is unverified.
- [ ] **Step 2: Implement** the adapter field, the wording as service constants (no literal in the hook or component), and the `cancelPending` action as the same save the email field uses with the current address. Replace the description at `ProfileTab.tsx:86`.
- [ ] **Step 3: Run** `pnpm --filter @odudu/admin-console test`, the console lints under `tests/lint` (`console-labels`, `console-usecase-integration-only`, `console-no-duplicate-exports`), and `apps/docs/tests/console-areas.test.ts`. Expected: PASS.
- [ ] **Step 4: Commit** `feat(console): show and cancel a pending email change`.

### Task 4: Documentation, transcripts and placement

**Files:**
- Modify: `apps/docs/content/en/admin-console/subjects.mdx` (line 60), `apps/docs/content/en/admin-console/settings.mdx` (the `registration_username` paragraph), the reset text in `apps/docs/content/en/concepts/sessions.mdx` and any other concept page `git grep -n -i 'reset' -- apps/docs/content/en/concepts guides` shows stating the old rule, `CHANGELOG.md` under `## [Unreleased]`
- Re-run on a live stack and replace: `reference/transcripts/admin-paths/patch-subjectsid.md` (pending, old address still signs in, completion by link, cancel), `reference/transcripts/request-paths/password-reset.md` (a verified address, an unverified one with `verify_email` on and off, scoped as `contributing/transcripts.md` requires)
- Modify: `docs/NEXT.md`, `docs/phases/admin-email-confirm.md` (the increment's note), `tests/docs/roadmap-section-11.test.ts` if a placement is added
- Archive: `git mv` this plan and the spec to `docs/archive/`

- [ ] **Step 1: Re-run the two transcripts** on a freshly built stack, following `apps/docs/content/en/contributing/transcripts.md` (no language tag on response blocks, no hand edits, status lines checked complete); run `pnpm --filter @odudu/docs test` and `tests/docs/references.test.ts`, `link-fragments.test.ts`.
- [ ] **Step 2: Update the prose** that stated the old behaviour (`subjects.mdx:60`, `settings.mdx` `registration_username` paragraph, the reset concept text) so it says the person confirms, the old address keeps working, and a reset link goes only to a verified address when **Verify email addresses** is on.
- [ ] **Step 3: Check whether a completed reset sends the person a notice** (`git grep -n 'enqueueCredentialNotice\|recoverAccount' -- packages apps`); callers today are second-factor and recovery-code removal only. When none exists, add a `docs/NEXT.md` row under its argument's address naming the phase that owns account recovery (grep the roadmap and section 11 first), with its roadmap line, and map it in `tests/docs/roadmap-section-11.test.ts`.
- [ ] **Step 4: Write `CHANGELOG.md`** under `Unreleased` in the installer's words: Changed (an administrator's email change is confirmed by the person and the old address keeps signing in until then; a reset link goes only to a verified address when Verify email addresses is on), Security (no unproved address is stored by an administrator's change).
- [ ] **Step 5: Closing greps** over the public surface: `git grep -n -i -E 'unverified until|new address is unverified|marked verified' -- apps/docs README.md` and confirm each hit is true; then write the phase note and archive the spec and plan.
- [ ] **Step 6: Commit** `docs: describe confirmed email changes and verified-only reset`.

### Task 5: A completed reset tells the person

**Files:**
- Modify: `packages/email/src/service/templates.ts`, `packages/email/src/service/messages.ts`, `packages/email/src/service/messages.ar.ts` (a reset-completed notice: subject, preheader, heading, text, reason; the shared `own.when` and `own.notYou` lines are reused), `packages/email/src/index.ts`
- Create: a queueing function beside `queueOwnChangeNotice` in `packages/email/src/usecase/` that sends to the address on file whether or not it is verified, returning `'sent' | 'skipped_none'`
- Modify: `packages/account/src/usecase/reset-password.ts` (`completePasswordReset`/`recoverAccount`: queue the notice in the transaction that sets the password and put its outcome in the reset's audit detail), `apps/server/tests/reset-password.int.test.ts`
- Test: `packages/email/src/service/templates-*.test.ts` (new test file for the new message), the Arabic catalogue tests (`tests/lint/arabic-catalogues.test.ts`), `tests/lint/server-page-literals.test.ts` rules for mail templates

**Interfaces:**
- Consumes: `renderNotice` and the notice shell in `templates.ts`; `outboxRepository(tx).enqueue`; `tenantMailContext` (see `own-change-notice.ts` for the shape).
- Produces: `renderResetCompleted(input: NoticeInput): EmailMessage`; `queueResetCompletedNotice(tx, input: { tenantId; subjectId; now }, resolveMailLook): Promise<'sent' | 'skipped_none'>` (names may follow the file's conventions).

- [ ] **Step 1: Write failing tests:** the template renders subject, heading, text, `own.when` and `own.notYou` in English and in Arabic with no link, code or secret in the body (see `templates-own-change.test.ts`); an integration test that a completed reset queues exactly one notice to the address on file, to an unverified address too, none for a subject with no address, and none when the reset is refused (bad token, weak password) or rolled back.
- [ ] **Step 2: Implement** the message entries (English and Arabic), the render function and the queueing function; call it from the reset-completion path in the same transaction as `setPassword`.
- [ ] **Step 3: Run** the email and account unit suites, `tests/lint/arabic-catalogues.test.ts`, `tests/lint/server-page-literals.test.ts` and the reset integration tests through the heavy-slot lock. Expected: PASS.
- [ ] **Step 4: Commit** `feat(account): tell the person when a reset sets their password`.

### Task 6: Re-run what the whole-branch review and Task 5 changed

**Files:** `apps/docs/content/en/reference/transcripts/admin-paths/get-adminopenapijson.md`, `admin-paths/patch-subjectsid.md` (audit detail now carries `email_change: cancelled` and `cleared`), `request-paths/password-reset.md` (the notice mail after a completed reset), any other transcript a test reports as stale, `apps/docs/content/en/concepts/` text on reset, `CHANGELOG.md`, `docs/NEXT.md` (remove the "owner's call" row for the reset notice), `apps/docs/content/en/roadmap.md` (remove its "no phase placed" sentence), `docs/phases/admin-email-confirm.md`, `tests/docs/roadmap-section-11.test.ts` if a mapping referenced it

- [ ] **Step 1:** Re-run the three transcripts live on a freshly built stack, following `contributing/transcripts.md` and the transcript rules (no hand edits).
- [ ] **Step 2:** Update prose, changelog (Added: the reset-completed mail), the phase note, and remove the ownerless NEXT row and roadmap sentence.
- [ ] **Step 3:** Run `pnpm --filter @odudu/docs test`, `tests/docs/**`; commit `docs: re-run the email transcripts and describe the reset notice`.
