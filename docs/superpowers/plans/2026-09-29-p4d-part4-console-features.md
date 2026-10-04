# P4d Part 4 — The Console's Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every admin API route and every configurable OIDC capability is
operable from the admin console. Each area in spec §7.2 is a working feature
with its own Playwright flow, and a tenant's discovery document and JWKS can
be read in the console.

**Architecture:** Two groups of work. First the admin API and gateway gaps the
research found are closed, because the console cannot drive them as they
stand. Then shared record and list patterns are built once. Then each feature
fills its shell route slot, lazy-loaded, using only `index.ts`-published
surfaces and the transport. A coverage test holds the console to the whole
`ADMIN_ROUTES` table, so no route can be left without a screen.

**Tech Stack:** as Part 3 (React 19.3, TanStack Router 1.170.39 and Query
5.104.0, React Aria Components 1.21.1, Zustand, CSS Modules, Vitest and jsdom,
Playwright 1.63.0, axe), plus the admin API (Fastify 5, Zod 4) and the console
gateway.

**Spec:** `docs/superpowers/specs/2026-09-26-p4d-admin-console-design.md`
§7 (UX), §8, §9 (including the accessibility checklist and e2e duties) and
§12 item 5 (features and owed work).

**Facts:** every claim about routes, schemas, ETags, errors and gaps is from
`.superpowers/sdd/2026-09-29-p4d-part4-console-features/features-facts.md`,
where each carries its file:line or command. Parts A to D and the
Reconciliations are cited below by section, e.g. "facts B-2 Clients".
Every task re-greps what it relies on before writing code.

## Global Constraints

- Every Part 3 rule still holds, including the lints and boundary rules:
  - features expose only `index.ts`;
  - a view never touches a repository, adapter or transport;
  - a usecase never touches an adapter or transport;
  - storage lives only in adapters;
  - plain props, with `readonly T[]` for arrays;
  - `useX.ts` for hooks, and explicit `.tsx`/`.ts` import extensions;
  - no `any`;
  - no comment block over 8 lines, and no process references in comments;
  - PORTS: never :3000 and never the user's `docker` project. Use separate compose projects on 3080 and 3090.
- **§7.3 editing rules:**
  - one section, one save, one API call, and no save-all;
  - nothing saves silently;
  - the save bar shows only when the section is dirty;
  - every save sends its loaded ETag, and a 412 shows theirs against yours, field by field, with "keep mine" or "take theirs";
  - errors sit under their field;
  - a dialog is used only to stop an action;
  - creation is a short page that lands on the new record;
  - undo only where the API has an inverse;
  - nothing hidden.
- **§7.4 edge cases:**
  - a 428 is a console defect: logged, never blamed on the user;
  - one request per section in flight at a time;
  - an unconfirmed POST is never retried;
  - reads never overwrite a field being edited;
  - "updated since you opened it";
  - a 403 names the missing capability and re-reads whoami;
  - an action against yourself says so;
  - typed confirmation to disable a tenant, retire a key, or delete a client or subject;
  - a 409 is shown beside its action;
  - a secret is shown once in a SecretDialog and never in a toast, URL, draft or the cache;
  - a fixed rule is shown as fixed text with its reason;
  - three empty states;
  - ids shortened with a copy control;
  - times shown relative and absolute;
  - durations with their human reading;
  - effective defaults shown;
  - `request_id` labelled as a correlation, not evidence;
  - lists page with Load more and Previous/Next, with the cursor trail in the URL.
- **Draft fields** declare `kind: 'plain' | 'secret'`. Secret fields are never drafted.
- **Accessibility (§9, per feature):**
  - axe on every state reached (list, record tabs, dialogs, errors, empty states), in both themes;
  - one complete task done keyboard-only;
  - one pass at 390 px;
  - the review checklist: labels, errors under fields, focus after save, delete and close, targets of 24 px or more, no status by colour alone, secrets not announced;
  - a VoiceOver pass at close, run by the user from a scripted checklist.
- **Server-side changes** follow `CLAUDE.md`:
  - test first;
  - probe every repository method with a foreign `tenant_id`;
  - `SET LOCAL` only;
  - `docs/admin-paths.md` transcripts captured for real on a separately named stack;
  - OpenAPI and the capability matrix stay derived from `ADMIN_ROUTES`.

## Review Focus

