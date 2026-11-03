# P4k domain 1: session entity, area entity, shell and session-gate widgets

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** the session data and rules live in `entities/session`, the area catalogue in `entities/area`, the sign-in gate in `widgets/session-gate`, the shell in `widgets/shell` and the home screen in `pages/console-home`, with every importer repointed and no behaviour changed.

**Spec:** `docs/superpowers/specs/2026-11-02-p4k-frontend-architecture-design.md` (D1-D12). Parent plan: `2026-11-02-p4k-frontend-architecture.md`, "Increment 5 onward" (tasks A to G).

## Global constraints

- Behaviour never changes. Tests move with their code and pass unchanged except for import paths.
- Moves use `git mv`; importers are repointed with a script (alias `#/features/session/...` to the new path). Imports carry no `.ts` or `.tsx`.
- Layers: `app` > `pages` > `widgets` > `features` > `entities` > `shared`. A slice is imported only through its `index.ts`; an index never exports an adapter.
- A service file stays under 300 lines and is named for a concept. Services are pure; browser access sits in an adapter.
- CLAUDE.md comment rules, no `any`, no `void` statements, no tool-attribution trailer in commits (subject at most 72 characters, body at most 8 lines).
- Each task ends with `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test:unit` (plus `pnpm --filter @odudu/docs test` when a console service path changes) green. Inventories in `tests/lint/architecture/inventory.ts` and `inventory.baseline.json` shrink in the same commit as the move that resolves them.

## Evidence (import graph at the start)

`#/features/session` is imported 86 times through its index by 17 other features plus `shell`, `app` and `testing`; `#/features/shell` 31 times by 15 features plus `app` and `testing`. The gate and shell UIs are used by `app/router.tsx`, `app/router.test.ts`, `app/App/failure.test.tsx` (`vi.mock('#/features/shell', ...)`) and `testing/mountGuardedPage.tsx`. Every UI in both slices has a `*.test.tsx`; no sign-in route journey runs through `fakeTransport` (`SessionGate.test.tsx` is the closest).

## Rulings

- **Area slices are pages in waiting.** Today's `features/<area>` slices become `pages/<area>` in their domain's last step. Until then they may import `widgets/*` and `entities/*`; the upward-import rule is checked for a slice only once it is in `MIGRATED`. `AreaGate`, `useArea`, `pendingPage` and `AreaAccess` (24 importers) therefore live in `widgets/shell` and stay legal.
- **Capability vocabulary and transport signals stay in `shared`.** `AdminCapability`, `Authority`, `SYSTEM_TENANT` (14 shared files import them) stay in `shared/services/principal.ts` until the capabilities domain moves them. `sessionEnded` and `sessionEvents` stay (the transport imports them). Only the session's own concepts (`Principal`, `isOwnTenant`, `isSelf`) move to `entities/session`; the `no-domain-in-shared` inventory loses only what actually moves.
- **No entity imports an entity.** `entities/area` holds only the catalogue (`areaAt`, `Area`, `EVERY_AREA`, `OVERVIEW`, `areaHref`) and takes `AdminCapability` from shared. `showsSystemArea` and `actsWithSystemAuthority` take a principal, so they live in `widgets/shell` (rail build).

## Target layout

| New slice              | Receives                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `entities/session`     | `session/{adapter,repository}` whole; services `whoami`, `tenant`, `boot`, `entry`, and the return-path and login-URL services split from `address`; use-cases `useSession`, `useSignedIn`, `useAuthority`, `useTenantAccess`, `useAuditReadable`, `useReloadConsole`, `useSignOut`, `useEndOwnSession`; `Principal`, `isOwnTenant`, `isSelf` into `types/principal.ts` and `services/principal.ts`. The index exports everything the 86 importers use (enumerate from the grep: `usePrincipal`, `useSignedIn`, `useAuthority`, `useAuthorityAnswered`, `useRefusal`, `useRereadAuthority`, `useTenantMissing`, `useTenantAccess`, `useAuditReadable`, `useReloadConsole`, `useSignOut`, `useEndOwnSession`, `useLeaveConsole`, `draftOwner`, `rememberedTenant`, `CHOOSE_TENANT`, `SWITCH_HREF`, the `entry` and `tenant` services) |
| `entities/area`        | `shell/services/areas` (catalogue) and `areaHref`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `widgets/session-gate` | `SessionGate`, `SignIn`, `SigningIn`, `SignedInElsewhere`, `PrincipalChanged`, `SessionStatus`, `useSignIn`, `useElapsed`, `usePlaceholderDue`, `signInText` (was `labels`), `loginError`; index also exports what `pages/console-home` needs (`SignIn`, `SigningIn`, `SignedInElsewhere`, `useSignIn`, the `loginError` service)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `widgets/shell`        | `TenantShell`, `PendingFrame`, `AreaGate`, `RailFooter`, `TenantNotFound`, `ThemeControl`, `shell/{adapter,repository}` whole, `useArea`, `usePendingFrame`, `useShell`, `pending`, `railGroups`, `systemAuthority`, `shellText`, `pageContext`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `pages/console-home`   | `ConsoleHome`, `useConsoleHome`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

A widget's view that imports a service or repository directly is a `view-no-service` breach once migrated (`SessionStatus` imports `repository/useLeaveConsole`): route it through a use-case in the same task.

## Tasks

### Task 0: Rules know about widgets

