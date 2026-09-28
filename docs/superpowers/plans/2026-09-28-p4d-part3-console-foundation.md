# P4d Part 3 — The Console Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `apps/admin-console` — a React 19.3 SPA the gateway
serves — with its boundary rules, naming lint, transport, the Instrument
design system, the shell, sign-in and draft restore, and a Playwright job
that signs in against the built image. Part 4 then adds the features one at
a time on top of it.

**Architecture:** Vite builds a static SPA with base `/console/`; the Docker
image copies it to `/app/console`, where the gateway already serves it. The
app is feature-based (spec §6.2): `app/` assembles, `shared/` holds only
what two features use, each `features/<name>/` holds its own layers by path
segment. It talks to nothing but the gateway: `/console/api/session`,
`/console/api/admin/*`, `/console/auth/login`, `POST /console/auth/logout`.

**Tech Stack (pinned exactly; each version ≥ 24 h old per
`pnpm-workspace.yaml:8`, re-checked at install):** react / react-dom 19.3.0,
vite 8.3.1, @vitejs/plugin-react 6.1.1, @tanstack/react-router 1.170.39,
@tanstack/router-plugin 1.168.40 (only if file routes are used — see Task 2),
@tanstack/react-query 5.104.0, react-aria-components 1.21.1 (react-aria
3.52.1), zustand 5.0.15, @testing-library/react 16.3.3,
@testing-library/user-event 14.6.7, @testing-library/jest-dom 7.0.1,
jsdom 30.1.1, @playwright/test 1.63.0, @axe-core/playwright 4.13.0,
axe-core (the version @axe-core/playwright pins), eslint-plugin-react-hooks
7.1.1, @fontsource/ibm-plex-sans 5.3.0, @fontsource/ibm-plex-mono 5.3.0.
verified: `npm view <pkg> version time --json` for each on 2026-09-28
(facts file; re-run at install, and take a newer version only if it too is
≥ 24 h old).

**Spec:** `docs/superpowers/specs/2026-09-26-p4d-admin-console-design.md`
§6 (application), §7 (UX rules), §8 (Instrument), §9 (testing, `e2e`),
§12 item 4. Gateway contract: `docs/console-paths.md` and `docs/NEXT.md`
"P4d's Part 3 inherits the gateway".

## Global Constraints

- Layout and layers exactly as spec §6.2; naming exactly as §6.3
  (`PascalCase.tsx` components, `useX.ts(x)` for any file exporting a hook,
  `camelCase.ts` otherwise, `*.test.ts(x)` beside the subject, CSS module
  beside its component). State homes exactly as §6.4: server data only in
  TanStack Query inside `repository`; position in the URL; principal,
  transport, theme in Context; toasts and the unsaved-changes guard in
  Zustand inside `repository`. A view never imports a store, a transport or
  an adapter.
- The SPA sends `X-Odudu-Console: 1` on every non-GET, `credentials:
'same-origin'`, never an `Authorization` header, and never reads or writes
  a cookie (the session cookie is `HttpOnly`).
- A `401` whose problem `type` is `about:blank#console-session-ended` means
  sign in again; every other `401`/`403` is shown as-is (spec §7.4).
- Secrets (client secrets, registration tokens, one-time passwords, import
  secrets) never enter a toast, the URL, a draft, `sessionStorage`,
  `localStorage` or the Query cache (§7.4).
- Tokens and components exactly per §8: IBM Plex Sans / Mono self-hosted;
  type scale 12, 13, 15, 20, 28; 4 px space base (8, 12, 16, 24, 32); radii
  3–4 px; 120 ms / 200 ms, one ease-out; `prefers-reduced-motion` instant;
  amber only for system authority; every signal ink ≥ 4.5:1 on its surface;
  container-query breakpoints 640 and 1024.
- WCAG 2.2 AA: visible focus, focus return on dialog close, ≥ 24 px
  targets, no status by colour alone; axe runs on every rendered component
  test and every Playwright page, in both themes.
