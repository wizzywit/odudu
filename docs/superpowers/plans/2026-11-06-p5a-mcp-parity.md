# P5a — MCP console parity: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When P5a closes, an agent reads everything the admin console reads that is not a secret, and makes every console change that is content (no access change); access-changing, credential and destructive work is placed in P5b, in seven places each pinned by a test.

**Architecture:** The shipped catalogue (`packages/mcp/src/service/catalogue.ts`) and admin door (`packages/protocol-admin/src/service/agent-scope.ts`) gain read tools over unchanged routes, one allowance for two instance-level reads, and a generalised write allowlist (method and body mode per route, field-gated) behind which ten new content-write tools sit. The owner's capability stays required on every call.

**Tech Stack:** as the P5a plan (TypeScript on Node 24, Fastify 5, Zod 4, Vitest, Testcontainers PostgreSQL, the MCP SDK 2.4.0).

**Spec:** [2026-11-06-p5a-mcp-parity-design.md](../specs/2026-11-06-p5a-mcp-parity-design.md); section numbers (§) are its. Read it, the P5a spec and plan, `docs/phases/p5a.md` and `CLAUDE.md` first.

## Global Constraints

Copied from `CLAUDE.md` and the P5a plan; every task includes them.

- The owner's decisions (§1): content writes (W1) and non-secret reads reach console parity in this phase; W2, C and D are P5b's, which this plan widens and places (Increment 19).
- No tool is the control: the admin door admits by route, method and field, and the owner's capability is judged on every call (§5). A read token never writes, whatever a tool says.
- No `any`, no `void doThing()`, no inline `eslint-disable`. Tests precede implementation; integration tests use real PostgreSQL; every repository method is probed with a foreign `tenant_id`; `SET LOCAL`.
- Comments carry only what code cannot say, blocks of at most eight lines, **no reference to this plan, a task, a step, an increment or a phase slot in a comment or a production string** (`tests/lint/comment-block-length.test.ts`). Quote this in every dispatch. A `NOT_TOOLS` reason names its **class** ("Access-changing: …"), never a phase.
- Console and docs-app rules do not apply (no console code changes) except where the docs app's tests are named.
- Performance and scale (ADR 0041): 1,000,000 subjects, 10,000 clients, 10,000 tenants, 100,000,000 audit events. Each increment states its bound; a list tool pages under `MAX_LIMIT`, a result is capped at 256,000 bytes.
- Subagents run on Sonnet 5.5; no `git stash`; heavy suites go through the heavy-slot lock; commit subject at most 72 characters, body at most 8 lines, no tool-attribution trailer in a commit or the pull request.
- Branch `p5a/i12-parity` onward, one pull request per increment into `p5a/mcp-server`'s integration branch, draft PR with the first push; CI green and the review answered before the next increment (CLAUDE.md "CI runs on the branch").
- A claim about this repository carries its grep; a claim about library behaviour is `verified:` or `assumption:`.
- Each increment owns its documentation (CLAUDE.md "The documentation an increment owns"): the transcript of a changed route is re-run on a live stack, `CHANGELOG.md` `Unreleased` gets the user-visible change in the words of the person who installs Odudu.

## Review Focus

Inputs no single task's happy path exercises; each has a test in the owning task.

