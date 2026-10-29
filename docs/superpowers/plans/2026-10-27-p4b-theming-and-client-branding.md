# P4b — theming and client branding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every server page and the tenant's mail render in a tenant's theme, a client can override any piece of it, and a tenant manages it through the admin API and a Branding area.

**Architecture:** A page renderer returns named **parts** and fills a **slot template**; the default (Instrument) template and a tenant's template go through the same `fillTemplate`, so a theme replaces a template and never a document. Themes (tokens, stylesheet, templates, asset references) and uploaded images live in PostgreSQL, behind a new `@odudu/domain-theme` package; a theme resolves per request through a bounded cache and reaches renderers on `PageLocale.branding`.

**Tech Stack:** TypeScript, Fastify, Drizzle and hand-written SQL migrations, Testcontainers, React console, Docusaurus docs. New dependencies are chosen by Spike S1.

**Spec:** [`docs/superpowers/specs/2026-10-27-p4b-theming-and-client-branding-design.md`](../specs/2026-10-27-p4b-theming-and-client-branding-design.md). Read it first; section numbers below refer to it.

## Global Constraints

- The spec's section 4a is a contract: each path it lists has its check. `pnpm test:plans` (the required `query-plans` job, `apps/server/tests/query-plans.plan.test.ts`) must drive every path this phase adds, and every new foreign key must be indexed (`unindexedForeignKeys`).
- Volume: 10,000 tenants, 10,000 clients per tenant, constant queries per page render, every in-process structure states its bound (CLAUDE.md "Performance and scale").
- Layering: view / usecase / repository / adapter / service (CLAUDE.md "Layering"); a usecase and a repository hold no logic, however small.
- No `any`; no `void doThing()`; tests precede code; integration tests on real PostgreSQL via Testcontainers; every repository method probed with a foreign `tenant_id` (`expectCrossTenantMethodProbe` from `@odudu/db/testing`); tenant context by `withTenant` (`SET LOCAL`).
- Comments carry only what code cannot say; no block over 8 lines; never name a task, step or phase slot in a comment.
- Console imports never carry `.ts` or `.tsx`; reuse `shared/` before writing (report a "Reuse scan").
- A user-facing string is a catalogue entry (ADR 0043); `tests/lint/server-page-literals.test.ts` fails on text typed in a `*-html.ts`.
- Headers have one authority, `pageHeaders` in `@odudu/kernel`; no route sets a CSP or `x-frame-options` itself.
- Raster uploads only: PNG, JPEG, WebP. No SVG, no font uploads, no inline `style` attributes, no `unsafe-inline`.
- Commit messages: subject at most 72 characters, body at most 8 lines, **no tool-attribution trailer** (a PR description carries none either).
- Subagents run on Sonnet; ask the owner before any other model.

**Execution notes.** The phase branch is `p4b-theming-and-client-branding`. Each increment is its own branch `p4b/<letter>-<name>` off it, one PR into the phase branch, deleted after merge. Open the draft PR to `main` with the first push; push at the end of each increment; an increment is finished when CI is green **and** its review threads are answered (CLAUDE.md "A push attracts review"). Quote the Comments, Layering and Performance rules in every dispatch.

**The try-list, at push time, for every increment.** Sequence: implementer reports → push and open the PR → rebuild `odudu-try` from that branch (the working tree on the branch with the implementer idle, otherwise from a worktree of `origin/<branch>`) → send the list below → then watch CI and answer review. Rebuild with `cd <repo> && ODUDU_HOST_PORT=3090 POSTGRES_HOST_PORT=5472 docker compose -p odudu-try --env-file ~/.odudu-try.env -f infra/docker/compose.yaml -f infra/docker/compose.try.yaml up -d --build odudu`, then check `docker port odudu-try-odudu-1` shows 3090, never 3000. Mailpit is at http://localhost:8090. Seed test accounts with known passwords; leave `seed admin` to the owner so its one-time password prints in their terminal. After the push run `docker builder prune -f` and `docker image prune -f` (never while `pnpm verify` or an e2e run is in progress, never delete tagged images). If review or CI changes behaviour afterwards, send a short re-try list. Anything an increment needs from outside (a relying-party app, a webhook) goes into `infra/docker/compose.try.yaml` with a line in the list saying how to use it.

## Review Focus

Inputs the spec implies and no task's happy path exercises, most likely first. Each has its test in the task named.

1. A template that puts a slot inside an attribute value or inside an element's text where it would break out (`<a href="{{field.password}}">`). Refused at save. → Task 6.
2. A published theme whose asset was deleted, or whose template no longer passes a newer sanitiser. The page renders the layer below and logs it; it never errors. → Task 12.
3. Two editors publish from the same draft. The second gets `412` and nothing is lost. → Task 16.
4. A hostile upload: polyglot PNG/HTML, EXIF with script, animated WebP, a decompression bomb, a `Content-Type` that lies. → Task 14.
5. `return_to` naming another tenant's client, or a garbage `client_id`. The page uses the tenant's theme. → Task 12.

## Try lists

What to do by hand after each increment's push; the list sent is the one below, adjusted for what the increment really built. Accounts: the seeded demo tenant and its test user; the owner's own system administrator for the console.

- **A (placement):** open the docs site's Roadmap page; P4b reads as the new scope, P4j appears after it, Liquid-style templates are under "Decided against". No behaviour changed, and the list says so.
- **B (sign-out):** sign in to a demo client; open its end-session URL with the `id_token_hint` it was given, and the confirmation page appears (it used to sign out at once); press Confirm and the session ends and the redirect follows. Repeat with an expired hint (still asks). In devtools change the hidden `client_id` or `post_logout_redirect_uri` and submit: refused. Visit the URL with no hint: asks. Console → Clients → the demo client → Logout: read the warning beside the new toggle (is it clear?), turn it on, repeat the sign-out URL with its hint: no confirmation page, signed out at once; turn it off and it asks again. Sign out of the console itself: immediate, no confirmation page.
- **C (foundation):** no user-visible change; the list says so and gives `docker exec odudu-try-postgres-1 psql -U odudu -c '\d theme_versions'` to see the tables.
- **D (render path):** click through every page (sign-in, select account, consent, registration, verification, reset, change password, TOTP, passkey and recovery-code enrolment, logout) in light and dark; each must look exactly as before. This increment's risk is a regression, and there is no way to set a theme yet.
- **E (assets):** no public route serves an unpublished image; `curl -i http://localhost:3090/tenants/demo/brand/<anything>.png` is a 404. No upload route yet, so nothing else by hand.
- **F (admin API):** with an admin token, `PUT` a draft theme with a logo (upload it first), `POST publish`, and reload the demo sign-in page: the logo and colours appear. Try a template missing `{{form.open}}`, a `<script>` in a template, a polyglot image, an oversize image and a failing contrast pair: each is refused with its field named. `PUT` twice from a stale `ETag`: 412. Restore a previous version, then reset to default. Open the preview URL in a browser tab. Do the same on a client and see it override one piece only.
- **G (locales and mail):** `PATCH` the tenant's locales and default to `ar`; load pages with `Accept-Language: ar` and see right-to-left Arabic; add an override and see it; set a French client name and see it on the consent page; register and reset a password and open the mail in Mailpit (http://localhost:8090): the logo, colours and wording follow the tenant, in light and dark.
- **H (console):** in the console, Tenant → Branding: edit tokens (a failing contrast pair blocks publishing and names the pair), upload a logo with alt text, write a sign-in template, preview it, publish, restore, reset. Open the same draft in two tabs and save from both (conflict panel). Clients → a client → Branding: override one piece and see which layer supplies each. Languages tab: add an override, a refused key. Check phone width, dark mode and keyboard-only use.
- **I (docs):** open the landing page's branding band (no "Planned" chip, two real looks), the new console page and tour, the concept page, and run the guide's commands in a clean checkout.

## Increments

A docs placement (1) · B logout (2–3b) · C theme foundation (4–7) · D render path (8–13) · E assets (14–15) · F admin API (16–18) · G locales and mail (19–22) · H console (23–25) · I documentation close (26–27).

---

### Spike S1: libraries (before Tasks 6, 7 and 14)

No image, HTML or CSS library is installed (`git grep -l '"sharp"\|"parse5"\|"postcss"' -- '*package.json'` prints nothing, run 2026-10-27). Each is an `assumption:` until run.

