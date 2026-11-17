# Flows in the tenant export and import: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A tenant export carries every flow and each client's flow by name, and an import restores them, so a client keeps the flow it ran.

**Architecture:** Three additive optional members under document version 1 (`flow_name`, `flows`, `clients[].flow`); export reads the flows once; import validates them, then writes the default flow, the named flows and the clients in the existing transaction; roadmap, section 11, `docs/NEXT.md` and their test move the flows off P7 and keep the theme and images there.

**Tech Stack:** TypeScript, Zod 4, Drizzle + Postgres (Testcontainers), Vitest, Docusaurus docs.

**Spec:** `docs/superpowers/specs/2026-11-17-flows-in-tenant-export-design.md`

## Global Constraints

- Document version stays `1`. `flow_name` defaults to `"default"`, `flows` to `[]`, a client's `flow` to `null`. A document without them imports as before.
- Flows are keyed by name; ids never travel. The default flow is the row marked `is_default`, never found by name.
- Named flows: at most `FLOW_LIMIT - 1` (19), each with at most `FLOW_STEP_MAX` (20) steps, names valid flow names (1..64, unique in the document, different from `flow_name`).
- Import validates everything before writing; writes in the existing single import transaction; flows are written before clients.
- Repository rules (CLAUDE.md): tests first; no `any`; no `void` statements; comments carry only what code cannot say, no block over 8 lines, no process words; no user-facing literal in a `*-html.ts`; every repository method probed with a foreign `tenant_id`; commit subject at most 72 chars, body at most 8 lines, **no tool-attribution trailer** in commits or the PR body; heavy runs (docker, Testcontainers, e2e, `test:plans`, live stack) through `/Users/wep/WebstormProjects/odudu/.superpowers/sdd/tools/heavy-slot [-p int|e2e] --`; package-wide vitest with `--project unit`; no `git stash`, no `reset --hard`; run the console e2e specs that touch the export panel through heavy-slot -p e2e before reporting; documents the change touches are updated in the same commit.
- Open a draft PR with the first push; push at the end of the increment; CI green and the review answered before merge; merging into `main` needs the owner's explicit yes.

## Review Focus

- A client pinned to the default flow row round-trips pinned (exported under the default's name, imported with the default's id), not as `null`.
- A tenant whose default was renamed or promoted from a named flow round-trips with that name and its flows intact.
- A pre-change document (no `flow_name`, `flows`, `flow`) still imports and leaves every client on the default.
- A client naming a flow the document does not hold, a duplicate name, the default's name used by a named flow, and more than 19 named flows are each refused before any write, at a path that names the member.
- A failing client write rolls back the flows too (atomic).
- The export of a tenant with no named flows differs from today's only by `flow_name`.

## Task 1: The document members and the export

**Files:**

- Modify: `packages/contracts/src/admin/tenant-document.ts` (the document and client schemas), `packages/contracts/src/admin/flow.ts` (export the flow-name schema if it is private: `git grep -n flowNameSchema -- packages`), `packages/contracts/src/admin/docs.ts` (field descriptions for the three new members), `packages/protocol-admin/src/usecase/tenant-export.ts` (near line 710 and 752)
- Test: `packages/contracts/src/admin/tenant-document.test.ts`, `packages/protocol-admin/tests/tenant-export.int.test.ts` (find it: `git grep -l "tenant-export" -- packages/protocol-admin/tests`)

**Interfaces:**

- Produces: document members `flow_name: string` (valid flow name, default `"default"`), `flows: { name: string; steps: ExportedFlowStep[] }[]` (default `[]`, max `FLOW_LIMIT - 1`), `clients[].flow: string | null` (default `null`).

