# Generated username at registration: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A tenant setting `registration_username` (`required` | `optional` | `generated`) that decides whether the registration form asks for a username, and a form that marks every field required or optional.

**Architecture:** One new `tenants` column and settings-map entry; a cross-field rule in `tenantSettingProblems` (used by the admin PATCH and by tenant import); a pure handle generator and username chooser in `@odudu/account`'s `service`; the form renderer and the registration route follow the setting; the console gets one choice control; P5b's MCP write is recorded in four places and one test.

**Tech Stack:** TypeScript, Fastify 5, Drizzle + Postgres (Testcontainers), Zod 4, Vitest, React console (FSD layers), Docusaurus docs.

**Spec:** `docs/superpowers/specs/2026-11-17-generated-username-design.md`

## Global Constraints

- Wire name `registration_username`; values exactly `required`, `optional`, `generated`; default `required`.
- Handle: `u-` plus 10 characters of `abcdefghijklmnopqrstuvwxyz234567`, each from one random byte masked with `& 31` (uniform, 50 bits). Never derived from the address.
- `optional` and `generated` need `login_with_email` and `verify_email` both on; refused otherwise, and turning either off while the mode is not `required` is refused.
- Email stays required. Admin-created subjects keep a required username. Existing users are untouched.
- Labels end `(required)` or `(optional)` (messages in `packages/account/src/view/messages.ts` and `messages.ar.ts`); required inputs carry the `required` attribute; an optional input never does.
- `generated`: no Username input in the markup, a posted `username` is ignored and not echoed back.
- Repository rules (CLAUDE.md): tests first; no `any`; no `void` statements; comments carry only what code cannot say, no block over 8 lines, no process words; every user-facing string is a message entry, never a literal in a `*-html.ts`; commit subject at most 72 chars, body at most 8 lines, **no tool-attribution trailer** in commits or the PR body; heavy runs (docker, integration, e2e, `test:plans`, live stack) go through `/Users/wep/WebstormProjects/odudu/.superpowers/sdd/tools/heavy-slot [-p int|e2e] -- cmd`; package-wide vitest uses `--project unit`; no `git stash`, no `reset --hard`; documents the change touches are updated in the same commit (CLAUDE.md "The documentation an increment owns").
- Open a draft PR with the first push; push at the end of each task; CI green and the review answered before the next task.

## Review Focus

- A whitespace-only or empty posted `username` in `optional` is blank: a handle is assigned, no "Enter a username" refusal.
- In `generated` a posted `username` is ignored, never stored and never echoed back in a refused form.
- Switching `login_with_email` or `verify_email` off while the mode is `optional` or `generated` is refused by the admin PATCH, and an import whose `registration_policy.verify_email` is off with the mode not `required` is refused.
- A tenant document exported before the setting imports as `required`.
- A handle collision is retried and, if it never clears, ends on the existing failure page, not a raw 500.
- The Arabic form carries the markers, with the bidirectional isolation the page already tests.

## Task 1: The setting, its column and its cross-field rule

**Files:**

- Create: `packages/db/drizzle/0140_registration_username.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`, `packages/db/src/schema/tenants.ts`, `packages/db/tests/migrate.int.test.ts` (column list near line 63)
- Modify: `packages/contracts/src/admin/settings.ts` (`TENANT_SETTING_CHOICES`, line 64), `packages/contracts/src/admin/docs.ts` (field description, near line 1102), `packages/contracts/src/admin/tenant-document.ts` (settings schema, default `'required'`)
- Modify: `packages/domain-tenant/src/service/tenant-settings.ts` (`SETTINGS`, `tenantSettingProblems`)
- Modify: `packages/protocol-admin/src/usecase/tenant-import-validation.ts:847`
- Test: `packages/domain-tenant/src/service/tenant-settings.test.ts`, `packages/protocol-admin/src/usecase/tenant-document-settings-parity.test.ts`, `packages/contracts/src/admin/tenant-document.test.ts`, an integration test beside `packages/protocol-admin/tests/login-with-email.int.test.ts`

**Interfaces:**