- [ ] **Step 1:** In a scratch directory outside the repo, install candidates and run each against hostile fixtures: an image library for decode, re-encode to PNG/JPEG/WebP and metadata strip (assumption: `sharp` decodes a 1x1 PNG with trailing bytes and emits no trailer); an HTML parser with a tree walk for the allowlist (assumption: `parse5` reports a slot inside an attribute value); a CSS parser that exposes every at-rule and `url()` (assumption: `postcss` exposes `@import` and `url()` inside `background`).
- [ ] **Step 2:** Record in the task's report, per library, `verified: <command run>` and its output, its licence (must be compatible with ADR 0042), its install size, and whether it has native binaries the container build must carry (`docker build` of the image is the check: `pnpm` does not build it).
- [ ] **Step 3:** Choose; if the image library needs a native build the container job cannot supply, say so and stop for the owner. Commit nothing from the spike except the choice in the first task that adds the dependency.

---

## Increment A — placement

### Task 1: Record the moves and the new decisions

**Files:** Modify `apps/docs/content/en/roadmap.md` (lines ~63 and ~95), `docs/superpowers/specs/2026-09-10-odudu-design.md` (P4b row ~442, new P4j row, order line ~532), `docs/NEXT.md` (Start here, P4b inheritance, line ~277 logout entry), `tests/docs/roadmap-section-11.test.ts` (P4b rows lines 100-111, 311, 317), `tests/docs/roadmap-shape.test.ts` (126, 159), `tests/docs/questions.md` (461, 469); Create `docs/phases/p4b.md` (running record).

**Interfaces:** Produces: the phase name **P4j** (custom domain per tenant, after P4b) and the roadmap sentences later tasks cite.

- [ ] **Step 1:** Write the failing change first: edit the mapping rows in `roadmap-section-11.test.ts` to the new P4b words (slot templates, per-client themes, draft/publish, Arabic, always-confirm logout) and add the P4j row; run `pnpm exec vitest run tests/docs` — expect the roadmap, shape and questions tests to fail.
- [ ] **Step 2:** Edit the roadmap: P4b's "Next" paragraph rewritten to the spec's goals; the custom-domain sentence moves to a P4j bullet and "What is not implemented" line 95 names P4j; add Liquid-style template logic to "Decided against" with its reason and trigger (spec section 3); correct `tests/docs/questions.md` 461 and 469 only to say what is still planned (they are finished in Task 27).
- [ ] **Step 3:** Section 11: P4b row reworded to spec section 15's criteria (including its accessibility rewording), hours left as `TBD-by-plan: increments A–I` and set at the end of Task 27 from what the increments cost; new P4j row; order line gains P4j after P4b. `docs/NEXT.md`: Start here, the logout entry (P4b closes it), and a one-row "Decisions still open" entry for the skipped-confirmation client setting pointing at ADR 0047 (Task 3).
- [ ] **Step 4:** `docs/phases/p4b.md` created with a heading and the date; each later task appends what it found.
- [ ] **Step 5:** Run `pnpm exec vitest run tests/docs` — expect PASS; run `git grep -n '\bP4b\b' -- ':!docs/archive'` and read every hit against the new placement (CLAUDE.md "Start the phase"). Commit: `Roadmap: P4b narrowed, custom domain to P4j`.

---

## Increment B — sign-out

### Task 2: Logout always asks

**Files:** Modify `packages/protocol-oidc/src/usecase/logout.ts` (`decideLogout`, lines 44-58); Test `packages/protocol-oidc/src/usecase/logout.test.ts`, `packages/protocol-oidc/tests/logout.int.test.ts`, `logout-expired-hint.int.test.ts`, `logout-hint-audience.int.test.ts`, `frontchannel-logout.int.test.ts`, `apps/server/tests/console-logout.int.test.ts`.

**Interfaces:** Consumes `decideLogout` as it is. Produces: with a session present it returns `confirm` for every hint, valid, expired, matching `sid` or not; with no session it still ends only for a registered redirect (unchanged).

- [ ] **Step 1:** `grep -rn "decideLogout\|end-session\|post_logout" packages apps --include='*.test.ts'` (CLAUDE.md memory: grep tests that pin a changed value) and list every test that expects a `GET` with a valid hint to end the session.
- [ ] **Step 2:** Rewrite those tests to the new rule, adding `it('a valid hint for the cookie's session still asks')` and `it('an expired hint still identifies the session and asks')` (spec section 11); run them, expect FAIL.
- [ ] **Step 3:** Change the `end` branch in `decideLogout` so a session with a hint returns `confirm`. Keep `subjectOfLogoutHint` accepting an expired token.
- [ ] **Step 4:** Run the files above, expect PASS. Commit: `Logout: a valid hint no longer ends a session by GET`.

### Task 3: Bind the form's fields into the token; ADR 0047

**Files:** Modify `packages/authn-flows/src/service/session-entry.ts` (`proof`, lines 51-58), `packages/protocol-oidc/src/usecase/logout.ts` (`LOGOUT_CONFIRMATION` use, `handleLogoutConfirmation` line 350), `packages/protocol-oidc/src/view/logout-html.ts`; Create the ADR numbered 0047 (`logout-confirms-by-default`); Test `packages/authn-flows/src/service/session-entry.test.ts`, `packages/protocol-oidc/src/usecase/logout.test.ts`, `tests/logout.int.test.ts`.

**Interfaces:** Produces: `proof(purpose: string, bound?: readonly string[]): string` where `bound` values are length-prefixed into the HMAC input; the logout confirmation passes `[clientId ?? '', postLogoutRedirectUri ?? '', state ?? '']`.

- [ ] **Step 1:** Tests: `it('a csrf proof does not verify when client_id changes')`, same for `post_logout_redirect_uri` and `state`; `it('proof without bound values is unchanged')` pinning today's value for every other purpose (grep `proof(` callers first).
- [ ] **Step 2:** Run, expect FAIL. Implement; length-prefix each bound value so `["a","bc"]` and `["ab","c"]` differ (assert it).
- [ ] **Step 3:** Run the test files, then `pnpm exec vitest run packages/authn-flows packages/protocol-oidc`, expect PASS.
- [ ] **Step 4:** Write ADR 0047: confirm by default, the spec's section 11 reasoning, and the per-client opt-out (Task 3b) with its residual risk; Keycloak's unconditional skip as the rejected alternative.
- [ ] **Step 5:** Re-run the transcript that shows logout on a live stack (`apps/docs/content/en/reference/transcripts/request-paths/`, find it with `grep -rln logout`), update `concepts/sessions.mdx`, append the finding to `docs/phases/p4b.md`. Commit: `Logout: bind client_id, redirect and state into the proof`.

---

## Increment C — theme foundation

### Task 3b: Per-client opt-out of the logout confirmation