- The shell's CSP (`packages/console-gateway/src/view/spa.ts` `SHELL_CSP`)
  is fixed: no inline `<script>`, no `<style>` element except React Aria's
  hashed one. A `style={…}` prop is allowed — React DOM applies it through
  the CSSOM, which `style-src` does not govern, and React Aria's overlays
  position themselves that way. `assumption:` checked in S3 by the
  violation listener; the Playwright job is the guard.
- `CLAUDE.md` rules apply: comment blocks ≤ 8 lines, no process references,
  no `any` (the lint and the test are extended to `.tsx`), no `void`
  statements, TDD, commit subject ≤ 72, no trailer.

## Review Focus

1. **The strict CSP breaking the app silently.** A built bundle that
   injects a style or script the CSP refuses renders blank with no error a
   test sees. Guard: the Playwright job loads the built shell through the
   gateway with the real CSP and fails on any `securitypolicyviolation`
   event and on any console error.
2. **A session ending mid-edit losing work or saving on the user's
   behalf.** A `401 console-session-ended` during an edit keeps the draft in
   `sessionStorage` (never a secret field), goes through sign-in, restores
   it marked for review, and sends nothing.
3. **Cross-site writes refused because a header was forgotten.** Every
   non-GET goes through the one transport; a unit test asserts the header
   and `same-origin` on every method, and the boundary rule forbids `fetch`
   outside `shared/transport`.
4. **A `.tsx` file escaping the repo's lints.** The relative-import ban, the
   no-any waiver test, the comment-length test and vitest's globs match
   `.tsx` after this part; a fixture proves each.
5. **The unsaved-changes guard missing an exit.** In-app navigation, tab
   change, tenant switch, sign-out, and the browser's back, reload and close
   each ask first (§7.4).

---

### Task 1: Spike the three untested assumptions

**Files:** throwaway only under `/tmp`; results into `docs/phases/p4d.md`
"## Part 3 spikes".

- [ ] **S1 — Vite resolves a workspace package whose `exports` point at
      `.ts` source with `#/` subpath imports.** `assumption:` a scratch Vite app
      importing `@odudu/contracts/admin` (`packages/contracts/package.json`
      `exports` → `./src/admin/index.ts`) type-checks, runs under `vite dev`,
      and builds with `vite build`, with the schemas' `#/admin/*` imports
      resolved. Record what config it needed (`resolve.conditions`,
      `optimizeDeps.exclude`, or none).
- [ ] **S2 — React Aria Components under jsdom + Testing Library in this
      repo's Vitest 5.** `assumption:` a `Button` and a `Dialog` render, respond
      to `userEvent`, and pass `axe-core` in a `jsdom` Vitest project. Record the
      setup file it needed.
- [ ] **S3 — Playwright against the built image.** `assumption:` the
      container stack (`infra/docker`) with a console build copied to
      `/app/console` serves `GET /console/` 200 with `SHELL_CSP`, and Playwright
      (1.63.0, `npx playwright install chromium --with-deps` on
      `ubuntu-latest`) can sign in through `/console/auth/login` against it
      with a seeded admin, with no CSP violation. Record the seed commands used.
- [ ] Commit: `Record what the console foundation's spikes found`.

### Task 2: Scaffold `apps/admin-console` and ship it in the image

**Files:**

- Create: `apps/admin-console/{package.json,tsconfig.json,vite.config.ts,index.html}`,
  `src/main.tsx`, `src/app/{App.tsx,router.tsx,providers.tsx}`,
  `src/app/App.test.tsx`.