- Produces: tenants column `registration_username text NOT NULL DEFAULT 'required'` with a CHECK of the three values; drizzle field `registrationUsername`; `TENANT_SETTING_CHOICES.registration_username = ['required','optional','generated']`; `SETTINGS.registration_username = { column: 'registrationUsername', type: 'text', values: ... }`; admin `GET/PATCH /settings` carry the name; `tenantSettingProblems` returns `{ name: 'registration_username', message: 'needs login_with_email and verify_email on' }` and, for the reverse, `{ name: 'login_with_email' | 'verify_email', message: 'must stay on while registration_username is optional or generated' }`.

- [ ] **Step 1: Verify the repository facts this task leans on.** Run and read: `git grep -n "totp_algorithm" -- packages/db/drizzle` (the CHECK form of an existing text setting; copy it); `git grep -n "tenantSettingProblems(" -- packages` (two callers: `usecase/settings.ts:226` and `tenant-import-validation.ts:847`); `ls packages/db/drizzle | tail -2` (next free number is 0140).
- [ ] **Step 2: Write the failing tests.** In `tenant-settings.test.ts`: `tenantSettingProblems({ registration_username: 'generated', login_with_email: false, verify_email: true })` returns the `registration_username` problem; same with `verify_email: false`; `'optional'` behaves the same; `'required'` returns none whatever the two are; `{ registration_username: 'optional', login_with_email: false }` over a stored `login_with_email: true` names `login_with_email`; `'sometimes'` returns the choices problem. In `tenant-document.test.ts`: a document without the member parses with `'required'`. Parity test: it passes with the new member. Integration test: `PATCH /settings { registration_username: 'optional' }` is 400 with the problem while `login_with_email` is off, 200 once both are on; turning `verify_email` off afterwards is 400.
- [ ] **Step 3: Run them and see them fail** (`pnpm --filter @odudu/domain-tenant exec vitest run --project unit`; the integration test through `heavy-slot -p int`).
- [ ] **Step 4: Implement.** The migration, schema field, journal entry, choices, `SETTINGS` entry, field description, document schema default, and the cross-field rule inside `tenantSettingProblems` (judged over the whole value set, so it needs no new parameter). In `tenant-import-validation.ts` pass `{ ...document.settings, ...document.registration_policy }` so `verify_email` is seen; the problem path stays `document.settings.<name>`.
- [ ] **Step 5: Run the tests, `pnpm boundaries`, typecheck and eslint on the touched packages.** All pass.
- [ ] **Step 6: Commit** `feat(tenant): a registration_username setting and its rule`.

## Task 2: Record the MCP write for P5b

**Files:**

- Modify: `docs/protocols/mcp-route-classes.md` (the `PATCH ~/settings` row, W2 cell, line 266), `apps/docs/content/en/roadmap.md` (the P5b bullet), `docs/superpowers/specs/2026-09-10-odudu-design.md` (the P5b row of section 11), `packages/mcp/src/service/tools/settings-write.test.ts` (the `OTHERS` list, line 78)
- Test: `tests/docs/mcp-route-classes.test.ts`, `tests/docs/roadmap-section-11.test.ts`

**Interfaces:** Consumes the setting name from Task 1.

- [ ] **Step 1: Verify.** `git grep -n "username_editable" -- docs/protocols/mcp-route-classes.md` shows the cell that lists the W2 settings; `git grep -n "P5b" -- tests/docs/roadmap-section-11.test.ts | head` shows how a roadmap sentence is mapped to words in a row.
- [ ] **Step 2: Write the failing test** in `tests/docs/mcp-route-classes.test.ts`: the `PATCH ~/settings` row's W2 cell contains `registration_username`. Run it; it fails.
- [ ] **Step 3: Edit the four records.** Name `registration_username` in the W2 cell beside `login_with_email`; add it to the "security settings" words of the P5b roadmap bullet and of the P5b row in section 11 (same words in both, so `roadmap-section-11.test.ts` maps them); add it to `OTHERS` in `settings-write.test.ts`.
- [ ] **Step 4: Run** the two `tests/docs` files, the `settings-write` unit test, and (heavy-slot) `apps/server/tests/mcp-write-wording.int.test.ts`; the last refuses the new name with no code change. All pass.
- [ ] **Step 5: Commit** `docs(mcp): place registration_username writes on P5b`.