**Files:** Create a migration adding `clients.skip_logout_confirmation boolean NOT NULL DEFAULT false` (next free number; re-check with `ls packages/db/drizzle | tail -1`) that also sets it `true` for the console's own client (find its identifier with `grep -rn "odudu-admin" apps/server/src packages --include=*.ts | head`); Modify `packages/domain-tenant/src/schema/clients.ts`, `packages/contracts/src/admin/clients.ts` (`clientFieldsSchema`), the client create/amend routes and usecases in `packages/protocol-admin`, `packages/protocol-oidc/src/usecase/logout.ts` (`decideLogout`), the client's Logout tab in `apps/admin-console/src/features/clients/` (its wording constant in the feature's `service`), the console client's provisioning (`seed`/`init`, found by the grep above), `docs/NEXT.md` (the "Decisions still open" row for the skip setting becomes decided, pointing at ADR 0047), `apps/docs/content/en/admin-console/clients.mdx`, `concepts/sessions.mdx`, `docs/protocols/oidc-rpinitiated.md` (the §2 "SHOULD ask" row becomes "covered by default; accepted deviation for a client with the setting on, only for a valid hint of its own that belongs to the current session", with its reason; the two MUST rows about a missing or foreign hint stay covered, and `tests/docs` holds the table); Test beside each.

**Interfaces:** Consumes the confirm-by-default `decideLogout` from Task 2. Produces `decideLogout(input: { session: boolean; hint: ValidHint | null; client: { id: string; skipsConfirmation: boolean } | null; redirect: RegisteredRedirect | null })`, where `ValidHint = { clientId: string; sid: string }` is built only after signature, issuer, key and `exp` handling that Task 2 kept; it returns `end` only for a present session whose `hint.clientId === client.id`, `hint.sid === session id` and `client.skipsConfirmation`, or for the unchanged no-session registered-redirect case, and `confirm` otherwise.

- [ ] **Step 1:** Tests, one per row of the spec's section 11 behaviour: `it('a client with the setting on signs out at once for its own valid hint')`, `it('asks with no hint, even with client_id')`, `it('asks for an invalid hint')`, `it('asks for a hint minted for another client, even when this client skips')`, `it('asks when the hint's sid is not the live session')`, `it('asks for every client with the setting off')`, `it('Dynamic Client Registration refuses the field and a registered client has it off')`, `it('PATCH requires manage-clients and is audited')`, `it('the console client has it on after migration and after a fresh init')`; console: `it('shows the warning beside the toggle, off by default, in plain words')` (assert the spec's exact warning sentence from section 13), `it('the toggle passes axe in both themes')`, e2e: turn it on for a client, sign out through its hint and land on the redirect with no confirmation page; the admin-console sign-out e2e confirms the console signs out at once.
- [ ] **Step 2:** Run, expect FAIL; implement: the column and migration, the contract field, the admin write path with audit, the `decideLogout` signature above, the Logout tab toggle (console quality bar applies), and the console client's seed.
- [ ] **Step 3:** Run `pnpm exec vitest run packages/protocol-oidc packages/protocol-admin packages/domain-tenant packages/contracts tests/docs tests/lint`, the docs app suite and the console unit tests, plus the touched e2e specs.
- [ ] **Step 4:** Re-run the transcripts for `PATCH /clients/{id}` and the logout request-path on a live stack; update the console page, the sessions concept and ADR 0047's text; add the plan-check drive if the clients read statement count changes (`pnpm test:plans`). Commit: `Logout: per-client opt-out of the confirmation`.

### Task 4: `@odudu/domain-theme` schema and repositories

**Files:** Create `packages/domain-theme/` (copy the layout of `packages/domain-tenant`: `package.json`, `tsconfig.json`, `src/{index.ts,schema,repository,service,usecase}`, `tests/`), `packages/db/drizzle/0106_themes.sql` (re-check the number: `ls packages/db/drizzle | tail -1`), a journal entry in `packages/db/drizzle/meta/_journal.json` (`when` = previous + 86400000, idx 106); Modify workspace registration, `.dependency-cruiser.cjs` if packages are listed, `packages/db` schema-drift test inputs.

**Interfaces:** Produces:

```ts
type ThemeScope = { tenantId: string; clientId: string | null };
type ThemeState = 'draft' | 'published' | 'archived';
themeRepository(tx): {
  draft(scope): Promise<ThemeRecord | null>;
  published(scope): Promise<ThemeRecord | null>;
  saveDraft(scope, body: ThemeBody, ifMatch: string | null): Promise<ThemeRecord | 'precondition_failed'>;
  publish(scope): Promise<ThemeRecord>;          // archives the previous published
  versions(scope, limit: number): Promise<ThemeRecord[]>;
  restore(scope, versionId: string): Promise<ThemeRecord>;
  reset(scope): Promise<void>;                   // archives published, deletes draft
};
assetRepository(tx): {
  put(asset: NewAsset): Promise<AssetRef | 'over_cap'>;
  get(tenantId: string, sha256: string): Promise<AssetRecord | null>;
  referencedBy(tenantId: string, assetId: string): Promise<number>;
  delete(tenantId: string, assetId: string): Promise<void>;
  bytesUsed(tenantId: string): Promise<number>;
};
```

`ThemeRecord = { id, scope, state, version, etag, body: ThemeBody, publishedAt }`; `ThemeBody` is defined in Task 5. Tables `theme_versions(id, tenant_id, client_id null FK, state, version, body jsonb, created_at, published_at)` with partial unique indexes: one `draft` and one `published` per `(tenant_id, coalesce(client_id, nil-uuid))`; `theme_assets(id, tenant_id, sha256, mime, width, height, bytes bytea, created_at)` unique `(tenant_id, sha256)`. Both have RLS hand-written in the migration (no `pgPolicy`: see the comment in `packages/domain-tenant/src/schema/clients.ts`), `ENABLE` and `FORCE ROW LEVEL SECURITY`, policy `tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid` (pattern: `0104_pending_registrations.sql`). Versions per scope are capped at 20 (archived beyond it are deleted on publish).

- [ ] **Step 1:** Tests (`packages/domain-theme/tests/theme-repository.int.test.ts`): `it('keeps one draft per scope')`, `it('publish archives the previous version')`, `it('saveDraft with a stale etag returns precondition_failed')`, `it('prunes to 20 versions')`, `it('deleting a client deletes its themes')`; and per method an `expectCrossTenantMethodProbe` (pattern: `packages/domain-tenant/tests/client-scopes.int.test.ts`).
- [ ] **Step 2:** Run, expect FAIL (no package). Create the package, migration, schema (`.enableRLS()` as in `pending-registrations.ts`), repositories; `bytea` is never selected by `themeRepository` and `assetRepository.get` is the only reader.
- [ ] **Step 2b:** Index every foreign key (`theme_versions.tenant_id`, `.client_id`, `theme_assets.tenant_id`) and the resolution lookup `(tenant_id, client_id, state)`; extend the plan drives (`apps/server/src/testing/plan-oidc-drives.ts`) so the plan check reaches a theme lookup; run `pnpm test:plans` and expect no sequential scan.
- [ ] **Step 3:** `pnpm exec vitest run packages/domain-theme packages/db/tests/rls-policy.int.test.ts packages/db/tests/schema-drift.int.test.ts` — expect PASS.
- [ ] **Step 4:** Commit: `domain-theme: themes and assets tables with RLS`.

### Task 5: Theme model — pieces, resolution, tokens

**Files:** Create `packages/domain-theme/src/service/{body.ts,resolve.ts,contrast.ts}` and tests beside them.

**Interfaces:** Produces:

```ts
type TokenGroups = { light?: Palette; dark?: Palette; font?: FontChoice };   // each group complete or absent
type ThemeBody = {
  tokens: TokenGroups; stylesheet: string | null;
  templates: Partial<Record<PageKind, string>>;
  assets: { logo?: { assetId: string; alt: string }; darkLogo?: { assetId: string; alt: string };
            favicon?: { assetId: string }; background?: { assetId: string } };
};
resolvePieces(layers: readonly (ThemeBody | null)[]): ThemeBody;      // first layer holding a piece wins, per piece; groups whole
contrastFailures(tokens: TokenGroups): ContrastFailure[];               // 4.5:1 text pairs, 3:1 large text and UI pairs
```

`Palette` has the named pairs the pages use (text/background, muted/background, primary/primary-text, border/background, focus ring/background); `FontChoice` is one of Instrument's self-hosted families (`grep -n font-family packages/instrument` for the list). `PageKind` comes from Task 8.

- [ ] **Step 1:** Tests: `it('a client template overrides only that page kind')`, `it('a client palette group replaces the tenant group whole')`, `it('falls through to null when no layer has a piece')`, `it('flags a 4.4:1 text pair and passes 4.5:1')` (use two exact hex pairs computed in the test), `it('flags a 2.9:1 focus ring')`.
- [ ] **Step 2:** Run, expect FAIL; implement WCAG relative-luminance contrast in `contrast.ts` (a pure function, formula from WCAG 2.2 1.4.3).
- [ ] **Step 3:** Run, expect PASS. Commit: `domain-theme: piecewise resolution and token contrast`.

### Task 6: Slot grammar and template sanitiser (also lands Task 8's kernel half)

**Files:** Create `packages/kernel/src/slots.ts`, `packages/kernel/src/page-kinds.ts` and tests; Create `packages/domain-theme/src/service/template.ts` and test.

**Interfaces:** Produces in kernel:

```ts
type PageKind = 'sign-in' | 'consent' | 'select-account' | 'logout-confirm' | 'totp-enrolment'
  | 'passkey-enrolment' | 'recovery-codes' | 'update-password' | 'required-action'
  | 'registration' | 'reset' | 'verification' | 'required-actions' | 'authorize-error'
  | 'email-unverified' | 'logged-out';       // the kinds the renderers table in Task 9-11 fixes