1. A write tool called with a field outside its W1 list, a `tenant`, a header, or a body shape the schema does not name: refused before any call, and refused by the door when sent past the tool (§5.1).
2. A W1 route reached with `mcp:read`, with `mcp:write` by an owner lacking the capability, and by a tenant-local owner for the instance-level reads (§6).
3. Hostile text in every new read (a role description, a message override, a stylesheet, a template, another tenant's display name) obeyed by the scripted agent: zero rows change except W1 fields, and each W2 attempt is refused and audited (§5.7).
4. A retried create with the same `Idempotency-Key`, the same key with a different body, and the 11th create within one token (§5.2, §5.5).
5. A theme draft edited by an agent while a person edits it in the console: a stale `If-Match` is a 412, and the merge never drops a part it did not name (§5.4).
6. A draft larger than the caller may send: a plain refusal, never a truncated draft written (§5.4).
7. `tools/list` for a token or owner lacking the capability or the scope: the tool is absent, not failing; `list_tenants` absent for a tenant-local owner.
8. The route table of §3, `NOT_TOOLS` and the allowlist agree: a route cannot move from W2 to W1 without a failing test (Increment 15).

## File Structure

| Path                                                                                                                                                                               | Responsibility                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `packages/mcp/src/service/tools/{tenants,tenant,branding,client-branding,scope-checks}.ts` (new)                                                                                   | the new read tools                                                                     |
| `packages/mcp/src/service/tools/{roles,groups,scopes,settings,message-overrides,theme}-write.ts` (new)                                                                             | the new write tools, built by `contentWriteTool`                                       |
| `packages/mcp/src/service/write-tool.ts`                                                                                                                                           | `contentWriteTool` beside `metadataTool`; POST, PUT and DELETE bodies; idempotency key |
| `packages/mcp/src/service/{admin-request,admin-path,tool}.ts`, `adapter/{in-process,http}-caller.ts`                                                                               | caller allowances: methods, `Idempotency-Key`, per-tool body cap                       |
| `packages/protocol-admin/src/service/agent-scope.ts`, `view/routes/router.ts`                                                                                                      | allowlist by method, route and field; the instance-level rule                          |
| `packages/mcp/src/service/catalogue.ts`                                                                                                                                            | `NotToolKind` split; class-named reasons                                               |
| `protocols/mcp-route-classes.md (under docs)` (new)                                                                                                                                | the §3 table, durable                                                                  |
| `tests/docs/{mcp-route-classes,p5b-scope,mcp-agent-capabilities}.test.ts` (new), `tests/lint/mcp-tool-coverage.test.ts`                                                            | pins                                                                                   |
| `apps/server/tests/mcp-prompt-injection.int.test.ts`, `apps/server/src/testing/mcp-stack.ts`                                                                                       | the extended suite                                                                     |
| `apps/docs/content/en/guides/{connect-claude,connect-cursor,protect-an-mcp-server}.md`, `reference/transcripts/request-paths/the-mcp-endpoint.md`, `concepts/consent-and-audit.md` | what an agent can and cannot do, and why                                               |

---

## Increment 12 — Instance-level reads: `list_tenants` and `count_tenants`

Exit: a person holding `manage-tenants` can ask their agent how many tenants exist and list them; nobody else's agent can. About 3 to 4 hours, 2 tools.

### Task 12.1: The door's rule

**Files:** modify `packages/protocol-admin/src/service/agent-scope.ts` (remove the two entries from `AGENT_DENIED_READS`; add `INSTANCE_READS` and the rule in `scopeAdmits`), `view/routes/router.ts` only if `scopeAdmits` cannot see the token's tenant. Test `agent-scope.test.ts`.

**Interfaces:** Produces `scopeAdmits(scopes, route, tenantIsSystem: boolean): boolean`: a GET in `INSTANCE_READS` (`GET /admin/tenants`, `GET /admin/tenants/count`) admits only when `tenantIsSystem` is true.

verified: `sed -n 107,114p packages/protocol-admin/src/view/routes/router.ts` (a route with no `:tenant` targets the system tenant); `git grep -n "scopeAdmits(" -- packages | head` shows the one call site at `router.ts:199`.

- [ ] **Step 1: Failing tests:** every ADMIN_ROUTES entry is judged as before except the two; the two admit `mcp:read` and `mcp:write` for a system-tenant principal and, at the unit level, refuse a principal whose `issuerTenantId` is not the system tenant (`scopeAdmits` with `tenantIsSystem` false). Correction found by running it: a real tenant-local agent token never reaches that check, because a route with no `:tenant` targets the system tenant and `authenticateAdmin` accepts only a token the system tenant signed there, so the answer is `401` and a `token.foreign_issuer` row in the system tenant naming the person (asserted in the integration test, with the tool call recorded as failed); `403` with `capability.refused` is the answer for a system-tenant owner who lacks `manage-tenants`. The owner without `manage-tenants` is still refused by `authorizeAdmin` (both gates); `GET /admin/tenants/:tenant` for any tenant is unchanged.
- [ ] **Step 2:** `pnpm --filter @odudu/protocol-admin test -- agent-scope`; expect FAIL.
- [ ] **Step 3:** implement. **Step 4:** run to PASS. **Step 5:** commit.

### Task 12.2: The two tools

**Files:** create `packages/mcp/src/service/tools/tenants.ts`; modify `catalogue.ts` (add to `TOOLS`, delete the two `NOT_TOOLS` entries). Tests `tools/tenants.test.ts`, extend `tests/lint/mcp-tool-coverage.test.ts` expectations, `visible-tools.test.ts`.

**Interfaces:** Produces `list_tenants` (`pageTool`, shape `listTenantsQuerySchema.shape` plus `pageShape`) and `count_tenants` (`valueTool`, `countTenantsQuerySchema.shape`), both `capability: 'manage-tenants'`, route keys `GET /admin/tenants` and `GET /admin/tenants/count`. `routeKey` has no `:tenant`; `expandPattern` leaves it untouched.

verified: `sed -n 1,30p packages/mcp/src/service/admin-path.ts` (`:tenant` is filled only if the pattern has it); assumption: the in-process caller sends `host` of the issuer and the bearer of the system tenant for a system-tenant token; Step 1's integration test establishes it.

- [ ] **Step 1: Failing tests:** against a fake caller, arguments validated and bounded (`limit <= MAX_LIMIT`), `display_name` text under `data`; `tools/list` shows both for a token whose owner holds `manage-tenants` and neither otherwise (`whoami`'s `capabilities` carries `manage-tenants` for them: verify with `git grep -n "MANAGE_TENANTS" -- packages/protocol-admin/src/view/routes/whoami.ts`); integration (`apps/server/tests/mcp-instance-reads.int.test.ts`): a system administrator's `mcp:read` token lists tenants and counts them; a tenant administrator's token is refused by the door (`403`, `capability.refused` row); a `tenant` argument is a validation error; a tenant whose `display_name` carries instructions comes back under `data`.
- [ ] **Steps 2-5:** run to fail; implement; run to pass; `query-plans`: `git grep -n "listTenants" -- $(git ls-files '*plan*' '.github')` and add an entry if absent. Transcript `request-paths/the-mcp-endpoint.md` re-run on a live stack; `CHANGELOG.md` _Added_. Bound: pages of at most `MAX_LIMIT` over 10,000 tenants by cursor on the name index.

Push the increment's PR; CI green; review answered.

---

## Increment 13 — The remaining small reads

Exit: six non-secret reads the console uses and the catalogue withheld as "not useful" are tools. About 3 hours, 6 tools.

### Task 13.1: Six reads

**Files:** create `packages/mcp/src/service/tools/{tenant,scope-checks}.ts`; extend `tools/{subjects,domains,clients}.ts`; `catalogue.ts` (move six `NOT_TOOLS` entries to `TOOLS`). Tests beside each.

**Interfaces:** Produces `get_tenant` (`GET ~`, `manage-tenant`, own tenant only), `get_username_policy` (`GET ~/subjects/username-policy`, `view-users`), `get_passkey_impact` (`GET ~/domains/passkey-impact`, `view-domains`, shape `passkeyImpactQuerySchema.shape`), `get_scope_impact` (`GET ~/scopes/:id/impact`, `manage-tenant`), `list_builtin_scopes` (`GET ~/scopes/builtins`, `manage-tenant`), `get_client_installation` (`GET ~/clients/:id/installation`, `manage-clients`).

verified: route capabilities from the dump of `ADMIN_ROUTES` (`GET ~` is `manage-tenant`; `GET ~/subjects/username-policy` is `view-users`; the passkey-impact GET is `view-domains`). `get_client_installation` returns what `get_client` returns plus the issuer and discovery address: check with `sed -n` of `clientInstallationSchema` that it carries no secret before the tool is written (assumption: it does not; a test asserts the keys).

- [ ] **Step 1: Failing tests:** each tool against a fake caller (arguments bounded, output validated by the contract schema, text under `data`); `data-label.test.ts`'s poisoned-answer suite runs over each; the coverage test now lists them as tools; the `evaluate` read stays refused at the door (unchanged, asserted again in the integration test); `get_tenant` called with a `tenant` argument is a validation error; integration: a tenant administrator reads their own record, a tenant-local token cannot read another tenant's through any argument.
- [ ] **Steps 2-5.** Docs: `apps/docs/content/en/guides/protect-an-mcp-server.md` catalogue sentence; no transcript changes (no route changed). CHANGELOG _Added_. Push; CI; review.

---

## Increment 14 — Branding reads and the long-text allowance

Exit: an agent can read a tenant's and a client's theme, mail look and message wording in full. About 5 hours, 11 tools.

### Task 14.1: The long-text allowance

**Files:** modify `packages/mcp/src/service/sanitize.ts` and `read-tool.ts`. Test `sanitize.test.ts`.

**Interfaces:** Produces `cleanData(value, stats, options?: { longText?: readonly string[] })`: a string member whose key is in `longText` is cut at 128 KiB instead of 1,000 characters, still stripped of controls and bidirectional overrides; the whole result stays under the 256,000-byte cap. The list is declared per tool and never global, and it names a member by path with inheritance: `stylesheet` is one string, while `templates` is an object of page-kind keys, so the entry `templates` means every string at any depth under a member of that name, not the member's own value (a key-only match would never fire on the bodies).

verified: `git grep -n "1000\|1_000" -- packages/mcp/src/service/sanitize.ts` for the cut and `ADMIN_BODY_CAP_BYTES = 1_048_576` in `admin-request.ts` for the read cap.

- [ ] **Step 1: Failing tests:** a `stylesheet` of 100 KiB comes back whole, one of 200 KiB is cut with `truncated: true`; a template body nested under a page-kind key (`templates` is an object whose keys are page kinds such as `sign-in` and whose values are the bodies) of 100 KiB comes back whole and one of 200 KiB is cut, in the theme and in a client's mail templates; every other field is still cut at 1,000; the stripped characters are the same; a key named `stylesheet` outside a tool that declares it is cut; a result over 256,000 bytes is `mcp:result_too_large`.
- [ ] **Steps 2-5.** Commit.

### Task 14.2: The eleven reads

**Files:** create `packages/mcp/src/service/tools/{branding,client-branding}.ts`; move eleven `NOT_TOOLS` entries to `TOOLS` (the theme, its versions, preview info, stylesheet hooks, mail branding, message overrides and catalogue, and the client's theme, versions, preview info and mail branding). Tests beside.

**Interfaces:** Produces `get_theme`, `list_theme_versions`, `get_theme_preview_info`, `get_stylesheet_hooks`, `get_mail_branding`, `list_message_overrides`, `get_message_catalogue`, `get_client_theme`, `list_client_theme_versions`, `get_client_theme_preview_info`, `get_client_mail_branding`; each returns the draft's `ETag` beside `data` where the route sends one (the theme tools in Increment 18 read it from the admin API themselves). The previews (`GET …/theme/preview`, `…/mail/preview`) stay `N`, and the asset bytes stay refused at the door.

verified: `git grep -n "stylesheet-hooks" -- packages/protocol-admin/src/service/capability.ts` shows `alsoAdmits: manage-clients`; each theme route's capability is `manage-tenant` or `manage-clients` from the dump.

- [ ] **Step 1: Failing tests:** each tool against a fake caller; the poisoned-answer suite (`data-label.test.ts`) runs over them, including a stylesheet and a template full of instructions: every string stays under `data`; `tools/list` hides the client tools from an owner lacking `manage-clients`; integration: a tenant with a published theme and a draft is read whole; the asset content route is still refused for `mcp:read` and `mcp:write`.
- [ ] **Steps 2-5.** Docs: the Branding page's "Do the same through the API" untouched (no route changed); guide catalogue sentence; CHANGELOG _Added_. Bound: a theme is at most 4 MiB, the read cap is 1 MiB and the result cap 256,000 bytes, so an oversized theme is `mcp:result_too_large`, said to read the parts apart (a test with a 600 KiB theme). Push; CI; review.

---

## Increment 15 — The write door, generalised, and the route classes written down

Exit: the admin door and the caller can carry a W1 POST, PUT or DELETE under a field gate, a per-token write budget and an `Idempotency-Key`; the class of every route is a durable, tested document. No new tool. About 6 hours.

### Task 15.1: The allowlist by method, route and body mode

**Files:** modify `packages/protocol-admin/src/service/agent-scope.ts`, `view/routes/router.ts` (`agentMayWrite`). Test `agent-scope.test.ts`.

**Interfaces:** Produces `AgentWriteRoute { method: 'PATCH' | 'POST' | 'PUT' | 'DELETE'; pattern; target: 'client' | 'scope' | 'none'; body: 'fields' | 'whole'; fields: readonly string[] }`. `scopeAdmits`: `mcp:write` admits GET and exactly the allowlist entries; `agentBodyAdmitted` for `fields` is the shipped check, for `whole` admits only the named members and refuses a non-record. `AGENT_WRITE_ROUTES` still holds the two shipped entries only after this task.

verified: `sed -n 1,12p packages/protocol-admin/src/service/agent-scope.ts` (the interface types `method: 'PATCH'`).

- [ ] **Step 1: Failing tests:** over every `ADMIN_ROUTES` entry and a synthetic allowlist, `mcp:read` admits exactly the GETs, `mcp:write` exactly GETs plus entries; a POST with a field outside `fields` is refused `insufficient_scope`; `__proto__`, duplicate keys and an array body are refused; a DELETE entry admits no body.
- [ ] **Steps 2-5.** Commit.

### Task 15.2: The caller carries them

**Files:** modify `packages/mcp/src/service/{tool,admin-request}.ts` (`AdminMethod` gains `POST | PUT | DELETE`; `payloadOf` takes the method rules; `idempotencyKey?: string` on `AdminRequestSpec`; `bodyCap?: number`), `adapter/in-process-caller.ts`, `adapter/http-caller.ts`. Tests `admin-request.test.ts`, `in-process-caller.test.ts`, `http-caller.test.ts`.

**Interfaces:** Produces the one added header `Idempotency-Key` (a validated pattern, 1 to 255 visible ASCII, as the admin API's `idempotencyKeyOf` accepts); no other header can be set from input; a DELETE or GET carries no body.

verified: `sed -n 20,40p packages/mcp/src/service/admin-request.ts` (a body is refused on anything but PATCH today) and `git grep -n "idempotencyKeyOf" -- packages/protocol-admin/src/service/idempotency.ts`.

- [ ] **Step 1: Failing tests:** each method's request is built from fixed parts; a key with a space, a newline or 256 characters is refused before any call; no header besides the five (authorization, accept, x-request-id, host, content-type, if-match, idempotency-key where named) appears; a per-tool `bodyCap` above 1 MiB is refused.
- [ ] **Steps 2-5.** Commit.

### Task 15.3: `contentWriteTool`, the budget

**Files:** modify `packages/mcp/src/service/write-tool.ts` (add `contentWriteTool` beside `metadataTool`, which becomes a call of it), `call-mcp-tool.ts` or the endpoint's write path for the budget, `packages/mcp/src/service/rate-limit.ts` untouched. Tests `write-tool.test.ts`, `call-mcp-tool.test.ts`.

**Interfaces:** Produces `contentWriteTool({ name, description, routeKey, capability, what, fields, response, mode: 'amend' | 'create' | 'put' | 'delete', body? })` returning a `RegisteredTool` with `access: 'write'`, `bodyFields`, `idempotentHint` true for amend, put and delete, and the budget: the count of `agent.tool_call` rows `allowed` for the token's grant (20 mutating, 10 creates) read in the same transaction that records the call; over it, `429` `mcp:write_budget` and a `refused` row.

assumption: a count over `(tenant_id, actor_subject_id, created_at)` is cheap and indexed. Verify first: `git grep -n "agent.tool_call" -- packages/domain-audit packages/db/src | head` and the audit table's indexes (`git grep -n "index(" -- packages/db/src/schema/audit*`); add an index by migration, next number from `ls packages/db/drizzle | tail -1`, only if the plan shows a scan.

- [ ] **Step 1: Failing tests:** the 21st mutating call and the 11th create in one token are refused and audited; a read does not spend the budget; a second token has its own; an `mcp:outcome_unknown` still spends it; a create requires a stable `idempotency_key` argument supplied by the client and is refused before any call without one (none is derived from the MCP request id, which differs on every retry); a retry of the same create under a different request id and the same key answers the stored response without a second row, and the same key with a different body is the admin API's conflict (against the real admin API in the integration test); `query-plans` entry for the count.
- [ ] **Steps 2-5.** Commit.

### Task 15.4: The route classes, written down and pinned

**Files:** split `NotToolKind` in `catalogue.ts` (`'write'` becomes `'access-changing'` and `'credential'`; every W2, C and D reason begins with its class and says why; no phase number); create `protocols/mcp-route-classes.md (under docs)` from §3 of the spec (the table, the counts, the class definitions, the field table of §4), indexed in `docs/README.md`; create `tests/docs/mcp-route-classes.test.ts`. Modify `tests/lint/mcp-tool-coverage.test.ts`.

**Interfaces:** the document's table is one row per `ADMIN_ROUTES` entry with columns `#`, route, class and placement (`this phase`, `P5b`, `never`).

verified: `git grep -n "NOT_TOOL_KINDS" -- packages tests | head`.

- [ ] **Step 1: Failing tests:** every `ADMIN_ROUTES` key is a row and no row names a route that does not exist; every `NOT_TOOLS` key's kind maps to the row's class (`access-changing` to W2, `credential` to C, `destructive` to D, `sensitive` and `denied` to RS, `not-useful` to N); every row of class W2, C or D has placement `P5b`; every row of class W1 with a tool names that tool; the class counts printed in the document equal the counts of the table; a route that moves to a tool without a class change fails; the reason of an `access-changing`, `credential` or `destructive` entry starts with its class word and holds no `P5` string.
- [ ] **Steps 2-5.** Commit. Push the increment's PR; CI; review.

---

## Increment 16 — Structure: roles, groups and scopes

Exit: an agent can create a role, group or scope that grants nothing and describe existing ones. About 5 hours, 5 new tools and one field added.

### Task 16.1: The allowlist entries and the tools

**Files:** `AGENT_WRITE_ROUTES` entries for `POST ~/roles` (`name`, `description`, `client_id`), `PATCH ~/roles/:id` (`description`), `POST ~/groups` (`name`, `description`), `PATCH ~/groups/:id` (`description`), `POST ~/scopes` (`name`, `description`, `description_i18n`, `display_order`) and `display_order` added to the shipped scope PATCH entry; create `packages/mcp/src/service/tools/{roles,groups,scopes}-write.ts`; extend `scope-metadata.ts`; move five `NOT_TOOLS` entries. Tests beside each, `agent-scope.test.ts`, the coverage lint.

**Interfaces:** Produces `create_role`, `update_role_description`, `create_group`, `update_group_description`, `create_scope`, and `update_scope_metadata` with `display_order` (an integer within `displayOrderSchema`). Tools for a create take the validated fields and a required, client-supplied `idempotency_key`; for an amend, `id`, `if_match` and the fields. Refused by schema before any call: `default_for_new_subjects`, `parent_id`, `include_in_*`, `default_client_assignment`, `consent_text*`.

verified: field lists from the dump of `AMENDABLE_{ROLE,GROUP,SCOPE}_FIELDS` and the three create schemas (`sed -n 54,66p packages/contracts/src/admin/scopes.ts`); `git grep -n "role.create\|group.create\|scope.create" -- packages/domain-audit/src/service/admin-mutation-actions.ts` for the audit actions. assumption: the three create usecases write a `detail` with the allowlisted fields; Step 1's integration test asserts it, and a gap is fixed in the admin API.

- [ ] **Step 1: Failing tests:** `mcp:read` refused by the door for each (unguarded-caller test as for the shipped tools); an `mcp:write` owner lacking `manage-tenant` is refused and audited; each W2 field named in a body sent past the tool is refused by the door (a table of six bodies per route, nothing changed); a built-in-named role or a duplicate name is the admin API's `409`/`400`, surfaced; a stale `if_match` is a `412`; the 11th create is `mcp:write_budget`; `Idempotency-Key` replays; a NUL or bidirectional control is refused; the audit rows carry before and after of W1 fields only; **injection scenario "structure"**: a role description, group description and scope description each hold instructions to grant a role, set `default_for_new_subjects`, move a group, change a consent text; the scripted agent obeys; against `mcp:read` zero rows change, against `mcp:write` only descriptions and new empty roles, groups and scopes appear and no `subject_roles`, `group_roles`, `scope_roles`, `role_composites` or client row changes (the snapshot of 43 tenant tables).
- [ ] **Steps 2-5.** Docs: `admin-console/{roles,groups,scopes}.mdx` gain an API sentence only if their "Do the same through the API" block changes (it does not; no route changed); transcripts re-run on a live stack for `the-mcp-endpoint.md`; CHANGELOG _Added_; the guide's "what an agent can change" list. Bound: every create is one row, under `SCOPE_LIMIT` (1,000 scopes) and the role and group limits the admin API enforces (assumption: enforced; an integration test creates up to the limit through the tool and sees the admin API's refusal). Push; CI; review.

---

## Increment 17 — Wording: settings text and message overrides

Exit: an agent can set the tenant's display name and languages and the wording of its pages. About 4 hours, 3 tools.

### Task 17.1: The tools

**Files:** `AGENT_WRITE_ROUTES` entries for `PATCH ~/settings` (`display_name`, `supported_locales`, `default_locale`), `PUT ~/message-overrides/:locale/:key` (`message`) and `DELETE ~/message-overrides/:locale/:key`; create `tools/{settings,message-overrides}-write.ts`; move three `NOT_TOOLS` entries. Tests beside.

**Interfaces:** Produces `update_tenant_text_settings` (`if_match` from `get_settings`, at least one of the three fields; `supported_locales` a list of language tags, the admin API's `tenantSettingProblems` still judging them), `set_message_override` (`locale`, `key`, `message` at most `MESSAGE_OVERRIDE_MAX_LENGTH` = 2,000), `clear_message_override` (`locale`, `key`). The settings PATCH body gate is by name: any other of the 40 setting names is refused, and so is the combination of a W1 and a W2 name in one body.

verified: `sed -n 12,69p packages/domain-tenant/src/service/tenant-settings.ts` for the names; `sed -n 47,50p packages/contracts/src/admin/message-overrides.ts` for the limits; assumption: a `PUT` of an existing override needs no `If-Match` (read `put` handler in `packages/protocol-admin/src/usecase/message-overrides.ts`: if it needs one, the tool takes it).

- [ ] **Step 1: Failing tests:** each of the 37 other setting names is refused by the door for an agent (a generated test over `TENANT_SETTING_NAMES`); a mixed body is refused whole; shrinking `supported_locales` below an existing override's locale is the admin API's behaviour, surfaced (assert which); the audit rows `tenant.amend_settings`, `message_override.set` and `message_override.delete` carry before and after; `clear_message_override` is audited and the earlier text is in the row; **injection scenario "wording"**: an existing message override and `display_name` hold instructions to set `registration_allowed`, `otp_required`, `audit_retention_days`; the agent obeys; zero setting columns other than the three change, every refusal a `capability.refused` row.
- [ ] **Steps 2-5.** Docs: `admin-console/settings.mdx` untouched except an API line if it changes; transcript re-run; CHANGELOG _Added_ and the guide's "what an agent can change" list says the wording is shown to people on sign-in pages. Bound: overrides are bounded per tenant by the catalogue's key set. Push; CI; review.

---

## Increment 18 — Theme drafts

Exit: an agent can prepare a tenant's or a client's theme as a draft; a person publishes it. About 6 hours, 2 tools.

### Task 18.1: Read-merge-write

**Files:** `AGENT_WRITE_ROUTES` entries (`body: 'whole'`) for `PUT ~/theme` and `PUT ~/clients/:id/theme`; create `tools/theme-write.ts`; move two `NOT_TOOLS` entries; `target: 'client'` rules for a built-in client (the client theme of a built-in admin or MCP client is refused as the shipped name guard does). Tests beside.

**Interfaces:** Produces `update_theme_draft` and `update_client_theme_draft`: arguments `tokens?`, `stylesheet?`, `templates?` (at least one), each part replacing that part whole; the tool reads the draft (or the published theme when none) through the caller in full, merges, and PUTs with `If-Match` of that read (none for a first draft), at a body cap of 512 KiB. Returns `{ data: draft view, etag }`. Publishing, restoring, discarding and resetting are not tools (W2, D).

verified: `sed -n 13,14p packages/contracts/src/admin/theme.ts` (`putThemeRequestSchema` is `themeBodyRequestSchema`); the route's description in `capability.ts` ("a part left out is absent"; `428` when `If-Match` is missing, `412` when stale). assumption: reading the draft inside the tool through the same caller is within the 20 s deadline and the read cap for a draft near 512 KiB; Step 1 includes a 500 KiB draft.

- [ ] **Step 1: Failing tests:** a call naming only `tokens` leaves `stylesheet` and `templates` byte-identical (compared on the stored form); a draft above the body cap is a plain refusal and nothing is written; a stale etag from a concurrent console edit is `412` with the read-again advice; `mcp:read` and an owner lacking `manage-tenant` (client: `manage-clients`) refused; publish, restore and discard are not reachable (the door refuses each for an agent, asserted over the five routes); the draft is never what users see (an integration test fetches the sign-in page and finds the published theme); a template or stylesheet failing the admin API's checks is its `400` with `errors`, surfaced capped; **injection scenario "theme"**: a stylesheet comment and a template carry instructions to publish, restore, change redirect URIs, set a message; the agent obeys; only draft rows change, no published version is added.
- [ ] **Step 1b: Never write back a read.** `get_theme` text is sanitized (carriage returns, invisible characters, bidirectional controls removed) and may be cut with `truncated: true`. The draft-edit tools read the draft only for its `ETag` and for the parts the caller did not name, straight from the admin API through the caller and never through `cleanData`; every part the caller names is written from the caller's own content. Test: a draft holding a stylesheet with `\r` and a zero-width space, edited by naming only `tokens`, comes back byte-identical on the stored form; and no code path passes a sanitized or truncated read into the PUT body.
- [ ] **Steps 2-5.** Docs: `admin-console/{branding,client-branding}.mdx` get one sentence that a draft prepared by an agent waits for a person to publish; the API transcript for the theme re-run; screenshots only if a console control changes (none). CHANGELOG _Added_. Bound: draft at most 4 MiB in the admin API, at most 512 KiB through the tool. Push; CI; review.

---

## Increment 19 — The closing pass, the parity statement, and P5b placed

Exit: the owner's condition is met in seven places, each pinned; the user-facing guides say what an agent can and cannot do and why. About 5 hours.

### Task 19.1: P5b placed, test first

**Files:** create `tests/docs/p5b-scope.test.ts`; then edit `apps/docs/content/en/roadmap.md` (P5b bullet), `docs/superpowers/specs/2026-09-10-odudu-design.md` (section 11 row P5b), `docs/NEXT.md` (a section "What P5b inherits"), `docs/phases/p5a.md` (a section "What P5b inherits"). Tests also: `tests/docs/roadmap-section-11.test.ts` mappings, `phase-references.test.ts`, `next-budget.test.ts`, `references.test.ts`, `link-fragments.test.ts`.

**Interfaces:** the P5b identity becomes "MCP server: access-changing and destructive tools". The row's criterion names W2, C, D, the confirmation step (MCP elicitation, CIBA through P5, or a step-up scope; the first design question) and `protocols/mcp-route-classes.md (under docs)` as the work list; the NEXT section lists routes by class (counts from the document), the injection-suite requirements (a scenario per class, a model measured: the existing row moves here), the open decisions (confirmation mechanism, whether `tenant` is ever accepted, bulk, binary uploads, mail sending), and is within the 130-line section cap.

verified: `git grep -n "\bP5b\b" -- ':!docs/archive' | head -30` lists today's placements (roadmap line 84, section 11 row, `docs/NEXT.md` lines 46, 218, 243), each re-read and reworded; grep again after the edit and in the closing pass.

- [ ] **Step 1: Failing tests:** `p5b-scope.test.ts` asserts the roadmap's P5b bullet and the section 11 row contain `access-changing`, `destructive`, `credential` and `confirmation`; `docs/NEXT.md` has the heading "What P5b inherits" linking `protocols/mcp-route-classes.md (under docs)`; `docs/phases/p5a.md` has the same heading and link; the document's W2, C and D placements are all `P5b`; `roadmap-section-11.test.ts` (both directions) is green after the reword.
- [ ] **Steps 2-5.** Commit.

### Task 19.2: What an agent can and cannot do, and why

**Files:** `apps/docs/content/en/guides/{connect-claude,connect-cursor,protect-an-mcp-server}.md`, `concepts/consent-and-audit.md`; create `tests/docs/mcp-agent-capabilities.test.ts`.

**Interfaces:** each guide carries the same table: classes R, W1, then "not yet" W2, C, D, "never" RS and N, each with a plain sentence of why and what a person does instead (use the console; the confirmation step arrives with the later release), with the counts of §3 in the table; the landing page's MCP card (`apps/docs/src/features/landing/services/capabilityCards.ts`) says the same in a sentence.

- [ ] **Step 1: Failing test:** the table in each guide names every class and its count equals the route table's; a sentence says access-changing and destructive operations are not available yet. **Steps 2-5.** `guides-runnable`, `concepts`, `links` green.

### Task 19.3: The closing pass (CLAUDE.md, six items)

- [ ] **Step 1:** the roadmap's "What is not implemented" markers re-read for truth (item 1); `git grep -n -E '\bP5b\b|read-only|destructive|not a tool' -- apps/docs README.md tests/docs docs/NEXT.md docs/phases` and every hit made true (items 2 and 5), including the landing page's MCP card, `README.md`'s feature list, `tests/docs/questions.md`; the headings of `docs/NEXT.md` against closed phases (item 3); the roadmap reconciled against section 11 and `docs/NEXT.md` in both directions (item 4, `roadmap-section-11.test.ts`).
- [ ] **Step 2:** `CHANGELOG.md` `Unreleased`: _Added_ (the tenant list tools, eleven branding reads, six small reads, ten content-write tools), _Changed_ (the MCP guide's capability table), _Security_ (the write budget, the per-route allowlist by field; nothing access-changing is reachable by an agent). Item 6.
- [ ] **Step 3:** whole-branch review of the parity increments (spec compliance and quality, Sonnet), fix loop to clean; `docs/phases/p5a.md` completed with what building found; `git mv` this spec and plan to `docs/archive/`; `pnpm verify` green; finish with `superpowers:finishing-a-development-branch` (the merge into `main` is the owner's approval).

---

## Self-Review

- **Coverage:** §3 counts: 12 (2 tools), 13 (6), 14 (11) make 19 reads; 16 (5 new + 1 extended), 17 (3), 18 (2) make 10 new writes; 15 and 19 add no tools. §5.1 to §5.9 each land in 15 to 18; §6 in 12; §8's seven places in 15.4, 19.1 and 19.2; §10's decisions are inputs the owner confirms before Increment 16 (decision 2) and 18 (decision 9).
- **Dependency order:** 12, 13 and 14 are independent of one another and of 15; 15 precedes 16 to 18 (the door, caller, budget, class document); 16, 17 and 18 are independent of one another; 19 last. 12 to 14 can run before the owner settles §10.
- **Unverified by a command and settled inside an increment:** the in-process caller's bearer for a system-tenant token (12.2), the audit count's index (15.3), create usecases' audit `detail` (16.1), the 512 KiB theme path (18.1), role and group limits (16.1), whether a message override PUT needs `If-Match` (17.1).