1. **A 412 on a section whose record another administrator changed.** Show
   theirs against yours, field by field. Nothing merges on its own, and "keep
   mine" re-saves on the fresh ETag. Pinned in Task 4's `useSectionSave` tests
   and in Task 9's Subjects e2e.
2. **A secret surfacing twice.** A client secret, a registration token, a
   one-time password or an import secret must appear only in its SecretDialog:
   never in the Query cache, a toast, the URL, a draft, or a re-rendered page
   after the dialog closes. Pinned in Task 4's `useSecretOnce` tests and in each
   secret-bearing feature's e2e.
3. **A capability-limited operator.** For example, a `manage-users`-only holder
   opening Subjects needs its role and group pickers, which today require
   `manage-tenant` (facts B-1 Subjects). Each screen must render what the
   operator can do and show CapabilityNote for the rest. It must never give a
   blank page or a 403 toast storm. Pinned in Task 2's read-access change and in
   each feature's "limited operator" test.
4. **Removing the last administrator.** Revoking `tenant-admin` from the last
   holder, or disabling the last administrator, locks the tenant out. The API
   must refuse it, and the console must say so beforehand. Pinned in Task 2 and
   Task 7.
5. **Stale discovery.** Discovery must show the issuer relying parties see, the
   public base's, not whatever host the administrator typed (facts D.3). Pinned
   in Task 3.

---

## Group A — close the API and gateway gaps

### Task 1: Spike the three unproven browser behaviours

**Files:** throwaway only. Results go in `docs/phases/p4d.md`, "## Part 4 spikes".

- [ ] **S1. Blob download.** Build a 5 MB `application/vnd.odudu.tenant+json`
      file from a raw response. Save it through `URL.createObjectURL` and
      `<a download>` under `SHELL_CSP` in Chromium, and confirm no violation and a
      byte-identical file. `assumption:` no directive in `SHELL_CSP` governs it
      (facts C).
- [ ] **S2. Lazy routes.** Split a route with TanStack Router's
      `lazyRouteComponent` (or `createLazyRoute`) and confirm the chunk loads under
      `script-src 'self'` with no violation. Record what it writes to
      `sessionStorage` and its `location.reload()` on a stale chunk (facts C). The
      storage lint allows only adapters to touch storage, so decide whether to
      exempt the library or use a plain `React.lazy` split.
- [ ] **S3. Nginx body size.** Confirm what the conformance nginx allows for a
      16 MiB import (facts C: 1 MiB default). Record the fix for a deployment
      behind a proxy.
- [ ] Record the results with `verified:` and delete the throwaway code.
      Commit: `Record what the console features' spikes found`.

### Task 2: Admin API gaps and contract fixes

**Files:**

- `packages/protocol-admin/src/{service/capability.ts,usecase/*,view/routes/*,view/problem.ts}`
- `packages/contracts/src/admin/*`
- the tests beside each
- `docs/admin-paths.md`

Each item below is its own commit, test first, each with a real transcript.

1. **Structured field errors.** Every admin 400 that names a field also
   carries `errors: [{ path, message }]`, the shape settings and import already
   use (facts B-1 §0). `detail` keeps its prose. One helper in `view/problem.ts`
   serves every route. Contract: `problemDetailsSchema` gains an optional
   `errors`. The test is a matrix: every 400 in `ADMIN_ROUTES`' known refusals
   names at least one path.
2. **ETags where the console needs them.**
   - Every create answers with `ETag`.
   - `PUT …/scopes/:id/clients/:clientId` answers the client's new ETag.
   - SMTP GET/PUT and the key and composite writes answer ETags, and honour
     `If-Match` where given.

   `If-Match` stays optional where it is optional today. The console always
   sends it.

3. **SMTP password preservation.** A PUT without a `password` field keeps the
   stored one. `password: null` clears it. `smtp` GET reports
   `effective: 'tenant' | 'deployment' | 'none'` for the Overview check (facts
   B-1 Overview).
4. **`GET …/scopes/:id/clients`**, gated by `manage-tenant`. It returns the
   assigned clients' `client_id`s and names, cursored.
5. **Administrators.**
   - `GET …/subjects?capability=<name>` filters by _effective_ capability,
     including groups and composites, reusing `capabilitiesReachableFrom`.
   - The last-administrator guard: a change that would leave no enabled
     subject holding `tenant-admin` (for `system`, `manage-tenants`) is refused
     with 409 `last_administrator`. The change can be a role removal, a group
     change, a disable or a delete.
   - Refused rows follow ADR 0037 and ADR 0040.