type PageManifest = { required: readonly string[]; optional: readonly string[] };
PAGE_KINDS: Record<PageKind, PageManifest>;
fillTemplate(template: string, parts: Readonly<Record<string, string>>, t: (key: string) => string): string;
```

Grammar: `{{part.name}}` for a part, `{{t "catalogue.key"}}` for text; nothing else; `fillTemplate` inserts parts verbatim (they are server markup) and `t` results escaped. In domain-theme: `checkTemplate(kind: PageKind, template: string): TemplateIssue[]` runs the allowlist (spec 6.1) and the required-parts check. Slots are refused inside attribute values and inside `title`, `textarea` or any raw-text element.

- [ ] **Step 1:** Kernel tests: `it('fills a part and escapes a catalogue value')`, `it('an unknown slot throws')`, `it('a slot appearing twice is a template issue, not a fill error')` (fill itself is dumb; the check owns it).
- [ ] **Step 2:** Template tests (Review Focus 1): `it('refuses a slot inside href')`, `it('refuses script, style, link, meta, base, iframe, object, embed, form, input, button, select, textarea, svg')` (table-driven, one case per tag), `it('refuses on* and style attributes')`, `it('refuses a javascript: and an http: href, accepts https with rel')`, `it('img src must be an asset URL of the theme')`, `it('refuses a missing required part and a doubled one')`, `it('refuses an unrecognised element rather than passing it')`, `it('rejects over-size and over-slot-count')`.
- [ ] **Step 3:** Run both, expect FAIL. Implement `slots.ts` with a single anchored regex tokenizer (no eval, bounded input) and `template.ts` over the parser chosen in S1; anything the walker does not recognise is an issue.
- [ ] **Step 4:** Run, expect PASS. Commit: `Slot templates: grammar, page kinds and the template check`. Write ADR 0045 (the template model: slots, fail-closed allowlist, why A over B and C, Liquid decided against) in this commit.

### Task 7: Stylesheet sanitiser

**Files:** Create `packages/domain-theme/src/service/stylesheet.ts` and test; `packages/domain-theme/src/service/hooks.ts` (the published CSS hooks list).

**Interfaces:** Produces `checkStylesheet(css: string, allowedAssetUrls: readonly string[]): StylesheetIssue[]` and `CSS_HOOKS: readonly string[]` (the stable class names, versioned by `CSS_HOOKS_VERSION = 1`).

- [ ] **Step 1:** Tests: refuses `@import`, `@font-face`, `@namespace`, `expression(`, `behavior`, `-moz-binding`, `url(https://…)`, `url(data:…)`; accepts `url()` only for an allowed asset URL; refuses a selector that is not built from `CSS_HOOKS` and element types; `it('an input the parser cannot read is refused, not passed through')`; `it('refuses a property outside the allowlist')`.
- [ ] **Step 2:** Run, expect FAIL; implement over the S1 CSS parser, property allowlist from a constant; unknown at-rule, unknown property and unparsable input are issues.
- [ ] **Step 3:** Run, expect PASS. Commit: `domain-theme: fail-closed stylesheet check`.

---

## Increment D — render path

### Task 8: `PageLocale.branding`, per-theme CSP, shell head

**Files:** Modify `packages/kernel/src/page.ts` (`PageLocale` 23-29, `baseDirectives` 112-123, `policyFor` 130-150), the four `document.ts` shells (`packages/{protocol-oidc,account,authn-flows,console-gateway}/src/view/document.ts`, lines 54 and 59; `instrument-reach.test.ts` line ~200 holds them byte-identical, so edit all four the same way); Test `packages/kernel/src/page.test.ts`, `packages/protocol-oidc/src/view/instrument-reach.test.ts`.

**Interfaces:** Produces in kernel:

```ts
interface ResolvedBranding {
  templates: Readonly<Partial<Record<PageKind, string>>>;
  tokensCss: string;                     // custom properties for :root and the dark scheme
  stylesheetUrl: string | null;
  faviconUrl: string | null;
  logo: { url: string; darkUrl: string | null; alt: string } | null;
  assetUrls: readonly string[];          // every URL the page may load
}
PageLocale.branding?: ResolvedBranding;
withBranding(locale: PageLocale, branding: ResolvedBranding | null): PageLocale;
```

`policyFor` replaces `img-src 'self'` and `style-src 'self'` with the explicit `assetUrls` plus Instrument's own stylesheet path when `branding` is present; a page without branding is byte-for-byte as today. Tokens reach the page as a `<style>`-free mechanism: `tokensCss` is written to the hashed stylesheet file, never inline.

- [ ] **Step 1:** Tests: `it('a page without branding has today's policy exactly')` (snapshot the current header set first), `it('a themed page lists only its own asset URLs in img-src and style-src')`, `it('refuses an asset URL that is not a same-origin path')`, `it('the shells stay identical')`.
- [ ] **Step 2:** Run, expect FAIL; implement; the shared head logic is one kernel function `brandingHead(locale): string` called by the identical shells (favicon link, tenant stylesheet link, `alt` logo is body content, not head).
- [ ] **Step 3:** `pnpm exec vitest run packages/kernel packages/protocol-oidc/src/view packages/account packages/authn-flows packages/console-gateway` — expect PASS. Commit: `Pages: a resolved branding rides on PageLocale`.

### Task 9: Convert protocol-oidc renderers to parts and a default template

**Files:** Modify `packages/protocol-oidc/src/view/{authorize-html.ts,consent-html.ts,select-account-html.ts,logout-html.ts}` and their `.test.ts`; Create `packages/protocol-oidc/src/view/templates/*.ts` (one default template string per page kind); `not-found-html.ts`, `server-error-html.ts`, `throttled-html.ts` are registered as **no tenant in scope** (Task 13) and not converted.

**Interfaces:** Consumes `fillTemplate`, `PAGE_KINDS`. Produces: each renderer builds `parts: Record<string,string>`, takes its template from `locale.branding?.templates[kind] ?? DEFAULT_TEMPLATES[kind]`, and returns `page(title, fillTemplate(template, parts, t), …)`. Manifests for the kinds it owns are filled in `page-kinds.ts` (sign-in: `form.open`, `field.username`, `field.password`, `submit`, `error`, `links`; consent: `form.open`, `scopes`, `allow`, `deny`, `client`; logout-confirm: `form.open`, `confirm`, `cancel`).

- [ ] **Step 1:** Before changing anything run each renderer's existing tests and keep their expected markup: `it('renders byte-identical output under the default template')` for every renderer, comparing against a snapshot taken from the current implementation (take the snapshots first and commit them red-free in this step).
- [ ] **Step 2:** Add `it('renders a theme's template with parts in its own order')` and `it('keeps the hidden auth_session_id inside form.open')` (Review: the part, not the template, owns hidden fields) per renderer.
- [ ] **Step 3:** Convert one renderer at a time; run its tests after each; `tests/lint/server-page-literals.test.ts` must stay green (default template text is catalogue keys through `t`).
- [ ] **Step 4:** Run `pnpm exec vitest run packages/protocol-oidc` — expect PASS. Commit per renderer pair: `Pages: sign-in and consent fill a default template`.

### Task 10: Convert account renderers

**Files:** Modify `packages/account/src/view/{registration-html.ts,reset-html.ts,verification-html.ts,required-actions-html.ts}` and tests; Create their default templates under `packages/account/src/view/templates/`.

**Interfaces:** Same contract as Task 9; page kinds `registration`, `reset`, `verification`, `required-actions`.

- [ ] **Steps 1–4:** as Task 9 (snapshot first, then conversion, then run `pnpm exec vitest run packages/account`). Commit: `Pages: account pages fill default templates`.

### Task 11: Convert authn-flows renderers

**Files:** Modify `packages/authn-flows/src/view/{totp-enrolment-html.ts,passkey-enrolment-html.ts,recovery-codes-html.ts,update-password-html.ts,required-action-html.ts}` and tests; Create default templates.

**Interfaces:** As Task 9, plus a required `script` part on `passkey-enrolment` carrying the nonce'd script the `RenderedPage` names (spec 6). `fillTemplate` leaves `script` to the renderer; the check requires the slot.

- [ ] **Steps 1–4:** as Task 9, with `it('the nonce survives a themed passkey page')` (`RenderedPage.script.nonce` appears in the output exactly once). Run `pnpm exec vitest run packages/authn-flows`. Commit: `Pages: authn-flows pages fill default templates`.

### Task 12: Resolve branding per request, with a bound

**Files:** Create `packages/domain-theme/src/usecase/resolve-branding.ts` and `src/service/branding-cache.ts` with tests; Modify each package's page-locale helper (`grep -rn "negotiatePageLocale" packages/*/src` lists them; `packages/account/src/view/request-locale.ts` is one) and the routes that call the converted renderers (`authorize.ts`, `login-response.ts`, `consent.ts`, `required-action.ts`, `logout.ts`, account `registration.ts`, `reset-password.ts`, `action-token.ts`); `apps/server/src/app-deps.ts` for wiring.

**Interfaces:** Produces:

```ts
resolveBranding(deps): (input: { tenantId: string; clientId: string | null }) => Promise<ResolvedBranding | null>;
brandingCache: { maxEntries: 5000; ttlMs: 30_000 }   // LRU keyed `${tenantId}:${clientId ?? ''}:${version}`
clientFromReturnTo(tenant: string, returnTo: string | null, isClientOfTenant: (id: string) => Promise<boolean>): Promise<string | null>
```

Client rules (spec 6): authorization-session pages use the pending request's `clientId`; account pages derive it from `return_to` only when it names a registered client of the same tenant; everything else null. One query resolves both layers (published tenant row and published client row) per render when the cache misses.

- [ ] **Step 1:** Tests (Review Focus 2 and 5): `it('falls back to the tenant when the client has no theme')`, `it('falls back to default and logs when a referenced asset is gone')`, `it('falls back when a stored template fails the current check')`, `it('return_to naming another tenant's client yields the tenant theme')`, `it('a garbage client_id yields the tenant theme')`, `it('a render makes at most 1 theme query on a cache miss and 0 on a hit')` (count queries), `it('the cache never holds more than maxEntries')`, `it('publishing invalidates the entry')`.
- [ ] **Step 2:** Run, expect FAIL; implement; the cache states its bound in code and ADR 0045's consequences.
- [ ] **Step 2b:** Add a themed sign-in render to the plan drives and assert the statement count equals the unthemed render plus at most one; run `pnpm test:plans`.
- [ ] **Step 3:** Wire into the page-locale helpers and routes (a route cannot render without calling it). `pnpm exec vitest run packages/domain-theme packages/protocol-oidc packages/account packages/authn-flows` — expect PASS. Commit: `Pages: branding resolved per request, bounded and cached`.

### Task 13: Every renderer reaches a theme; hostile-theme tests

**Files:** Create `packages/protocol-oidc/src/view/theme-reach.test.ts` (beside `instrument-reach.test.ts`, which it copies in method: TypeScript AST walk over `packages/*/src/view` and `apps/*/src`); Create `packages/domain-theme/tests/hostile-theme.int.test.ts`; Create `packages/kernel/src/page-kinds-registry.ts` (the list of exemptions with reasons).

**Interfaces:** Produces `NO_TENANT_IN_SCOPE: Record<string, string>` mapping renderer file → reason: `not-found-html.ts`, `server-error-html.ts`, `throttled-html.ts` (no tenant resolved), `console-gateway/src/view/refusal-html.ts` (console's own page), `logout-html.ts` renderers other than the confirmation (`renderLoggedOutPage` and kin render after the session is gone but the tenant is in scope: **not** exempt; decide per renderer when writing the registry and record why).

- [ ] **Step 1:** Tests: `it('every *-html.ts renderer is themeable or named in NO_TENANT_IN_SCOPE with a reason')`; negative fixture under `tests/lint/fixtures/` as `instrument-reach` has; `it('a hostile theme cannot drop or duplicate form.open, the submit or the hidden fields')` per page kind, driving the real route with `inject` and posting the form it returns.
- [ ] **Step 2:** Run, expect FAIL; fix any renderer the walk finds; run `pnpm exec vitest run packages tests/lint` — expect PASS. Commit: `Build check: every page renderer reaches a theme`.

---

## Increment E — assets

### Task 14: Upload pipeline

**Files:** Create `packages/domain-theme/src/service/image.ts` (+ test), `packages/domain-theme/src/usecase/upload-asset.ts` (+ test); Modify `package.json` for the S1 image dependency; ADR 0046 (`theme-assets-live-in-postgresql`).

**Interfaces:** Produces `inspectImage(bytes: Uint8Array): Promise<{ mime: 'image/png'|'image/jpeg'|'image/webp'; width: number; height: number; bytes: Uint8Array } | ImageRefusal>` (decodes, re-encodes, strips metadata), `uploadAsset(deps)(input: { tenantId; bytes; kind: 'logo'|'darkLogo'|'favicon'|'background' }): Promise<AssetRef | UploadRefusal>`; limits as constants: logo and favicon at most 256 KiB and 1024 px, background 1 MiB and 2560 px, tenant total 8 MiB, decoded pixels at most 16 M.

- [ ] **Step 1:** Tests (Review Focus 4), fixtures generated in the test: `it('refuses a polyglot PNG with HTML appended')` (accepts only after re-encode, output has no trailer), `it('refuses EXIF-bearing JPEG metadata in the output')`, `it('refuses an animated WebP')`, `it('refuses a decompression bomb by declared pixels before decoding')`, `it('detects type by bytes and ignores the declared content-type')`, `it('refuses SVG')`, `it('refuses over the tenant cap')`, `it('the same bytes upload to the same hash and one row')`.
- [ ] **Step 2:** Run, expect FAIL; implement; the pixel check happens on the header before a full decode.
- [ ] **Step 3:** Run, expect PASS; run a `docker build` of the image with the new dependency (the `container` job has no local equivalent otherwise). ADR 0046 written (bytea in its own table, caps, object storage as the later swap behind `assetRepository`). Commit: `domain-theme: validated, re-encoded uploads`.

### Task 15: Serve assets

**Files:** Create `packages/domain-theme/src/view/routes/assets.ts` (or the protocol-oidc package that already owns tenant-scoped GET routes: follow where `/instrument/instrument.css` is served; `grep -rn INSTRUMENT_STYLESHEET packages`), registration in `apps/server`; Test beside it and an int test.

**Interfaces:** Produces `GET /tenants/:tenant/brand/:sha256.:ext` (and the hashed stylesheet `GET /tenants/:tenant/brand/:sha256.css` built from `tokensCss` + the sanitised stylesheet), serving only assets referenced by a **published** theme, `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`, `Content-Type` from the stored mime, and no cookies.

- [ ] **Step 1:** Tests: `it('serves a published asset with immutable caching and nosniff')`, `it('404s an asset only a draft references')`, `it('404s another tenant's hash')`, `it('a mismatched extension is a 404')`.
- [ ] **Step 2a:** Add the asset lookup to the plan drives; `pnpm test:plans` must plan it as an index read.
- [ ] **Step 2:** Run, expect FAIL; implement (this route bypasses `pageHeaders`: it is not a page; state it in the file's one comment and in `html-response.test.ts`'s exempt list only if that test requires it).
- [ ] **Step 3:** Run, expect PASS. Commit: `Serve published theme assets under hashed URLs`.

---

## Increment F — admin API

### Task 16: Theme routes

**Files:** Create `packages/contracts/src/admin/theme.ts`, `packages/protocol-admin/src/view/routes/theme.ts`, `packages/protocol-admin/src/usecase/theme.ts`; Modify `packages/protocol-admin/src/service/capability.ts` (`ADMIN_ROUTES`, entry shape at line 140, settings entries 744-760 as the example), `packages/protocol-admin/src/index.ts` (handler wiring ~631), `packages/contracts/src/admin/docs.ts`; Test `packages/protocol-admin/tests/theme.int.test.ts`, `openapi.int.test.ts` agrees.

**Interfaces:** Produces under `/admin/tenants/:tenant/` with capability `manage-tenant` (client scope: `manage-clients`): `GET|PUT theme` (draft, `ETag`/`If-Match`), `POST theme/publish`, `GET theme/versions`, `POST theme/versions/:id/restore`, `DELETE theme` (reset), and the same under `clients/:id/theme`; `GET theme` also returns, per piece, `source: 'client'|'tenant'|'default'`. Publish runs `checkTemplate`, `checkStylesheet`, `contrastFailures` and returns field errors (`fieldProblem`), contrast failures as errors, a stylesheet or template warning as `warnings[]`.

- [ ] **Step 1:** Tests: `it('PUT with a stale If-Match is 412 and the draft is unchanged')` (Review Focus 3), `it('publish refuses a failing contrast pair with its path')`, `it('publish refuses a template missing form.open')`, `it('restore brings back the whole snapshot')`, `it('reset on a client returns it to the tenant theme')`, `it('every route needs its capability')`, `it('a foreign tenant id is a 404')`.
- [ ] **Step 2:** Run, expect FAIL; implement routes, contracts, docs strings; add the new routes to `apps/server/src/testing/plan-admin-drives.ts` and `plan-admin-writes.ts` (every `ADMIN_ROUTES` entry is reached by the plan check), and `GET theme/versions` returns at most 20.
- [ ] **Step 3:** `pnpm exec vitest run packages/protocol-admin packages/contracts tests/docs/admin-paths.test.ts tests/docs/endpoints.test.ts` — expect PASS. Commit: `Admin API: theme draft, publish, versions and reset`.

### Task 17: Asset routes

**Files:** Modify `capability.ts`, `packages/contracts/src/admin/theme.ts`; Create `packages/protocol-admin/src/view/routes/theme-assets.ts`; Test `theme-assets.int.test.ts`.

**Interfaces:** `POST /admin/tenants/:tenant/theme/assets` (raw image body, query `kind`), `DELETE …/assets/:id` (refused while referenced by any draft or published version, via `referencedBy`); the route sets a body limit per kind (check `bodyLimit` conventions: `grep -rn bodyLimit apps packages` found none, so set it on this route only).

- [ ] **Step 1:** Tests: `it('rejects an upload larger than the kind's limit before reading it all')`, `it('deleting a referenced asset is 409')`, `it('an uploaded asset is not served until a published theme references it')`.
- [ ] **Step 2–3:** implement, run `pnpm exec vitest run packages/protocol-admin`, commit: `Admin API: theme assets`.

### Task 18: Preview route

**Files:** Create `packages/protocol-admin/src/view/routes/theme-preview.ts` (or console-gateway, whichever owns admin-session-gated GETs; decide with `grep -rn "session" packages/console-gateway/src/view/routes`); Test `theme-preview.int.test.ts`.

**Interfaces:** `GET /admin/tenants/:tenant/theme/preview?kind=<PageKind>&client=<id>` renders the draft through the **production** renderer and `fillTemplate` with sample parts, inlining the stylesheet and images as `data:` URIs (bound: 1 MiB total), CSP `default-src 'none'; img-src data:; style-src 'sha256-…'`, `frame-ancestors 'self'` on this route only, admin session required; a page needing script renders without it.

- [ ] **Step 1:** Tests: `it('previews the draft exactly as the production render does')` (same fill function, same output modulo URLs), `it('is refused without an admin session')`, `it('frame-ancestors is self and no other page's changes')` (assert `pageHeaders` untouched), `it('inlines a draft asset that no public URL serves')`.
- [ ] **Step 2–3:** implement, run, commit: `Admin API: theme preview through the production render path`.

---

## Increment G — locales and mail

### Task 19: Tenant locales and overrides

**Files:** Create migration `0107_tenant_locales.sql` (columns `supported_locales text[]`, `default_locale text` on `tenants`; table `message_overrides(tenant_id, locale, key, message, PRIMARY KEY …)` with RLS and a per-tenant count bound of 500 enforced in the repository); Modify `packages/db/src/schema/tenants.ts`, `packages/domain-tenant/src/service/tenant-settings.ts` (`SETTINGS` map), `packages/contracts/src/admin/settings.ts`, the page-locale helpers (`tenantDefault` argument of `negotiateLocale`), `packages/protocol-oidc/src/index.ts:324` (`pageLocales` becomes the tenant's list), `packages/i18n/src/service/translators.ts` (override lookup before catalogue); routes for overrides in `protocol-admin`.

**Interfaces:** `messageOverrideRepository(tx): { list(tenantId, locale): Promise<Override[]>; put(o): Promise<'ok'|'over_bound'|'unknown_key'>; delete(...) }`; `translators.t` takes an optional `overrides` map; an override of a key absent from `en` is refused; the value is escaped like any catalogue value.

- [ ] **Step 1:** Tests (Review Focus is locale tags too): `it('refuses an override for a key not in en')`, `it('refuses a locale tag that fails isValidLocale')`, `it('refuses the 501st override')`, `it('lists overrides keyset-paged under MAX_LIMIT')`, `it('an override text containing markup is escaped, not rendered')`, `it('discovery ui_locales_supported is the tenant's list')`, `it('negotiation uses the tenant default')`, plus foreign-tenant probes.
- [ ] **Step 2–4:** implement, extend the plan drives for the override list, run `pnpm test:plans`, then `pnpm exec vitest run packages/db packages/domain-tenant packages/i18n packages/protocol-admin packages/protocol-oidc`, commit: `Tenant locale list, default and message overrides`.

### Task 20: Localised client and scope metadata

**Files:** Create migration `0108_i18n_metadata.sql` (`clients.name_i18n`, `clients.description_i18n`, `client_scopes.description_i18n`, `client_scopes.consent_text_i18n`, all `jsonb NOT NULL DEFAULT '{}'`); Modify `packages/domain-tenant/src/schema/{clients,client-scopes}.ts`, `packages/contracts/src/admin/{clients,scopes}.ts`, `packages/protocol-oidc/src/index.ts` (`consentContext` ~349-383), `packages/protocol-oidc/src/service/client-metadata.ts` (line ~228 `client_name`, 474), `client-registration.ts:27`.

**Interfaces:** each map is `Record<locale, string>`, keys `isValidLocale`, bounded by the tenant's list and 32 entries, each value at most its base column's limit; the consent page picks the negotiated locale by RFC 4647 lookup then the base column; DCR accepts `client_name#fr` and stores it in `name_i18n`.

- [ ] **Step 1:** Tests: `it('consent shows the French client name for a fr page')`, `it('falls back to the base column for a locale with no entry')`, `it('DCR stores client_name#fr in name_i18n')`, `it('a key outside the tenant's locales is refused')`, `it('a list read makes the same number of queries as before')`.
- [ ] **Step 2–4:** implement, run the files plus `pnpm exec vitest run packages/domain-tenant packages/protocol-oidc packages/protocol-admin`, commit: `Per-locale client and scope metadata`.

### Task 21: Arabic

**Files:** Create `packages/{authn-flows,account,protocol-oidc,console-gateway}/src/view/messages.ar.ts` (follow how `messages.ts` is built; `createCatalogue` takes `Messages<T> = {en: T} & Record<string, Partial<T>>`), mail messages in `packages/email/src/service/messages.ts`; Modify `packages/i18n/src/service/shipped.ts` (`SHIPPED_LOCALES = ['en','ar']`); Test a completeness check and an axe e2e.

**Interfaces:** `ar` complete for every key of every page and mail template (ADR 0043's rule: a locale ships only when complete); `RELEASING.md` gains an owner step: "a reader of Arabic reviews the catalogue before any release".

- [ ] **Step 1:** Tests: `it('ar has every key en has, in every catalogue')`, `it('ar pages render dir="rtl" and lang="ar"')`, `it('no physical left/right in the page stylesheet')` (`grep -n 'left\|right' packages/instrument/src/pages.css`), and an e2e that runs axe on each page kind in `ar` under both colour schemes.
- [ ] **Step 2:** Run, expect FAIL; write the catalogues (a drafted translation, marked unreviewed in `docs/phases/p4b.md` and `RELEASING.md`), fix any physical-direction CSS the check finds.
- [ ] **Step 3:** Run, expect PASS. Commit: `Ship Arabic with a layout pass under axe`.

### Task 22: Themed mail

**Files:** Modify `packages/email/src/service/{shell.ts,templates.ts,palette.ts}` (`renderShell` line 139 uses fixed `MAIL_PALETTE.light`; `MailInput` lines 7-17), the callers that build `MailInput` (`grep -rn "renderVerifyEmail\|renderResetPassword" packages apps`); Test `shell.test.ts`, `templates.test.ts`.

**Interfaces:** `MailInput` gains `branding?: MailBranding` = `{ palette: Palette; logo: { src: string; alt: string; width: number; height: number } | null; darkLogo: … | null }`; `renderShell` inlines explicit colours on every element from it, emits the dark logo under `prefers-color-scheme`, and falls back to `MAIL_PALETTE` without it; mail locale is the recipient's `users.locale`, else the tenant default.

- [ ] **Step 0 (spike, assumption: embedded CID logos render in the major clients):** send a test mail from `mailpit` to inspect markup, and record which of CID or hosted logo the plan keeps; the research did not rank them. `verified:` line in the task report.
- [ ] **Step 1:** Tests: `it('uses the tenant palette on every element')`, `it('logo has width, height and alt')`, `it('falls back to the default palette without branding')`, `it('uses the tenant default locale when the recipient has none')`.
- [ ] **Step 2–3:** implement, run `pnpm exec vitest run packages/email`, commit: `Mail follows the tenant theme`.

---

## Increment H — console

### Task 23: Branding feature — Theme and Pages tabs

**Files:** Create `apps/admin-console/src/features/branding/{adapter,repository,service,usecase,view}/…` with `index.ts` exporting `BrandingPage`; Modify `apps/admin-console/src/app/router.tsx` (~480-490, email as the pattern), `features/shell/service/areas.ts` (`area('branding','Branding','manage-tenant')` in `TENANT_AREAS`), `apps/docs/tests/console-areas.test.ts` (`PAGE_OF_FEATURE`, `PAGE_OF_AREA`); Create `apps/docs/content/en/admin-console/branding.mdx` (a stub satisfying that test, filled in Task 26).

**Interfaces:** Consumes `adminCall` from `shared/adapter/route.ts`, `useRecord`, `useSectionSave` (the 412 and drafts machinery), `RecordPage` tabs as `clients` does. Produces `features/branding/service/tabs.ts` with `BRANDING_TABS = ['theme','pages','mail','languages'] as const` and labels; pure services for contrast display and issue wording (a usecase holds none).

- [ ] **Step 1:** Tests beside each file (`BrandingPage.test.tsx` includes `axeInBothThemes`, required by `tests/lint/console-view-tests-run-axe.test.ts`): `it('shows which layer supplies each piece')`, `it('a failing contrast pair blocks publish and names the pair')`, `it('a 412 offers keep mine or take theirs')`, `it('preview frames the production route with sandbox and no allow-same-origin')`, `it('reset to default asks first')`, `it('the Branding route is lazy and the entry chunk budget holds')` (`tests/lint/console-phone-chunk.test.ts` is the existing chunk check; run it and, if it does not cover this feature's editors, extend it), e2e `apps/admin-console/e2e/branding.spec.ts` (publish a theme, see the sign-in page change).
- [ ] **Step 2–4:** implement; run `pnpm --filter @odudu/admin-console test`, the lint tests under `tests/lint`, `pnpm exec vitest run apps/docs/tests/console-areas.test.ts`; commit: `Console: Branding area, theme and pages`.

### Task 24: Mail and Languages tabs

**Files:** Modify `features/branding/**`; Create views for the two tabs.

**Interfaces:** Mail tab: preview of a verification mail (the production render, framed the same way) and the logo/palette it inherits; Languages tab: supported list, default, overrides table (bounded, paged) with the `unknown_key` and `over_bound` refusals worded from `service` constants.

**Added during execution:** no admin route returned a rendered mail, so this task also builds `GET /admin/tenants/:tenant/mail/preview` and `GET /admin/tenants/:tenant/mail/branding` (manage-tenant, tenant scope, kernel `previewHeaders`, statement count asserted). The Languages tab can add a validated supported tag and clear the default language (the settings route clears it on an empty string).

- [ ] **Steps 1–4:** tests per tab including axe and `it('refuses a key not in en with its wording')`; implement; run console tests; commit: `Console: Branding mail and languages tabs`.

### Task 24b: Stylesheet editor and CodeField

**Files:** Create `apps/admin-console/src/shared/view/CodeField/` (an in-house textarea with a highlighted overlay: the textarea stays the real control, tokens are coloured by CSS classes, no inline styles, own small tokenizers for CSS and the template language, line numbers, a server refusal marked on its line); Modify `features/branding/**` (a stylesheet editor in the Theme tab, the Pages tab's template editor uses `CodeField`).

**Interfaces:** Consumes the theme draft's `stylesheet` field and the server's `checkStylesheet` refusals, worded from `service` constants; same save, publish, preview and 412 flow as the other editors.

**Decision:** not CodeMirror 6. The console CSP has no `unsafe-inline` and no nonce; CodeMirror in the document root raised a `style-src-elem` violation and broke its layout, and worked only in a ShadowRoot; its chunk is 6 to 8 times the Branding chunk; it is contenteditable with no native form value (`verified:` the spike in the session ledger, `spike-codemirror.md`).

- [ ] **Steps 1–4:** tests (tokenizers as pure service tests, `axeInBothThemes`, a refusal marked on its line, keyboard Tab handling with an escape route); implement; commit: `Console: stylesheet editor and CodeField`.

### Task 24c: Message key catalogue and preview fallback notice

**Files:** a bounded admin read returning the en catalogue's keys with their text per page kind (and the keys the override table accepts); a readable channel for the preview's fallback reason; the template editor's key picker, the override key field and the preview notice in `features/branding/**`.

**Interfaces:** the picker inserts `{{t "key"}}`; the override key field offers the same list; the preview says which layer it fell back to and why, because a frame cannot expose the `x-odudu-preview-fallback` header.

- [ ] **Steps 1–4:** tests (server int test with a foreign-tenant probe, statement count; console tests with axe); implement; commit: `Branding: message key catalogue and preview fallback notice`.

### Task 25: Client Branding tab and locale-tabbed metadata editor

**Files:** Modify `apps/admin-console/src/features/clients/service/tabs.ts` (`CLIENT_TABS`, `CLIENT_TAB_LABELS`, `TAB_SECTIONS`), `features/clients/view/ClientRecordPage/ClientRecordPage.tsx` (`PANELS`), `features/scopes/view/ScopeRecordPage/GeneralTab.tsx`; Create `features/clients/view/BrandingTab/`, `features/clients/usecase/useClientBranding.ts`; Modify `apps/docs/content/en/admin-console/clients.mdx` (new tab label in **bold**, required by `console-areas.test.ts`).

**Interfaces:** Reuses the branding feature's components through its `index.ts` (a feature reaches another only so); a shared locale-tabbed field editor goes to `shared/view` if scopes and clients both use it (reuse rule).

- [ ] **Steps 1–4:** tests (axe, `it('a client override shows the tenant piece it hides')`), e2e, implement, run console tests and `console-areas.test.ts`; commit: `Console: client Branding tab and localised metadata editor`.

### Task 25b: Console reuse consolidation

**Files:** every console file this phase added or changed.

**Interfaces:** the Reuse scan rule in `CLAUDE.md`. Audit the phase's console code against `shared/` and every sibling feature (searches by behaviour words and synonyms, not only names, and the cases the duplicate-exports lint cannot see), rule each hit, then move to `shared/` in its own commit and repoint both sides, or keep apart with a written reason.

- [ ] **Steps 1–3:** audit report; rulings; execute with the console tests green after each move; commit per move.

### Task 25c: Console findings the phase owns

**Files:** `features/branding/**`, `features/clients/**`, `shared/view/ComboBoxField`.

**Interfaces:** every minor an earlier review deferred inside the branding feature is fixed with a test, because the phase owns defects in its own topic whatever their severity: the unsaved-sections hold quoting section titles, service-side guards in place of hook guards, Enter adding a language tag, the supported-languages note naming Add, an unsaved dot on Languages, the Mail tab drawing a same-origin logo, the empty preview-notice region taking no grid row, and an e2e for adding a language.

- [ ] **Steps 1–3:** a finding table (finding, fix, commit); tests first; commit per group.

### Task 25d: Findings outside the console, and the uploaded-asset thumbnail

**Files:** the domain, server and gateway code the phase wrote (Tasks 4–21), and the Theme tab.

**Interfaces:** every deferred minor in the ledger is re-checked against the code and fixed with a test first, marked already fixed or wrong with evidence, or placed with one line against another phase's topic. An admin read `GET /admin/tenants/:tenant/theme/assets/:id/content` (tenant-scoped, read capability, stored mime, `nosniff`, `no-store`, bounded, foreign-tenant probe, statement count) with a gateway pass-through and an adapter returning a `data:` URL, so the Theme tab shows a bounded thumbnail of any uploaded asset, published or not.

- [ ] **Steps 1–3:** finding table; tests first; commit per area; the transcript and screenshots stay owed to Task 26.

### Task 25f: Publish and revert from every tab

**Files:** `packages/protocol-admin` and `packages/domain-theme` (a list of the pieces where the draft differs from the published theme, and a discard-draft action), `apps/admin-console/src/features/branding/**` (a publication bar shared by the tabs, per-tab revert), `apps/docs/content/en/admin-console/branding.mdx`, `clients.mdx`.

**Interfaces:** the theme read answers the pieces (`tokens`, `assets`, `stylesheet`, `templates`) whose saved draft value differs from the published one, for the tenant and for a client; the server compares the two bodies, never the console. `DELETE …/theme/draft` removes only the draft and leaves the published theme (manage-tenant, also admitting manage-clients for the client scope; foreign-tenant probe, statement count asserted, ETag precondition as the other draft writes, `test:plans`, OpenAPI and capability rows). The bar sits above every tab: it names what differs ("Changed: Colours, Page templates"), holds Publish with "Nothing to publish: the draft matches what people see" when nothing differs, and offers Discard draft behind a confirmation. Each tab offers Revert this tab to published, which writes the draft again with that tab's pieces taken from the published theme (cleared when nothing is published) and leaves every other piece alone. Publishing stays all-or-nothing over the whole draft. A tab shows a dot when part of the change is in it.

- [ ] **Steps 1–4:** server tests first (differs for each piece, equal after a revert, discard leaves published, foreign-tenant probe, statement counts); console tests including axe, the hold message, a revert on one tab leaving another's change, discard after two tabs changed; implement; the transcript, OpenAPI figures and screenshots are owed to Task 26 (add the rows to `docs/phases/p4b.md`). Quote the layering, comment and Reuse-scan rules in the dispatch.

### Task 25e: Selectors you can use, beside the stylesheet editor

**Files:** `packages/protocol-admin` (a static read beside the message catalogue, wired the same way), `packages/domain-theme/src/service/hooks.ts` (the one list the read answers from), `apps/admin-console/src/features/branding/**` (adapter, repository, service, view), `apps/docs/content/en/admin-console/branding.mdx`.

**Interfaces:** `GET /admin/tenants/:tenant/theme/stylesheet-hooks` answers the hook version, the rendered classes, the `page-<kind>` classes and the plain elements the stylesheet checker accepts (manage-tenant, also admitting manage-clients; static, unpaged, no database read, foreign-tenant probe, statement count asserted, `test:plans`, OpenAPI and capability rows). The Stylesheet section shows a bounded "Selectors you can use" list that narrows by text and inserts the chosen selector at the caret as one undo step, the way the message picker does; wording comes from service constants, and the list is the server's, never a copy in the console. The refusal for a selector outside the list says where the list is.

- [ ] **Steps 1–4:** server tests first (answer equals `CSS_HOOKS`, `RENDERED_HOOKS` and `CSS_ELEMENTS`, so a hook added to the checker cannot be missing from the answer); console tests including axe and the one-undo-step insert; implement; the transcript, OpenAPI figures and a screenshot are owed to Task 26 (add the rows to `docs/phases/p4b.md`). Quote the layering, comment and Reuse-scan rules in the dispatch.

---

## Increment I — documentation close

### Task 26: Transcripts, console pages, concepts, guide

**Files:** Create transcripts under `apps/docs/content/en/reference/transcripts/admin-paths/` for each new route group (copy the shape of `get-mail.md`; add to `order.json`), a branding transcript of a themed sign-in in `request-paths/` that also fetches the stylesheet and logo it links (the `/brand/` route, which has no transcript until the admin routes can publish a theme); Modify `apps/docs/content/en/admin-console/{branding.mdx,clients.mdx,tour.mdx,index.md}` (`tour.mdx` line 68 TENANT list), `concepts/{sessions,scopes,clients}.mdx`; Create `concepts/branding.mdx`, `guides/brand-a-tenant.md` with `{run}` blocks; Modify `apps/docs/scripts/console-shots/screens.ts` and run `pnpm docs:screenshots` against a stack.

**Interfaces:** Documentation rules in CLAUDE.md "The documentation an increment owns": responses carry no language tag; each transcript says what ran before it; a refusal's precondition is shown; a page's prose names no ADR, path or phase (`console-areas.test.ts`).

- [ ] **Step 1:** Bring up a stack (`docs/phases/p4g.md` records the compose invocation) and run every new or changed route, including the ones Task 25 changed after their transcripts were written and which carry a note saying so: `GET /clients/{id}` and `PATCH /clients/{id}` (`supported_locales`) in `get-clients-post-clients-and-get-clientsid.md` and `patch-clientsid.md`, the client theme read in `get-theme-put-theme-and-the-theme-routes.md` (`tenant_sources`), and `get-adminopenapijson.md`, whose `content-length`, size and path count were hand-edited to the derived values beside an old `Date` header and so is no longer a capture; remove each note when its block is re-run, a rejected template and a rejected upload, the always-confirm logout and a themed sign-in; paste real output only.
- [ ] **Step 2:** Write `concepts/branding.mdx` (layers, parts and slots, the safety model, the versioned CSS hooks reference generated from `CSS_HOOKS`, the same list the editor's selector reference shows), the guide, and the console pages; run `pnpm exec vitest run apps/docs tests/docs` and `pnpm docs:screenshots`, then `--check`.
- [ ] **Step 3:** Commit: `Docs: branding transcripts, console page, concept and guide`.

### Task 27: Landing page, server-page shots, README, roadmap close

**Files:** Modify `apps/docs/src/features/landing/service/content.ts` (`BRANDING`, lines ~225-250), `view/Branding/Branding.tsx` and tests, `usecase/useBrandingPictures.ts` and test, `apps/docs/tests/landing-planned.test.ts` (`PLANNED = [...AGENT_ITEMS, BRANDING]` loses `BRANDING`), `apps/docs/scripts/page-shots/{shots.ts,brand.ts}`, `README.md` (line 46), `tests/docs/questions.md` (461, 469), `apps/docs/content/en/roadmap.md`, section 11 hours, `docs/NEXT.md`, `docs/phases/p4b.md`.

**Interfaces:** The "Branding and theming" band stops being Planned: no chip, no roadmap link, a real tenant theme beside Instrument's from the production render (`look-other` becomes a genuinely themed render, not `brandStyle()` injection), claim and alt text rewritten to what exists, `today` removed.

- [ ] **Step 1:** Update the landing tests first (`Branding.test.tsx` loses the Planned expectations and gains `it('shows two real looks with alt text')`); run, expect FAIL; implement; `pnpm --filter @odudu/instrument build && pnpm --filter @odudu/docs page-shots`; `pnpm exec vitest run apps/docs scripts` including `drift.test.ts`.
- [ ] **Step 2:** Closing pass (CLAUDE.md, all five): read "What is not implemented" for truth; `git grep -n '\bP4b\b\|\bP4j\b'`; read `docs/NEXT.md` headings against closed phases; reconcile roadmap against section 11 both ways; `git grep -n -i -E 'planned|theming' -- apps/docs README.md`. Set the P4b hours from the increments' real cost.
- [ ] **Step 3:** Commit: `Docs: landing branding band shipped, roadmap closed for P4b`. Then the whole-branch review (four readers: server, console and admin API, documentation, release) and `superpowers:finishing-a-development-branch`; the spec and this plan move with `git mv` to `docs/archive/`.

---

## Self-review

- **Spec coverage:** goals 1–7 → Tasks 4–13, 14–15, 22, 19–21, 23–25, 3; section 3 → Task 1; section 6 → 5–7, 12; 6.3 CSP → 8; 7 → 14–15; 8 → 16, 18, 23; 9 → 22; 10 → 19–21; 11 → 2–3; 12 → 13, 21, 23; 13 → 16–18, 23–26; 14 is a comparison, no task; 15 criteria 1–12 → 13, 16, 13, 14, 8, 22, 19–21, 2, 13/21, 4–20 probes, 1, 26–27. Gap checked: spec 17 "owner" items are in Task 1 (name) and Task 21 (review step).
- **Types:** `ResolvedBranding`, `ThemeBody`, `PageKind`, `ThemeScope` are defined once (Tasks 4, 5, 6, 8) and used with those names after.
- **Open assumptions needing a spike:** S1 (libraries), Task 22 Step 0 (mail logo), and the page-kind list in Task 6, which Task 13's registry confirms against `git ls-files 'packages/*/src/view/*-html.ts'`.
