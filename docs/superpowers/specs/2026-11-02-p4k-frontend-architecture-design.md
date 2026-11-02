# P4k: Frontend architecture, aligned with Feature-Sliced Design and five layers

**Status:** draft for approval · 2026-11-02 · behaviour-preserving refactor

## 1. Intent

The two React frontends (`apps/admin-console`, `apps/docs`) follow the
five-layer architecture of ADR 0010 only in part. The owner's reading of the
code is that services are numerous, hard to follow and repeat each other. An
audit (notes in `side-session-notes/…/audit-*.md`, summarised in section 3)
confirmed it. This phase brings both apps to the architecture in
`FRONTEND_ARCHITECTURE.md` (Feature-Sliced Design for where code lives, five
layers for what it may do) in small mergeable increments, with every action
and screen behaving exactly as today.

## 2. Goals, non-goals, anti-goals

**Goals**

- One folder vocabulary in both apps: slices contain only the segments `ui`,
  `use-cases`, `repository`, `services`, `adapter`, `types`.
- FSD layers where the code has a real need for them: `app`, `pages`,
  `widgets`, `features` (reusable user actions used by two or more pages),
  `entities`, `shared`.
- `shared` holds no business knowledge: `ui`, `api`, `lib`, `config` only.
- Services: one file per business concept, one owner per rule, no
  `services/index.ts` holding or re-exporting anything, domain services pure,
  application services taking side effects as parameters, expected outcomes
  returned as results.
- Adapters are the only code touching the outside world and map wire shapes
  to domain types; nothing above an adapter sees a contracts DTO.
- Every rule of the document that can be checked is checked by lint or
  dependency-cruiser, replacing (never dropping) the lints the rename breaks.
- Tests per the document: unit tests for services and adapter mapping,
  integration tests (React Testing Library over the existing fake transport)
  for use case, repository and view journeys, and the existing Playwright
  suite green.

**Non-goals**

- No visible change: no wording, layout, route, request, cache or
  accessibility change. Where two copies of a rule disagree, the variants are
  kept (section 5, decision D2) and listed for a later, separate decision.
- No change to the server, the contracts package or the build tooling.
- No new product features, no localization (P4h follows this phase and
  extracts strings onto the settled layout).
- No pruning of the e2e suite. It is far larger than the document's "critical
  flows only"; shrinking it is a separate decision.

**Anti-goals**

- A rename that leaves the old lints green by matching nothing.
- An entity per noun: an entity exists only where two or more slices share
  the concept.
- A refactor that changes behaviour and hides it inside a move commit.

## 3. What exists today (audit summary)

- Console: 19 area slices under `features/<area>`, each with `view`,
  `usecase`, `repository`, `adapter`, `service`; `shared/` holds all five
  layers and domain knowledge (pickers, audit table, capabilities, tenant
  settings). About 1,570 TS/TSX files.
- Docs: 4 features with `view`, `usecase`, `service`, plus `shared` and
  `shared/platform` (the adapter role).
- Layering is clean where it is already linted: no view reaches a repository,
  adapter or transport; `fetch` and storage live in adapters or the transport;
  services read no clock, randomness or DOM (one import-time `navigator` read
  in `shared/service/platform.ts`).
- Not enforced and breached: 131 cross-feature import lines (via `index.ts`);
  domain knowledge in `shared/`; 137 views importing services; adapters that
  parse but do not map (contracts types flow through about 300 files); 19
  console and several docs `service/index.ts` barrels; 9 console adapters
  untested; fixtures hand-written rather than saved responses; docs usecases
  using the clipboard, timers and observers directly.
- Duplicated rules (32 rows in audit B, 9 groups in audit A): failure-to-text
  mapping hand-rolled 10 times beside `writeFailureText`; the "holds X which
  you do not" sentence 8+ times; tab models in 5 features; `groups` and
  `roles` each define the default-block rule and the `Ceiling` state machine;
  area paths copied out of `shell/areas.ts`; names-or-"none" lists 9 times;
  several exact copies of existing shared helpers. Some copies differ (for
  example `requiredProblem` trims; three sibling checks do not).
- About 25 multi-concept service files and many named for a screen (`page`,
  `labels`, `frame`, `panelText`, `copy`).