6. **Authenticator catalogue.** `GET …/flow/executions` adds `available: string[]`
   from `registeredAuthenticatorNames()`, mirroring scope mappers (facts D.2).
7. **Picker reads.** `GET …/roles` and `GET …/groups` (lists only) are readable
   with `view-users` or `manage-users` as well as `manage-tenant`, so a user
   manager can assign what exists. Update the capability matrix. The ADR 0040
   ceilings on assignment are unchanged.
8. **Role lists name their owning client** (`client_id` and the client's key,
   or null for a tenant role).
9. **The OpenAPI response** for `PUT …/scopes/:id/clients/:clientId` declares
   what the handler actually sends.
10. **Spec §7.4 correction.** Remove the "a role still in a composite" 409
    example, since a delete cascades (facts Reconciliations). Replace it with
    `last_administrator`.

- [ ] Each item: failing test, implementation, run, transcript, commit.
- [ ] Run `pnpm verify` green.

### Task 3: Discovery and JWKS through the gateway

**Files:**

- `packages/console-gateway/src/{adapter/odudu-client.ts,service/odudu-port.ts,view/routes/discovery.ts}`
- `apps/server/tests/console-discovery.int.test.ts`
- `docs/console-paths.md`

**Interfaces:**

- `GET /console/api/tenants/:tenant/discovery` returns the tenant's discovery document as the public base serves it.
- `GET /console/api/tenants/:tenant/jwks` returns its JWKS.
- Both require a session whose principal may read that tenant: its own
  tenant, or a system administrator for any. Anything else is 403.
- Both widen `OduduPort.issuerOf` / `keysOf` to return the whole parsed
  document, using the public base's authority (facts D.3).

- [ ] Write failing tests:
  - a `Host: evil.example` browser request still gets the public-base issuer;
  - a tenant admin reading another tenant's discovery is refused;
  - an unknown tenant is 404.
- [ ] Implement, run, capture real output, and commit.

## Group B — shared patterns, built once

> **Push point — increment O (Tasks 1–3).** Push; wait for CI green (verify, container, e2e, conformance, commit-messages); answer every CodeRabbit thread and review-body item; only then start the next task.

### Task 4: Record, list and save patterns

**Files:** `apps/admin-console/src/shared/{repository,service,view}/…` and tests.

**Interfaces:**

- `useSectionSave({ tenant, record, section, etag, fields, save })` returns
  `{ status, fieldErrors, conflicts, keepMine, takeTheirs }`.
  - It maps `errors[]` from Task 2 item 1 to fields, and falls back to parsing
    `detail`'s `field: reason` only where no `errors` is present.
  - On a 412 it re-reads, runs `rebase`, and exposes the conflicts.
  - It runs one request per section at a time.
  - It rebases the record's other dirty sections on the fresh read.
- `ConflictPanel` (view) shows theirs against yours per field, with the two actions.
- `useSecretOnce()`: a mutation wrapper whose result reaches the SecretDialog
  only. It is never cached: the console's `QueryClient` sets mutation
  `gcTime: 0` (`shared/repository/queryClient.ts:12`), which drops an
  unobserved result from the `MutationCache`. Tests assert that neither the
  hook's result nor the `MutationCache` holds the secret once the dialog closes.
- `ResourceListPage`: FilterBar, Count, DataTable, Pager and the three empty
  states, bound to a list query with `q`, filters and a cursor trail in the URL.
- `RecordPage`: PageHeader, tabs through `useRecordTab`, the "updated since you
  opened it" notice, and the unsaved-changes guard.
- `ActivityTab`: the audit trail filtered by `resource_type` and `resource_id`,
  with the correlation label.
- `RolePicker` and `GroupPicker`: searched and cursored, naming each role's
  owning client (Task 2 item 8).
- Lazy route helper per S2's outcome, e.g. `lazyFeatureRoute()`.
- Coverage test `tests/lint/console-covers-admin-routes.test.ts`: every
  `ADMIN_ROUTES` entry is referenced, by method and path template, from some
  `features/*/adapter` in `apps/admin-console`. A reviewed allowlist is
  permitted only for routes the console deliberately never calls, each with a
  reason. It starts failing and turns green feature by feature, as a `todo`
  list the final feature empties.