## Task 3: Handle generator and username chooser

**Files:**

- Create: `packages/account/src/service/username-choice.ts`, `packages/account/src/service/username-choice.test.ts`
- Modify: `packages/account/src/index.ts` (export)

**Interfaces:**

- Produces: `generateHandle(bytes: Uint8Array): string` (needs at least 10 bytes; returns `u-` + 10 chars); `chooseUsername(mode: RegistrationUsernameMode, posted: string | undefined): { kind: 'use'; username: string } | { kind: 'generate' } | { kind: 'missing' }`; `type RegistrationUsernameMode = 'required' | 'optional' | 'generated'`; `HANDLE_ATTEMPTS = 3`.

- [ ] **Step 1: Verify.** `ls packages/account/src/service | head` (a pure-function home with colocated tests, e.g. `sign-in-path.ts`).
- [ ] **Step 2: Write the failing tests.** `generateHandle(new Uint8Array(10))` is `u-aaaaaaaaaa`; byte value 31 maps to `7`, 32 to `a` (mask); length is 12 and all characters are in the alphabet for 200 random draws; fewer than 10 bytes throws. `chooseUsername`: `('required', undefined)` is `missing`; `('required', 'ann')` is `use`; `('optional', undefined)` is `generate`; `('optional', 'ann')` is `use`; `('generated', 'ann')` is `generate`; `('generated', undefined)` is `generate`.
- [ ] **Step 3: Run, see them fail. Step 4: Implement** both as pure functions (no I/O, no clock; the random bytes are an argument).
- [ ] **Step 5: Run the unit project for the package; commit** `feat(account): a username handle and the registration choice`.

## Task 4: The registration form and route follow the setting

**Files:**

- Modify: `packages/account/src/repository/tenant-settings.ts` (add `registrationUsername` to `TenantSettings`, read from the row), `packages/account/src/view/routes/registration.ts` (`RegistrationTenantLookup`, POST handler), `packages/account/src/view/registration-html.ts` (`RegistrationForm`, fields), `packages/account/src/view/messages.ts`, `packages/account/src/view/messages.ar.ts`, `apps/server/src/app.ts` (a `randomBytes` dependency at the registration composition, near line 877)
- Test: `packages/account/src/view/registration-html.test.ts`, `packages/account/src/view/routes/registration.test.ts` (create if absent: `git grep -l registerRegistrationRoute -- packages/account`), `packages/account/src/view/arabic-isolation.test.ts`, update `packages/account/src/view/__snapshots__/default-template-output.test.ts.snap`, an integration test for the three modes against Postgres

**Interfaces:**

- Consumes: `chooseUsername`, `generateHandle`, `HANDLE_ATTEMPTS` (Task 3); tenant row field from Task 1.
- Produces: `RegistrationForm.usernameMode: RegistrationUsernameMode` (default `'required'`); messages `registration.required` = `required`, `registration.optional` = `optional` (Arabic counterparts); `RegistrationRouteDeps.randomBytes: (length: number) => Uint8Array`.