- Modify: `vitest.config.ts` (a `dom` project: `environment: 'jsdom'`,
  include `apps/admin-console/src/**/*.test.{ts,tsx}`, with the setup S2
  found; extend the other projects' globs to `.tsx` where they scan
  sources), `eslint.config.js` (react-hooks plugin for
  `apps/admin-console/**`; extend `no-restricted-imports`' globs to
  `*.tsx`), `tests/lint/no-any.test.ts` and
  `tests/lint/comment-block-length.test.ts` globs (`.tsx`),
  `infra/docker/Dockerfile` (build the console in the `build` stage; `COPY
--from=build /repo/apps/admin-console/dist /app/console`; `ODUDU_CONSOLE_DIR=/app/console`),
  `infra/docker/smoke.sh` (assert `GET /console/` is 200 with the exact
  `SHELL_CSP` and a hashed asset 200 `immutable`), `turbo.json` if the
  build needs inputs beyond defaults, `docs/request-paths.md`'s "not
  implemented" entry (the shell is served; features are Part 4).
- Create: `packages/console-gateway/src/view/react-aria-style.test.ts` — the
  owed test: read the pinned `react-aria`'s
  `dist/private/interactions/usePress.mjs`, rebuild the injected text
  (`@layer { [data-react-aria-pressable] { touch-action: pan-x pan-y
pinch-zoom; } }` as the template renders it, `.trim()`ed), hash it, and
  assert `SHELL_CSP` names that hash. Also locate `usePreventScroll`'s iOS
  style in the same package and, if it injects one, assert its hash too or
  record why the shell never triggers it.

**Interfaces:**

- **zod must run jitless under the shell's CSP** (Part 3 spike S3: zod
  4.6.1 probes `new Function` when a schema is built, a `script-src`
  violation). `src/zodConfig.ts` calls `z.config({ jitless: true })` and is
  the **first import** of `src/main.tsx`; `zod` is a direct dependency pinned
  to the exact version `@odudu/contracts` uses, so there is one instance. A
  unit test asserts `main.tsx`'s first import is `./zodConfig` and that the
  app's `zod` version equals the contracts' one.
- `vite.config.ts`: `base: '/console/'`; `build.outDir: 'dist'`, hashed
  assets under `assets/` (Vite default names satisfy the gateway's
  `CONTENT_HASHED_NAME`); `server.proxy` for `/console/api` and
  `/console/auth` → `http://localhost:3000` (`packages/kernel/src/config.ts:82`
  default port).
- Routing: **code-based TanStack Router routes**, each feature's `index.ts`
  exporting its route objects, `app/router.tsx` assembling them — keeps the
  "feature exposes one `index.ts`" rule without a generated route tree. No
  `@tanstack/router-plugin`.
- `tsconfig.json` extends the base with `lib: ["es2023","dom","dom.iterable"]`,
  `jsx: "react-jsx"`, `module: "esnext"`, `moduleResolution: "bundler"`,
  `types: ["vite/client"]` — the first package needing overrides (the base
  sets `nodenext`, `tsconfig.base.json`).

- [ ] **Step 1: Failing tests** — `App.test.tsx` renders the app shell
      placeholder under the router; `react-aria-style.test.ts` fails until the
      dependency exists; `smoke.sh` fails on the missing shell; a lint fixture
      `.tsx` with a relative import and one with an `eslint-disable` of an
      any-rule are both caught.
- [ ] **Step 2:** Implement; run `pnpm verify`, `./infra/docker/smoke.sh`.
- [ ] **Step 3:** Commit: `Scaffold the admin console and ship it in the image`.

### Task 3: The console's boundary rules and naming lint

**Files:** Modify `.dependency-cruiser.cjs`; create fixtures under
`tests/boundaries/fixtures/apps/admin-console/src/…`; create
`tests/lint/react-naming.test.ts`.

**Interfaces — rules (spec §6.2):**

- `console-feature-imports-only-index`: from
  `apps/admin-console/src/features/([^/]+)/`, to
  `apps/admin-console/src/features/(?!$1/)[^/]+/(?!index\.ts$)` forbidden.
