# P4k — the frontend architecture

What the phase found, in the shape `docs/phases/p2b.md` established: the
running record the spec and plan do not keep. The argument is in
[ADR 0048](../adr/0048-how-the-frontend-architecture-is-checked.md) and the
amendments to [ADR 0010](../adr/0010-five-layer-architecture.md); how it was
planned is in the [spec](../archive/specs/2026-11-02-p4k-frontend-architecture-design.md)
and the [plan](../archive/plans/2026-11-02-p4k-frontend-architecture.md) with
its nine domain plans beside it. The phase changed no behaviour except one
defect it found while pinning (below), and no route, request, cache key or
wording.

## What shipped

Both frontends use one folder vocabulary, the segments `ui`, `use-cases`,
`repository`, `services`, `adapter` and `types`, where they were `view`,
`usecase`, `service` before.

**The admin console** (`apps/admin-console/src`):

| Layer      | Holds                                                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app`      | providers, router, global guards                                                                                                                                                                                                     |
| `pages`    | one slice per route screen: 17 (`audit`, `branding`, `clients`, `console-home`, `email`, `flow`, `groups`, `overview`, `roles`, `settings`, ...)                                                                                     |
| `widgets`  | three blocks composed of other slices: `shell`, `session-gate`, `failure`                                                                                                                                                            |
| `features` | nine reusable user actions used by two or more pages: `begin-administrator`, `grant-administrator`, `own-roles`, `record-activity`, `role-mapping`, `scope-assignment`, `subject-capabilities`, `subject-members`, `branding-editor` |
| `entities` | 13 domain concepts: `administrator`, `area`, `audit-event`, `client`, `creation-draft`, `group`, `mail-relay`, `role`, `scope`, `session`, `signing-key`, `subject`, `tenant`; each has a README listing the rules it owns           |
| `shared`   | `ui`, `api` (`adapter`, `transport`) and `lib` (`services`, `repository`, `use-cases`); no business knowledge beyond the closed list below                                                                                           |

**The docs app** (`apps/docs/src`): `features/<name>/{ui,use-cases,services}`
with one `index.ts`, and `shared/{ui,lib}` where `lib` holds `services`,
`use-cases` and `platform` (the browser wrappers a use case hands to a
service). It has no `pages`, `widgets` or `entities`: it has no remote data.

Beyond the move:

- One owner per rule where the audits found copies: failure and refusal
  wording (`failureTextWith`, `refusedBy`), record tabs (`recordTabs`), area
  data (`entities/area`), the ceiling state machine (`Ceiling<Ready>`), the
  default-reach rule (`blockedByDefault`), the mapped-roles rule (`keptRoles`)
  and the exact copies of existing helpers.
- Adapters map to domain types and each has a mapping test over a saved
  response, including the nine that had no test.
- Services split by concept, one file per noun phrase and none over 300 lines
  (`console-service-length`, now reading the docs app too).
- The docs use cases no longer touch the clipboard, timers or observers
  directly; they receive them from `shared/lib/platform`.

## The architecture checks

All plain error-level rules with no allowlist. The inventory-and-baseline
mechanism that carried the phase (a rule fails on a breach not listed, on a
listed file that no longer breaches, and on a count that differs from the
list) ran to zero and was deleted together with the `segment-rename` codemod;
ADR 0048 has the account.

- `tests/lint/architecture`: `no-service-barrel`, `no-domain-in-shared`,
  `no-sideways-slice`, `view-no-service`, `no-adapter-export`, read over both
  apps, plus `console-service-length`.
- dependency-cruiser (`pnpm boundaries`): `console-feature-imports-only-index`,
  `console-service-imports-only-service`, `console-service-entity-index-type-only`,
  `console-index-exports-ui-use-cases-services`, `console-lower-layers-import-no-upper`,
  `console-features-import-no-page`, `console-features-import-no-widget`,
  `console-widgets-import-no-page`, and the `docs-*` equivalents.
- **The shared vocabulary**, closed, in `tests/lint/architecture/shared-vocabulary.ts`:
  `principal.ts` (`SYSTEM_TENANT`, `isTenantName`), `address.ts` (`tenantPage`),
  `failure.ts` (`isUnknownTenant`), `queryKeys.ts` (`groupKey`), and the four files
  of `capabilities/`. They stay in `shared/lib` because several slices read each,
  an entity imports no entity, and an `@x` file per symbol would be the ten
  cross-imports the architecture document calls a wrong boundary. A new entry is a
  decision against ADR 0048, not a way to quiet the rule.
- `shared/ui` may import `shared/lib/services`, the pure helpers the design
  system formats with; a slice's own services stay out of every view.

## What it found

- **The layer-order gap.** A feature importing a page broke the order with every
  check green for two commits in domain 3, because the sideways rule compares
  one layer only. `console-features-import-no-page` and `-no-widget` closed it.
- **Whole-repository scans time out in CI.** The architecture rules read every
  file; on the runner they passed five seconds under load. The scan is
  memoised per test file and the timeout is 60 seconds.
- **Intermediate commits red on their own.** A handful (a sideways breach in
  domain 3, a raised baseline in domain 5, a docs label test in domain 7 and 8)
  are red alone and green after the next; a bisect through them lands there.
- **A plan that misread the code.** Where a plan said two copies disagreed
  and they did not (the limit readings of domain 7 differ only in where the
  noun sits), the repository won and the named option is `overNoun`.
- **Lint errors escaped reviewers** until every implementer and reviewer ran
  the whole `pnpm lint`, not the changed files.
- **Steiger was run, not read about**, and is not adopted (ADR 0048).

**The one behaviour change.** Pinning the signing-keys page showed that a stage
request refused for the algorithm alone was drawn nowhere: the service placed
the error under `alg` and the page dropped it. It now shows under the Algorithm
control. Test first, its own commit, listed in the changelog under _Fixed_.

**Adapter calls through use-cases.** A use case may not import an adapter and an
entity index may not export one, so an entity exposes a wire call as a thin
re-export in a use-case file (`tenantSettingsCalls`, `subjectCalls`). It is the
pattern; a later refactor to hooks is possible and not owed.

**An entity carries use-cases.** The spec said an entity has no `use-cases`.
`session`, `tenant` and `creation-draft` carry them because the widgets and
slices above consume their reads and rules as hooks, and an entity cannot import
a feature. ADR 0048's second amendment records the exception; an entity's index
still exports only `ui`, `use-cases` and `services`.

**An entity's index.** `area` and `administrator` publish services and types only,
and `console-service-entity-index-type-only` lets a service import any other
entity index for types alone, so a rule an entity owns reaches a service as an
argument (the overview's `EntityRules`).

## Variants kept

Where two copies of a rule disagreed, the variant stayed as a named option of
one owner, pinned by a test, and is listed here for a later and separate
decision (spec D2). None changed a word a person reads.

- **`listOrNone` and / comma.** `join: 'and'` writes "a, b and c", `join:
'comma'` writes "a, b, c". The comma form serves `describeHoldings`,
  `describeActions`, `describeIds` and the settings description; the and form
  serves `namesOrNone`. **UX note for the owner:** one record page can read one
  list as "A, B" and another as "A and B". A fifth comma form, the array case of
  `describeValue` in `shared/lib/services/conflict.ts`, was left as it was.
- **`submitOrAsk` `whenAsked`.** What `submit` returns when it asked instead of
  sending. Settings returns `false`, so a Save pressed again after Cancel asks
  again; `useCapabilities` and `useSubjectGroups` return `true`, so the guard
  stays set. The `true` callers probably ignore a second Save after Cancel: a
  likely latent defect, not changed.
- **Token lifetimes** keep their hand-written "(1 minute)", "(365 days)" and
  ungrouped numbers: `formatDuration(60)` reads `60 s · 1 minute` and
  `groupedNumber` writes `31,536,000`.
- **`keptRoles` `lookup`.** Scopes read a role's reach through the picker index
  and keep nothing for an unknown role; groups judge the item's own reach.
- **`roleOwnerLine`** returns `TENANT_ROLE_TEXT` for a tenant role and keeps its
  own sentence for the service-account tab ("Scoped to portal." against
  "client portal"); only the tenant wording is shared.
- **Ceiling and reach.** `ServiceAccountReach` stays beside `Ceiling<Ready>`
  (renamed from `Reach`), and `reachLine` ("...so you cannot change {name}.")
  against `beyondText` ("...cannot change what {name} holds.") differ.
- **`NAME_FIXED`.** Three claims, three tails: roles, groups and scopes each say
  why a name cannot change, pinned by a service test and the page's test.
- **412 wording.** Only `tenantChangeFailure` says "changed elsewhere since you
  opened it. It has been read again; look at it before trying again."; the
  three "needs the manage-tenant capability" sentences differ per caller and go
  through `failureTextWith`. A whitespace-only tenant name shows the rule text
  and an empty one "Enter a name for the tenant."
- **`isInstant` against `isAuditInstant`.** The form's `Date.parse` check reads
  a pre-1970 instant that the contract's check refuses. Merging would drop the
  form's "To is before From" problem for such a range.
- **`overNoun`.** `limitReading` says "1 bytes over the limit of 2,000." for
  bytes and "3 over the limit of 200 web origins." for counts.
- **Per-slice sentences** that name different things: the audit and tenant
  `savedText` and `exportFailureText`; the nine network sentences that remain
  caller overrides of `failureTextWith`; the activity tab's shorter correlation
  note; `AuditDetail`'s label sentence; the audit form's `RANGE_PROBLEM` and the
  address's `BACKWARDS`.
- **Tone unions** (`EffectiveTone`, `MailTone`, `DeliveryTone`) are three subsets
  of the view's `StatusTone`; a service cannot import the view type.
- **`MailSchemeName`** duplicates the editor's `Scheme`: a types file cannot take
  a feature type and a service cannot import a feature index.
- **`readyToPromote` against `promotionOf`** agree at the edge and are both pinned.

## Left, and where it went

- **Contract types outside adapters, closed afterwards.** The spec's aim that a
  contracts type appear only in an `adapter` was first reached for the entities
  and not for the pages: 145 non-test files above the adapters imported
  `@odudu/contracts`. `contracts-only-in-adapter` now exists
  (`tests/lint/architecture/contracts-only-in-adapter.test.ts`, with fixtures)
  and holds every console source with no inventory: a contracts type, in an
  `import type`, an `{ type X }` specifier or an `export type … from`, is
  allowed only under `adapter/` and `types/`; a contracts value (a limit, a
  kind list, a schema) also under `services/`, `shared/api` and a shared
  `config/`, never in a view, use case or repository. Each slice's
  `types/<concept>.ts` re-exports what it reads; what two slices read lives
  once, in `shared/lib/types/` (wire shapes with no domain word) or in the
  owning entity's index. What stays outside the rule: test files and the
  `testing/` doubles, and the docs app, which has no contracts import. Still
  open, and named: the domain types keep the wire's field names
  (`admin_reach`, `client_key`), and a re-export is not a mapping, so most
  `types/` files hand the wire shape on unchanged; mapping them to camelCase
  domain types is in `docs/NEXT.md`, "Decisions still open", with the other
  cleanup.
- **Console literals, for P4h.** The console has no lint for typed text yet.
  `AuditDetail`, `AuditTable` and `RecordActivity` still hold literals ("Event
  id", "Details", "Close", "no subject", "from elsewhere"), and
  `entities/audit-event` joins them; P4h's extraction takes them with the
  literal lint it adds.
- **Return bags.** `useClientTokens`, `useClientAdvanced` and `useClientLogout`
  return 25-30 fields; grouping them per section is a use-case refactor no
  rule asks for yet.
- **Screen-named service files** (`mailTabView`, `overridesView`,
  `languagesView`, `stylesheetView`, `publicationBar`, `pagesTab`, `imageCards`),
  four "decode an id, then call back" helpers in branding and
  `SCHEME_PREVIEW_WORDS` holding functions.
- **A sideways-slice blind spot.** The rule compares slices of one layer; a
  page importing a feature is legal by order and is not flagged.
- **`failure.ts`** carries `isUnknownTenant` on the vocabulary list for the whole
  file; splitting it moves one function and removes an entry.
- **Done at the close:** `authEvents` now sits beside the transport that
  emits it, `authEnded` stays a service (the session entity's `boot` reads it);
  78 constants and functions nothing else read were unexported.
- **Not run locally:** the e2e specs and `console-shots` of every domain ran in
  CI at each push, not locally.