- [ ] **Step 1: Verify.** `grep -n "firstNonEmptyString" packages/account/src/view/routes/registration.ts` (a whitespace-only value is read as absent); `git grep -n "updateProfile.required" -- packages/authn-flows/src/view` (the marker pattern to match).
- [ ] **Step 2: Write the failing renderer tests.** `required`: four labels end `(required)`, Username, Email, Password and Confirm inputs carry `required`. `optional`: the Username label ends `(optional)` and its input has no `required`; the other three read `(required)`. `generated`: no `name="username"` in the markup; Email, Password and Confirm read `(required)`. A refused `generated` form with a `username` in the failure echoes none. Arabic: the same markers, and `arabic-isolation.test.ts` stays green.
- [ ] **Step 3: Write the failing route tests.** POST in `generated` with `username=mallory` creates an account whose username matches `^u-[a-z2-7]{10}$`; in `optional` with a blank username the same, with `username=ann` it is `ann`; in `required` with a blank username the form returns the existing `usernameRequired` refusal; with `generated` and a `findTaken` that reports the username held twice then free, the account is made on the third draw; held three times ends on `renderRegistrationFailedPage` with status 500.
- [ ] **Step 4: Run them, see them fail. Step 5: Implement.** Renderer: build each label from the message and the marker message; omit the Username label and input in `generated`; add `required` to required inputs only. Route: derive the mode from the tenant lookup, call `chooseUsername`, loop `register` up to `HANDLE_ATTEMPTS` while the outcome is `username_taken` and the username was generated, never put a generated or ignored username into the refusal echo. Wire `randomBytes` in `apps/server/src/app.ts` with `node:crypto`'s `randomBytes`.
- [ ] **Step 6: Run** the account unit project, the snapshot update (`-u` only after reading the diff: it must show markers and nothing else), the integration test (heavy-slot -p int), `pnpm boundaries`, `tests/lint`. All pass.
- [ ] **Step 7: Commit** `feat(account): the registration form follows registration_username`.

## Task 4b: Themable markers

**Files:**

- Modify: `packages/account/src/view/registration-html.ts`, `packages/authn-flows/src/view/update-profile-html.ts` (the marker markup), `packages/domain-theme/src/service/hooks.ts` (`RENDERED_HOOKS`), `apps/docs/content/en/concepts/branding.mdx` and the generated branding reference, `CHANGELOG.md`
- Test: `packages/account/src/view/registration-html.test.ts`, `packages/authn-flows/src/view/update-profile-html.test.ts`, the hooks and stylesheet-checker tests in `packages/domain-theme`, `packages/account/src/view/__snapshots__/default-template-output.test.ts.snap`, and the page-shots drift manifest

**Interfaces:**

- Produces: each marker is `<span class="marker marker-required">(required)</span>` or `<span class="marker marker-optional">(optional)</span>`, the text still from the message entries; `RENDERED_HOOKS` gains `marker`, `marker-required`, `marker-optional` (adding a hook does not bump `CSS_HOOKS_VERSION`); the default look is unchanged.

- [ ] **Step 1: Verify.** `git grep -n "RENDERED_HOOKS" -- packages apps tests` lists everything that reads the list; `sed -n 175,190p packages/domain-theme/src/service/stylesheet-values.ts` shows which `content` values the checker accepts (decides whether a theme can swap the word for an asterisk with `::after`; the branding page states the answer).
- [ ] **Step 2: Write the failing tests.** Renderer: `required` mode has four `marker marker-required` spans and no `marker-optional`; `optional` has one `marker-optional` span on Username; `generated` has none for Username. Update-profile: required fields use `marker marker-required`. Hooks: the three names are in `CSS_HOOKS`. Checker: a stylesheet with `.marker-required { color: var(--signal-danger-ink) }` and `.marker-optional { font-size: 12px }` passes; one naming `.marker-unknown` is refused. If `content` values allow it, a rule `.marker-required::after { content: '*' }` passes or is refused as the checker decides, and a test pins whichever.
- [ ] **Step 3: Run, see them fail. Step 4: Implement.** One helper that builds the marker span from the message entry (reuse it from both pages if the package layering allows, else one small helper per package with the same markup; say which in the report), add the hooks, update the branding page ("CSS hooks": the three names and what they are for), regenerate the generated reference, update the snapshot only after reading the diff (spans only), regenerate the create-account pictures with `pnpm --filter @odudu/docs page-shots`, add a CHANGELOG line under Added.
- [ ] **Step 5: Run** the touched unit projects, the integration test for the registration form, `tests/docs` and `tests/lint`, boundaries, eslint, prettier.
- [ ] **Step 6: Commit** `feat(theme): required and optional markers are themable`.

## Task 5: The console control and its note

**Files:**

- Modify: `apps/admin-console/src/pages/settings/services/accessSections.ts` (the `registration` section, after `verify_email_ttl_seconds`), `apps/admin-console/src/testing/settingsFixtures.ts`, `apps/admin-console/src/entities/tenant/adapter/fixtures/settings.json`
- Test: `apps/admin-console/src/pages/settings/services/sections.test.ts`, `apps/admin-console/src/pages/settings/ui/SettingsPage/SettingsPage.test.tsx`, `apps/admin-console/e2e/settings.spec.ts`

