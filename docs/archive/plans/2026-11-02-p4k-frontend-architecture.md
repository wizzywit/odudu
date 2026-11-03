# P4k Frontend Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `apps/admin-console` and `apps/docs` to the Feature-Sliced Design plus five-layer architecture of `FRONTEND_ARCHITECTURE.md`, with behaviour unchanged and every rule that can be checked checked.

**Architecture:** First the whole-app mechanical foundation (placement, segment rename, new checks as inventories, barrels, exact copies), then a repeated per-domain sequence that splits services by concept, gives each rule one owner, maps adapters to domain types, extracts entities and reusable features, and moves each area slice under `pages/`. Each rule check is an error for migrated slices and an inventory of breaches elsewhere that may only shrink.

**Tech Stack:** TypeScript, React, TanStack Query, Zustand, Vitest, React Testing Library over `testing/fakeTransport.ts`, Playwright, dependency-cruiser, ESLint.

**Spec:** `docs/superpowers/specs/2026-11-02-p4k-frontend-architecture-design.md` (decisions D1 to D12 are cited below). Audit notes: `/Users/wep/Library/Application Support/Claude/side-session-notes/local_f6e1687a-3842-4ee3-ad0f-49f5a190190c/audit-services-A.md`, `audit-services-B.md`, `audit-layers.md`, `audit-docs.md`.

## Global Constraints

- Behaviour never changes (D2a). Where copies of a rule disagree, every variant stays as a named option of the one owner, and each disagreement is appended to the p4k note in `docs/phases` (created in the closing pass) under "Variants kept".
- Segment names become `ui`, `use-cases`, `services` (plus existing `repository`, `adapter`, new `types`). No `model`, `components`, `hooks`, `utils` folders inside a slice.
- `shared` ends holding `ui`, `api`, `lib`, `config` only. No domain word in it.
- No `services/index.ts` holding anything. One file per business concept, at most 300 lines (existing `console-service-length`). Domain services pure; application services take side effects as a parameter object; expected outcomes are `{ ok: true } | { ok: false; reason }`; time and randomness enter as parameters.
- Entity: `types`, `adapter`, `repository`, `services`, presentational `ui` only. Feature: `ui`, `use-cases`, own `services` for action-specific rules. A repository sits in the entity unless exactly one feature uses the data (D10).
- A slice is imported only through its `index.ts`; never an adapter export; no same-layer slice imports; `entities/<x>/@x` only sparingly.
- CLAUDE.md in force: TDD; no `any`; no `void` statements; comments carry only what code cannot say, no block over eight lines, no process references (no "Task", "Step", "increment", "P4k" in code comments); imports `#/…` in the console and `@site/src/…` in docs, never relative, never with an extension; commit subject at most 72 characters, body at most 8 lines, no tool-attribution trailer; same for PR bodies.
- Work on branch `p4k/frontend-architecture`; open a draft PR with the first push; push at the end of each increment; an increment is done when CI is green on the pushed commit and the review that push attracted is answered (CLAUDE.md, "A push attracts review"). Each task below ends in a commit; an increment is a set of tasks pushed together.
- Heavy jobs (docker, e2e, Testcontainers) run as `.superpowers/sdd/tools/heavy-slot -- <command>` (pool `e2e`; `-p int -n 2` for Testcontainers). verified: `ls .superpowers/sdd/tools` lists `heavy-slot`.
- Every implementer and reviewer subagent is Sonnet. Console usecases and repositories hold no logic (ADR 0010 amendment); a decision is a pure service function.
- Every task's report carries a "Reuse scan" (CLAUDE.md, "Reuse before writing").
- Volume (ADR 0041): nothing renders an unbounded collection; a list endpoint keeps a constant number of queries. This phase adds no such path; a task that moves one proves it unchanged by its existing test.

## Review Focus

