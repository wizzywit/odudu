# P5 — Agent identity layer and approvals: design

**Status:** Draft for approval · 2026-11-24
**Umbrella:** [section 9](2026-09-10-odudu-design.md) (the model) and section 11, row P5.
**Followed by:** [P5c, the console assistant](2026-11-24-p5c-console-assistant-design.md), then P5b.

## 1. Why this phase, and what changed since the umbrella spec

An agent that acts for a person needs three things the protocol already half
has: an identity of its own to delegate to, a bound on what it may spend, and a
way for the person to say yes to one specific action without the agent being
able to say it for itself. P4a built the RFC 8693 exchange and P5a built an MCP
server that spends a per-sign-in write budget. What nothing reads yet:

Paths below are under `packages/protocol-oidc/src/` unless a package is named.

| Gap                                | Where it stands today (checked 2026-11-24)                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No agent instance                  | `subjects.type` allows `agent_instance`; no row is ever made, no table holds an owner, parent, budget or expiry (`packages/domain-identity/src/schema/subjects.ts`)      |
| `may_act` is never minted          | `mayActPermits` allows an exchange when the claim is absent (`service/token-exchange.ts:142`)                                                                            |
| `may_act` is lost on refresh       | the refresh branch sets `mayAct: undefined` (`usecase/token-exchange-subject.ts:143`); no grant column holds it                                                          |
| Revoking a grant is not transitive | `tokenGrantRepository.revoke` updates one row (`repository/grants.ts:161`); `exchanged_from_grant_id` and its index exist (migrations 0059, 0095) and nothing walks them |
| Depth is a constant                | `MAX_DELEGATION_DEPTH = 8` (`service/token-exchange.ts`)                                                                                                                 |
| Budget is per sign-in only         | `reserveAgentWrite` on `token_grants.agent_writes` / `agent_creates` (`repository/grants.ts`)                                                                            |
| No CIBA                            | no `backchannel_authentication_endpoint` anywhere                                                                                                                        |

Two decisions made since the umbrella spec shape this design:

- **The instance is the actor, never `sub`.** Umbrella §9 says "`sub` is the
  agent instance". ADR 0050 and everything P5a shipped keep `sub` as the person
  and put the agent in `act`, which is what RFC 8693 means by delegation. This
  design follows the shipped wire: `sub` is the owner, `act.sub` is the instance.
  ADR 0003 and §9 get an amendment saying so.
- **An approval is one object with two channels** (ADR 0059): a console card
  (P5c) and CIBA (this phase). P5b's confirmation step and P5c's write approvals
  both consume it.

## 2. Goals, non-goals, anti-goals

**Goals.** Every item the roadmap and section 11 place on P5, and each item of
`docs/NEXT.md` "What P5 inherits":

1. Agent instances: minted by the exchange, reaped on TTL, with owner, type,
   parent, scope, budget, depth and expiry.
2. The four invariants of §9 as pure, property-tested functions: scope
   attenuates, TTL narrows and never passes the root session, depth is bounded,
   revoking a link revokes everything below it.
3. `may_act` minted from two sources and persisted on the grant, so presenting
   a refresh token escapes no restriction placed on its access token.
4. Delegation depth as a tenant setting.
5. A budget across a delegation: carved down a chain and shared over several
   sign-ins of one owner and agent type.
6. Approvals and CIBA (poll mode), end to end.
7. An operator's view: agents and approvals in the console, audited.

**Non-goals.** No LLM, chat or assistant (P5c). No new MCP tools and no change to
which routes an agent may reach (P5b). CIBA `ping` and `push` modes, `user_code`,
signed authentication requests and rich authorization requests are not built;
discovery says so. No grant type beyond RFC 8693 and CIBA's own. No change to how
a person's own token is issued.

**Anti-goals.** An instance that can widen anything its parent holds. An
approval a client can answer with its own credentials. A cascade that is not
bounded. A second pipeline beside stage 4 of the token pipeline (ADR 0003): the
layer consumes the exchange and introduces no grant of its own.

## 3. Constraints

