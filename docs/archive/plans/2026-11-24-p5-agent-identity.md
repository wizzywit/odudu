# P5 — Agent identity layer and approvals: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent instances, `may_act` persisted and minted, transitive revocation, depth and budgets as tenant settings, and approvals with CIBA poll mode, end to end.

**Architecture:** A new pure-domain package `@odudu/domain-agents` holds the invariants, the digest and the tables; `@odudu/protocol-oidc` consumes it at stage 4 of the exchange and in `mintAgentToken` and adds CIBA; `@odudu/protocol-admin`, the "me" API and the console expose it. No new grant type beyond CIBA's own; the exchange stays the only thing that makes a grant (ADR 0003).

**Tech Stack:** TypeScript, Fastify, Drizzle and hand-written SQL migrations, PostgreSQL with Testcontainers, Vitest, fast-check 4.11.0 (MIT) for property tests, Stryker, React console.

**Spec:** [P5 spec](../specs/2026-11-24-p5-agent-identity-design.md) at `docs/archive/specs/2026-11-24-p5-agent-identity-design.md`; ADRs 0003, 0050, 0059. Read the spec first: it carries the reasoning; this plan carries the decisions an implementer cannot make alone.

## Global Constraints

- Every implementer and reviewer runs on Sonnet 5.5; ask the owner before any larger model.
- No `any`, no `void doThing()`, imports in the console carry no `.ts`/`.tsx`. Tests precede code. Integration tests use real PostgreSQL via Testcontainers. Every repository method is probed with a foreign `tenant_id` (`expectCrossTenantMethodProbe`, `packages/db/src/tenant-probe.ts:43`). `SET LOCAL`, never `SET`.
- Policies are hand-written SQL in `packages/db/drizzle/`, never `pgPolicy()`; the idiom is `ENABLE` and `FORCE ROW LEVEL SECURITY` plus `CREATE POLICY <t>_isolation ON <t> USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)` (`0137_flows.sql:27-31`). A journal entry per migration in `meta/_journal.json`, `when` +86400000 over the last.
- Defaults, verbatim from the spec: depth 3 (range 1 to 8; 8 is `MAX_DELEGATION_DEPTH`, the structural bound), children 20, live instances 1000, instance TTL 900 s, idle TTL 1800 s, approval TTL 600 s capped at 900 s, writes per grant 20, creates per grant 10 (today's `WRITE_BUDGET`), window writes 1000 (range 1 to 100000). Poll mode only for CIBA.
- `sub` stays the owner; the instance is `act.sub` (ADR 0050).
- Comments carry only what code cannot say and never name a task or phase. No comment block over 8 lines. A user-facing string is a catalogue entry (`messages.ts`), never a literal in a `*-html.ts`.
- Commit messages: subject at most 72 characters, body at most 8 lines, no tool-attribution trailer. Pull request bodies likewise carry none.
- A plan-level claim about third-party behaviour is `verified:` or `assumption:`; the assumptions are in the spec's section 13 and Task 1's spike list.
- Increment workflow (CLAUDE.md): the phase branch is `p5-agent-identity`; open a draft pull request with the first push; push at the end of each increment, then `gh pr checks <pr> --watch`, fix red, and answer every review thread (valid, wrong on the facts, right risk wrong fix, or out of scope with a `docs/NEXT.md` row) before the next increment. Never `git stash`. Heavy jobs go through the heavy-slot lock.
- Check `git log origin/<branch>..HEAD` for other agents' commits before every push.

## Review Focus

1. Two callers mint children of one parent at once at `agent_max_children - 1`: exactly one succeeds (Task 4, Task 9).
2. `login_hint` for an unknown person returns the same body, status and timing class as a known one (Task 11).
3. Approve and deny arrive together for one approval: one wins, the other is refused, the row is never both (Task 10).
4. The owner's session ends or the owner is disabled while an instance is live: the next token is refused and the instance is revoked (Task 6).
5. A reaped instance is still named in an old grant's `act_chain`: introspection and audit reads of that grant do not fail (Task 8).

---

## Increment 1: placement and decisions

### Task 1: Place P5 and P5c, accept the ADRs, list the spikes

**Files:**

- Modify: `docs/superpowers/specs/2026-09-10-odudu-design.md` (section 11 rows near line 449; section 9 and ADR 0003 amendments), `apps/docs/content/en/roadmap.md` (line 99 and the "Later" list), `docs/NEXT.md` ("Start here", "What P5 inherits", add "What P5c inherits"), `docs/adr/0003-hybrid-agent-model.md`, `docs/adr/0055`–`0059` (status to Accepted), `docs/adr/README.md` if it indexes.
- Test: `tests/docs/roadmap-section-11.test.ts`, `phase-references.test.ts`, `next-budget.test.ts`, `not-implemented-placement.test.ts` (run, do not edit unless a new mapping is required).
- Create: `docs/phases/p5-spikes.md`.

**Interfaces:** Produces the phase names P5 (this plan), P5c, P5b, in the order P5, P5c, P5b, which later tasks and the roadmap use.

- [ ] **Step 1:** Split the P5 row of section 11 into P5 (criteria of spec section 8) and a new P5c row (spec P5c section 8); P5b's row now cites P5's approvals and P5c. Mirror both in `roadmap.md` under "Next" with phase tags, and in `docs/NEXT.md`.
- [ ] **Step 2:** Add dated amendments to ADR 0003 and umbrella section 9: the instance is `act.sub`, never `sub`; set ADRs 0055 to 0059 to `Accepted · 2026-11-24`.
- [ ] **Step 3:** Run `pnpm vitest run --project unit tests/docs/roadmap-section-11.test.ts tests/docs/phase-references.test.ts tests/docs/next-budget.test.ts tests/docs/not-implemented-placement.test.ts`; fix mappings until green. Run `git grep -n -E '\bP5\b' -- ':!docs/archive'` and make each hit say the same thing.
- [ ] **Step 4:** In `docs/phases/p5-spikes.md` record the three assumptions of spec section 13 as commands to run and the result field each task cites: OIDF CIBA poll plan in the `conformance` job; `subjects` accepting an `agent_instance` row with no credentials (grep the CHECKs and `type` readers); the recursive-CTE plan under row-level security with `EXPLAIN` on the `query-plans` fixture. Run the second now and write the answer in; the other two are run in Tasks 7 and 16.
- [ ] **Step 5:** Commit `docs: place P5 and P5c, accept ADRs 0055-0059`; push; open the draft PR for the phase branch.

---

## Increment 2: the invariants, with no database

### Task 2: `@odudu/domain-agents` package and the invariant service

**Files:**

- Create: `packages/domain-agents/{package.json,tsconfig.json,stryker.config.json}`, `packages/domain-agents/src/index.ts`, `src/service/admit-child.ts`, `src/service/admit-child.test.ts`, `src/service/admit-child.property.test.ts`, `src/service/defaults.ts`.
- Modify: root `package.json` (script `"mutate:agents": "stryker run packages/domain-agents/stryker.config.json"`), `.dependency-cruiser.cjs` only if a new package needs registering (copy how `domain-audit` is covered).

**Interfaces:**

- Produces, from `@odudu/domain-agents`:
  - `interface AgentNode { readonly scope: readonly string[]; readonly expiresAt: Date; readonly depth: number; readonly liveChildren: number }`
  - `interface ChildRequest { readonly scope: readonly string[]; readonly expiresAt: Date }`
  - `interface AgentLimits { readonly maxDepth: number; readonly maxChildren: number; readonly sessionEndsAt: Date }`
  - `type Invariant = 'scope_widened' | 'ttl_exceeds_parent' | 'ttl_exceeds_session' | 'depth_exceeded' | 'fanout_exceeded'`
  - `admitChild(parent: AgentNode, request: ChildRequest, limits: AgentLimits): { kind: 'ok'; node: AgentNode } | { kind: 'refused'; invariant: Invariant }` (a grant is passed as a depth-0 `parent`)
  - `AGENT_DEFAULTS` (the values in Global Constraints) and `STRUCTURAL_MAX_DEPTH = 8`.

- [ ] **Step 1:** Copy `packages/domain-audit`'s `package.json`/`tsconfig.json` shape (name `@odudu/domain-agents`, license `AGPL-3.0-only`, deps `@odudu/kernel`, `drizzle-orm`; devDeps `@odudu/testkit`, `vitest`, `fast-check` at exact `4.11.0`; `verified: npm view fast-check version license` gave 4.11.0 MIT). Copy `packages/crypto/stryker.config.json`, pointing at this package. Run `pnpm install`.
- [ ] **Step 2: Failing tests** in `admit-child.test.ts`: refuses `'scope_widened'` for a scope not a subset; `'ttl_exceeds_parent'`; `'ttl_exceeds_session'` when the child outlives `limits.sessionEndsAt` even if inside the parent; `'depth_exceeded'` at `parent.depth + 1 > maxDepth`; `'fanout_exceeded'` at `liveChildren >= maxChildren`; admits and returns `depth = parent.depth + 1`, the requested scope and `expiresAt`.
- [ ] **Step 3: Property tests** in `admit-child.property.test.ts` (fast-check): for random chains of 1 to 12 requests built by folding `admitChild`, every accepted chain has non-widening scope, non-increasing expiry never past `sessionEndsAt`, and depth at most `maxDepth`; every refusal names the invariant a direct check shows was broken. Run `pnpm --filter @odudu/domain-agents test`: FAIL (module missing).
- [ ] **Step 4:** Implement `admitChild`, pure, no I/O; check order scope, ttl parent, ttl session, depth, fanout (the order the tests fix). Run the tests: PASS. Run `pnpm mutate:agents` once and record the surviving-mutant count in the commit message body; do not add it to `verify`.
- [ ] **Step 5:** `pnpm verify` green; commit `feat(agents): invariant service with property tests`.

---

## Increment 3: vocabulary, schema and repositories

### Task 3: Withdrawn, folded into the tasks that write the events

`tests/lint/audit-vocabulary-coverage.test.ts` fails the build for any action in `AUDIT_ACTIONS` that no production source writes (no allowlist), so the vocabulary cannot land ahead of its writers. A first attempt (commit `069bd5fcb`, reverted by the next commit on the branch) added all eleven actions at once and was red; it is the reference for the plumbing described below.

**Rule for every task that emits an event:** in the same commit as the writer, add the action to `AUDIT_ACTIONS` under the new event type `agent_identity`, its typed event member (near `vocabulary.ts:128`), its `ACTION_DETAIL_KEYS` entry (line 302, and `STRING_DETAIL_KEYS` at 339 for a new string key), its one-paragraph description in `vocabulary-docs.ts`, and a test that the writer records it. The first task to add an action also registers the event type, and `git show 069bd5fcb` lists every place that needs: the wire `event_type` enum in `packages/contracts/src/admin/audit.ts`, the console filter `apps/admin-console/src/pages/audit/services/filterOptions.ts`, `ALWAYS_STORED` in `packages/domain-audit/src/repository/audit.ts` (so the tenant's event-type list and its CHECK stay at six and agent events cannot be switched off), `audit-event-type-parity.test.ts`, `sdks/mcp-stdio/src/mcp-tools.json` (regenerate with `pnpm mcp:catalogue`) and the two audit transcripts under `apps/docs/content/en/reference/transcripts/admin-paths/` (derived from the test; re-run on a live stack in Task 16). Detail keys, all snake_case and no free text: `agent_client`, `owner`, `instance`, `approval` (UUID strings), `depth`, `count` (integers at least 0), `state` (approved or denied), `via` (owner, admin, cascade, reaper), plus `reason` (a closed list; add reasons for `ciba.poll_refused` when it is written).

Which task writes which action: Task 6 `agent.instance_minted`; Task 8 `agent.instance_revoked`, `agent.instance_expired`, `agent.approval_expired`; Task 10 `agent.approval_requested`, `agent.approval_decided`; Task 11 `ciba.requested`, `ciba.poll_refused`, `ciba.token_issued`; Task 14 `agent.delegation_created`, `agent.delegation_revoked`.

### Task 4: Tables, migrations and repositories

**Files:**

- Create: `packages/domain-agents/src/schema/{agent-instances,agent-delegations,agent-approvals,agent-budget-windows}.ts`, `src/repository/{instances,delegations,approvals}.ts`, `packages/db/drizzle/0141_agent_identity.sql` (confirm the next free number first: `ls packages/db/drizzle | tail -2`), journal entry; tests `packages/domain-agents/tests/{instances,approvals,delegations}.int.test.ts`.
- Modify: `packages/domain-agents/src/index.ts`, `packages/protocol-oidc/src/schema/token-grants.ts` (add `mayAct: jsonb('may_act')`) and `NewTokenGrant`/`TokenGrantRecord` in `repository/grants.ts`; `packages/protocol-oidc/src/schema/client-oidc-config.ts` (add `agentType: boolean('agent_type').notNull().default(false)`).
- Test: `packages/db/tests/schema-drift.int.test.ts` (must stay green).

**Interfaces (Produces):**

- Tables, all tenant-scoped with the isolation policy above: `agent_instances(tenant_id, id, owner_subject_id, agent_client_id, parent_instance_id, root_grant_id, depth smallint, scope text, expires_at, idle_expires_at null, revoked_at null, created_at)` with `id` also a `subjects` row of type `agent_instance`, composite FKs to `subjects` and `token_grants` on `(tenant_id, id)`, indexes on `(tenant_id, owner_subject_id) WHERE revoked_at IS NULL`, `(tenant_id, parent_instance_id)`, `(root_grant_id)`, `(expires_at)`; `agent_delegations(tenant_id, id, subject_id, client_id, actor_client_id, scope_ceiling, expires_at, revoked_at, created_at)`; `agent_approvals(tenant_id, id, subject_id, requesting_client_id, instance_id null, kind, summary, action_digest, state, decided_at null, decided_via null, expires_at, created_at)` with a CHECK on `state in ('pending','approved','denied','expired','consumed')`; `agent_budget_windows(tenant_id, owner_subject_id, agent_client_id, window_start, writes smallint, PRIMARY KEY (tenant_id, owner_subject_id, agent_client_id, window_start))`; `token_grants.may_act jsonb`; `client_oidc_config.agent_type boolean` and `client_oidc_config.delegated_actors text[] NOT NULL DEFAULT '{}'` (client ids allowed to act for subjects who use this client; the operator-configured source of `may_act`).
- `agentInstanceRepository(tx: TenantScopedDatabase)`: `mint(input: NewAgentInstance): Promise<AgentInstanceRecord>`, `byId(id)`, `liveChildren(parentId): Promise<number>`, `liveCount(): Promise<number>`, `touch(id, now, idleSeconds, sessionEndsAt): Promise<boolean>`, `revoke(id, at): Promise<number>`, `expireDue(now, tombstoneBefore): Promise<{ expired: number; deleted: number }>`.
- `agentApprovalRepository(tx)`: `create(input)`, `byId(id)`, `decide(id, state: 'approved'|'denied', via: 'ciba_page'|'console', now): Promise<boolean>` (one conditional `UPDATE … WHERE state = 'pending' AND expires_at > now RETURNING`), `consume(id, digest, now): Promise<boolean>` (`approved → consumed` only when the digest equals), `pendingCount(subjectId): Promise<number>`, `expireDue(now)`.
- `agentDelegationRepository(tx)`: `create`, `revoke(id, at)`, `activeFor(subjectId, clientId, now): Promise<AgentDelegationRecord[]>`, `list(subjectId)`.

- [ ] **Step 1: Failing int tests**: each method works on its happy path; every method returns nothing or refuses for a foreign tenant (`expectCrossTenantMethodProbe`); `decide` called twice concurrently with `approved` and `denied` yields exactly one `true`; `consume` with a different digest returns `false`; `mint` refuses a duplicate id.
- [ ] **Step 2:** Run them: FAIL. **Step 3:** write the SQL migration, Drizzle schema, repositories. **Step 4:** run the int project for the package and `packages/db/tests/schema-drift.int.test.ts`: PASS.
- [ ] **Step 5:** commit `feat(agents): tables, policies and repositories`.

### Task 5: Tenant settings and the `agent_type` client field, end to end

**Files:**

- Modify: `packages/db/src/schema/tenants.ts` (columns `agent_max_delegation_depth`, `agent_max_children`, `agent_max_live_instances`, `agent_instance_ttl_seconds`, `agent_instance_idle_seconds`, `agent_approval_ttl_seconds`, `agent_writes_per_grant`, `agent_creates_per_grant`, `agent_window_writes`, each `NOT NULL` with the spec default and a CHECK range) with migration `0142_agent_settings.sql`; `packages/domain-tenant/src/service/tenant-settings.ts` (the name-to-column map, line 49 pattern); `packages/contracts/src/admin/settings.ts` (ranges beside line 41: depth 1 to 8, children 1 to 200, live 1 to 100000, ttl and idle 60 to 86400, approval 60 to 900, writes and creates 1 to 1000, window writes 1 to 100000) and `docs.ts`, `tenant-document.ts`; `apps/admin-console/src/pages/settings/services/accessSections.ts` plus the fixtures `apps/admin-console/src/entities/tenant/adapter/fixtures/settings.json` and `src/testing/settingsFixtures.ts`; `apps/docs/content/en/admin-console/settings.mdx`; and for `agent_type` and `delegated_actors` (a list of client ids, each of which must exist in the tenant, at most 20): `packages/contracts/src/admin/clients.ts` (lines 59-61 pattern), `tenant-document.ts` (227-231 pattern), `docs.ts`, `packages/protocol-admin/src/usecase/clients.ts` (wire mapping 844-846, patch field list 1090-1108, 1245-1255), `service/audit-detail.ts:20-22`, `usecase/tenant-export.ts:446`, `tenant-import.ts:210`, console `AdvancedTab.tsx:247`, `useClientAdvanced.ts:207`, `useClientConfigSaves.ts:76,157`, `adapter/clients.ts:116`, `entities/client/types/client.ts:43`.
- Test: `packages/domain-tenant/tests/tenant-setting-checks.int.test.ts` (ranges agree with CHECKs), `tests/docs/config-defaults.test.ts`, `admin-paths.test.ts`, console area tests.

**Interfaces:** Produces `readAgentSettings(tx, tenantId): Promise<AgentSettings>` in `@odudu/domain-tenant` where `AgentSettings` has the nine fields above in camelCase, and `ClientRecord.agentType: boolean`.

- [ ] **Step 1: Failing tests:** settings PATCH accepts in-range values and refuses `agent_max_delegation_depth: 9`; the tenant-setting-checks test covers every new column; a client PATCH sets and returns `agent_type`; export then import round-trips both; the console shows the fields (component tests beside the existing settings and advanced-tab tests). **Step 2:** run: FAIL. **Step 3:** implement across the files above. **Step 4:** run the unit and integration projects for the touched packages and `pnpm docs:screenshots` only when Task 15 lands. PASS. **Step 5:** commit `feat(admin): agent settings and the agent_type client field`.

- [ ] **Step 6 (increment close):** `pnpm verify`; push; `gh pr checks --watch`; answer reviews.

---

## Increment 4: exchange and in-process minting

### Task 6: `may_act` minted, persisted and read; instance minted at stage 4

**Files:**

- Modify: `packages/protocol-oidc/src/usecase/token-issuance.ts` (`issueExchangedTokens`, line 1088; hook between `mayActPermits` at 1169 and `attenuateScope` near 1179; grant creation near 1238-1251 and 1355-1357), `usecase/token-exchange-subject.ts` (line 143: read `grant.mayAct`), `service/token-exchange.ts` (`buildActChain` reads the tenant depth setting instead of `MAX_DELEGATION_DEPTH`; the constant stays as the structural bound), `usecase/authorization-request.ts` (where the owner's access token is minted: add `may_act`), `usecase/refresh-rotation.ts` (reapply `may_act`).
- Create: `packages/protocol-oidc/src/usecase/agent-layer.ts` (stage 4 facade), `agent-layer.test.ts`; int tests `packages/protocol-oidc/tests/agent-exchange.int.test.ts`, `may-act-refresh.int.test.ts`.

**Interfaces:**

- Consumes: `admitChild`, repositories (Task 4), `readAgentSettings` (Task 5).
- Produces: `async function applyAgentLayer(tx, deps, input: { client: ClientRecord; subject: ResolvedExchangeSubject; actorSubject: string; requestedScope: readonly string[]; now: Date }): Promise<{ kind: 'ok'; actorSub: string; instance: AgentInstanceRecord | null; scope: readonly string[] } | { kind: 'refused'; error: 'invalid_request' | 'invalid_target' | 'access_denied'; invariant: Invariant }>`. For a client with `agentType === false` it returns `{ kind: 'ok', actorSub: actorSubject, instance: null, scope: requestedScope }` unchanged. For an agent type it calls `admitChild`, mints the instance and its `subjects` row, records `agent.instance_minted`, and returns the instance id as `actorSub`.
- `mayActFor(tx, { subjectId, clientId, now }): Promise<{ sub: string; iss: string } | undefined>`: the union of the client's configured actors and the owner's active delegations; with neither it returns `undefined`.

**Audit actions added here:** `agent.instance_minted`, and the event type itself (see Task 3).

- [ ] **Step 1: Failing tests:** (unit) `applyAgentLayer` leaves a non-agent client byte-identical; refuses widening scope, depth beyond the tenant setting, fanout beyond `agent_max_children`; (int) an exchange by an agent-type client returns a token whose `act.sub` is a new instance id and whose `token_grants.act_chain` and `actor_subject_id` match; a nested exchange yields `act.act`; a grant minted with `may_act` persists it and **a refresh-token subject presented to the exchange by a non-permitted actor is refused** (`may-act-refresh`); two concurrent exchanges at `maxChildren - 1` give one success (Review Focus 1).
- [ ] **Step 2:** run: FAIL. **Step 3:** implement. Persist `may_act` on the grant when the owner's grant is created; read it in the refresh branch at `token-exchange-subject.ts:143`; `mayActPermits` is unchanged. Take the parent row `FOR UPDATE` before counting children so fanout is serial.
- [ ] **Step 4:** run unit and `agent-exchange.int.test.ts`, `may-act-refresh.int.test.ts`, the existing `token-exchange.int.test.ts` (no edits to expectations): PASS. **Step 5:** commit `feat(oidc): agent layer at stage 4, may_act persisted`.

### Task 7: Instances for `mintAgentToken`, owner-ended refusal

**Files:**

- Modify: `packages/protocol-oidc/src/usecase/mint-agent-token.ts` (line 66; `act: { sub: client.clientId }` at its end), `mcp` callers only through the existing `MintAgentTokenInput`.
- Test: `packages/protocol-oidc/tests/mint-agent-token-instance.int.test.ts`; the existing `mint-agent-token` tests stay unchanged.

**Interfaces:** `MintAgentTokenInput` gains optional `run?: { key: string; parentInstanceId?: string }`. With `run` and an agent-type client: find or mint the instance for `(grant, run.key)`, extend its idle lifetime with `touch` (never past the session), and put its id in `act.sub`; without `run`, or for a client that is not an agent type, the result is exactly today's. Refusals add `'owner_ended'` when the session or owner is gone, revoking the instance.

- [ ] **Step 1: Failing tests:** non-agent client: token byte-identical to before; agent client with `run`: `act.sub` is the instance, a second call with the same key reuses it, `touch` extends but never past session end; session ended then call: refused `'owner_ended'` and the instance revoked (Review Focus 4); disabled owner likewise. **Step 2:** FAIL. **Step 3:** implement via the facade of Task 6. **Step 4:** PASS, with the MCP suite (`pnpm vitest run --project integration packages/mcp`) green and unedited. **Step 5:** commit `feat(oidc): mintAgentToken names the run's instance`.

- [ ] **Step 6 (increment close):** `pnpm verify`, push, CI, reviews.

---

## Increment 5: revocation, reaping and budgets

### Task 8: Transitive revocation and the reaper passes

**Files:**

- Modify: `packages/protocol-oidc/src/repository/grants.ts` (`revoke` 161, `revokeForSession` 239, `revokeForSessions` 251, `revokeForSubjectClient` 269, `revokeForSubject` 291, `revokeForActor` 303), `apps/server/src/cli/reap.ts` (`TableName` 25-48, the pass table near 297, `REAP_ORDER` near 520), `tests/docs/retention-schedule.test.ts`, `apps/server/src/cli/reap.test.ts`, `packages/db/drizzle/0143_agent_cascade_index.sql` only if the plan check below needs it.
- Create: `packages/protocol-oidc/tests/revoke-cascade.int.test.ts`.

**Interfaces:** Produces `tokenGrantRepository(tx).revokeCascade(ids: readonly string[], at: Date, cap?: number): Promise<{ grants: number; instances: number; capped: boolean }>`: one recursive statement over `exchanged_from_grant_id`, bounded by `STRUCTURAL_MAX_DEPTH` and `cap` (default 10000), that revokes every reachable grant and every `agent_instances` row whose `root_grant_id` is among them; every existing revoke method calls it and returns its prior shape. Produces reaper passes `agent_instances` (expire, then delete after a 7-day tombstone) and `agent_approvals` (expire pending, delete decided rows after 30 days) and `agent_budget_windows` (delete windows older than 2 days).

**Audit actions added here:** `agent.instance_revoked`, `agent.instance_expired`, `agent.approval_expired` (see Task 3).

- [ ] **Step 1: Failing tests:** a chain of 6 exchanged grants, revoking the root revokes all and the rooted instances and writes one audit row with `count`; revoking a middle grant leaves its ancestors live; a 1000-grant fan chain finishes in one statement (assert via a single query count with the test's query logger) and `capped` is reported past the cap; session end, logout, reuse detection and admin consent revoke all cascade; reaper deletes an instance past tombstone and **leaves reads of an old grant whose `act_chain` names it working** (Review Focus 5: introspection returns the chain without resolving the instance); foreign-tenant probe on `revokeCascade`.
- [ ] **Step 2:** FAIL. **Step 3:** implement; run `EXPLAIN` on the recursive query under the `query-plans` fixture and add a composite `(tenant_id, exchanged_from_grant_id)` index in `0143` only if the plan seq-scans (record the result in `docs/phases/p5-spikes.md`, closing spec assumption 3). **Step 4:** PASS, with `reap.test.ts` and the docs test. **Step 5:** commit `feat(oidc): revoking a grant revokes everything exchanged from it`.

### Task 9: Budgets across a delegation

**Files:**

- Create: `packages/protocol-oidc/src/repository/agent-budget.ts`, `tests/agent-budget.int.test.ts`.
- Modify: `apps/server/src/mcp-deps.ts:139` (replace `WRITE_BUDGET` with the tenant's `agentWritesPerGrant` and `agentCreatesPerGrant` from `readAgentSettings`), `packages/mcp/src/index.ts` (keep `WRITE_BUDGET` exported as the default values, 20 and 10), `apps/server/src/testing/plan-background-drives.ts:344`.

**Interfaces:** Produces `agentBudgetRepository(tx).spend(input: { grantId: string; instanceId: string | null; ownerSubjectId: string; agentClientId: string; kind: 'mutating' | 'create'; now: Date; limits: { grant: { mutating: number; creates: number }; instanceSlice: { mutating: number; creates: number } | null; windowWrites: number } }): Promise<{ kind: 'ok' } | { kind: 'refused'; level: 'grant' | 'instance' | 'window' }>`: one transaction taking row locks in the order grant, instance, window, all three conditional updates or none (rolled back on the first refusal). Creates count against the window's `writes` too. An instance's slice is carved from its parent's remainder at mint (Task 6 stores it on `agent_instances`; add the two slice columns there if absent, in the same migration file as Task 4 if unmerged, else `0144`).

- [ ] **Step 1: Failing tests:** 100 parallel `spend` calls against limits of 20 allow exactly 20 and refuse the rest at the smallest remaining level; a refusal at the window level leaves the grant and instance counters unspent; the existing `grant-write-budget.int.test.ts` stays green unedited; MCP default behaviour is unchanged (20 changes, 10 creates) with default settings. **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS; run `pnpm vitest run --project integration packages/mcp apps/server`. **Step 5:** commit `feat(oidc): budgets across a delegation, tenant settings`.

- [ ] **Step 6 (increment close):** `pnpm verify`, push, CI, reviews.

---

## Increment 6: approvals and CIBA

### Task 10: Approval service

**Files:** Create `packages/domain-agents/src/service/approval-digest.ts` (+ test), `packages/protocol-oidc/src/usecase/approvals.ts` (+ test), `tests/approvals.int.test.ts`. Modify: `packages/domain-agents/src/index.ts`.

**Interfaces:** Produces `canonicalJson(value: unknown): string` (keys sorted, no whitespace) and `approvalDigest(input: { name: string; input: unknown; tenantId: string; ownerSubjectId: string; instanceId: string | null }): string` (hex SHA-256 over `canonicalJson`); `requestApproval(tx, deps, input): Promise<AgentApprovalRecord>` (capped pending per subject at 20; expiry `min(approval_ttl, instance expiry)`; records `agent.approval_requested`); `decideApproval(tx, deps, input: { approvalId: string; subjectId: string; approve: boolean; via: 'ciba_page' | 'console'; now: Date }): Promise<'decided' | 'not_pending' | 'not_owner'>` (the only writer of a decision; records `agent.approval_decided`); `consumeApproval(tx, id, digest, now): Promise<boolean>`.

**Audit actions added here:** `agent.approval_requested`, `agent.approval_decided` (see Task 3).

- [ ] **Step 1: Failing tests:** digest differs when any field differs and equals for reordered keys; a decision by a subject who is not the approval's owner is `'not_owner'`; approve and deny at once: one `'decided'`, one `'not_pending'` (Review Focus 3, ten parallel pairs); an approval after expiry is `'not_pending'`; `consumeApproval` succeeds once; the 21st pending approval for a subject is refused; no client credential path reaches `decide` (a test that the repository's `decide` is imported only by `approvals.ts`, via `tests/lint`). **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5:** commit `feat(oidc): approvals, one decision writer`.

### Task 11: CIBA endpoint, grant and discovery

**Files:**

- Create: `packages/protocol-oidc/src/usecase/ciba.ts` (+ `ciba.test.ts`), `src/view/routes/bc-authorize.ts`, `src/service/ciba-throttle.ts`, the CIBA reading note `oidc-ciba.md` in `docs/protocols/` (reading notes and clause table, written first), `tests/ciba.int.test.ts`, `tests/ciba.adversarial.int.test.ts`.
- Modify: `packages/contracts/src/discovery.ts` (type at 75; metadata near line 166), `packages/protocol-oidc/src/index.ts` (register the route beside the others), `usecase/token-issuance.ts` (`parseStructure` 261, dispatch 1468, `'token.…'` map 1415: add the CIBA grant), `service/errors.ts`, `view/routes/token.ts` (limiter wiring like `clientSecretLimiter`), `apps/server/src/throttle.ts`, `apps/server/src/app.ts` (limiter instance), the client `grant_types` allow-list wherever grant types are validated (grep `token-exchange` in `packages/contracts/src/admin/clients.ts`).

**Interfaces:** Produces `POST /:tenant/bc-authorize` accepting `login_hint` or `id_token_hint`, `scope`, `binding_message` (max 140 characters, stored escaped), `requested_expiry` (capped by `agent_approval_ttl_seconds`), authenticating the client as the token endpoint does, returning `{ auth_req_id, expires_in, interval: 5 }`; token endpoint grant `urn:openid:params:grant-type:ciba` returning `authorization_pending`, `slow_down` (when polled before `interval`), `expired_token`, `access_denied`, or tokens for the approving subject to that client, recording `ciba.token_issued`; discovery adds `backchannel_authentication_endpoint`, `backchannel_token_delivery_modes_supported: ['poll']`, `backchannel_user_code_parameter_supported: false`, and the grant in `grant_types_supported`. `bc-authorize` creates the approval through `requestApproval` (kind `'ciba'`).

**Audit actions added here:** `ciba.requested`, `ciba.poll_refused`, `ciba.token_issued` (see Task 3).

- [ ] **Step 1:** write the CIBA reading note `oidc-ciba.md` in `docs/protocols/` with the OpenID CIBA Core 1.0 clauses this implements as a requirement table keyed for `pnpm trace` (follow `oidc-backchannel.md`).
- [ ] **Step 2: Failing tests:** full flow request, approve through `decideApproval`, poll, tokens; poll before approval `authorization_pending`; poll twice inside `interval` `slow_down`; deny `access_denied`; expiry `expired_token`; a reused `auth_req_id` after tokens is `invalid_grant`; **an unknown `login_hint` and a known one return the same status, body shape and the same call count of password-hash or lookup work** (Review Focus 2); `binding_message` is escaped; a client lacking the grant is `unauthorized_client`; no client credential changes an approval's state (adversarial); rate limit per `auth_req_id` returns `slow_down`; discovery contains the three fields and `tests/docs/discovery.test.ts` is updated and green.
- [ ] **Step 3:** FAIL. **Step 4:** implement. **Step 5:** PASS; `pnpm trace` green. **Step 6:** commit `feat(oidc): CIBA poll mode`.

### Task 12: Approval page and mail

**Files:**

- Create: `packages/protocol-oidc/src/view/approval-html.ts` (+ test), `src/view/routes/approval.ts`, `packages/email/src/usecase/approval-notice.ts` (+ test) modelled on `reset-completed-notice.ts` (`queueApprovalNotice(tx, input, resolveMailLook): Promise<'sent' | 'skipped_none'>`), the mail renderer beside `packages/email/src/service/`.
- Modify: `view/messages.ts` and `messages.ar.ts` (new keys), `packages/protocol-oidc/src/index.ts`, `tests/lint/server-page-literals.test.ts` stays green (no literals).

**Interfaces:** Produces `GET /:tenant/approval/:id` (needs the person's session; shows agent, summary, binding message, expiry) and `POST /:tenant/approval/:id` (CSRF-protected, body `decision=approve|deny`) both returning pages through `sendHtml`; `renderApprovalPage(view: ApprovalPageView, messages): string` pure; the mail carries only the approval id link.

- [ ] **Step 1: Failing tests:** page escapes the summary and binding message; no session redirects to sign-in and back; POST without CSRF is refused; a different signed-in subject sees the generic not-found page; approve calls `decideApproval` with `via: 'ciba_page'`; the mail body contains the link and no token; Arabic catalogue has every key. **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS; the page markup drift test `apps/docs/scripts/page-shots/drift.test.ts` fails until `pnpm --filter @odudu/instrument build && pnpm --filter @odudu/docs page-shots` is rerun; rerun and commit the manifest. **Step 5:** commit `feat(oidc): approval page and notice mail`.

- [ ] **Step 6 (increment close):** `pnpm verify`; push; CI (`conformance` builds the suite: minutes); reviews.

---

## Increment 7: operators and people

### Task 13: Admin API for instances and approvals

**Files:**

- Create: `packages/contracts/src/admin/agents.ts`, `packages/protocol-admin/src/usecase/agents.ts`, `src/view/routes/agents.ts`, tests beside each.
- Modify: `packages/contracts/src/admin/index.ts`, `docs.ts`, `packages/protocol-admin/src/index.ts` (register near 897-902), `service/capability.ts` (route table entries), `view/routes/openapi.ts`/`operations.ts`, `apps/docs/content/en/reference/transcripts/admin-paths/` (new pages, re-run on a live stack), `packages/mcp` route-class table `docs/protocols/mcp-route-classes.md` (each new route gets a class row; the test holds it).

**Interfaces:** Produces `GET /admin/tenants/:tenant/agents` (paged under `MAX_LIMIT`, filter by owner, state; each with lineage fields `id, owner, agent_client, parent, depth, expires_at, remaining_budget`), `GET …/agents/:id`, `DELETE …/agents/:id` (revokes the tree, returns `{ grants, instances }`), `GET …/agent-approvals` (paged, filter by state). Capabilities are the existing ones: all four routes `manage-sessions`, as session reads are (no new capability; the ceiling of ADR 0040 applies). Agents may not call these routes: they are class W2/D rows in `mcp-route-classes.md`.

- [ ] **Step 1: Failing tests:** list is bounded, ordered, indexed (`query-plans` fixture has the query); delete cascades and audits; foreign tenant cannot read or delete; an agent token is refused (door test); transcripts and endpoints/openapi docs tests. **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS, `tests/docs/{endpoints,admin-paths,docs-coverage}.test.ts` green. **Step 5:** commit `feat(admin): agents and approvals read, revoke`.

### Task 14: Delegations in the "me" API

**Files:** Modify `packages/me/src/view/routes.ts` (a `MeRoute` const per operation beside `PROFILE_GET` at 115; add to `ME_ROUTES` at 217; bind near 513), `packages/contracts/src/me/*`, `packages/me/src/view/openapi.ts`, `sdks/*` generated clients via `pnpm sdks:generate`, `apps/docs/content/en/sdks/`. Create `packages/me/src/usecase/delegations.ts` (+ tests).

**Interfaces:** Produces `GET /me/delegations`, `POST /me/delegations` (`{ client_id, actor_client_id, scope_ceiling, expires_in }`), `DELETE /me/delegations/:id`, each through `admitMeRead`/`admitMeWrite`, recording `agent.delegation_created` and `agent.delegation_revoked`, capped at 20 active per subject; creating one for a client that is not an agent type's actor is refused.

**Audit actions added here:** `agent.delegation_created`, `agent.delegation_revoked` (see Task 3).

- [ ] **Step 1: Failing tests:** create, list, revoke, cap, foreign subject cannot see another's; `mayActFor` (Task 6) returns the actor after creation and `undefined` after revoke; the OpenAPI document test and SDK generation leave no diff; guides excerpt tests. **Step 2:** FAIL. **Step 3:** implement; run `pnpm sdks:generate` and `pnpm mcp:catalogue` and commit the diff. **Step 4:** PASS. **Step 5:** commit `feat(me): delegations`.

### Task 15: Console "Agents" area

**Files:** Create `apps/admin-console/src/pages/agents/{index.ts,adapter,repository,services,types,ui,use-cases}` and `entities/agent/` for the shared types and wording; modify `apps/admin-console/src/app/router.tsx` (lazy route like `scopes`, ~368 and 385), shell navigation, `apps/docs/content/en/admin-console/agents.mdx`, `tour.mdx`, `apps/docs/tests/console-areas.test.ts` map; then `pnpm docs:screenshots`.

**Interfaces:** Shows instances as a tree by lineage with owner, type, remaining budget, expiry; a revoke action whose confirmation says how many grants and instances it will end (from a dry count: add `?dry_run=true` to the Task 13 delete returning the counts without changing anything); a pending and recent approvals list. All wording is constants in `services` with `counted()` and `plural()`; no logic in use cases (ADR 0010 amendment); every collection bounded and paged.

- [ ] **Step 1: Failing tests:** component tests for the tree, the revoke confirmation text, empty and error states; `console-labels.test.ts` finds every quoted label in the source; layering lints (`tests/lint/architecture`) green; a Playwright flow in the existing e2e project. **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5:** commit `feat(console): agents area`.

- [ ] **Step 6 (increment close):** `pnpm verify`; push; CI including `console-shots`; reviews.

---

## Increment 8: documentation, conformance and the closing pass

### Task 16: Documents, conformance and the phase's closing pass

**Files:** Create `apps/docs/content/en/concepts/agents.md`, a guide `apps/docs/content/en/guides/agent-delegation.md` (runnable blocks executed by `tools/docs-run`), transcripts for `bc-authorize`, the CIBA token poll, approval page and the admin routes (each re-run on a live stack, fenced response blocks carry no language tag), the phase note `p5.md` in `docs/phases/`. Modify `docs/protocols/rfc8693.md` (stage 4, `may_act`), `apps/docs/content/en/concepts/tokens.md`, `reference/` generated pages, `README.md`, `CHANGELOG.md` under `## [Unreleased]` (Added, Changed, Security in the installer's words), `.github/workflows` conformance plan for CIBA poll if the OIDF suite has one (closes spec assumption 1; if it has none, record that and keep the integration tests as the proof, saying so in the phase note `p5.md` in `docs/phases/`), `docs/NEXT.md` ("What P5c inherits", delete "What P5 inherits"), the roadmap's "What is not implemented".

- [ ] **Step 1:** Run the closing pass of CLAUDE.md in order: gaps in "What is not implemented" still true; `git grep -n -E '\bP5\b'` and the numbers moved; NEXT headings against closed phases; section 11 against the roadmap in both directions (`roadmap-section-11.test.ts`); the capability's words across the public surface (`git grep -n -i -E 'planned|agent|delegation' -- apps/docs README.md`); `CHANGELOG.md`. Fix each hit.
- [ ] **Step 2:** `pnpm verify`; whole-branch review by a fresh Sonnet reviewer (spec compliance and quality); fix loop until clean.
- [ ] **Step 3:** Move the spec and this plan with `git mv` to `docs/archive/specs/` and `docs/archive/plans/`; update references (`tests/docs/references.test.ts`). Commit `docs: close P5`; push; CI green; ask the owner before the merge to `main`.