- [ ] Write failing tests for each, including axe in both themes for the views.
- [ ] Implement.
- [ ] Add the patterns to the gallery and regenerate the screenshots.
- [ ] Commit.

## Group C — features

Each feature task:

- fills its shell slot through its own `index.ts`, lazy-loaded;
- has an adapter per route family, parsing with `@odudu/contracts`;
- names its routes in the coverage test;
- ships an e2e spec covering: its main flow; axe on every state; one
  keyboard-only task; 390 px; a limited-operator case; and, where it applies,
  a secret-once case and a 412 case;
- updates `docs/console-paths.md` only if it adds a gateway behaviour.

Routes, schemas, ETag rules, errors and secrets per feature are in the facts
section named on each task. The task lists the decisions those facts leave
open.

> **Push point — increment P (Task 4).** Push; wait for CI green (verify, container, e2e, conformance, commit-messages); answer every CodeRabbit thread and review-body item; only then start the next task.

### Task 5: Overview (facts B-1 Overview; D.3)

- The issuer with CopyValue, and discovery and JWKS **viewed in the console**:
  a "Discovery" panel with the endpoints, supported values and keys (kid, alg,
  use), plus the raw JSON with copy. Uses Task 3's routes.
- Bounded counts.
- A "needs attention" list:
  - no effective SMTP while verification or reset is on (Task 2 item 3);
  - a `rotating` key older than the tenant's longest token lifetime plus
    5 minutes, i.e. ready to promote (compute from `created_at`; re-grep that
    the column exists);
  - dynamic registration open with no client-cap headroom.