- ADR 0003: touches stage 4 of the token pipeline only. ADR 0050: `sub` stays the
  person. ADR 0009: every new table is tenant-scoped under row-level security
  written as SQL in `packages/db/drizzle/`, and every repository method is probed
  with a foreign `tenant_id`. ADR 0041: a stated bound for every path at 1M
  subjects, 10k clients, 10k tenants and 100M audit events.
- Plan rule (CLAUDE.md): a claim about third-party behaviour carries
  `verified:` or `assumption:`; a claim about this repository is grepped first.
  The ones this spec rests on are in section 13.

## 4. Approaches considered

**Where an instance lives.**

- _A. No table: lineage only, on `token_grants`._ Least schema. Nothing names the
  instance, so there is no per-instance revocation, budget slice or audit
  identity, which is what ADR 0003 exists to provide.
- _B. A `subjects` row of type `agent_instance` plus an `agent_instances` detail
  row (chosen)._ The subject row is what `act.sub`, sessions, grants and
  revocation already point at, as P0 intended. The detail row holds owner, type,
  parent, root, depth, scope, budget slice and expiry.
- _C. One row per instance in `clients`._ ADR 0003 rejected this: unbounded
  client growth and configuration, not directory entries.

**How `may_act` gets minted.**

- _A. Per client only (operator names who may act)._ Simple, no new person-facing
  surface; the owner never decides.
- _B. Per person only, through the "me" API._ The owner decides; needs a new
  public surface, SDK and docs.
- _C. Both (chosen):_ a client's configured actors, and a person's own delegation
  records. The narrower of the two applies when both exist. The person-facing half
  is the first increment to split if the phase runs long, and is named for P5c if
  it is.

**CIBA delivery.** Poll only. Ping and push need a client-hosted endpoint and a
notification-security story that nothing here needs; discovery advertises `poll`.

## 5. The model

### 5.1 Instance

`agent_instances(tenant_id, id, owner_subject_id, agent_client_id,
parent_instance_id, root_grant_id, depth, scope, expires_at, revoked_at,
created_at)` with `id` also the `subjects` row's id. **An agent type** is a client with a new boolean `agent_type` in its OIDC
configuration, off by default, set through the admin API and console. A client
that is not an agent type exchanges exactly as it does today and mints no
instance, so nothing existing changes.

**Two paths make an instance, and both call the same `agents` service:**

1. Stage 4 of an RFC 8693 exchange whose requesting client is an agent type and
   whose `actor` is that client or an instance of it; a nested exchange by an
   instance mints a child.
2. `mintAgentToken` (`usecase/mint-agent-token.ts`), the in-process path the MCP
   endpoint and the console assistant use. Today it signs a short token for the
   owner's grant with `act: { sub: <agent client id> }` and writes nothing. For an
   agent type it first finds or mints the instance for the caller's _run_ (the
   assistant's conversation) and puts the instance id in `act.sub` instead, so the
   audit row names the instance. It stays a token bound to the owner's grant: it
   makes no grant, and a client that is not an agent type is unchanged.

An instance has no credentials, no session and no token of its own. It exists as
`act.sub`, as the holder of a budget slice, and as a node in a lineage. Its scope
is fixed when it is minted. Its lifetime is the shorter of its parent's and the
owner's session, and either a fixed TTL (exchange, default 15 minutes) or a
sliding idle TTL (a run that keeps making calls, default 30 minutes), extended on
use and never past the session. A run on a session lasts at most as long as the
session, subject to the idle limit and the parent's expiry; a run on a grant with no session is bounded at 24 hours from its mint. An
approval's expiry never outlives its instance.

`act` on the issued token is the chain it already is (RFC 8693 §4.4), now with
instance ids as `sub`. `token_grants.actor_subject_id` and `act_chain` already
record it.

### 5.2 Invariants (`agents` service, pure)

Given a parent and a requested child: `child.scope ⊆ parent.scope`;
`child.expires_at ≤ min(parent.expires_at, root session end)`; `child.depth =
parent.depth + 1 ≤ max_depth`; `fanout(parent) ≤ max_children`. The exchange's
existing `attenuateScope` and `expCeiling` are the first two checks; the service
generalises them and the exchange calls it. Property-based tests (fast-check,
MIT, 4.11.0, `verified: npm view fast-check version license`) generate random
chains and assert the four invariants hold for every accepted chain and that
every rejected request names the invariant it broke. Stryker runs on this service
beside `crypto`.