## 4. Constraints

- CLAUDE.md applies unchanged: TDD, no `any`, no `void`, comment rules, commit
  rules, `main` protected, draft PR from the first push, CI green per
  increment, review answered per increment, closing pass and changelog.
- The segment rename changes folder names matched by `.dependency-cruiser.cjs`,
  `eslint.config.js`, about 12 `tests/lint/*` tests, and several docs tests and
  scripts. In each increment the replacement check lands first, or in the same
  commit, and the fixtures under `tests/lint/fixtures` are renamed with it.
- Imports stay `#/…` in the console and `@site/src/…` in docs, never relative
  and never with an extension.
- Performance rules (ADR 0041) hold: nothing renders an unbounded collection.

## 5. Approaches and decisions

**D1, relation to the repo's layout.** Options were: keep repo names; adopt
the document's segment names with `features/<name>` as the slice level; adopt
full FSD. **Chosen (by the owner):** rename segments, and introduce the other
FSD layers where a real need shows. The audit shows the need: today's
`features/<area>` are pages, and their 131 sideways imports are reusable
actions and domain data trapped in page-sized slices.

**D2, behaviour where copies disagree.** Options: (a) preserve every variant
as a named option of one owner and list the disagreements; (b) the careful
shared version wins and changes are logged. **Chosen (by the owner):** (a).

**D3, migration sequencing.** Options: layer by layer over the whole app; one
domain at a time through every layer; a hybrid. **Chosen (by the owner):**
hybrid. Whole-app mechanical foundation first (checks, rename, barrels, exact
copies), then domain by domain for the semantic work, with the docs app as a
small parallel track.

**D4, target layout.**