- `console-shared-imports-no-feature`: from `apps/admin-console/src/shared/`
  to `apps/admin-console/src/features/` forbidden.
- `console-nothing-imports-app`: from `apps/admin-console/src/(shared|features)/`
  to `apps/admin-console/src/app/` forbidden. With the first rule, `app/` is
  the only place that can see every feature's `index.ts` together, which is
  what "`app/` assembles" means here.
- `console-view-no-transport`: from `(^|/)(view)(/|\.tsx?$)` under the app
  to `shared/(transport|repository)/` forbidden.
- `console-fetch-only-in-transport`: a lint test (not depcruise) — no
  `fetch(` call in `apps/admin-console/src` outside `shared/transport/`.
- Existing layer regexes extended to match a single-file layer:
  `(view|usecase|repository|adapter|service)(/|\.tsx?$)`.
- Fixtures: a feature importing another's internals (fails), shared
  importing a feature (fails), a view importing transport (fails), a
  service importing a sibling service **in the same package (passes — the
  missing negative control `docs/NEXT.md` records against
  `service-is-a-leaf`)**, a single-file `view.tsx` importing `adapter.ts`
  (fails).
- `react-naming.test.ts`: fails on a `use*` file exporting no hook, a hook
  (`export function use…`/`export const use… =`) from a file not named
  `use*`, a component file (`.tsx` exporting a PascalCase function returning
  JSX) not PascalCase-named — with passing and failing fixtures.

- [ ] **Step 1:** Fixtures and lint fixtures first; see each fail as
      specified. **Step 2:** Rules; run `pnpm boundaries` and the lint tests.
      **Step 3:** Commit: `Hold the console to its feature and naming rules`.

### Task 4: The one transport

**Files:** `apps/admin-console/src/shared/transport/{gateway.ts,problem.ts,cursor.ts,etag.ts}`
and tests; `shared/repository/queryClient.ts`; `shared/service/sessionEvents.ts`.

**Interfaces:**

