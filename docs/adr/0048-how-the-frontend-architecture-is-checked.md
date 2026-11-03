# 0048 — The frontend architecture is checked by dependency-cruiser and `tests/lint`; Steiger is not adopted

**Status:** Accepted · 2026-11-02

## Context

The console's layout is `features/<area>/{ui,use-cases,repository,services,adapter}`
plus `shared/{ui,use-cases,repository,services,adapter,transport}`. P4k moves
the code that breaks that layout back into it: 19 service barrels, 322 files
in `shared` that hold domain code, 131 sideways imports between features in
106 files, and 143 views that import a service. A rule that fails on all of
them on day one cannot be merged, and a rule that merely warns is not read.

The design document for the frontend names Steiger, a linter for
Feature-Sliced Design. Two checks were already in place: dependency-cruiser
(34 named rules, run by `pnpm boundaries`) and one test per rule under
`tests/lint` with fixtures and no allowlist. Whether Steiger adds anything to
them was a question to answer by running it, not by reading its documentation.

## The spike

Run in a scratch directory outside the repository, on a copy of
`apps/admin-console/src`; nothing was added to the repository's dependencies.

- verified: `npm install @feature-sliced/steiger @feature-sliced/steiger-plugin`
  fails with 404. The CLI is published as `steiger` (0.9.0); the rules are in
  `@feature-sliced/steiger-plugin` (0.8.2). `npm install steiger
@feature-sliced/steiger-plugin` installs 61 packages, 46 MB.
- verified: with the recommended preset and no `tsconfig.json` beside it,
  `npx steiger ./src` reports 44 findings and no import findings at all.
  Steiger resolves the console's `#/` alias only from a `tsconfig.json`
  with `paths`; without one every `#/features/...` import is invisible and
  19 slices report "no references".
- verified: with a `tsconfig.json` carrying `"paths": { "#/*": ["./src/*"] }`,
  the same command reports 1,416 findings: `fsd/forbidden-imports` 131,
  `fsd/no-public-api-sidestep` 1,260, `fsd/segments-by-purpose` 20,
  `fsd/public-api` 5.
- **Same-layer imports:** the 131 `fsd/forbidden-imports` findings fall in 106
  files, the same counts as the sideways-slice inventory. It flags an import
  of a sibling feature through its `index.ts` as well, so the barrel is no
  exemption, as the inventory has it.
- **Public API only:** all 1,260 `fsd/no-public-api-sidestep` findings are in
  `shared` and the `app`/`features` files importing it, because Steiger wants
  one `index.ts` per slice and `shared` here is a folder of segments
  (`#/shared/lib/services/x`). No finding is in a feature: features already expose
  one `index.ts`. A deliberate deep import added to a copy
  (`#/features/clients/ui/ClientRecordPage` from the audit feature) was
  reported by `fsd/no-public-api-sidestep` on that line. A deep import of a
  path that does not exist was not reported, since Steiger reports what it
  resolves.
- **Configuration:** `steiger.config.ts` needed three entries to reach a result
  that can be read: `fsd/no-public-api-sidestep` and `fsd/public-api` off for
  `./src/shared/**`, `fsd/segments-by-purpose` off everywhere (it objects to
  `services` and `ui`), and `fsd/forbidden-imports` off for `gallery` and
  `testing`. The result is 131 findings, all the sideways imports.
- **What it cannot say:** the preset has no rule for segment direction or for
  what a layer's segments may hold (`rules` of the plugin: ambiguous-slice-names,
  excessive-slicing, forbidden-imports, inconsistent-naming,
  insignificant-slice, no-layer-public-api, no-public-api-sidestep,
  no-reserved-folder-names, no-segmentless-slices,
  no-segments-on-sliced-layers, no-ui-in-app, public-api, repetitive-naming,
  segments-by-purpose, shared-lib-grouping, typo-in-layer-name, no-processes).
  `no-domain-in-shared`, `view-no-service` and `no-adapter-export` have no
  equivalent. Its model of `shared` (ui, api, lib, config) is not ours.
- **Inventory:** Steiger has per-glob `files` and `ignores` in its config and no
  per-finding suppression and no baseline. Holding the 106 files out would be
  a list of 106 globs, and nothing would fail when a file on it was fixed
  and the list stayed, which is what the equality ratchet below exists to
  catch.
