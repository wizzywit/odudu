# P5c — The Act write surface and the reads' accounting: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Act covers every console write except the owner-ruled human-only set, each write approved on a card by the person, removals confirmed, security changes confirmed by typing the target's name, every write audited; every read is an assistant tool or a registered exclusion; a test fails when a route is neither.

**Architecture:** The assistant gets a door list of its own and tools with an `audience`, so nothing here reaches an outside MCP agent. Tier is computed on the server from tool and target. The coverage test `tests/lint/mcp-tool-coverage.test.ts` is extended, not duplicated.

**Tech Stack:** As the console assistant plan (`docs/superpowers/plans/2026-11-25-p5c-console-assistant.md`): TypeScript, Fastify, Zod contracts, Vitest, Testcontainers PostgreSQL, React console, Playwright.

**Spec and decisions:** [Spec section 5.3a](../specs/2026-11-24-p5c-console-assistant-design.md), [ADR 0061](../../adr/0061-the-assistants-write-surface-tiers-human-only-operations-and-the-coverage-guard.md) (tiers, human-only set, guard), ADRs 0059 and 0060 (approval object, grant). Classification evidence, local and git-ignored: `.superpowers/sdd/2026-11-25-p5c-console-assistant/{write-inventory,write-independent,write-compare,read-audit}.md`; `write-compare.md` is the one that decides.

## Start condition and placement

**W0 starts only after the cross-tenant Act branch (`p5c-xt-act`) has merged into `p5c-console-assistant`.** Both touch the shared door (`agent-reach.ts`, `agent-scope.ts`, `authenticate-admin.ts`) and the approval files (`apps/server/src/assistant-approvals.ts`, `packages/assistant/src/service/approval-card.ts`); a W0 started earlier conflicts in exactly the files W0 rewrites. `verified:` `git branch -a | grep xt-act` lists `p5c-xt-act` as a local branch and no remote one; it is not an ancestor of this branch.

Placement (CLAUDE.md "Start the phase"): this is work inside P5c, whose roadmap bullet and section 11 row already place Act and the approval card. What cannot be done now is placed on **P5d** (new, after P5c): the reveal channel, tenant creation and import through an instance-write door, the delegated-administrator rule, sessions without the caller. `verified:` `git grep -n '\bP5d\b' -- ':!docs/archive'` finds only the documents this change adds.

## What was read, and what it found (resolving the open questions)

Each finding has the command beside it.

1. **Does the decide route accept a tier or typed name without a contract change?** The tier needs none; the typed name is one additive optional field. `grep: git grep -n "decideApprovalRequestSchema" -- packages/contracts` gives `z.strictObject({ approve: z.boolean() })` (`packages/contracts/src/admin/assistant.ts:178`), so an extra field is refused today. The route is `.../approvals/:approvalId` (`capability.ts:2320`). `decideCard` loads the stored card's `tool` before deciding (`packages/assistant/src/usecase/approvals.ts:40-47`), so the server derives the tier from the tool and the target without a wire field. **Decision:** `decideApprovalRequestSchema` gains `confirm: z.string().optional()`; `assistantApprovalCardSchema` gains `tier` (`'A'|'B'|'C'`) and `confirm_with` (the exact text to type, null below C). Additive: an old console that sends `{approve}` is refused on a C card, never run. W0 regenerates the OpenAPI document and re-runs the decide transcript.
2. **What separates a public from a confidential client create?** The request schema checks only `client_id` and passes the rest as a catchall (`createClientRequestSchema`, `packages/contracts/src/admin/clients.ts:126`); the usecase decides by `clientType(token_endpoint_auth_method)`, `'none'` is public and anything else confidential (`packages/protocol-admin/src/usecase/clients.ts:558-560`), and an omitted method defaults to `client_secret_basic` (`packages/protocol-oidc/src/service/client-metadata.ts:289`). **Decision:** the W3b create tool is public-only: its schema fixes `token_endpoint_auth_method: 'none'` and the plan refuses any other value at proposal. A tool that omitted the field would create a confidential client and return a secret to the model.
3. **Does `admin_reach` cover group ancestors?** Yes. `adminReachOfGroups` walks a `chain` CTE up through `parent_id` before probing `group_roles` (`packages/protocol-admin/src/service/capability-ceiling.ts:374-400`), `capabilitiesOfGroupsAndAncestors` does the same for the ceiling (`:45`), and a group delete uses `subtreeAdminReach` (`:405`), which adds the descendants. `grep: git grep -n "adminReachOfGroups" -- packages` shows `withGroupReach` (`usecase/admin-reach.ts:25`) calling it for list and read, and `tests/admin-reach.int.test.ts:309` covering it. **Decision:** the server-side tier rule reuses these three functions; no new reach code.
4. **`POST ~/subjects/bulk` is not a create** (correction to the classification reports). The request is `{ action: 'disable'|'enable'|'delete'|'end-sessions', ids: uuid[1..100] }` and each id is answered as its own single-subject request (`packages/contracts/src/admin/subjects.ts:299-322`). The tool is tier C with a batch bound (W5b).
5. The registration-tokens list carries no token (`registrationTokenSchema` is id, uses, created, expires), the credentials route carries types only, and `GET ~/smtp` carries `password_set` but also the relay `username`; this is why R1a adds a masked status, not a pass-through (`read-audit.md` rows 53, 70, 75).