| Layer | Holds | Console examples |
|---|---|---|
| `app` | providers, router, global guards and layers | today's `app/` |
| `pages` | one slice per route screen | `clients`, `roles`, `tenants`, `audit` (today's `features/<area>`) |
| `widgets` | large blocks combining features | the shell (rail, header, pending banner) |
| `features` | reusable user actions used by 2+ pages | subject-members panel, client and role pickers, audit table, ceiling guard |
| `entities` | domain data and rules | `session`, `tenant`, `subject`, `role`, `client`, `scope`, `group`, `administrator`, `audit-event` (final list set by evidence) |
| `shared` | `ui`, `api`, `lib`, `config` | design-system pieces, the transport and gateway, formatters |

The area slices become `pages/` only after their shared parts have moved down,
as the last step of each domain, so a page's move is a rename with no logic in
it. `entities/<x>/@x` cross-references are allowed sparingly, per the document.

**D5, tooling for the checks.** The document names Steiger and a boundaries
rule. The repo already has dependency-cruiser with 34 rules. **My call:**
extend dependency-cruiser and the `tests/lint` pattern (one test per rule, no
allowlist, fixtures) rather than add Steiger; the plan carries a short spike
to confirm whether Steiger adds anything dependency-cruiser cannot express.
The spike's outcome is recorded in an ADR; adding it is allowed if it does.

**D6, integration-test fake API.** The console already runs RTL journeys over
`testing/fakeTransport.ts`, a route table injected into the real gateway.
**My call:** keep it as the fake API and do not add MSW. Journeys that the
audit found thin (failure, sign-in, usecases without a page test) get tests as
their domain is migrated.

**D7, adapters and domain types.** Adapters map `@odudu/contracts` types to
domain types in `types/`, per entity, as each entity is extracted. A page not
yet migrated keeps contracts types until its domain is done. At phase close
contracts types appear only in `adapter`. Saved copies of real responses
become fixtures beside each adapter's mapping test; the nine untested adapters
get them first.

**D8, services shape.** Domain services are pure functions. Application
services (retries, notifications, deciding what to persist) take their
dependencies as a parameter object. Results are `{ ok: true } | { ok: false;
reason }`. Result types that carry callbacks (`retry: () => void`) are
reshaped so the use case supplies the callback. Time and randomness enter as
parameters. The 300-line service file cap stays (it exists today as `console-service-length`; no file exceeds it).

**D9, increments, in order.** Each is independently mergeable, ends green on
a pushed commit, and states its volume checks (ADR 0041).

1. Placement: a P4k row in section 11, the roadmap and `docs/NEXT.md`
   (ahead of P4h, which follows it), with `tests/docs/roadmap-section-11.test.ts`
   mapped. Then the console segment rename (`view`→`ui`, `usecase`→`use-cases`,
   `service`→`services`) with the dependency-cruiser rules, the lint tests,
   their fixtures and `eslint.config.js` repointed in the same commits, and
   every docs test or script that reads a source path (`console-labels`,
   `console-areas`, `console-shots`) repointed. No rule is weakened.
2. Segment rename, docs app, with its tests and scripts; the docs usecases'
   browser access (clipboard, timers, observers) moved behind
   `shared/platform`. The docs app gets no `pages`, `widgets` or `entities`;
   it has no remote data and four small features.
3. The new checks, written test-first with fixtures: no segment-index
   barrels, no domain words in `shared`, no sideways slice imports, views do
   not import services, adapters not exported, one-concept-per-service file
   limits where checkable. Each rule is an error for every slice marked
   migrated and carries a committed inventory of the breaches elsewhere; the
   inventory may only shrink, and a test fails if it grows.
4. Barrels removed (console and docs) and the exact copies folded into their
   owners (the exact-copy rows of audits A and B).
5. Shared tab-model and failure/refusal owners, with each variant kept (D2).
6. Per-domain sequence, repeated (order set by the plan from the import
   graph: `session` and `shell` first, as they receive most imports, then
   tenant, subject, role/group, client/scope, audit, branding, settings, and
   the small ones): split multi-concept services by concept; one owner per
   rule; adapter mapping and fixtures; entity extraction; reusable features
   extracted; page moved under `pages/`; the domain's slices added to the
   migrated list.
7. When the inventories are empty the migrated list is the whole app; the
   inventory mechanism is deleted.
8. The closing pass of CLAUDE.md, plus a README per entity listing the rules
   it owns.

A mixed layout (some areas under `pages/`, others still under
`features/<area>`) is acceptable on `main` and in release candidates between
increments, because the checks hold every migrated slice to the full rules.

**D10, entity versus feature.** An entity owns a domain concept's `types`,
`adapter`, `repository` and `services`, and may carry presentational `ui`
only (no `use-cases`). A feature owns a reusable user action: `ui` and
`use-cases`, built on entities' public APIs, and its own `services` only for
rules specific to the action. A repository sits in the entity unless exactly
one feature uses that data. A concept qualifies as an entity when two or more
slices use it, and the evidence (the importing slices) goes in the plan.

**D11, characterisation first.** Before two copies of a rule are merged, a
unit test pins each variant's current output on shared inputs, and it passes
before and after the merge. Existing tests, `console-shots` and the e2e specs
stay unchanged; the characterisation tests are the oracle for the rules
those do not reach.

**D12, Steiger spike.** Timeboxed to two hours in increment 3, recorded in an
ADR either way. Steiger is adopted only if it enforces public-API-only
imports and no same-layer slice imports with less configuration than the
dependency-cruiser rules, and runs in `verify` without slowing it past what
ADR 0044 allows. Absent a clear gain the answer is no.

## 6. Left to the builder

Exact entity list and boundaries (by import-graph evidence), file names within
services, the domain order of increment 6, how the section 11 row for this phase is worded, and whether the phase is cut into two releases at an
increment boundary.

## 7. Testing and verification

Services: unit tests, written before the move, run on the old and new
location. Adapters: mapping tests on saved responses. Journeys: RTL over the
fake transport before a domain is touched, so the same test passes before and
after. Existing e2e suite, docs tests and lints green on every increment. A
behaviour-preservation check per domain: the page's existing tests, the
`console-shots` screenshots and the e2e specs for it, unchanged.

## 8. Risks

- Size: a domain-by-domain move over about 1,570 files; each domain is its own
  reviewed increment and the phase may be cut after any of them.
- A mechanical rename that conflicts with in-flight branches; the rename
  increments go in first and fast.
- P4h, which extracts console strings, is to follow this phase, not run
  beside it (my call; the roadmap order puts P4j, P5a and P4f before it).
- Equal-looking copies that differ; D2 keeps the variant, and each is listed.