- **Run time:** 3.2 s on three consecutive runs (about 1,570 files), against
  `pnpm boundaries` at about 5 s for the whole repository (3,743 modules).
  It is a new CLI and a new config file on the `verify` path (ADR 0044) but a
  small amount of time.
- verified, the comparison: one dependency-cruiser rule written in a scratch
  config (`from` a feature, `to` another feature, `pathNot` the same one,
  via `$1`) reports the same 131 violations in 106 files, 5.7 s. It needs the
  alias resolved, which the repository's `tsConfig` (`tsconfig.base.json`) does
  not do for `#/`: given a scratch `tsconfig` with the `paths` entry it
  matches; with the repository's it reports 0. That gap is why the
  console's boundary checks in `tests/lint` read import specifiers themselves.

## Decision

Steiger is not adopted. It enforces public-API-only imports and no same-layer
imports, and finds the same 131 as the inventory, but the work the layout needs
beyond those two (what `shared` may hold, views never reaching a service,
adapters not exporting, a shrinking inventory) is outside it, it needs its own
`shared` exemptions and a `tsconfig` to see the alias, and the two checks it does
cover are one dependency-cruiser rule or one `tests/lint` rule each. A second
linter with its own configuration, to cover a subset of what has to be checked,
is more to keep than it saves.

The frontend architecture is checked by three things that already exist or
are built with P4k:

- **dependency-cruiser** (`.dependency-cruiser.cjs`, 34 rules, `pnpm
boundaries`): the segment boundaries, which layer may import which, and the
  package-level rules. It holds what resolves through the repository's
  `tsconfig`.
- **`tests/lint`, one test per rule**, each with fixtures under
  `tests/lint/fixtures/` and no allowlist: rules that need the console's `#/`
  specifiers, or a reading of the source that an import graph does not give.
- **The inventory framework in `tests/lint/architecture`.** A rule that
  has breaches today lists them in `inventory.baseline.json`, one count per
  rule, and in `inventory.ts`, the files themselves. A rule fails on a breach
  that is not in the inventory (fix it, never add it), on a file in the
  inventory that no longer breaches (delete the line), and on a baseline count
  that differs from the inventory's length, so a count can only go down by a
  commit that shows it. A slice listed in `migrated.ts` may not breach any
  rule at all and has no inventory entry. The rules are `no-service-barrel`,
  `no-domain-in-shared`, `no-sideways-slice`, `view-no-service` and
  `no-adapter-export`. A sixth, `contracts-only-in-adapter`, was planned for
  the first contract moved, built after the inventory closed, and holds every
  console source from the start (see Consequences).

## Consequences

- The inventory mechanism ran and closed. Every slice of both apps moved and
  every inventory reached zero, so `inventory.ts`, `inventory.baseline.json`,
  `migrated.ts`, the baseline check and the `segment-rename` codemod are
  deleted. The five rules now apply to every slice with no exemption, like
  every other test in `tests/lint`. `contracts-only-in-adapter` came after
  the inventory closed and has none: it fails on any breach.
- Some platform vocabulary stays in `shared` although it names a domain word:
  the tenant vocabulary (`SYSTEM_TENANT`, `isTenantName`, `tenantPage`,
  `isUnknownTenant`), the capability rules under `shared/lib/services/capabilities`,
  what the failure wording reads from them and the `group` cache kind, which the
  role entity invalidates and the group page reads. Several slices read each, an
  entity imports no entity, and an `@x` file per symbol would be the ten
  cross-imports the architecture document calls a wrong boundary. They are
  named in `tests/lint/architecture/shared-vocabulary.ts`, one line of reason
  each, and `no-domain-in-shared` excuses a listed file its domain word and
  nothing else. The list is closed, and a test fails on an entry whose file is
  gone or no longer names a domain word, so it can only shrink.
- The console's `shared` holds `ui`, `api` (`adapter`, `transport`) and `lib`
  (`services`, `repository`, `use-cases`); the sub-folders keep the purity and
  layer rules readable. `view-no-service` makes one stated exemption: a file
  in `shared/ui` may import `shared/lib/services`, the pure helpers the design
  system formats with. A slice's services stay out of every view, `shared/ui`
  included, and a feature view reading `shared/lib/services` is still flagged.