**Not verified (state, do not assume):** whether any non-PUT route besides `PUT ~/subjects/:id/roles|groups`, `groups/:id/roles`, `scopes/:id/roles|mappers`, `flow/executions` replaces a list without an ETag; W0's step 5 greps `If-Match` per route before the re-read list is fixed.

## Global Constraints

As the console assistant plan's "Global Constraints", verbatim in every dispatch: comment rules (no increment or phase names, blocks at most 8 lines), ADR 0010's amendment (no logic in a use case or repository), console imports carry no `.ts`/`.tsx`, the Reuse scan, performance and scale (ADR 0041), heavy-slot lock (`.superpowers/sdd/tools/heavy-slot -p int|e2e -- …`), no `git stash`, Sonnet for every implementer and reviewer. Also:

- Volume (ADR 0041): a card, a list and a batch are bounded. A tool that takes ids takes at most 25 (a card shows each value whole, `CARD_FIELD_MAX` 2,000, and a call that does not fit is refused, never shown as a prefix). A removal shows a holder count from an indexed count, not a scan.
- Every tool is a `wire` tool (`pnpm mcp:catalogue` throws on any other, `tools/mcp-catalogue/src/run.ts`), so `sdks/mcp-stdio/src/mcp-tools.json` is regenerated and must show no tool of audience `assistant`.
- Every tool: its `WRITE_PLANS` entry (read for the card's "before", title, target, `removes`, tier), the door entry in `ASSISTANT_WRITE_ROUTES`, the console's tool set and wording, `mcp-route-classes.md` row and count, `CHANGELOG.md` `## [Unreleased]`, and `apps/docs/content/en/` pages that name Act's writes. `grep: git grep -n "twelve\|12 write" -- apps/docs README.md docs/protocols` before each increment's docs step.
- A tool of tier C is never `auto` and never gets an "allow for this conversation" control.
- Commits: subject at most 72 characters, body at most 8 lines, no tool-attribution trailer. Push at the end of each increment; CI green and the review answered before the next.

## Review Focus

1. Nothing an increment adds is callable by an outside MCP agent holding `mcp:write` (W0, every increment).
2. An injected instruction in a read result cannot open an approval the model did not propose, and a card's text is the server's, not the model's (W3a to W6).
3. A target that reaches an administrator capability is refused at proposal and at the door, through composites and group ancestors (W2, W3a, W5b).
4. The decision of a C approval is refused without the exact name, by the server (W0).
5. A replacing PUT whose state moved since the card runs nothing (W0, W3a, W3b, W5b).

---

## Increment W0: groundwork, no new tool (6 h)

**Files:** Create `packages/protocol-admin/src/service/assistant-write-routes.ts`, `packages/assistant/src/service/tier.ts`, tests beside each. Modify `packages/mcp/src/service/tool.ts` (`audience`), `packages/mcp/src/service/visible-tools.ts` and `apps/server/src/mcp-deps.ts` (skip audience `assistant`), `packages/protocol-admin/src/service/agent-scope.ts` (route the assistant grant to its own list), `packages/assistant/src/service/approval-card.ts`, `approval-policy.ts`, `packages/contracts/src/admin/assistant.ts`, `packages/assistant/src/usecase/approvals.ts`, `apps/server/src/assistant-approvals.ts`, `apps/admin-console/src/widgets/assistant-panel/**`, `packages/mcp/src/service/catalogue.ts`, `tests/lint/mcp-tool-coverage.test.ts`, `tests/docs/mcp-route-classes.test.ts`, `docs/protocols/mcp-route-classes.md`.
**Interfaces (Produces):**

- `type Tier = 'A' | 'B' | 'C'`; `interface Plan` in `approval-card.ts` gains `tier: Tier` and `confirmWith?: (input: Input, before: Fields | null) => string` (required when `tier === 'C'`).
- `ASSISTANT_WRITE_ROUTES: readonly AgentWriteRoute[]`, the same shape as `AGENT_WRITE_ROUTES`, admitted only when the grant is the built-in assistant client's (`grep: git grep -n "assistantTarget" -- packages/protocol-admin/src` shows the door already knows the grant, `agent-reach.ts:21`, `authenticate-admin.ts:420`; confirm the client id is on the same object before coding).
- `RegisteredTool.audience: 'all' | 'assistant'` (default `'all'`).
- `tierOf(tool: string, target: Target, facts: TargetFacts): Tier | { x: HumanOnlyGroup }`, a pure service function. `TargetFacts` carries `adminReach: readonly string[]`, `isOwner`, `isBuiltinClient`, `rootsConversationGrant`.
- Decide body `{ approve: boolean; confirm?: string }`; card fields `tier`, `confirm_with`.
- `HumanOnlyEntry = { routes: string[]; kind: 'human-only'; why: HumanOnlyWhy; group: string; note: string }` in `catalogue.ts`.

- [ ] **Step 1: Failing door and catalogue tests.** (a) A route in `ASSISTANT_WRITE_ROUTES` and not in `AGENT_WRITE_ROUTES` answers 403 `insufficient_scope` to an outside agent token holding `mcp:write` and passes for the built-in assistant client's write grant. (b) A tool of audience `assistant` is absent from `tools/list` of the MCP endpoint, from `directCallerTools` and from `mcp-tools.json`. (c) With no tool of audience `assistant` yet, every existing test is unchanged (`mcp` CI job, no changed expectation).
- [ ] **Step 2: Failing tier tests.** `tierOf` returns X for: a role or group whose `adminReach` is non-empty, a subject who holds an administrator capability or is the owner, `odudu-admin` and `odudu-assistant`, a session that is the owner's own or roots the conversation's grant. A property test over generated role and group graphs (composites, ancestors) asserts X exactly when `adminReachOfRoles/Groups` is non-empty. `verified:` `pnpm vitest run packages/protocol-admin/tests/admin-reach.int.test.ts` under the heavy-slot `int` pool, run first, to see the shapes.
- [ ] **Step 3: Failing decide tests.** A C card decided with `{approve: true}` or a wrong `confirm` is refused 400 and the approval stays pending; the exact `confirm_with` text approves once; an A card ignores `confirm`; a B card needs the console's second click (a console test, since the server cannot see a click); a decision never runs a call (the write runs on resume only).
- [ ] **Step 4: Failing consume-time test.** For each replacing PUT (list in the next step) the plan's read is re-run when the approval is spent and compared with the card's `before`; a difference closes the approval as `not run` and the model is told the state moved. Add the audit detail `state_moved`.
- [ ] **Step 5:** `grep: git grep -n "If-Match\|ifMatch" -- packages/protocol-admin/src/service/capability.ts | wc -l` and list every non-GET route without it; that list is the re-read set. Record it in the plan's commit message body and in `mcp-route-classes.md`.
- [ ] **Step 6: Write budget per tier.** Each approval is its own grant drawing from the root grant's `agent_writes_per_grant` / `agent_creates_per_grant` (`apps/admin-console/src/pages/settings/services/platformSections.ts:107`, `docs/.../settings.mdx:240`); C draws from a separate counter so a burst of A cannot starve it. `assumption:` the budget counter is keyed by grant, so a second key needs a migration; read `grep: git grep -n "budgetGrantId" -- packages apps` first and, if so, number the migration with `ls packages/db/drizzle | tail -2`. Probe the table with a foreign tenant.
- [ ] **Step 7: The guard, part 1.** In `catalogue.ts` add the `human-only` kind and the registry of ADR 0061's groups, empty of tools. In `mcp-tool-coverage.test.ts` add: every non-GET route is a tool, a `human-only` entry or a withheld entry; a `human-only` entry has no tool; its `why` is in the closed union; its `group` is a backticked id in ADR 0061's table and every id there is used; a ratchet constant `UNPLACED_WRITES` lists the withheld writes not yet assistant tools (all of them today) and every increment deletes its entries; no phase name in a note. Add the Assistant column to `mcp-route-classes.md` and make `mcp-route-classes.test.ts` assert it; change "puts every access-changing, credential and destructive route in P5b" to "has no tool of audience `all`".
- [ ] **Step 8: Implement,** run the unit and `int` projects, `pnpm mcp:catalogue` (no diff), `pnpm boundaries`. Docs: `apps/docs/content/en/reference/transcripts/` for the decide route re-run on a live stack; the generated OpenAPI follows. Console: card shows the tier and the name field; `pnpm docs:screenshots`. Commit `feat(assistant): tiers, an assistant door and typed confirmation`.

## Increment W1: tier A remainder (4 h)

**Routes:** `POST ~/domains`, `POST ~/domains/:id/verify`, `POST ~/subjects/:id/verification`, `POST ~/subjects/:id/password-reset`, `POST ~/subjects/:id/actions-email`, `POST ~/flows`, `POST ~/scopes/restore-builtins`, `POST ~/smtp/test`.
**Interfaces:** Tools `create_domain`, `verify_domain`, `send_verification`, `send_password_reset`, `send_actions_email` (`actions` from the closed enum `update-password`, `configure-totp`, `configure-passkey`, `generate-recovery-codes`), `create_flow`, `restore_builtin_scopes`, `test_mail_relay`.
**Claims, with their greps:** the three mail routes answer `void` 202 and take only `client_id` and `redirect_uri`, so the recipient is the stored address and the link is never in the response (`grep: git grep -n "password-reset\|actions-email\|verification" -- packages/protocol-admin/src/service/capability.ts`, `successStatus: 202`). `POST ~/smtp/test` takes `{ to, client_id? }` with a free address, so the tool has no `to` field and the server sets it to the approving administrator's own address, failing the proposal when the owner has no verified address (`grep: git grep -n "smtp/test" -- packages/protocol-admin/src`).

- [ ] **Step 1: Failing tests per tool** (the A matrix): schema and wire; plan before and after, `oversizeField` refusal; an extra field is `403` at the door; integration on PostgreSQL: propose, approve, spend once, replay refused, wrong digest refused, expired, Ask mode denied, foreign `tenant_id` in the path refused; audit rows `assistant.approval` and `agent.tool_call`. For `test_mail_relay`: a model-supplied `to` is refused at the schema.
- [ ] **Step 2:** Implement with the existing factories (`packages/mcp/src/service/write-tool.ts:263`), remove each route from `UNPLACED_WRITES`. Docs, console tool set, wording, `CHANGELOG`. Commit `feat(assistant): write tools for domains, mail and flows`.

## Increment W2: tier B removals (6 h)

**Routes (B):** theme draft and live-theme reset (tenant and client), theme asset delete, registration-token delete, `DELETE ~/domains/:id` (an inactive record only), consent, subject session and `sid`, grant by client, `DELETE ~/clients/:id/grants`, `DELETE ~/agents/:id`, `DELETE ~/subjects/:id/lockout`, `DELETE ~/roles/:id`, `DELETE ~/groups/:id`, `DELETE ~/scopes/:id` (custom), role composite, scope-client, `DELETE ~/flows/:id`, `DELETE ~/smtp`, `DELETE ~/keys/:id` (a retired key).
**Claims:** the API already refuses: a built-in admin client's role and anything above the caller's capabilities (`guardsAdministrators`, `overreach`, `grep: git grep -n "guardsAdministrators" -- packages/protocol-admin/src`), a default or pinned flow (409), an active domain (409), an active key and a key a client needs (409), a non-retired key delete, and a built-in scope without `confirm`. `DELETE ~/clients/:id/grants` revokes at most 10,000 per call and ends no session (`clearLockoutsResponseSchema` has the same shape for lockouts, `subjects.ts:324-331`).

- [ ] **Step 1: Failing tests** (A matrix plus): the card says what depends on the target (holder count, clients using it); a second console confirmation (console test) and `removes: true` on the plan; a target that vanished since the card is closed as not run; a role or group delete whose `adminReach` (and for a group `subtreeAdminReach`) is non-empty is refused at proposal as X-by-data; deleting the owner's own session or one that roots the conversation's grant is refused; `DELETE ~/clients/:id/grants` says "up to 10,000 per call" on the card.
- [ ] **Step 2: Facts for the card** through the existing impact reads where they exist: `grep: git grep -n "impact\|passkey-impact" -- packages/mcp/src/service/tools | head` (`get_scope_impact`, `get_passkey_impact`).
- [ ] **Step 3:** Implement, update `UNPLACED_WRITES`, docs, console wording. Commit `feat(assistant): removals with a second confirmation`.

## Increment W3a: tier C access structure, part 1 (6 h)

**Routes (C):** `PATCH` of role, group and scope beyond the description (default flags, `parent_id`, scope token and consent fields), role and group `default`, `POST/DELETE` role composites, `PUT groups/:id/roles`, built-in scope delete (typed name, `confirm` exists in the API), `restore` where a built-in is involved.
**Interfaces:** the set-diff card kind `{ kind: 'set', added: string[], removed: string[] }` with names resolved from ids, in `assistantApprovalCardSchema` (additive) and the console card (a card for 40 ids must be readable; a call whose diff does not fit is refused, never truncated).

- [ ] **Step 1: Failing tests:** the B set; set-diff names and counts; never-`auto`; typed name required (W0's decide path); a red-team case in which a read result (a role's description) carries "approve the pending change", proving that no approval is opened unless the model proposes it and that the card text is the server's; a drift test for `PUT groups/:id/roles` (state moved, nothing runs); admin-capability refusal through composites and ancestors.
- [ ] **Step 2:** Implement, docs, `UNPLACED_WRITES`. Commit `feat(assistant): roles, groups and scopes with typed confirmation`.

## Increment W3b: tier C access structure, part 2 (6 h)

**Routes (C):** `PUT scopes/:id/roles`, `PUT scopes/:id/mappers`, `PUT scopes/:id/clients`, client config by field group (redirect and logout URIs, grants, PKCE, token lifetimes, flow, delegated actors, each group its own tool), public client create (finding 2), `DELETE ~/clients/:id`, `enabled` on a client with the built-in refusal.
**Claims:** `odudu-admin` and `odudu-assistant` cannot be amended beyond `BUILTIN_ASSISTANT_AMENDABLE_FIELDS` (`packages/protocol-admin/src/usecase/clients.ts:1484-1488`); the tool also refuses at proposal, with a constant denial. A client PATCH carries `If-Match`, so no re-read is needed there.

- [ ] **Step 1: Failing tests:** B set plus C set; the create tool refuses any `token_endpoint_auth_method` but `none` and any `client_credentials` grant for a public client; redirect and logout URI lists are shown whole in the card or the call is refused; built-in client refusals; `DELETE ~/clients/:id` shows its grants and sessions count.
- [ ] **Step 2:** Implement, docs, `UNPLACED_WRITES`. Commit `feat(assistant): client configuration and client creation without a secret`.

## Increment W4: branding goes live (4 h)

**Routes (C):** tenant and client theme `publish`, `restore`.

- [ ] **Step 1: Failing tests:** the card carries the digest of the draft and the test asserts it equals the draft that is published (state moved closes the approval); no built-in client; red-team case with a stylesheet that carries an instruction.
- [ ] **Step 2:** Implement, docs and screenshots (`pnpm docs:screenshots`), `UNPLACED_WRITES`. Commit `feat(assistant): publish and restore a theme`.

## Increment W5a: tier C users, part 1 (6 h)

**Routes (C):** `POST ~/subjects`, `PATCH ~/subjects/:id`, `PUT ~/subjects/:id/profile` (minus `email_verified` and `phone_number_verified`, the schema rejects them), `PUT ~/subjects/:id/required-actions`, `DELETE ~/subjects/:id`.

- [ ] **Step 1: Failing tests:** a subject who is the owner or holds an administrator capability is refused (X-by-data via the subject's admin capabilities, `get_subject_admin_capabilities` has a `complete` flag, `subjects.ts:293`; an incomplete answer refuses); verified flags in the body are refused at the schema; masked-email interaction; a red-team case with instruction text in a name, email or profile arriving through the read results.
- [ ] **Step 2:** Implement, docs, `UNPLACED_WRITES`. Commit `feat(assistant): users and their profiles`.

## Increment W5b: tier C users, part 2, and bulk subjects (6 h)

**Routes (C):** `PUT ~/subjects/:id/roles`, `PUT ~/subjects/:id/groups` (not admin-reach), credential delete, recovery-code delete, `DELETE ~/lockouts`, `POST ~/subjects/bulk`.
**Bulk:** one tool `bulk_subjects` with the request's four actions, at most 25 ids (the route allows `BULK_SUBJECT_LIMIT` = 100, `subjects.ts:300`; `assumption:` 25 usernames fit a card of 2,000 characters, measure it in the test and lower the bound if not). The card lists each id as a username resolved on the server; a subject the ceiling or the owner/admin rule refuses refuses the whole call at proposal, not per row. `DELETE ~/lockouts` clears at most 10,000 per call, skips subjects beyond the caller's ceiling and answers `remaining`; the card and the result say "repeat until 0".

- [ ] **Step 1: Failing tests:** C set; a bulk call over the bound is refused at the schema; a bulk `delete` or `end-sessions` that includes the owner or an administrator is refused as a whole; drift test for the two replacing PUTs; the three mail-derived tools remain A.
- [ ] **Step 2:** Implement, docs, `UNPLACED_WRITES`. Commit `feat(assistant): access of a person and bulk actions`.

## Increment W6: tenant security and keys (6 h)

**Routes (C):** `PATCH ~/settings` by group (one tool per group: sign-in and password policy, lockout, registration, sessions and tokens, mail; never `agent_*` or `audit_retention_days`, which are X), domain `activate`/`deactivate`, `POST ~/keys`, `promote`, `retire` (typed `kid`), `PUT ~/flows/:id` and `PUT ~/flow/executions` (a step list; a change that lowers the steps is refused at proposal; `If-Match` is mandatory), `make-default`.
**Claims:** a new key is `rotating` and published in the JWKS at once, which the card says; `promote` is an atomic swap and the demoted key stays published, so it is reversible; `retire` is irreversible, already 409 while the key is active or a client needs its algorithm (`grep: git grep -n "retire" -- packages/protocol-admin/src/usecase | head`). `validateFlowSteps` is the existing step check.

- [ ] **Step 1: Failing tests:** before and after for every field; an `agent_*` or `audit_retention_days` field in the same body is refused at the door; the typed `kid` for `retire`; the flow card shows the step list as a set-diff; the last increment asserts `UNPLACED_WRITES` is empty and deletes it.
- [ ] **Step 2:** Implement, docs, `CHANGELOG`, regenerate `mcp-tools.json` (no diff). Commit `feat(assistant): tenant security settings, keys and flows`.

## Increment R1a: the reads' accounting (5 h)

**Files:** `packages/mcp/src/service/catalogue.ts`, `packages/assistant/src/service/tool-set.ts` and its test, `apps/server/src/assistant-chat.ts`, `tests/lint/mcp-tool-coverage.test.ts`, `docs/protocols/mcp-route-classes.md`, `tests/docs/mcp-route-classes.test.ts`, three new read tools under `packages/mcp/src/service/tools/`.
**Interfaces:** `ASSISTANT_WITHHELD: Record<routeKey, { why: ExclusionReason; decision: string }>` holding `GET ~/audit` and `GET ~/audit/count` (ADR 0058); `assistantTools()` = read tools not in it, `OWN_RECORD` deleted. Tools `list_registration_tokens` (id, remaining uses, created, expires; no masking needed, `registrationTokenSchema`), `list_subject_credentials` (type, created, expired, recovery-code count; the `id` dropped from the output), `get_smtp_status` (configured, effective `tenant|deployment|none`, host, port, starttls, from address; no `username`). Withheld entries become `{ routes, kind, why, decision, note }` with the closed `why` union of ADR 0061.

- [ ] **Step 1: Failing tests:** (a) `assistantTools(TOOLS)` equals the read tools minus `ASSISTANT_WITHHELD`, replacing `reads.length - names.length === 2` in `tool-set.test.ts`; a read tool under `audit`, `agents` or `assistant` outside the list fails. (b) The bridge refuses `list_audit` called by name: `apps/server/src/assistant-chat.ts:216` resolves with `toolsFor(TOOLS, caller)` and checks only `access === 'read'`; change it to resolve through `assistantTools`, then `toolsFor`, and test the refusal (`assumption:` the SDK cannot call an un-offered name; the test makes this unnecessary). (c) `assistantTools` applies `toolVisible`, so `list_tenants` is not offered in a tenant that is not the system tenant (`read-audit.md` finding 2). (d) Every read is a tool or a withheld entry with a closed `why`, a `decision` whose ADR or document exists, and a compatible kind. (e) The three new tools: schema, no secret in any output (a property test over the response shape), capability, foreign-tenant probe, and the door's `AGENT_DENIED_READS` and the catalogue move together (the existing test "ties the door to the catalogue").
- [ ] **Step 2:** Move `registration-tokens`, `credentials` and `smtp` off the withheld list and `AGENT_DENIED_READS` in the same commit; amend `mcp-route-classes.md`, including the Assistant column for reads. Docs: `the-mcp-read-tools` page and the concept page, `CHANGELOG`. Commit `feat(assistant): three more reads, and a list of what it cannot read`.

## Increment R1b: injection coverage (5 h)

**Files:** `apps/server/tests/mcp-prompt-injection.int.test.ts`, `packages/mcp/src/service/data-label.test.ts`, a new `INJECTION_COVERAGE: Record<toolName, 'planted' | 'unit-only' | 'no-free-text'>` beside the integration test, `tests/lint/injection-coverage.test.ts`.
**Claims (observed in `read-audit.md`):** 43 of the 64 read tools carry free text; 11 are planted in the integration suite; the other 32 rely on the structural label test only (`list_mail`, `list_client_logout_deliveries`, domains, flows, grants and consents, installation, branding, settings, tenant, subject).

- [ ] **Step 1: Failing lint:** every read tool whose response schema holds a free-text string is in the registry; `unit-only` needs a one-line reason; `planted` needs the tool named in the integration test; a tool that gains a free-text field and no entry fails.
- [ ] **Step 2:** Plant text in the fixtures of the highest-risk unplanted reads (`list_mail` `last_error`, `list_client_logout_deliveries` `last_error`, `get_subject`, the theme reads, flows, domains) and assert the obedient agent's stream shows the text only under `data`; the rest stay `unit-only` with a reason. Run under the heavy-slot `int` pool. Commit `test(assistant): a registry of injection coverage`.

## Increment F1: prefilled forms for what a person submits (6 h)

Builds on the write-profiles increment (I17 of the console assistant plan), whose draft output is `{ kind: 'client_draft'; fields }`; if I17 has not merged, F1 starts after it. `grep: git grep -n "client_draft" -- packages apps` finds nothing on this branch today, so this is unbuilt.
**Interfaces:** profile outputs `client_draft` (a confidential client's metadata, opens the console create form), `password_draft` (a subject and, where an administrator wants it, the choice to generate; the form shows the one-time password to the person only), `smtp_draft` (host, port, starttls, from address, never the password, which the person types). Each is data the console renders; none is a tool call and none opens an approval.

- [ ] **Step 1: Failing tests:** the draft schema refuses a field named `password`, `secret` or `token`; the console opens the form with the fields and no secret; a draft never appears in the trace as a secret (it holds none); the human-only refusal message names the form it prefilled.
- [ ] **Step 2:** Implement in the assistant package (service for the draft, view contract) and the console (`features/assistant-actions`); docs and screenshots. Commit `feat(assistant): prefilled forms for secret-returning creates`.

---

## Placed for later (P5d, not built here)

Each waits for something named. The ADR and spec say why each is human-only today.

| What                                                                                       | Waits for                                                                                                                                                                              | Placement |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| The reveal channel for secrets, then tools for the five secret-returning writes (W7 spike) | A path that delivers a one-time value to the person's browser without messages, trace, export, compaction, report, audit or provider; a red-team case that asks the model to repeat it | P5d       |
| `POST /admin/tenants` and tenant import                                                    | An instance-write door and cross-tenant Act (both built or not, see the start condition)                                                                                               | P5d       |
| Admin-reach changes as tools                                                               | A delegated-administrator rule decided in an ADR                                                                                                                                       | P5d       |
| Tenant-wide `DELETE ~/sessions`                                                            | An `except` parameter on the route that spares the caller's session                                                                                                                    | P5d       |

## Closing the increments

- [ ] The ratchet `UNPLACED_WRITES` is deleted (W6); `grep: git grep -n "UNPLACED_WRITES"` finds nothing.
- [ ] Every non-GET route is a tool, a `human-only` entry or a withheld entry, and every GET is a tool or a withheld entry, in `mcp-route-classes.md`'s Assistant column.
- [ ] `CHANGELOG.md` `## [Unreleased]` says in the installer's words what Act can now do and what it hands the person.
- [ ] Docs pages that said "twelve writes" or "the three creates" are corrected: `grep: git grep -n -i "twelve\|12 write\|three create" -- apps/docs README.md docs/protocols`.