- The latest audit rows.
- A nonexistent tenant, opened by a system admin, gets a not-found page
  (placed here by Part 3's final review).

### Task 6: Tenants, guided creation and Import (facts B-1 Tenants; D.1 item 7)

- **The list:** search, count, and "enter tenant".
- **Guided, resumable creation:**
  - the tenant name, with the rule text from `@odudu/contracts` and a live issuer preview;
  - the first administrator: `seed`-equivalent create, a one-time password in a SecretDialog, and a `tenant-admin` grant;
  - then done.
- **The tenant record:** display name, enabled (a typed confirmation to
  disable, refused for `system`), administrators (Task 2 item 5), and export.
- **Export** is raw bytes through `shared/transport`, per S1, downloaded as a
  file.
- **Import** moves here, into System › Tenants. The tenant rail keeps Export
  only (facts: import is `manage-tenants`). The flow is:
  - upload, then validate;
  - show every error at once with its JSON path;
  - create;
  - show the returned client secrets once in a SecretDialog;
  - then offer to create the first administrator, since import creates none.
    Amend spec §7.2.

### Task 7: System administrators (facts B-1 System administrators)

- List the effective `manage-tenants` holders (Task 2 item 5).
- Grant through the guided "create or choose subject" flow.
- Revoke with a typed confirmation. It is refused as `last_administrator`, and
  says so beforehand when there is only one holder.

> **Push point — increment Q (Tasks 5–7) — then the user tries the console on the 3090 stack.** Push; wait for CI green (verify, container, e2e, conformance, commit-messages); answer every CodeRabbit thread and review-body item; only then start the next task.

### Task 8: Subjects — list, create, profile and credentials (facts B-1 Subjects)

- **The list:** field-scoped search, filters and the capability filter.
- **Create:** a short page that lands on the record.
- **Profile:** claims, verification flags, and username. Username is editable
  only while `username_editable` is on; otherwise it is fixed text with the
  reason and a link.
- **Credentials:** set a password (the one-time password shown once), passkeys,
  OTP, recovery codes as a count with a revoke-all option (they have no ids,
  per facts), and lockout clear (UNCOVERED, now placed here).

### Task 8a: Typed fields (added after the user tried the console)

- Shared `shared/view` fields built on React Aria:
  - DateField in the browser's locale, storing the OIDC form (including year only);
  - ComboBox with type-to-filter, and Select;
  - PhoneField (country plus national number, stored as E.164);
  - CountryField, which stores the English country name per OIDC Core §5.1.1;
  - TimeZoneField (`Intl.supportedValuesOf`) and LocaleField (BCP 47, shown by name);
  - GenderField (standard values plus free text);
  - UrlField, with a picture preview.
- Each field carries its HTML `autocomplete` token (WCAG 1.3.5).
- Subject create and Profile move onto them. Later tasks use them for grant
  types, settings enums and URL lists.

### Task 8b: Admin API gaps II (from the gap audit)

The server has each of these, but no admin route reaches it:

1. a subject's grants and offline tokens, listed and revoked;
2. delete a tenant;
3. a tenant-wide session list;
4. end every session in a tenant;
5. outgoing mail status (`email_outbox`);
6. revoke every grant a client holds;
7. a subject's effective roles;
8. evaluate a client's claims for a subject and scope;
9. a client's sessions;
10. session counts;
11. back-channel logout delivery status;
12. a list of locked subjects;
13. clear every lockout;
14. a group's children;
15. filter subjects by type;
16. search subjects by name and other claims;
17. bulk subject operations;
18. count and export audit events;
19. delete a retired key;
20. a client's installation config.

Also in this task:

- `POST …/subjects/:id/password-reset` and `POST …/subjects/:id/verification`;
- the refusal texts that ADR 0039 made permanent (`group-patch.ts`,
  `role-patch.ts`, `scope-patch.ts`, `tenant-patch.ts`, and the
  `contracts/admin/groups.ts:34-37` comment).

Each item needs the capability, the ceiling, audit, a foreign-tenant probe,
OpenAPI and a real transcript.

### Task 8c: Admin configuration placed in P4d (from the gap audit)

- Client `description`, `client_uri`, `policy_uri` and `tos_uri`.
- Per-client ID token `alg`, `default_max_age` and `require_auth_time`.
- Secret rotation with a grace period.
- Group and role description.
- Default groups.
- The tenant's default client scopes.
- Scope consent text and order.
- Tenant-wide default lifetimes, and code, login and action-token lifetimes.
- Choice of stored audit event types.
- Sign in with email.
- An admin "email required actions" action, which the two email routes above
  become part of.

Each needs a migration where storage is new, and the protocol behaviour it
drives, with tests at the protocol layer.

### Task 9: Subjects — groups, roles, required actions, sessions, consents, activity

- Groups and Roles use the pickers, with the ADR 0040 ceilings shown as
  CapabilityNote.
- Required actions.
- Sessions, with end-one and end-all. Ending your own session says so.
- Consents, with revoke. It says that revoking also revokes grants.
- Activity.
- **The owed Part 3 e2e: a session expires mid-edit.** A real Profile section
  edit restores its draft after sign-in. The `beforeunload` prompt is shown on
  reload while the section is dirty.

> **Push point — increment R (Tasks 8–9) — then the user tries the console on the 3090 stack.** Push; wait for CI green (verify, container, e2e, conformance, commit-messages); answer every CodeRabbit thread and review-body item; only then start the next task.

### Task 10: Groups and Roles (facts B-2 Groups, Roles)

- Groups: a tree with move and reparent (the removal ceiling), roles, and
  Activity.
- Roles: general, composites (the built-in roles show fixed text), a "default
  for new subjects" toggle (refused for admin reach, with the reason), and
  Activity.

### Task 11: Clients — list, create and General / Redirects & origins (facts B-2 Clients; D.2 client table)

- Create: confidential or public. A confidential client's secret is shown once.
- General: name, description, enabled, and consent required (UNCOVERED, now placed).
- Redirects & origins: redirect URIs, web origins, and post-logout URIs
  (UNCOVERED, now placed in Logout; cross-linked from here).

### Task 12: Clients — Tokens, Scopes, Logout, Advanced, Roles and service account

- **Tokens:** TTLs with their duration readings, grant types,
  `client_credentials_scopes`, and `full_scope_allowed` (UNCOVERED, now placed).
- **Scopes:** assign and unassign. Re-read the client ETag after each change
  (facts).
- **Logout:** the post-logout URIs, and back- and front-channel logout.
- **Advanced:** token endpoint auth method, `jwks`/`jwks_uri` (private members
  are refused, with the reason), userinfo signing, audiences, rotate secret
  (shown once), and delete (typed confirmation). Fixed-by-design items are
  shown as fixed text: response type `code`, PKCE S256.
- **Roles:** the client-scoped roles tab (UNCOVERED, now placed).
- **Service account:** its roles through `PUT …/subjects/:service_subject_id/roles`.
  It needs `manage-users`; show CapabilityNote otherwise.

### Task 13: Scopes (facts B-2 Scopes; Task 2 item 4)

- General; Roles; Claim mappers (with the `available` list); Clients (Task 2
  item 4); Activity.
- `openid` shows its delete refusal as fixed text.

> **Push point — increment S (Tasks 10–13) — then the user tries the console on the 3090 stack.** Push; wait for CI green (verify, container, e2e, conformance, commit-messages); answer every CodeRabbit thread and review-body item; only then start the next task.

### Task 14: Registration tokens, and the Sign-in flow (facts B-2 Registration tokens; B-3 Flow)

- **Registration tokens:** create (shown once), list, revoke.
- **Sign-in flow:** ordered steps with their requirement, add a step from
  `available` (Task 2 item 6), reorder, disable. `otp_required` sits beside
  the OTP step (UNCOVERED, now placed). The server's refusals (no enabled step,
  no first challenge) sit beside the action.