- dependency-cruiser does resolve the console's `#/` specifiers: it reads
  them through the `imports` map of `apps/admin-console/package.json`, which
  the repository's `tsconfig` does not need (verified: `npx depcruise --config
.dependency-cruiser.cjs -T json apps/admin-console/src/entities/subject/index.ts`
  lists `#/entities/subject/services/subjectAddress` as resolved). Rules about
  those imports may therefore live in `.dependency-cruiser.cjs`; `tests/lint`
  keeps the ones that read the source itself.
- The sideways rule compares slices of one layer only. A page importing a
  feature is legal by the layer order and is not flagged, as it should not be.
  A feature importing a page broke that order unflagged in domain 3, when
  `features/groups` and `features/roles` imported `pages/subjects` between two
  commits with every check green. `console-features-import-no-page` and
  `console-features-import-no-widget` close the gap. While slices were being
  migrated the widget rule exempted the ones not yet migrated, which were
  pages in waiting; every slice has migrated and the rule has no exemption.
- Steiger's findings are not a gap in coverage we are accepting: the two
  checks it makes are made here, and it makes no check we lack except
  `insignificant-slice` and the naming rules, which are advice about FSD and
  not about this layout.
- The spike is worth repeating only if the console adopts Feature-Sliced
  Design's own segment names (`ui`, `api`, `model`, `lib`) and a `shared` of
  that shape. Its output would then be the layout's own check with no
  configuration.

## Alternatives rejected

- **Adopt Steiger beside the other two.** Rejected for the reasons in the
  decision: a second tool, its configuration and a `tsconfig` for it, for two
  of the five rules, and no inventory.
- **Adopt Steiger and drop the five `tests/lint` rules.** It has no
  equivalent of three of them and no baseline for the rest.
- **dependency-cruiser alone, with an `$1` rule for sideways imports.** Works
  (131 in 106 files) but needs the alias, and cannot read the inventory or
  the segment-content rules; kept as the first thing to try if the alias is
  ever made resolvable.

## Amendment, 2026-11-03: an entity carries use-cases

The design spec (D10) gave an entity `types`, `adapter`, `repository` and
`services` and at most presentational `ui`, and a feature the `use-cases`. Three
entities carry use-cases anyway, `session`, `tenant` and `creation-draft`, and
the rule is amended to say so rather than leave them as exceptions.

An entity's reads and rules reach the slices above as hooks. The session gate,
the shell and 24 area slices read the session; the tenant settings are read by
every tenant-scoped page. A hook belongs in a `use-cases` segment, an entity
cannot import a feature, and a feature that held the entity's hook would be
imported by the entity's own use-cases. So an entity's use-cases expose its
reads and its rules to the slices above, never an orchestration of a journey
(that stays in the page or feature), and its `index.ts` still exports only `ui`,
`use-cases` and `services`. A wire call is exposed through a thin re-export in a
use-case file (`tenantSettingsCalls`, `subjectCalls`), since a use case may not
import an adapter and an index may not export one. `entities/area` and
`entities/administrator` publish services and types only, and
`console-service-entity-index-type-only` lets a service import any other entity
index for types alone, so a rule an entity owns reaches a service as an
argument.

The check `console-lower-layers-import-no-upper` holds the layers below
`features` out of the layers above, and `console-features-import-no-page` and
`console-features-import-no-widget` close the gap that sideways-slice leaves.

`contracts-only-in-adapter` was built after the close. A contracts type is
allowed only under `adapter/` and `types/`; a contracts value is also allowed
in `services/`, `shared/api` and a shared `config/`, and never in a view, use
case or repository. Test files and `testing/` are outside it. A slice's types
file re-exports what the slice reads, so the rule fixes where a wire shape is
named, not that it is mapped: camelCase domain types are a later pass
(`docs/NEXT.md`).

`console-no-browser-globals-below-ui` (in `tests/lint`, with fixtures) holds the
console's use cases, repositories and services to reading no page global:
`location`, `document`, `window`, `navigator`, storage and `console` go through
`shared/lib/platform` or `shared/api/adapter`. A view keeps its DOM integration.