**Interfaces:** Consumes the setting name and choices (Task 1). Produces a `choice` field `registration_username`, label `Username at registration`, options Required / Optional / Generated, and a description that states the dependency.

- [ ] **Step 1: Verify.** `sed -n 1,45p apps/admin-console/src/pages/settings/services/authenticatorsSection.ts` (how a `choice` control and its options are declared); `grep -n "options" apps/admin-console/src/pages/settings/services/controls.ts` (option shape `SettingOption`).
- [ ] **Step 2: Write the failing tests.** The registration section lists the control with the three options; the description names `Sign in with a verified email address` and `Verify email addresses`; a refused save shows the server's message on the field (extend the existing refused-save test). e2e: with both dependencies on, choose Optional, reload, and the value is kept.
- [ ] **Step 3: Implement** the field, the option wording as services-layer constants (no literals in a hook or view), and the fixtures. Keep usecases free of logic.
- [ ] **Step 4: Run** the console tests of the settings slice, `pnpm boundaries`, `pnpm format:check`, eslint; the e2e spec through `heavy-slot -p e2e`. Then `pnpm docs:screenshots` and revert any picture that changed without a reason.
- [ ] **Step 5: Commit** `feat(console): a Username at registration setting`.

## Task 6: Documentation and the closing reads

**Files:**

- Modify: `apps/docs/content/en/admin-console/settings.mdx` (Registration section), `apps/docs/content/en/guides/sign-a-user-in.md` (the registration passage), `CHANGELOG.md` (`## [Unreleased]`, Added), `README.md` if it lists registration settings, `apps/docs/content/en/contributing/transcripts.md` (what was re-run)
- Re-run on a live stack and save: the self-registration transcript under `apps/docs/content/en/reference/transcripts/` that shows the registration form (`git grep -l "login-actions/registration" -- apps/docs/content/en/reference/transcripts`), and the settings transcript (`get-settings-and-patch-settings.md`) whose settings list gains the member
- Run: `pnpm --filter @odudu/instrument build` then `pnpm --filter @odudu/docs page-shots`

- [ ] **Step 1: Verify.** `git grep -n -i "login_with_email" -- apps/docs/content/en/admin-console/settings.mdx` (the nearby wording to match); `ls apps/docs/content/en/reference/transcripts/request-paths | head`.
- [ ] **Step 2: Write the prose** in the words of the person who installs Odudu: what the three values do, what the form shows, the two settings `optional` and `generated` need, and that a handle can be renamed only where `username_editable` is on. Add the CHANGELOG entry under Added.
- [ ] **Step 3: Re-run the two transcripts** with the conventions in `contributing/transcripts.md` (live output only, response blocks carry no language tag, state the stack the output depends on); regenerate the page screenshots and revert any picture that changed without a reason.
- [ ] **Step 4: Closing reads.** `git grep -n -i -E "registration_username|username" -- apps/docs/content/en/roadmap.md`: every hit is true; `git grep -n -i "planned" -- apps/docs README.md`: no hit now false; `docs/NEXT.md` stays within its budget.
- [ ] **Step 5: Run** `tests/docs`, `tests/lint`, the apps/docs suite (build `dist` first), `pnpm format:check`. Keep the landing JS budget (185 KiB) and the docs image limit (HEADROOM 0.8) as they are; if either fails, report it and change neither.
- [ ] **Step 6: Commit** `docs: the registration_username setting and its form`.

## Task 7: Whole-branch review and finish

- [ ] **Step 1:** Dispatch the whole-branch review (spec compliance and quality) on Sonnet; fix findings in one wave.
- [ ] **Step 2:** Push, open the PR (no attribution line in the body), wait for CI and the review, answer every thread.
- [ ] **Step 3:** Archive this plan and the spec with `git mv` to `docs/archive/plans/` and `docs/archive/specs/`; ask for the explicit yes to merge into `main`.