- `gateway.request<T>(method, path, { body?, ifMatch?, schema }): Promise<GatewayResult<T>>`
  where `path` is relative to `/console/api/`; parses success bodies with
  the given Zod schema from `@odudu/contracts` (S1's resolution), returns
  `{ ok: true, data, etag, next }` or `{ ok: false, problem }`; never throws
  for an HTTP status.
- Adds `X-Odudu-Console: 1` on non-GET; `credentials: 'same-origin'`;
  `If-Match` when given; `content-type: application/json` on a JSON body.
- `problem.ts`: parses `application/problem+json`; `isSessionEnded(problem)`
  on `type === 'about:blank#console-session-ended'`; emits a
  `sessionEnded` event (`shared/service/sessionEvents.ts`) the session
  feature subscribes to.
- `cursor.ts`: parses the `Link: <…>; rel="next"` header into the next
  cursor, rewriting nothing (the gateway already rewrote it).
- A `428` is logged as a console defect and surfaced as a generic failure,
  never as the user's error (§7.4).
- POST is never retried; GET retries twice with backoff; PATCH/PUT retry
  once on a network error only (§7.4).

- [ ] **Step 1: Failing tests** against a fake `fetch`: header and
      credentials on every method; schema parse failure is a typed failure;
      `Link` next parsing; a `401 console-session-ended` emits `sessionEnded`
      and a plain `401` does not; `428` handling; retry policy per method.
- [ ] **Step 2:** Implement; run. **Step 3:** Commit:
      `Give the console one transport to the gateway`.

### Task 5: Instrument — tokens, fonts and the layout and feedback components

**Files:** `shared/view/tokens.css`, `shared/view/fonts.css` (Plex via
`@fontsource`, subset to latin + latin-ext weights 400/500/600), components
each as `Name.tsx` + `Name.module.css` + `Name.test.tsx`: AppShell, Rail,
ContextBar, PageHeader, Tabs, Toasts (+ `shared/repository/useToasts.ts`
Zustand store), EmptyState (three variants: nothing yet, nothing matches,
failed to load), Skeleton, StatusTag, CopyValue, Timestamp (relative +
absolute), Duration ("1209600 s · 14 days"), CapabilityNote.

**Interfaces:** token names as CSS custom properties
`--surface-*`, `--ink-*`, `--signal-{active,warning,danger,system}` with
`--signal-*-ink`, `--type-{12,13,15,20,28}`, `--space-{1,2,3,4,6,8}` (4, 8,
12, 16, 24, 32 px), `--radius-{s,m}`, `--motion-{fast,panel}`, `--ease`;
light and dark through `light-dark()`; theme follows the system with a
remembered override on `<html data-theme>`.

- [ ] **Step 1: Failing tests** — each component renders with its role and
      name, passes axe in both themes (render twice with `data-theme`), meets
      its behaviour (Toasts: success auto-dismisses after 5 s pausing on hover
      and focus, an error stays, `aria-live` announces; CopyValue copies and
      says so; Tabs are keyboard-operable; Timestamp shows both forms; Duration
      formats per the table in the test). A contrast test computes each signal
      ink against its surface from `tokens.css` and asserts ≥ 4.5:1.
- [ ] **Step 2:** Implement; run. **Step 3:** Commit:
      `Add Instrument's tokens and its layout and feedback components`.

### Task 6: Instrument — the editing and data components, and the gallery

**Files:** Section + SaveBar, Field (text, number with unit, select,
toggle, URL list, key-value), DataTable (with stacked mode under 640 px by
container query), FilterBar, Pager (Load more; Previous / Next with the
visited cursors in the URL), Count ("1,000+" at the cap), ConfirmDialog
(plain and typed), SecretDialog (copy + acknowledgement), UnsavedChangesDialog;
`shared/service/dirty.ts` (field-level dirty tracking, re-base on a fresh
read keeping edits); `shared/repository/useUnsavedGuard.ts` (Zustand);
`src/gallery/` — a **dev-only** Vite entry (`gallery.html`, excluded from
the production build) rendering every component in both themes and three
widths.

- [ ] **Step 1: Failing tests** — each component's role, name and
      behaviour, axe in both themes; SaveBar appears only when its section is
      dirty and shows "Saving…" with Enter unable to resubmit; typed
      ConfirmDialog enables confirm only on the exact text; SecretDialog cannot
      close before acknowledgement and never renders the secret into any
      attribute other than the one visible node; dialogs return focus;
      `dirty.ts` re-base keeps unsaved edits; the unsaved guard blocks and
      releases.
- [ ] **Step 2:** Implement; run. **Step 3:** Screenshot the gallery with
      Playwright (both themes, 1280 / 800 / 390 px) into
      `docs/phases/p4d-gallery/` (committed PNGs, small) for the design review.
- [ ] **Step 4:** Commit: `Add Instrument's editing and data components`.

### Task 7: The shell, the session and draft restore

**Files:** `features/session/` (`index.ts`, `view/SignIn.tsx` — the tenant
question and "a different tenant", `usecase/useSession.ts`,
`repository/useSessionQuery.ts`, `adapter.ts` against `/console/api/session`,
`service.ts` — last-tenant memory in `localStorage`, return-path rules),
`features/shell/` (`index.ts`, the rail's information architecture of
§7.2 with each area a placeholder route Part 4 fills, the amber
ContextBar for a system administrator inside a tenant, sign-out through
`POST /console/auth/logout` then navigating to `redirect`, theme control),
`shared/repository/useDrafts.ts` (per-record drafts in `sessionStorage`,
refusing secret fields by a field flag), `app/router.tsx` wiring, the
`403` handling (CapabilityNote plus a `whoami` re-read).

**Interfaces:**

- Boot: `GET /console/api/session`; `401 session-ended` → the SignIn view
  (with `?tenant=` from the URL, else the remembered tenant, else the
  question); success → the principal in Context.
- Sign in: navigate to `/console/auth/login?tenant=<t>&return_to=<current path>`.
- On `sessionEnded` mid-edit: every dirty section's non-secret fields saved
  to `useDrafts`, navigate to sign-in with `return_to`; on return, drafts
  restored into their sections marked "restored — review before saving";
  nothing sent.
- The unsaved guard wired to router navigation, tab change, tenant switch,
  sign-out, and `beforeunload`.

- [ ] **Step 1: Failing tests** — session boot branches; tenant memory;
      return path is always a `/console/` path; draft save on `sessionEnded`
      excludes a secret-flagged field; restore marks and sends nothing; guard
      on each exit; the context bar shows only for a system admin in another
      tenant; sign-out navigates to the returned `redirect`.
- [ ] **Step 2:** Implement; run. **Step 3:** Commit:
      `Sign an administrator in to the console shell and restore their drafts`.

### Task 8: The Playwright harness and the `e2e` job

**Files:** `apps/admin-console/e2e/{playwright.config.ts,global-setup.ts,signin.spec.ts,shell.spec.ts}`;
`apps/server/src/cli/seed.ts` (`seed user … --require-password-change`, so a
tenant admin can meet the forced change — `seed admin` forces it only for
`system`, `seed.ts:687`; `seed user` never does, `seed.ts:1232`), its
test; `.github/workflows/verify.yml` (`e2e` job beside `verify`: build the
image, start `infra/docker` with PostgreSQL, seed, run Playwright, upload
the report on failure).

**Interfaces:** on `infra/docker` (plain HTTP) the cookies are
`odudu-console` and `<tenant>-session`, without `__Host-` or `Secure`
(spike S3), so the specs assert behaviour, not prefixed names; the
conformance check covers the https form. `global-setup.ts` seeds through `docker compose exec odudu
node dist/main.js seed …` a throwaway tenant, a tenant admin with a known
password and `--require-password-change`, and a system admin.

- [ ] **Step 1: Failing specs** — sign-in with the forced change; a system
      administrator entering a tenant sees the amber context bar; an expired
      session (the test deletes the `console_sessions` row through psql)
      during an edit restores the draft after sign-in and saved nothing; a
      phone viewport (390 × 844) shows the top bar and menu sheet; dark mode;
      axe on every page in both themes; every page fails the test on a
      `securitypolicyviolation` or a console error.
- [ ] **Step 2:** Implement; run locally against the container stack; push
      and see the `e2e` job green. Making `e2e` a required check on `main` is a
      repository setting — the phase note asks the owner.
- [ ] **Step 3:** Commit: `Run the console's flows in a browser against the image`.

### Task 9: Document the foundation

- [ ] README: the console's dev loop (`pnpm --filter @odudu/admin-console dev`
      with the server on 3000), how to build it, where the image puts it.
- [ ] `docs/console-paths.md`: re-capture `GET /console/` (now 200 with the
      shell and `SHELL_CSP`) and one hashed asset, against `docker-odudu-1`
      rebuilt; replace the 503 section's claim.
- [ ] `docs/phases/p4d.md` "## Part 3 — what building the foundation
      found"; `docs/NEXT.md` — Part 3 landed, what Part 4 inherits (the
      transport, the components, the guard, drafts, the route slots, the e2e
      harness), and the `e2e` required-check request.
- [ ] Commit: `Document the console foundation`.

---

## Closing Part 3

- [ ] CI green (including `e2e`) and CodeRabbit answered on every increment.
- [ ] Final whole-range review on the most capable model, then its fix round.
- [ ] Send the user the gallery screenshots for the design review before
      Part 4 builds features on the components.
- [ ] Write Part 4's plan.

**Increments (push points):** K = Tasks 1–3 · L = Tasks 4–6 · M = Task 7 ·
N = Tasks 8–9.