- [ ] **Step 1: Verify.** `git grep -n "flowNameSchema\|FLOW_LIMIT\|FLOW_NAME_MAX" -- packages/contracts/src/admin/flow.ts`; `sed -n 700,760p packages/protocol-admin/src/usecase/tenant-export.ts` (how `flow` and clients are built); `git grep -n "forTenant\|byId\|defaultForTenant" -- packages/authn-flows/src/repository/flows.ts` (which read returns all of a tenant's flows).
- [ ] **Step 2: Write the failing tests.** Contract: a document with none of the three members parses to the defaults; one with `flows` over the limit, a duplicate name or an invalid name is refused; a client `flow` of `""` is refused. Export integration (Testcontainers): a tenant with the default renamed `core`, two named flows, one client pinned to a named flow, one pinned to the default row and one on `null` exports `flow_name: 'core'`, `flows` sorted by name with their steps and `settings`, the clients' `flow` values `<named>`, `'core'`, `null`; a tenant with no named flows exports `flows: []`.
- [ ] **Step 3: Run, see them fail. Step 4: Implement** the schema members and description entries, and in the export one flows read plus a flow-id-to-name map used for the clients. No new query per client.
- [ ] **Step 5: Run** the contracts and protocol-admin unit projects, the export integration test (heavy-slot -p int), `pnpm boundaries`, eslint, prettier.
- [ ] **Step 6: Commit** `feat(tenant): the export carries every flow and each client's flow`.

## Task 2: Import validation and writing

**Files:**

- Modify: `packages/protocol-admin/src/usecase/tenant-import-validation.ts` (beside `flowAndSmtpProblems`, ~line 469), `packages/protocol-admin/src/usecase/tenant-import.ts` (`writeDocument` ~397-456, the client writer, the audit counts ~507)
- Test: `packages/protocol-admin/src/usecase/tenant-import-validation.test.ts` (or the file that tests `flowAndSmtpProblems`), `packages/protocol-admin/tests/tenant-import.int.test.ts`

**Interfaces:**

- Consumes: the document members from Task 1; `validateFlowSteps`, `startsALogin`, `flowRepository(tx).replace/create` (`packages/authn-flows`).
- Produces: problems at `document.flows[i]`, `document.flow_name`, `document.clients[i].flow`; the `tenant.import` audit counts gain `flows` (the number of named flows).

- [ ] **Step 1: Verify.** `sed -n 469,490p packages/protocol-admin/src/usecase/tenant-import-validation.ts`; `sed -n 395,460p packages/protocol-admin/src/usecase/tenant-import.ts`; `git grep -n "tenant.import" -- packages/protocol-admin/src/service/audit-detail.ts` (whether counts pass an allowlist).
- [ ] **Step 2: Write the failing tests.** Validation: a named flow with an unknown authenticator, a duplicate authenticator, unread settings, no enabled step or no login start is refused at `document.flows[i]` like the default flow; a named flow whose name equals `flow_name`, a duplicate name, and a client `flow` naming nothing in the document are refused. Import integration: the Task 1 tenant round-trips (names, steps, `settings`, order of flows by name, the default's name, each client's resolved flow by name); a pre-change document imports with every client on the default; a failing client write leaves no flow behind (the transaction rolls back); the audit row names `flows: 2`.
- [ ] **Step 3: Run, see them fail. Step 4: Implement** `flowProblems` (reusing `validateFlowSteps`), the write order (default flow renamed and its steps replaced via `replace`, then `create` per named flow, then clients with the resolved `flowId`), and the audit count.
- [ ] **Step 5: Run** the protocol-admin unit project, the import integration test (heavy-slot -p int), boundaries, eslint, prettier.
- [ ] **Step 6: Commit** `feat(tenant): an import restores every flow and each client's flow`.

## Task 3: The console export panel and its records

**Files:**

- Modify: `apps/admin-console/src/pages/tenants/.../ExportPanel.tsx` (find it: `git grep -n "sign-in flow" -- apps/admin-console/src`), the wording constants it reads, `apps/docs/scripts/console-shots/record/*` that quote it, any import form text that lists the document's contents (`git grep -n -i "flow" -- apps/admin-console/src/pages/tenants`)
- Test: the panel's component test, `apps/docs/tests/console-labels.test.ts`

- [ ] **Step 1: Verify** where the panel says "the sign-in flow" and whether the import form lists contents.
- [ ] **Step 2: Write the failing test** that the panel's list says the sign-in flows (plural, all of them) and each client's flow; run it, see it fail.
- [ ] **Step 3: Implement** the wording as a services constant (the console keeps strings out of hooks and views), keep usecases logic-free.
- [ ] **Step 4: Run** the console dom tests of the tenants page, `pnpm boundaries`, `pnpm format:check`, eslint, tsc; then `pnpm docs:screenshots` through heavy-slot and revert every picture or record that changed without a reason (the export panel's record may change; no unrelated webp).
- [ ] **Step 5: Commit** `feat(console): the export panel names every flow`.

## Task 4: Placement, documentation and transcripts

**Files:**

- Modify: `apps/docs/content/en/roadmap.md` (P7 bullet, ~line 100), `docs/superpowers/specs/2026-09-10-odudu-design.md` (section 11, the P7 row, ~line 453), `docs/NEXT.md` (the flows row ~line 260; keep the theme row ~259), `tests/docs/roadmap-section-11.test.ts` (~362-366), `docs/phases/p4f.md` (a pointer under the open placement, not a rewrite), `CHANGELOG.md` (`## [Unreleased]`, Added), the export and import guide(s) (`git grep -n -i "tenant export\|default flow" -- apps/docs/content/en | head`), `apps/docs/content/en/contributing/transcripts.md`
- Re-run on a live stack and save: `apps/docs/content/en/reference/transcripts/admin-paths/get-export.md` and `post-admintenant-imports.md`, following `contributing/transcripts.md` (live output only, response blocks carry no language tag, the state the output depends on is named)

- [ ] **Step 1: Verify.** `git grep -n -i -E "beyond the default|each client runs|default flow only|flows beyond" -- ':!docs/archive'` lists every place to change; `sed -n 355,370p tests/docs/roadmap-section-11.test.ts` shows how the P7 sentence is mapped.
- [ ] **Step 2: Move the placement.** Reword the roadmap P7 bullet, the section 11 P7 row and the `docs/NEXT.md` row so the flows are gone and the published theme, the clients' themes and the images they use remain named under P7 (this is the part that must not be lost); update the mapping test so each remaining P7 sentence still maps to words in the row; `docs/phases/p4f.md` points to this increment's note.
- [ ] **Step 3: Write the prose** in the words of the person who installs Odudu: what an export now carries, how a client's flow travels by name, that an older server refuses a newer document by naming the unknown key; CHANGELOG Added.
- [ ] **Step 4: Re-run the two transcripts** on a live stack (a stack of your own, project name removed afterwards), with a tenant holding two named flows and a client on one so the output shows them; regenerate nothing else.
- [ ] **Step 5: Closing reads.** `git grep -n -i -E "default flow only|flows beyond|each client runs" -- ':!docs/archive'` is empty; the roadmap's "What is not implemented" and `docs/NEXT.md` stay within `tests/docs/next-budget.test.ts`; `git grep -n -i "planned" -- apps/docs README.md` shows nothing now false.
- [ ] **Step 6: Run** `tests/docs`, `tests/lint`, the apps/docs suite (build `dist` first), `pnpm format:check`. Keep the landing JS budget (185 KiB) and the docs image limit (HEADROOM 0.8): if one fails, report it and change neither.
- [ ] **Step 7: Commit** `docs: flows travel with a tenant export`.

## Task 5: Whole-branch review and finish

- [ ] **Step 1:** Whole-branch review (spec compliance and quality) on Sonnet; one fix wave.
- [ ] **Step 2:** Push, open the draft PR (no attribution line in the body), wait for CI and the review, answer every thread.
- [ ] **Step 3:** Archive this plan and the spec with `git mv` to `docs/archive/`; ask for the explicit yes to merge into `main`.