### Task 15: Signing keys (facts B-3 Keys)

- Three lanes by stored status: `rotating`, `active`, `retired`.
- Stage, promote, and retire (typed confirmation).
- A promote shows "ready" per the Task 5 rule. A retire of the only active key
  is refused.

### Task 16: Settings and Email (facts B-3 Settings, SMTP; D.2 tenant table)

- **Settings** is one page with a section per concern. The sections are:
  - General (display name and enabled; UNCOVERED, now placed);
  - sessions;
  - remember-me;
  - registration and recovery;
  - usernames;
  - password policy;
  - brute force;
  - dynamic registration;
  - retention.
- The settings ETag covers all 29 settings, so a save in one section rebases
  the others (facts).
- **Email:** the SMTP form. It keeps the stored password unless the password
  is replaced or cleared (Task 2 item 3), and includes the test send.

### Task 17: Audit (facts B-3 Audit)

- Filters: event type, action, resource, actor, outcome, `from`/`to` in the URL.
- Correlation labelling.
- Mark "a caller from elsewhere" (ADR 0037's third amendment).
- Row detail.

> **Push point — increment T (Tasks 14–17).** Push; wait for CI green (verify, container, e2e, conformance, commit-messages); answer every CodeRabbit thread and review-body item; only then start the next task.

### Task 18: Close Part 4

- [ ] The coverage test's `todo` list is empty. Every route is covered or
      allowlisted with a reason.
- [ ] Route-level code splitting is verified. The largest chunk is recorded
      against the 561 KB baseline, and the entry chunk is below Vite's 500 KB
      warning.
- [ ] `docs/phases/p4d.md`: add "Part 4 — what building the features found".
      Also add a scripted VoiceOver checklist for the user: one flow per feature,
      with what should be heard.
- [ ] README: the console section describes the working console. The "not
      built yet" P4d row goes.
- [ ] `docs/request-paths.md`: the not-implemented console entry closes.
- [ ] `docs/console-paths.md`: recapture the four gateway walkthroughs whose
      audit blocks are labelled as predating `actor_name` and `actor_origin`
      (a proxied PATCH, the principal-changed refusal, a refresh, a refresh
      that cannot take the lock), each run whole on one stack, and remove
      the labels.
- [ ] Docs tidy (asked for by the user):
  - Move every finished phase's plan out of `docs/superpowers/plans/` into
    `docs/archive/plans/`, and repoint the five documents that cite a plan.
  - Keep in place: ADRs, specs, phase notes, protocol notes and spike logs.
    Their citations are live: 23 files cite specs, and 18 cite spike logs.
  - Add `docs/README.md`, which says what each kind of document is for and
    whether it is kept current or written once.
  - A link check fails the build on a dangling reference into `docs/`.
- [ ] `docs/NEXT.md`: record where P4d stands.
- [ ] The phase-closing pass from `CLAUDE.md`, sections 1–4, for all of P4d.
- [ ] Commit: `Close the console's features`.

> **Push point — increment U (Task 18).** Push; CI green; CodeRabbit answered; then the final whole-range review of Part 4 and its fix round.

---

**Increments (push points):** O = Tasks 1–3 · P = Task 4 · Q = Tasks 5–7 ·
R = Tasks 8–9 · S = Tasks 10–13 · T = Tasks 14–17 · U = Task 18.
After Q, R and S, the user tries the console on the 3090 stack.