1. A repointed lint that matches nothing after the rename and so passes silently. Each repointed rule keeps a fixture that still fails on a violation written with the new names (Tasks 3, 4).
2. The codemod missing a specifier form (`vi.mock('…')`, `vi.importActual`, dynamic `import('…')`, `import type`, `export … from`). Its tests cover each form (Task 2).
3. Two copies of a rule that differ (trim versus no trim, wording) merged into one that changes output. A characterisation test per variant runs before and after (Tasks 12, 13, domain task B).
4. A migrated-slice list or breach inventory that grows unnoticed. A test fails if an inventory gains an entry or a migrated slice breaks a rule (Task 6).
5. Lazy-loaded route chunks and e2e or screenshot selectors that import by path breaking when a slice moves to `pages/`. Each page move reruns `console-shots` and its e2e specs (domain task G).

---

## Verified facts this plan relies on

- verified: `grep -n -E "/(view|usecase|service)\b" .dependency-cruiser.cjs` hits rules at lines 80-103, 127-138, 195-228, 245-248, 287-292, 342-383 (console and docs rules, plus the generic `no-*` rules).
- verified: `eslint.config.js:89` names `apps/docs/src/**/usecase/**/*.ts`.
- verified: 27 files under `tests/lint/` name a segment (list: the grep in the plan's task 3 step 1 reproduces it); `tests/docs/*` hits are on unrelated `/view/`-style words except where task 3 lists them.
- verified: docs tests and scripts that import a segment path: `apps/docs/tests/{diagram-purity,landing,landing.browser,landing-planned,concepts,concepts.browser,scene-timing,console-areas,fonts-agree,console-warning,logo-swap.browser}.test.ts`, `apps/docs/tests/support/{diagram-markup,console-labels}.ts`, `apps/docs/scripts/{landing-keyframes,page-shots/{brand,shots,run,drift.test,brand.test}}.ts`.
- verified: `pnpm-workspace.yaml` includes `tools/*`; a tool's tests are collected by the root vitest glob `tools/*/src/**/*.test.ts`.
- verified: console tests run from the root config (`apps/admin-console/package.json` `test` uses `../../vitest.config.ts`); lint is `pnpm lint`, boundaries `pnpm boundaries`, full gate `pnpm verify`.
- verified: the section 11 test maps roadmap "Next" and "Later" sentences to a phase's row (`tests/docs/roadmap-section-11.test.ts`); a new phase needs a row `| P4k | … |` in the spec table and roadmap bullets tagged `P4k`.
- verified: `shared/` holds `service` (61 files), `repository` (about 45), `adapter` (11 adapters with tests), `usecase`, `view`, `transport`; features: audit, branding, clients, email, failure, flow, groups, overview, registration-tokens, roles, scopes, session, settings, shell, signing-keys, subjects, system-admins, tenant-sessions, tenants.

---

# Increment 1: placement and the segment rename

### Task 1: Place P4k in the roadmap, section 11 and NEXT

**Files:**

- Modify: `docs/superpowers/specs/2026-09-10-odudu-design.md` (a `| P4k |` row in the section 11 table, and the order sentence near line 537)
- Modify: `apps/docs/content/en/roadmap.md`, `docs/NEXT.md`
- Test: `tests/docs/roadmap-section-11.test.ts` (existing; must pass)

**Interfaces:** Produces the phase name `P4k` and its criterion, used by later closing pass.

- [ ] **Step 1: Run `pnpm vitest run tests/docs/roadmap-section-11.test.ts` and confirm it passes before editing.**
- [ ] **Step 2: Add the row.** Phase `P4k`, title "Frontend architecture", effort a range the controller sets from the plan's task count, criterion: both frontends use the segments `ui`, `use-cases`, `services`, `repository`, `adapter`, `types`; `shared` holds no business knowledge; entities, features and pages exist where evidence showed a need; one owner per rule; adapters map to domain types; the architecture rules are lints with no allowlist; behaviour unchanged.
- [ ] **Step 3: Put P4k first in the order sentence** (the owner runs it now, ahead of P4j, P5a, P4f, P4h, P4i), in the spec near line 537 and in `docs/NEXT.md` "What is next". Add one roadmap "Next" bullet tagged P4k.
- [ ] **Step 4: Run the test again, expect PASS; then `pnpm vitest run tests/docs` for the rest.**
- [ ] **Step 5: Commit** `P4k: place the frontend architecture phase`.

### Task 2: The segment-rename codemod

**Files:**

- Create: `tools/segment-rename/{package.json,tsconfig.json,src/rename.ts,src/rename.test.ts,src/cli.ts}` (copy `tools/commit-message/package.json` and `tsconfig.json` as the shape)

**Interfaces:** Produces `renameSegments(root: string, aliasPrefix: string, mapping: Record<string, string>): { moved: string[]; rewritten: string[] }` and a CLI `pnpm --filter @odudu/segment-rename run rename -- <root> <aliasPrefix>`. Throwaway: deleted in Task 40.

- [ ] **Step 1: Write failing tests against a temp tree** (`rename.test.ts`), one per case, each asserting the rewritten specifier and the moved directory: static import, `import type`, `export … from`, dynamic `import('…')`, `vi.mock('…')`, `vi.importActual('…')`, a specifier ending at the directory (`…/service`), a specifier through a feature (`#/features/a/view/B/B`), and a non-matching path (`#/shared/viewport/x`) left untouched. Also assert a directory named `service` is renamed `services` at every depth but a file `service.ts` is not.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `renameSegments`.** Move matching directories with `git mv` (shell out via `node:child_process`); rewrite only string-literal specifiers whose resolved path passes through a renamed directory, using the TypeScript compiler API for locating literals (no regex over source).
- [ ] **Step 4: Run, expect PASS; `pnpm typecheck`.**
- [ ] **Step 5: Commit** `tools: a codemod that renames layer folders and their imports`.

### Task 3: Rename the console, repoint its checks

**Files:**

- Modify (by codemod): everything under `apps/admin-console/src` and `apps/admin-console/e2e` that names a segment
- Modify: `.dependency-cruiser.cjs` (console rules and generic `no-*` rules), `eslint.config.js`, the `tests/lint/console-*.test.ts` files and their fixtures under `tests/lint/fixtures/`, `apps/docs/tests/{console-areas,console-warning}.test.ts`, `apps/docs/tests/support/console-labels.ts`, `apps/docs/scripts/page-shots/*` where they name console paths
- Test: the lints themselves, `pnpm boundaries`, `pnpm lint`, `pnpm typecheck`

**Interfaces:** Consumes `renameSegments` (Task 2). Produces the console layout with `ui`, `use-cases`, `services`.

- [ ] **Step 1: List every file naming a segment:** `grep -rln -E "/(view|usecase|service)\b|'(view|usecase|service)'" tests apps/docs apps/admin-console .dependency-cruiser.cjs eslint.config.js vitest.config.ts --include='*' | grep -v node_modules`. Commit nothing; the list is the checklist.
- [ ] **Step 2: Run the codemod** on `apps/admin-console/src` with alias `#/` and mapping `{ view: 'ui', usecase: 'use-cases', service: 'services' }`; `pnpm --filter @odudu/admin-console typecheck` must pass.
- [ ] **Step 3: Repoint each rule and lint** from the Step 1 list. Rewrite the patterns, not the intent: `(?:view|.*/view)` becomes `(?:ui|.*/ui)`, and so on, including the `shared/view` and `shared/service` exemption on line 292 and the console-only lints (`console-no-module-state`, `console-usecase-integration-only`, `console-service-length`, `console-view-tests-run-axe`, …).
- [ ] **Step 4: Prove none went dead.** For each repointed `dependency-cruiser` rule and each `tests/lint` test with a fixtures folder, rename the fixture paths and confirm the rule still fails on its violation fixture (the lint tests already assert this) and `pnpm boundaries` has the same rule count: `node -e "…"` counting `name:` entries equals 34 before and after.
- [ ] **Step 5: Run** `pnpm typecheck && pnpm lint && pnpm boundaries && pnpm test:unit` and the console integration project via `heavy-slot -p int -n 2 -- pnpm test:integration`; all PASS.
- [ ] **Step 6: Run the console e2e subset and the screenshots check:** `heavy-slot -- pnpm --filter @odudu/admin-console e2e` (name from `apps/admin-console/package.json`), and `pnpm --filter @odudu/docs test` for `console-shots` and `console-areas`.
- [ ] **Step 7: Commit in two commits:** the codemod's move (`console: rename layer folders to ui, use-cases and services`) and the repoint (`console: lints and tests follow the renamed layers`). Push, open the draft PR, wait for CI green, answer the review.

### Task 4: Rename the docs app

**Files:**

- Modify (by codemod): `apps/docs/src` with alias `@site/src/`
- Modify: `.dependency-cruiser.cjs` docs rules (lines 195-265), `eslint.config.js:89`, `tests/lint/{docs-service-no-dom,docs-view-no-logic,docs-no-readonly,lost-art}.test.ts` and `console-no-module-state`, `console-usecase-integration-only` where they also read docs, the docs tests and scripts listed under "Verified facts", MDX imports of `@site/src/shared/view/Diagram` (`apps/docs/content/**`), `apps/docs/plugins/code-highlight.ts:14`

- [ ] **Step 1: Run the codemod** with alias `@site/src/`; grep MDX for `@site/src/shared/view` and fix by hand (the codemod reads TS only).
- [ ] **Step 2: Repoint** as in Task 3 step 3 and step 4, for every docs rule, lint and test; keep the violation fixtures failing.
- [ ] **Step 3: Run** `pnpm typecheck && pnpm lint && pnpm boundaries && pnpm test:unit`, then `pnpm --filter @odudu/docs build` and the docs browser tests as CI does (`.github/workflows/verify.yml` job that runs `*.browser.test.ts`).
- [ ] **Step 4: Commit** `docs app: rename layer folders and repoint their checks`. Push; CI green; review answered.

---

# Increment 2: the docs app's browser boundary

### Task 5: Browser access behind `shared/platform`

**Files:**

- Modify: `apps/docs/src/features/landing/use-cases/{useInstall,useSignInFlow,useIdle,useReveal,usePrefersReducedMotion}.ts` (names as of the audit), `apps/docs/src/shared/platform/*`
- Create: `apps/docs/src/shared/platform/clipboard.ts`, `timers.ts` with tests beside them
- Test: `tests/lint/docs-usecase-no-browser-globals.test.ts` (new)

**Interfaces:** Produces `copyText(text: string): Promise<boolean>` in `platform/clipboard.ts` and `schedule(fn: () => void, ms: number): () => void` in `platform/timers.ts` (returns a cancel function). Use-cases receive them as arguments or import them from `@site/src/shared/platform`.

- [ ] **Step 1: Write the failing lint test** that scans `apps/docs/src/**/use-cases/**` for `navigator.`, `setTimeout`, `setInterval`, `requestIdleCallback`, `IntersectionObserver`, `document.`, `window.` and fails naming file and line; add a fixture pair like the sibling lints. Run, expect FAIL listing the audit's hits (`useInstall`, `useSignInFlow`, `useIdle`, `useReveal`).
- [ ] **Step 2: For each hit, write the platform function's unit test first** (clipboard resolves true on success and false on rejection; `schedule` cancels), then implement it and repoint the use case. Existing use-case tests stay unchanged and green.
- [ ] **Step 3: Move `usePrefersReducedMotion` and `useIdle` to `apps/docs/src/shared/use-cases/`** with their tests; repoint landing.
- [ ] **Step 4: Run** the lint, `pnpm --filter @odudu/docs test`, the docs browser tests. Expect PASS.
- [ ] **Step 5: Commit** `docs: usecases reach the browser through shared/platform`. Push; CI green.

---

# Increment 3: the architecture checks, as inventories

### Task 6: The rule framework

**Files:**

- Create: `tests/lint/architecture/migrated.ts` (exported `MIGRATED: readonly string[]`, slice paths such as `apps/admin-console/src/pages/clients`), `tests/lint/architecture/inventory.ts` (a `Record<RuleId, string[]>` of breaching files), `tests/lint/architecture/rule.ts` (the helper), `tests/lint/architecture/rule.test.ts`
- Test: `tests/lint/architecture/rule.test.ts`

**Interfaces:** Produces `checkRule(id: RuleId, breaches: string[]): { errors: string[] }`: a breach in a migrated slice is an error; a breach outside the inventory is an error; an inventory entry that no longer breaches is an error ("remove it"). `RuleId = 'no-service-barrel' | 'no-domain-in-shared' | 'no-sideways-slice' | 'view-no-service' | 'no-adapter-export' | 'contracts-only-in-adapter'`.

- [ ] **Step 1: Failing tests** for the three outcomes above and for "an inventory may not gain an entry" (compare to a committed `inventory.baseline.json` count; fails if larger).
- [ ] **Step 2: Run, expect FAIL; implement `checkRule`; run, expect PASS.**
- [ ] **Step 3: Commit** `tests: a framework for architecture rules that shrink to zero`.

### Task 7: Rule `no-service-barrel`

**Files:** Create `tests/lint/architecture/no-service-barrel.test.ts`, fixtures under `tests/lint/fixtures/architecture/no-service-barrel/`; modify `inventory.ts`.

**Interfaces:** Consumes `checkRule`. A `services/index.ts` or `services/index.tsx` at any depth is a breach.

- [ ] **Step 1: Write the test** scanning `apps/{admin-console,docs}/src/**/services/index.{ts,tsx}`, with a fixture that must breach. Expect FAIL until the 19 console barrels (and docs ones) are put in the inventory.
- [ ] **Step 2: Seed the inventory** with the found paths; run, expect PASS. Commit `tests: no segment barrels, with the current ones inventoried`.

### Task 8: Rule `no-domain-in-shared`

**Files:** Create `tests/lint/architecture/no-domain-in-shared.test.ts`, fixtures; modify `inventory.ts`.

- [ ] **Step 1: Write the test.** A file under `src/shared/**` whose path or exported identifiers contain a word from `DOMAIN_WORDS = ['tenant','client','subject','role','group','scope','audit','session','administrator','branding','signing','registration']` is a breach; lists `shared/{ui,api,lib,config}` as the only allowed segments and breaches any other segment (`service`/`services`, `repository`, `usecase`/`use-cases`, `adapter`, `transport`) as `shared-segment`. Fixture pair included.
- [ ] **Step 2: Seed inventory; run; PASS; commit** `tests: shared holds no business knowledge, with today's breaches inventoried`.

### Task 9: Rules `no-sideways-slice`, `view-no-service`, `no-adapter-export`

**Files:** Create one test file each in `tests/lint/architecture/`, fixtures; modify `inventory.ts`.

- [ ] **Step 1: `no-sideways-slice`.** A file in `features/<a>` or `pages/<a>` or `entities/<a>` importing `#/<same layer>/<b>` with `b !== a` is a breach (`@x` paths excepted). Console and docs, with fixture.
- [ ] **Step 2: `view-no-service`.** A `ui/` file importing a `services/` path of its own slice or another is a breach; the exception is a type-only import. Fixture.
- [ ] **Step 3: `no-adapter-export`.** A slice `index.ts` exporting from `./adapter/…` is a breach. Fixture.
- [ ] **Step 4: Seed the inventory for each** (expect about 131 sideways lines and 137 view-to-service files); run all, PASS.
- [ ] **Step 5: Commit** `tests: sideways imports, views reaching services and exported adapters, inventoried`. Push the increment; CI green.

### Task 10: Steiger spike

**Files:** Create the next free ADR in `docs/adr` (about 0045, "how the frontend architecture is checked") (check the next free number first: `ls docs/adr | tail -3`).

- [ ] **Step 1: Timebox two hours.** In a scratch branch directory outside the repo's tracked tree, install Steiger and run it against `apps/admin-console/src` with a config mapping the new layers. Record: does it enforce public-API-only imports and no same-layer slice imports, with how much configuration, and the added `verify` time.
- [ ] **Step 2: Write the ADR** with the decision. Default: not adopted unless it clearly beats Tasks 6 to 9. If adopted, add a follow-up task to wire it into `pnpm lint`.
- [ ] **Step 3: Commit** `ADR 0045: how the frontend architecture is checked`.

---

# Increment 4: barrels and exact copies

### Task 11: Remove the service barrels

**Files:** Modify every importer of a `services/index.ts` (console, docs and the shared ones: `capabilities`, `code`, `sectionSave`, `countryNames`), delete the barrels, shrink `inventory.ts`.

- [ ] **Step 1: List importers:** `grep -rn "/services'" apps/admin-console/src apps/docs/src` and `grep -rn "/services/index" …`.
- [ ] **Step 2: Repoint each import to the file that defines the symbol.** A symbol re-exported from `shared` by a feature file (`groups/services/address.ts:5-15`, `roles/services/ceiling.ts:25`, `shell/services/rail.ts:12`) is imported from the shared file at the call site and the re-export deleted.
- [ ] **Step 3: Delete the barrels; remove their paths from `inventory.ts`; run `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm boundaries`.** PASS.
- [ ] **Step 4: Commit** `console: import services from the file that defines them`. Push.

### Task 12: Characterise, then fold, the exact copies

**Files:** the exact-copy rows of `audit-services-A.md` item 7 and `audit-services-B.md` item 7: `mint.ts:58 clearedError` → `shared/fieldErrors.withoutField`; `audit ANY` → `ANY_STATUS`; `toLocaleString('en')` copies → `groupedNumber`; `username ?? id`; `readable` (clients evaluate, sessions, roles); `toISOString().slice(0,10)` export date; KIB constant; names-or-"none" lists (clients lists.ts:21 and scopes mappers.ts:89 are identical); UTC export filename date.

- [ ] **Step 1: For each row, write the characterisation test first** in the owner's test file, asserting the output of every copy on the same inputs (the test imports the old copy, so it passes before the change). Run: PASS.
- [ ] **Step 2: Repoint the callers to the owner, delete the copy; the characterisation test now imports only the owner.** Where a "copy" differs (trim, locale, separator), add a named option to the owner and pass it from the caller.
- [ ] **Step 3: Run** `pnpm test:unit` and the affected pages' tests. PASS.
- [ ] **Step 4: Commit one row per commit**, subject `<owner>: one owner for <rule>`. Push the increment; CI green.

### Task 13: Hand-rolled failure and refusal wording, one owner

**Files:** `shared/services/failure.ts` (owner of `writeFailureText`) and its callers: `tenants/services/{failure.ts:5,steps.ts:39,import.ts:68}`, `subjects/services/{access.ts:103,credentials.ts:185,mail.ts:68}`, `branding/services/edits.ts:125`, `audit/services/export.ts:23`, `email/services/test.ts:34`, `system-admins/services/grant.ts:11`, `roles/services/removal.ts:30`, and the `refused: (p) => writeRefusal(p, cap)` lambdas in email, registration-tokens, tenant-sessions, settings and branding.

**Interfaces:** Produces `failureTextWith(overrides: Partial<Record<FailureKind, (p: Problem) => string>>): (p: Problem) => string` in `shared/services/failure.ts`, and `refusedBy(cap: Capability): (p: Problem) => string` for the repeated lambda.

- [ ] **Step 1: Characterisation tests:** for each hand-rolled switch, a table of (status, problem) → text, run against the existing function. PASS.
- [ ] **Step 2: Implement `failureTextWith` and `refusedBy` test-first; repoint each caller so the characterisation table passes unchanged.** A copy whose text differs becomes an override passed by the caller.
- [ ] **Step 3: Run** the console unit and integration projects. PASS.
- [ ] **Step 4: Commit** `console: one owner for failure and refusal wording`. Push; CI green.

### Task 14: Tab model and area data, one owner each

**Files:** `shared/services/record.ts` (tab list, labels, `…TabHref`, record keys, `tabsWithEdits`) for clients, subjects, scopes, roles, groups and branding variants; `shell/services/areas.ts` as owner of area paths and capabilities, replacing the copies in `overview/services/reads.ts:80`, `audit/services/links.ts:13`, `tokensHref`, `sessionsHref`, and the `TITLE` constants.

- [ ] **Step 1: Characterise** each feature's tab list, labels and hrefs on a table of inputs. PASS.
- [ ] **Step 2: Implement `shared/services/record.ts` exporting `recordTabs<T>(spec: TabSpec<T>): RecordTabs<T>`** and let each feature keep only its data; the characterisation tests pass unchanged.
- [ ] **Step 3: Repoint area data to `shell`.** Until `shell` is an entity (Increment 5) other features reach it through its `index.ts`.
- [ ] **Step 4: Commit** `console: one owner for record tabs and area data`. Push; CI green.

---

# Increment 5 onward: the per-domain sequence

Each domain is its own increment, pushed and green before the next. Before a domain starts, the controller writes `docs/superpowers/plans/2026-11-02-p4k-domain-<name>.md` from the import graph as it then stands (the files, the entity boundary and the moves are only knowable once the previous domain has landed), and has it reviewed by one fresh Sonnet reader. The sequence below is the fixed shape of that addendum.

**Order and evidence** (from the audits; the controller confirms against the graph):

| #   | Domain                                                                                    | Basis                                                                                                 |
| --- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1   | `session` entity, `shell` widget                                                          | 83 and 26 inbound imports; `shell/areas`, `overview` Place/AreaOf types                               |
| 2   | `tenants`, `tenant-sessions`                                                              | failure, steps, import services; tenant settings in shared                                            |
| 3   | `subjects`, `administrators`, `system-admins`                                             | credentials.ts (6 concepts), access, holdings, memberships                                            |
| 4   | `roles` and `groups`, `capabilities`                                                      | default-block and `Ceiling` written twice; tab models; held/refusal wording                           |
| 5   | `clients`, `scopes`                                                                       | account, advanced, tokens, create; copy-plan; assignment, guard                                       |
| 6   | `audit` (`audit-event` entity)                                                            | filters.ts 234 lines; export; links                                                                   |
| 7   | `branding`                                                                                | 27 service files, 6,412 lines; scheme labels repeated five times                                      |
| 8   | `settings`, `email`, `signing-keys`, `registration-tokens`, `flow`, `failure`, `overview` | smaller; `keyPromotion` split ownership; key lane                                                     |
| 9   | docs app features                                                                         | `content.ts`, `scene.ts`, `geometry.ts`, `playback.ts`, `terminal.ts`; `consoleShot`/`pageShot` twins |

**Per-domain tasks** (A to G, each its own commit set):

### Task D-A: Pin the journeys and rules

**Files:** tests beside the code, and `apps/admin-console/src/testing/*` fixtures.

- [ ] **Step 1: For each screen of the domain, confirm an RTL journey runs over `fakeTransport` (a `*Page.test.tsx` that renders via `renderConsole`/`mountAtRoute`).** Where one is missing (the audit names failure and sign-in, and the 12-usecase-test gap), write it first, asserting the visible outcome of the main action.
- [ ] **Step 2: For each rule the domain will merge or move, a characterisation unit test** (Task 12 shape). Run all: PASS before any move.

### Task D-B: Split services by concept

- [ ] **Step 1: For each service file the audit names as multi-concept or screen-named in this domain, write a mapping table** (symbol → new file) in the addendum, each file named for a concept (`orderSubmission`-style: noun phrase, no `page`, `labels`, `frame`, `copy`).
- [ ] **Step 2: Move the symbols and their tests together with `git mv` and edits; repoint importers; run the domain's tests after each file.** Domain services stay pure; an application service (retry, notify, persist-choice) takes a `deps` parameter object; callback-carrying result types (`retry: () => void`) become data with the use case supplying the callback.
- [ ] **Step 3: `pnpm lint && pnpm typecheck && pnpm test:unit`.** PASS; commit per concept.

### Task D-C: One owner per rule

- [ ] **Step 1: For each duplicate row of the audits that falls in the domain, name its owner (the addendum), extend the owner with the named variant option, repoint, delete the copy** (characterisation tests from D-A pass unchanged). Append each disagreement to the p4k note in `docs/phases` (created in the closing pass) "Variants kept".
- [ ] **Step 2: Commit per row.**

### Task D-D: Adapter maps to domain types, with saved responses

**Files:** the domain's `adapter/*.ts`, `types/*.ts`, `adapter/fixtures/*.json`.

- [ ] **Step 1: Save a real response per endpoint** from the stack (`heavy-slot -- ` the docs stack, or the existing transcripts under `apps/docs/content/en/reference/transcripts/` where they hold one), as `adapter/fixtures/<name>.json`; no invented data.
- [ ] **Step 2: Failing test:** `adapter/<name>.test.ts` maps the fixture and asserts the domain object (field renames, date parsing, enums). Domain type in `types/<name>.ts`.
- [ ] **Step 3: Implement the mapper in the adapter; the repository returns domain types; consumers in the domain stop importing `@odudu/contracts` types.** Run the domain tests. PASS.
- [ ] **Step 4: For each of the nine adapters without tests** (`branding/mail`, `clients/operations`, `email/smtp`, `failure/browser`, `flow/flow`, `registration-tokens`, `session/logout`, `signing-keys/keys`, `shared/audit`), this step is mandatory in its domain.

### Task D-E: Extract the entity

- [ ] **Step 1: Create `entities/<name>/{types,adapter,repository,services,ui}` as the addendum lists; move the domain's shared types, adapter, repository and rules in with `git mv`; its `index.ts` exports types, hooks and services other slices need, never the adapter.** Add `README.md` listing "Rules owned".
- [ ] **Step 2: Repoint every importer (the 131-line inventory entries for this entity) to `#/entities/<name>`;** delete the matching `shared/*` files and their inventory entries (`no-domain-in-shared`).
- [ ] **Step 3: `pnpm boundaries && pnpm lint && pnpm test:unit`;** PASS.

### Task D-F: Extract reusable features

- [ ] **Step 1: A UI or journey the audit lists as borrowed across slices** (subject-members panel, client/role/group/subject pickers, audit table, ceiling guard, section save) becomes `features/<kebab-name>/{ui,use-cases,services}`, built on entities' public APIs; the pages import it through `#/features/<name>`.
- [ ] **Step 2: Move its tests with it; its journey test runs through a page that uses it.** Remove the sideways-import inventory entries it resolves.

### Task D-G: Move the area slice to `pages/` and mark it migrated

- [ ] **Step 1: `git mv apps/admin-console/src/features/<area> apps/admin-console/src/pages/<area>`; repoint the router (`app/lazyFeatureRoute`, `router.tsx`) and `app` chunk names; run `apps/admin-console` `router.test.ts`.** If a lint pins `features/<area>`, repoint it in this commit.
- [ ] **Step 2: Add the slice to `MIGRATED`; the six rules now error on it. Run `pnpm test:unit`, the console integration project and the domain's e2e specs via `heavy-slot`, and the `console-shots` check.** PASS, screenshots unchanged.
- [ ] **Step 3: Push the increment; CI green; review answered; note anything deferred as a `docs/NEXT.md` row naming its phase.**

---

# Close

### Task 40: Tighten, delete the scaffolding

- [ ] **Step 1:** When every inventory is empty, `MIGRATED` covers every slice. Replace the framework with plain error-level rules, delete `inventory.ts`, `migrated.ts` and the baseline.
- [ ] **Step 2:** Delete `tools/segment-rename`.
- [ ] **Step 3:** Run `pnpm verify`; PASS. Commit `tests: the architecture rules hold everywhere`.

### Task 41: The closing pass

- [ ] **Step 1: The six checks of CLAUDE.md, "The pass that closes a phase":** roadmap "What is not implemented" markers still true; grep `P4k`; `docs/NEXT.md` headings; roadmap against section 11 both ways; the public surface (`git grep -n -i -E 'planned|\\bP4k\\b' -- apps/docs README.md`); changelog under `## [Unreleased]` (Changed: none visible; Added: none; write that the console and docs sources were reorganised only if a user-visible install detail changed).
- [ ] **Step 2:** Write the p4k note in `docs/phases` (created in the closing pass) (what it found, the "Variants kept" list, what was left and where it went); update `CLAUDE.md` "Layering" to the new segment names and the layer table; update ADR 0010 with an amendment pointing at the phase; `git mv` the phase's spec and plan to `docs/archive/`.
- [ ] **Step 3:** Whole-branch review by a fresh Sonnet reviewer (spec compliance and quality); fix loop; then `superpowers:finishing-a-development-branch`.