- [ ] Add `widgets` to `SLICE_LAYERS` in `tests/lint/architecture/no-sideways-slice.test.ts` with a fixture case, and extend the dependency-cruiser rules that match only `features/` (`console-feature-imports-only-index`, the index-exports rule, `shared-no-feature`, `nothing-imports-app`) to cover `widgets/`, `entities/`, `pages/`, each with a planted-violation check. Add an upward-import rule (`entities` and `shared` never import `widgets`, `pages`, `features`, `app`; `widgets` never import `pages`) that applies to every file outside the not-yet-migrated area slices. `MIGRATED` takes repo-relative paths such as `apps/admin-console/src/entities/session` (verified against `rule.ts`). Commit `tests: the architecture rules cover widgets and entities`.

### Task 1: Pin the journeys and rules (D-A)

- [ ] Add `SessionGate.journey.test.tsx` rendering the gate over `fakeTransport` for the four states (signed out shows `SignIn`, pending whoami shows `SigningIn`, a different principal shows `PrincipalChanged`, signed in renders children), asserting the visible text of each.
- [ ] Pin, from the public function `resourceHref` in `audit/services/links.ts`, that every area page it links to resolves through `areaAt`; no export of the private `AREA_PAGES`.
- [ ] Characterisation tests for `showsSystemArea`, `actsWithSystemAuthority`, `isOwnTenant`, `isSelf`, `areaHref`, `themeChoice`, `themeCookie` for each input class. All green before any move. Commit `console: pin session and shell journeys before the move`.

### Task 2: Split services by concept (D-B)

- [ ] `session/services/address.ts` (46 lines, five concepts) splits into `returnPath.ts`, `loginUrl.ts` (login URL, switch href, sign-out destination); the principal type re-exports are deleted and importers take types from `shared/services/principal` until the entity exists. `labels.ts` renames to `signInText.ts`. Tests move with them.
- [ ] `shell/services/rail.ts` splits into `railGroups.ts` (grouping and build) and `systemAuthority.ts` (the two principal rules); delete the `holds` re-export in `rail.ts` and in `shell/index.ts` (nobody imports it from there).
- [ ] `shell/services/frame.ts` (32 lines) is shell wording plus `dialogOpen` and `pathnameOf`: split into `shellText.ts` (`brandText`, `areasLabel`, `checkingText`, `tenantNotFoundText`, `signedInFrom`) and `pageContext.ts` (`dialogOpen`, `pathnameOf`). Commit per split.

### Task 3: One owner per rule (D-C)

- [ ] Theme: `shell/services/theme.ts` (`THEME_CHOICES`, `themeChoice`) merges into `shared/services/theme.ts`, which owns it; delete the copy; characterisation from Task 1 passes unchanged.
- [ ] Remove the re-exports of shared symbols in `shell/services/rail.ts` (done in Task 2). The six literal page titles (System administrators, Tenants, Subjects, Overview, Export, `FLOW_TITLE`) repoint to `areaAt(...).label` after Task 5 once the catalogue is in the entity; their tests stay.

### Task 4: Adapter maps to domain types, with saved responses (D-D)

- [ ] Verify first which file consumers import `@odudu/contracts` types through. `session/adapter/logout.ts` has no test: save a real logout response as `adapter/fixtures/logout.json` (from a docs transcript or a recorded stack run; no invented data), write `logout.test.ts`. `session.ts` maps `whoami` to the principal type in `types/principal.ts`; consumers in the entity stop importing contracts.

### Task 5: Extract entities (D-E)

- [ ] `git mv` per the table into `entities/session` and `entities/area` (`{types,adapter,repository,services,use-cases}`, `index.ts` never exports an adapter, `README.md` "Rules owned"). Repoint every importer with a script; delete the resolved `no-domain-in-shared` entries and update the baseline in the same commit. `pnpm boundaries && pnpm lint && pnpm test:unit` green; commit per entity.

### Task 6: Extract widgets and the page (D-F, D-G)

- [ ] `git mv` `widgets/session-gate`, `widgets/shell`, `pages/console-home`, each with an `index.ts`. Repoint `app/router.tsx`, `app/router.test.ts` (`EVERY_AREA`), `app/App/failure.test.tsx` (`vi.mock` specifier follows `TenantShell` to `widgets/shell`), `lazyFeatureRoute`, `testing/mountGuardedPage.tsx`. Remove `features/session` and `features/shell`.
- [ ] Repoint every string reference (grep both names): `apps/docs/tests/support/console-labels.ts` (lines 53, 99, 108, 899), `tests/lint/architecture/inventory.ts` (395-397, 500-513), `tests/lint/brand-assets.test.ts` (768-769), `tests/lint/console-view-tests-run-axe.test.ts` (104), `tests/lint/console-store-access.test.ts` (348-350), `tests/lint/fixtures/console-folder-imports/*`.
- [ ] Add the five new slices to `MIGRATED`; shrink inventories; baseline equal. Verify: format, typecheck, lint, test:unit, boundaries, `pnpm --filter @odudu/docs test`, the console integration project and shell/signin e2e through the heavy-slot lock. Push, CI green, review answered.

## Review focus

- A principal change mid-session still shows `PrincipalChanged` (not signed out).
- A return path outside the console is refused in the login URL.
- Rail still hides system areas for a tenant-only principal.
- The theme cookie string is byte-identical.
- Every deep import of a moved path is gone (grep `features/session` and `features/shell` returns nothing).