### 5.3 `may_act`

Persisted as `token_grants.may_act jsonb`, set when the owner's grant is made,
and read by the refresh branch of `resolveExchangeToken` in place of
`undefined`. Minted into the owner's access token. _Who_ may act is the union of the client's
configured actors and the owner's active delegations (`agent_delegations(tenant_id,
id, subject_id, client_id, actor_client_id, scope_ceiling, expires_at,
revoked_at)`); for an actor both name, the _scope ceiling_ is the narrower of the
two. With neither source, behaviour is unchanged: no claim, exchange permitted by
today's rule.

The person-facing half (three "me" API operations to list, create and revoke a
delegation, with the OpenAPI document, SDK and docs they bring) is in P5. If the
phase runs long it moves to the phase after P5c; P5c needs only the client-level
actors, so nothing waits on it.

### 5.4 Revocation

Revoking a grant revokes, in one statement, every grant reachable through
`exchanged_from_grant_id` and every instance rooted there. The walk is a
recursive query bounded by `max_depth` and by an in-statement row cap. The only
index today is partial and on `exchanged_from_grant_id` alone
(`packages/db/drizzle/0095_lookup_indexes.sql`), with no leading `tenant_id`; the
plan checks the plan under row-level security (section 13) and adds a composite
index if it is needed. A grant ended by session end, logout or reuse detection does the
same. Audit: one row for the root, with the count.

**Lock order.** Every revoker (a revoke of one grant, of a session, a client, a
subject or an actor, the admin's client-grants revoke, the instance revoke and
expiry, and the reaper's instance and grant deletes) first takes the _lineage
root_ of its seeds, the topmost grant reached by following
`exchanged_from_grant_id`, `for no key update` and in id order, and only then
touches any other grant, token or instance row. A client row is not part of a
lineage and comes after the roots wherever both are taken: retiring a client's
service account, by the retirement itself or by a client amendment that changes
its grant types, takes the roots of the account's grants before the client row
`for update`, because a grant insert for that client takes a key share on the row
and waits for it. The admin's client-grants revoke takes the client `for no key
update` first, which that key share does not wait for. Two revokers over one
lineage meet at the root and one waits; revokers of different lineages share no
row and never conflict. The worst case for lock volume is one row per distinct
lineage the seeds belong to, however many grants they are, taken a batch of at
most the cascade cap at a time. The reaper takes the roots `skip locked` and
leaves a lineage a revoker holds for its next pass. An exchange, a mint and a
budget spend each hold one grant and one instance (a spend holds the budget
root `for no key update` and reads the grant a call carries without a lock), and
none of them waits for a root while holding a grant or an instance: a mint
takes the root of its grant's lineage before the grant, because a refusal
revokes the run, which needs that root. Instance trees stay inside one lineage
because a child instance takes its parent's root grant (`agent-layer.ts`);
nothing in the schema enforces it.

Four cases can still deadlock. A pass of the cascade past the first (a child
committed after the first pass's snapshot, the depth-8 frontier, a capped pass)
locks grants while holding the instances of the passes before it, and an
exchange that holds a grant of that later pass and wants one of those instances
can deadlock with it. A root found late, because a middle grant was deleted
while a revoker waited, is locked out of id order. A revoke that picks its
seeds by a predicate (a session, a subject, a client, an actor) locks the roots
of the seeds it saw; a grant committed for the predicate after that lock, in a
lineage not yet held, has its root taken after the update, out of id order, and
another revoker queued on that root can deadlock with it; no lock on the
predicate closes this, only the window narrows. And an amendment or
retirement of a service account takes the roots of the account's live grants
before the client row, so a grant created for the account after that lock has
its root taken only by the revoke, under the client row, where an exchange
waiting for the client can deadlock with it (a window of milliseconds).
PostgreSQL aborts one of the two transactions with `40P01`. Its transaction rolls
back and the error reaches the caller: nothing in the server retries it, and the
global error handler (`answerServerError`) answers an error that carries no
status with `500 Internal Server Error`, so the exchange, the revoke or the
retirement has to be sent again.

### 5.5 Budgets

Three levels, each a counter spent by one conditional `UPDATE … RETURNING`:
the sign-in's own (exists, P5a); an instance's slice, carved from its parent's
remainder when it is minted; and a fixed 24-hour UTC bucket per owner and agent
type, `agent_budget_windows(tenant_id, owner_subject_id, agent_client_id,
window_start, writes)` (a create is also a mutating call, so one counter), for what an agent may spend over several
sign-ins. A call must clear all three or none: the three conditional updates run in
one transaction, taking their row locks in a fixed order (grant, instance,
window) so concurrent callers cannot deadlock, and any one refusing rolls the rest
back. The concurrency test in section 8 drives parallel callers through this. Defaults become tenant settings
(`agent_writes_per_grant`, `agent_creates_per_grant`, `agent_window_writes`),
replacing the server option P5a used.

### 5.6 Settings

`agent_max_delegation_depth` (default 3, range 1 to 8; 8 stays the structural
bound of the `act` parser), `agent_max_children` (default 20), `agent_max_live_instances` (a tenant cap,
default 1000), `agent_instance_ttl_seconds` (default 900) and
`agent_instance_idle_seconds` (default 1800), both bounded by the owner's session,
`agent_approval_ttl_seconds` (default 600, capped at 900), and the three budget
settings (`agent_writes_per_grant` 20, `agent_creates_per_grant` 10 and
`agent_window_writes`, default 1000, range 1 to 100000).
All on the admin API, console and in `docs/` generated reference.

### 5.7 Approvals and CIBA

`agent_approvals(tenant_id, id, subject_id, requesting_client_id,
instance_id, kind, summary, action_digest, state, decided_at, decided_via,
expires_at)`; `state` is pending, approved, denied or expired. One approval
authorises exactly one action named by its digest, once, before it expires. The
digest is SHA-256 over the canonical JSON of the tool or route name, its validated
input, the tenant, the owner and the instance id, so a changed argument is a
different action. One service, `decideApproval`, writes a decision, and both
channels call it: CIBA's approval page and the console card are different
endpoints over the same function.

CIBA (OpenID CIBA Core 1.0, poll mode):

- `POST /{tenant}/bc-authorize` from a client holding the grant, authenticated
  as at the token endpoint. Hints: `login_hint` (resolved in constant time and
  with an identical answer for an unknown person, so it cannot enumerate) and
  `id_token_hint`. `binding_message` is stored as validated text and escaped when shown. `requested_expiry`
  is capped by a tenant setting. Returns `auth_req_id`, `expires_in`, `interval`.
- Token endpoint grant `urn:openid:params:grant-type:ciba` returns
  `authorization_pending`, `slow_down`, `expired_token`, `access_denied` or the
  tokens. Polling is rate-limited per `auth_req_id`.
- Notification: the person gets a mail through the existing mail pipeline with a
  link to a server-rendered approval page (a `*-html.ts` renderer, ADR 0029, its
  strings in a catalogue per ADR 0043). The page needs the person's own session,
  shows the agent, the summary and the binding message, and approves or denies
  with a CSRF-protected POST. The link carries only the approval's id.
- Discovery advertises `backchannel_authentication_endpoint`,
  `backchannel_token_delivery_modes_supported: ["poll"]`,
  `backchannel_user_code_parameter_supported: false`.
- The client answers nothing: no endpoint or credential a client holds can set
  `state`; only the authenticated person's POST, or P5c's console card, can.

P5 ends with approval and token issuance end to end. P5b adds the door's
acceptance of an approved action for a tool of the three classes it withholds.

### 5.8 Console and audit

An "Agents" area (instances as a tree by lineage with owner, type, remaining
budget and expiry, a revoke action that says what it will cascade to; pending
and recent approvals) and the settings and client fields above. New audit actions
for instance minted, expired and revoked, delegation created and revoked, approval
requested, decided and expired, and CIBA request, poll refusal and token issued,
each with an allowlisted detail and an entry in the vocabulary's docs.

## 6. Performance and scale

At 1M subjects, 10k clients and 100M audit events: instances are bounded per
owner (`agent_max_children` per parent, a tenant cap on live instances) and
reaped by `odudu reap` as a command first and a timer second (ADR 0024); expired
rows are deleted after a tombstone window so lineage stays readable in audit.
Every list is served by an index and bounded under `MAX_LIMIT`; the cascade is
one bounded statement; pending approvals are capped per subject; CIBA polling is
rate-limited per request so a client cannot turn it into a load generator.

## 7. Increments (for the plan; each independently mergeable and green)

1. Placement and ADRs: section 11 splits P5 and adds P5c; roadmap, `docs/NEXT.md`
   and the tests that map them; ADRs 0055 to 0059.
2. The `agents` service and its property and mutation tests (no database).
3. Schema and repositories: `agent_instances`, `may_act` column, delegations,
   approvals, budget windows, with row-level security and foreign-tenant probes.
4. Exchange integration: mint and child-mint, depth setting, `may_act` minted and
   persisted, refresh branch fixed.
5. Cascade revocation, reaper pass and the budgets.
6. CIBA: endpoint, grant, discovery, rate limits, approval page, mail.
7. Admin API, console "Agents" area, settings, audit vocabulary.
8. Documentation and conformance: concept and guide pages, transcripts re-run,
   the CIBA reading note `oidc-ciba.md` in `docs/protocols/` and the RFC 8693 note, the CIBA conformance plan
   in `conformance`, `CHANGELOG.md`, and the closing pass of CLAUDE.md.

Estimate 100 to 130 hours, within the umbrella's 80 to 120 once the per-person
delegation half is counted; if it splits, that half moves and the figure returns.

## 8. Exit criteria

Property-based attenuation tests pass; every budget level atomic under concurrent
callers (an integration test with parallel callers asserts no overspend);
`may_act` minted, persisted on the grant and honoured when a refresh token is the
subject; revoking a grant revokes every grant exchanged from it and every
instance rooted there, in one bounded statement; `max_delegation_depth` a tenant
setting; CIBA poll mode end to end including the denial, expiry and
`slow_down` paths, and green on the OIDF conformance plan for it (see section 13);
no client credential can approve; every new table probed with a foreign tenant;
docs and transcripts current; `CHANGELOG.md` written.

## 9. Anti-requirements checked by test

An outside MCP client (Claude, Codex, Cursor or any other) signs in and works as it
does today: discovery, registration under an `mcp` policy, the `mcp:read` and
`mcp:write` scopes, the tool list and the P5a write budget (20 changes, 10 creates,
now read from tenant settings with those same defaults) are unchanged. The existing
`mcp` CI job and the MCP replays pass without edits to their expectations.

An instance cannot exceed its parent's scope or expiry for any generated chain;
a refresh token cannot be exchanged to escape a `may_act` its access token had;
a CIBA request for an unknown person returns what one for a known person does;
a client's own credentials cannot move an approval out of `pending`; a cascade of
a thousand-grant chain finishes in one statement.

## 10. Residual risk stated

CIBA approval by mail trusts the mailbox as much as a password reset does; the
approval page states the agent and the action so a person can refuse what they did
not start. An operator who enables an agent type accepts the budgets as the bound.

## 11. Open decisions (my calls, for the owner to confirm)

- Instance as actor, not `sub`; amend ADR 0003 and umbrella §9.
- Default depth 3, children 20, live instances 1000, instance TTL 15 minutes,
  idle TTL 30 minutes, approval expiry 10 minutes.
- Per-person delegation records through the "me" API are in P5; they are the
  first piece to move, to the phase after P5c, if the phase grows.
- Poll mode only.
- A client that is not an agent type is unchanged; the exchange is not refused
  for it.

## 12. What stays for other phases

Doors accepting an approval for a withheld tool, the three route classes and
their confirmation UX: P5b. The assistant, its provider layer, budgets for model
tokens and the AI-facing console: P5c. An agent library for delegation: P14.

## 13. Assumptions to spike before a task depends on them

- `assumption:` the OIDF conformance suite has a CIBA poll plan the existing
  `conformance` job can run. Check against the suite release the job builds.
- `assumption:` `subjects` accepts an `agent_instance` row with no credentials
  (grep the constraints and the repositories that read `type`).
- `assumption:` a recursive CTE over `exchanged_from_grant_id` stays one bounded
  statement under row-level security with the 0095 index (`EXPLAIN` on the
  `query-plans` fixture).
