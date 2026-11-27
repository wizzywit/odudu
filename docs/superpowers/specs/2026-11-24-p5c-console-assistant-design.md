# P5c — The console assistant: design

**Status:** Draft for approval · 2026-11-24
**Depends on:** [P5](../../archive/specs/2026-11-24-p5-agent-identity-design.md) (instances, budgets, approvals). **Followed by:** P5b.
**ADRs:** 0055 (the open product ships it), 0056 (the SDK runs the loop, we own the hooks), 0057 (one agent, modes, slots, sub-agents by profile), 0058 (two records: audit and trace), 0059 (an approval is one object with two channels).

## 1. Intent

An administrator opens a panel in the console, says what they want in words, and an
agent does it in a loop: reads what it needs, explains, proposes, and changes what it
is allowed to once the person approves. It must solve what the console can solve,
cost what a careful person would pay, and leave a record a person can read when it
goes wrong. It works with the operator's own model provider and key; without one,
nothing about it appears and the console is exactly what it is today.

Why: adoption and difference. Okta and OneLogin expose an API to someone else's
assistant, and JumpCloud has an assistant that pauses for approval. I found no
self-hosted, open-source identity provider that puts an in-console agent, delegated
and budgeted authority, an approval the agent cannot give itself, and any model in
one product. That combination is the claim this phase makes true.

## 2. Goals, non-goals, anti-goals

**Goals.**

1. A chat panel with Ask and Act modes, a visible activity feed, an approval card,
   a token meter and a stop button.
2. A provider port with Amazon Bedrock (the owner's bearer key first), Anthropic
   and OpenAI behind it, and any server that speaks the OpenAI chat protocol (vLLM,
   Ollama, LM Studio) for an operator who keeps the model inside their own network,
   all chosen by configuration.
3. Model slots (fast, standard, deep) and sub-agents chosen by task profile, so cost
   follows difficulty.
4. AI buttons inside console screens that open the same panel with that screen's
   context.
5. Token budgets at four levels, a tier extension point for the paid layer, and
   plain-language limits in the UI.
6. Two records of everything it does (ADR 0058) and a screen to investigate them.
7. Off, silently, when no provider is configured.

**Non-goals.** No tool beyond the 64 reads and, for writes, the surface section 5.3a fixes
(P5b widens the MCP endpoint's separately). No web, fetch or outbound tools. No
proactive, scheduled or whole-tenant review, anomaly detection or policy
suggestion: that is the paid managed assistant (ADR 0055). No voice, files or
images in. No memory across conversations in the first scope. No agent gallery.

**Anti-goals.** An assistant with a door of its own. A model that can approve its
own change. A spend nobody bounded. A trace the agent can read or edit. A screen
that shows AI to a person whose operator never configured it. An assistant that
reaches a tenant its conversation was not created for.

## 3. What already exists and is reused

| Need                                                      | Reused (checked 2026-11-24)                                                                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tools                                                     | `@odudu/mcp` catalogue: 76 tools with zod schemas and annotations (`packages/mcp/src/service/tool.ts`) mapped into the SDK's `tool()`             |
| Acting as the administrator                               | `mintAgentToken` (`packages/protocol-oidc/src/usecase/mint-agent-token.ts`), the admin API door's scope and capability checks (ADR 0040, 0050)    |
| One audit row per tool call                               | `agent.tool_call` (`packages/protocol-admin/src/usecase/access-audit.ts`)                                                                         |
| Loop, step cap, per-step model and tool choice            | AI SDK 7 `ToolLoopAgent`, `stopWhen`, `prepareStep`, `activeTools` (`verified:` read in the `ai@7.0.181` package docs, 03-agents/04-loop-control) |
| Approval statuses, history-aware policy, signed approvals | `toolApproval` (03-agents/06-tool-approvals; signing is `experimental_toolApprovalSecret`, marked experimental)                                   |
| Sub-agent pattern                                         | 03-agents/06-subagents: a tool whose `execute` runs another agent, summarised with `toModelOutput`                                                |
| Lifecycle events and OpenTelemetry spans                  | `Telemetry` interface and `@ai-sdk/otel` 1.0.181 (03-ai-sdk-core/60-telemetry)                                                                    |
| Streaming                                                 | `useChat` (client) and `pipeAgentUIStreamToResponse` (server)                                                                                     |
| Budget pattern                                            | P5a's `reserveAgentWrite` and P5's budget levels                                                                                                  |
| Evals and red-team                                        | promptfoo (MIT, Node) in CI                                                                                                                       |
| Prefilled forms                                           | the console's `creation-draft` entity                                                                                                             |

Built here because nothing off the shelf fits our tenancy and audit rules: the
budget ledger, the approval and conversation tables under row-level security, the
trace recorder, per-tenant gating, the router rules, and the UI.

## 4. Approaches considered

Settled in the brainstorm and recorded in ADRs 0056 and 0057: the loop is the SDK's
`ToolLoopAgent` with our rules in its hooks (rejected: our own loop, which the SDK
already provides; LangChain/LangGraph, Mastra, OpenAI Agents SDK, Claude Agent SDK
and LlamaIndex.TS, each for a reason specific to Odudu in ADR 0056); one agent with
sub-agents chosen by task profile (rejected: a multi-agent system from the start, at
three to ten times the tokens; and a user-visible gallery of agents). The SDK sits
behind a package boundary: only `@odudu/assistant` imports `ai`, at an exact pinned
version, so a major version is a one-package change.

## 5. Design

### 5.1 Packages and layers

A new server package `@odudu/assistant` with the five layers of CLAUDE.md. It sits
above the protocol packages, as `@odudu/mcp` does (ADR 0051), and imports the MCP
catalogue. Its routes live under `/admin/tenants/{tenant}/assistant/` so the console
gateway forwards them and the admin door authorises them by three new capabilities:
`use-assistant`, `read-assistant-activity`, `manage-assistant`. In the console:
`widgets/assistant-panel`, `features/assistant-actions`, `entities/assistant` and
`pages/assistant-activity`, within the existing layering rules.

### 5.2 Configuration and gating

The operator sets, in the environment (ADR 0015's rule; the key never reaches a
browser, a log or an audit row):

- `ODUDU_ASSISTANT_MODELS` mapping each slot to `provider:model`, for example
  `fast=bedrock:<id>,standard=bedrock:<id>,deep=anthropic:<id>`; and the provider's
  standard variables (`AWS_BEARER_TOKEN_BEDROCK` with `AWS_REGION`,
  `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). `assumption:` the Bedrock provider accepts
  the bearer key through `apiKey` and that variable, per its documentation; a spike
  runs it.
- `openai-compatible:<model>` as a slot's provider, for a self-hosted model, with
  `ODUDU_ASSISTANT_OPENAI_COMPATIBLE_BASE_URL` (required) and
  `ODUDU_ASSISTANT_OPENAI_COMPATIBLE_API_KEY` (optional). Slots may mix providers: a
  small local model on fast and a larger one on standard. The adapter is
  `@ai-sdk/openai-compatible` (`verified:` `npm view @ai-sdk/openai-compatible version
license` gave 3.0.94, Apache-2.0). The base URL is the operator's own trusted
  configuration, so a private or loopback address is allowed; this is not the client-
  supplied URL of ADR 0028.

**Self-hosted models.** Data then never leaves the operator's network, and the trace
and audit content stay local. What the operator must supply is a server that supports
tool calling for the chosen model (vLLM needs `--enable-auto-tool-choice` and a tool
parser for the model family; some models cannot make parallel calls), and, for the
token budget to be exact, usage reported on streamed responses (the provider's
`includeUsage` option); without it the ledger settles on an estimate and says so. No
prompt-cache saving is assumed. Tool inputs are validated by the door whatever the
model emits, so a malformed call is a refusal the loop sees and never a bad write, and
Act-mode writes still wait for the person. `assumption:` Ollama's OpenAI-compatible
endpoint supports streamed tool calls well enough for the loop; not yet run, so the
spike runs it. Quality, not safety, is what varies by model, which is why "supported"
is defined by the golden tasks (5.10) and not by a model's benchmark score.

The **standard** slot is required. An unset **fast** or **deep** slot falls back to
standard, and a profile that names deep runs on standard. A configured slot whose
provider key is missing is treated as not configured at boot, with one startup line
naming the variable. The assistant is enabled exactly when standard resolves, and
`status` reports the resolved slots and the allowed modes.

With no standard slot, `GET …/assistant/status` returns `{ enabled: false }`, the
console renders no AI element, no AI route does anything, and the MCP endpoint is
unaffected. A tenant administrator with `manage-assistant` can switch it off for the
tenant, choose the default mode, set email masking, trace retention and whether
conversations are visible to auditors (default yes, shown to every user in the
panel).

Entitlements are an interface the paid layer replaces:
`limits(tenant) → { monthlyTokensBySlot, allowedModels, toolClasses, modes,
maxConcurrent, maxStepsPerTurn }`. The open default reads tenant settings. The open
product never depends on the paid implementation.

Where a system administrator uses the assistant in another tenant, that tenant's switch,
email masking and Act setting apply as well as their own tenant's, and the stricter wins:
both must have the assistant on, either may mask, and a mode is offered only where both
offer it. The token limits and the four budget levels are the administrator's tenant's,
which pays. Trace retention and whether auditors see conversations are the administrator's
tenant's, because the conversation's text lives there; enforcing the shorter of the two
retentions waits for the trace pass (docs/NEXT.md, "What P5c inherits").

### 5.3 The engine

A conversation is one agent _instance_ of P5, owned by the signed-in administrator,
with a sliding idle lifetime that never passes their session; each model-driven tool
call gets a short admin token from `mintAgentToken` (P5 section 5.1), whose `act.sub`
is that instance, so its scopes, expiry and budget slice are P5's invariants and a
sub-agent is a child instance.

The conversation's identity is derived from the administrator's console session
(ADR 0060). When a conversation is created, the server makes one grant for the
built-in client `odudu-assistant` that every tenant has: the same subject and session as
the console grant, `exchangedFromGrantId` the console grant, and a scope that is
`mcp:read` in Ask mode and nothing wider. The grant is made from the verified console
principal, never from the request body, and is stored under the conversation's id, in the
transaction that creates the conversation. `mintAgentToken` is called with that grant,
unchanged, so the instance, its expiry, its budget slice and its revocation are P5's, and
its `scope_widened` rule is the ceiling. Ending the console session or revoking the
console grant ends every conversation under it. A conversation that rests past the
instance's idle lifetime is not ended: its run key is the conversation's id and a
generation, and the next tool call finds the instance lapsed, moves the conversation to the
next generation once and mints a new instance for it, while the old one stays ended. No
other refusal moves it on. Changing a conversation to a mode that
writes is a new grant with its own scope and its own approval, not a widening of this
one. Audit rows name `odudu-assistant` as the actor client and the administrator as the
actor subject. Cost: one grant row per conversation, removed with its session by the same
reaper that removes any grant; administrators are few and a conversation is a human act.

When the administrator is a system administrator acting in another tenant (the owner's
decision of 2026-11-26, ADR 0060's last amendment, which reverses P5a's decision 3 for the
assistant alone), the conversation, its grant, instance, approvals, budget and trace belong
to their own tenant, and the conversation names the tenant it acts in, fixed at creation from
the verified path. The tool calls are made in that tenant with the administrator's own
authority: the admin API checks `manage-tenants` and the route's capability on every call,
and admits the assistant's token at that one tenant's routes only. The assistant names no
tenant in a tool call, and `odudu mcp` and external agents keep the same-tenant rule. A
conversation in another tenant is Ask only in its first scope.
A tenant that lists `delegated_actors` on its console client must name `odudu-assistant`
there, or the assistant fails closed. A turn is a `ToolLoopAgent` run.
Our code lives in the SDK's hooks:

- `prepareStep`: reserve budget (5.5); pick the slot from the task profile and
  escalate after a failed step or on request; narrow `activeTools` to the profile
  and the mode; trim and compact history.
- `stopWhen`: the profile's step cap and an exhausted budget.
- `toolApproval`: a policy over mode, tool annotations and the approval rules: reads
  are automatic; a write in Ask mode is denied with a reason the model sees; a write
  in Act mode is `user-approval`, which stores an `agent_approvals` row (P5) and
  surfaces the card. The decision arrives from the person's authenticated request,
  never from the agent's token. A write outside section 5.3a's surface is not in the tool list.
  **Resuming:** the conversation's messages, including the pending
  `tool-approval-request`, are stored in PostgreSQL. On a decision any server instance
  loads them, appends the `tool-approval-response` and calls the agent again, which is
  the documented flow (`verified:` 03-agents/06-tool-approvals). Our own check does not
  rest on the SDK's experimental signing: before a tool runs, P5's `consume` spends the
  approval in one conditional update that succeeds only while the row is `approved`,
  unexpired and its digest (P5 section 5.7) equals that of the call about to run, and the
  tool runs only when it does, so of two server instances racing on one approval one
  runs the write. A call that fails after consumption leaves the approval consumed; the
  model sees the failure and a retry asks again. The SDK's signature, if stable, is a
  second line.
- A tool's input is validated against its schema, passes the door under the owner's
  capability and the agent's scope, and writes its `agent.tool_call` row, which now
  carries conversation and turn ids. If the row cannot be written the call does not
  run.

Anything the model can do beyond the surface below it does by preparing, not performing:
"prepare a client for my app" returns a structured draft that opens the console's
existing creation form pre-filled, and the person submits it.

### 5.3a The write surface (owner ruling of 2026-11-27, amends the first scope's 12 writes)

Act covers every console write except the human-only list below. The reasoning, the
tiers and the guard are [ADR 0061](../../adr/0061-the-assistants-write-surface-tiers-human-only-operations-and-the-coverage-guard.md);
the increments are [the plan](../plans/2026-11-27-p5c-act-surface.md). Tiers: **A** an
approved card; **B** a card plus a confirmation of the removal; **C** a card, a set-diff
where a list is replaced, and the target's name typed in the decision; **X** human-only.
Every write stays approved by the person, audited, and never `auto`. A tier rises by
target on the server: a target that reaches an administrator capability, the owner, a
built-in client or the conversation's own grant is X.

**Human-only, one line each** (owner may overturn: marked "yes" with what it waits for):

- Secret-returning creates: a confidential client, a client secret, a registration token and
  a subject's one-time password. The model would carry the secret into stored messages, trace
  and provider. The assistant prefills the console form and the person submits. Yes, with a
  reveal channel.
- The mail relay (`PUT ~/smtp`): its password would arrive through chat. Prefilled form. Yes.
- Anything reaching an administrator capability, decided per target on the server: role,
  group, composite, default and group-role changes, subject roles and groups, and a change to
  or deletion of an administrator or the owner. Yes, once a delegated-administrator rule exists.
- `DELETE ~/sessions` for the tenant: it has no "except mine", so it ends the approver's own
  session and the run. Yes, once the route can exclude the caller.
- The assistant's own settings and evidence: its mode, budget and allowance, the built-in
  clients, `audit_retention_days`, its own agent lineage. No.
- The nine conversation routes: the approval decision must not be reachable by the model. No.
- `PATCH ~` with `enabled` and `DELETE ~`: a disable ends the conversation's session, a delete
  loses the tenant. No.
- `POST /admin/tenants` and `POST /admin/tenant-imports`: no tenant to bind a grant to, and
  the import returns fresh secrets. Placed on the next phase. Yes, with an instance-write door.
- `POST ~/theme/assets` (a raw image body) and the two verified-claim fields of a subject's
  profile (only the mail flow sets them). No.

Bulk subject creation (`POST ~/subjects/bulk`) is a tier C tool with a batch bound; the owner
may overturn. The reads are accounted for the same way: every one is a tool or a registered
exclusion with a reason, three gain a tool (registration tokens without the token, a subject's
credential types, a masked mail relay status) and the assistant's own exclusions are a list
(ADR 0061).

### 5.4 Modes, slots, sub-agents, routing

Two modes, **Ask** (reads only, the default) and **Act** (reads plus writes that wait
for approval). A mode narrows tools and never widens them past the token and the door.
Three slots, **fast** (titles, summaries, sub-agent reads), **standard** (the loop),
**deep** (planning and hard reasoning). A person sees a model picker only when the
operator allowed more than one standard model.

A _task profile_ is data: `{ id, mode, slot, tools, subagents: allowed|required|never,
maxSteps, maxTokens }`. Free chat starts on standard. A button starts its profile.
A sub-agent is used when a profile requires one, or allows one and a result would
otherwise be large: reading an audit range, reviewing several objects in parallel, or
isolating a read-only tool set. A profile that says `never` has none; it runs on the fast slot with a share of the parent's budget and
returns a short summary. Routing is rules plus escalation, not a trained router
(RouteLLM is Python; a classifier call costs tokens too); evals decide whether more is
needed. Static prompt and tool definitions come first and per-tenant text last, so
provider prompt caching can hit (`assumption:` cache control works through the SDK's
Bedrock provider; spike).

### 5.5 Budgets

Four levels, each a conditional `UPDATE … RETURNING` like P5's: tenant per month and
slot, administrator per day, conversation, turn (steps and tokens). The unit is
tokens by slot, not dollars, so no price table is needed. Before each model call
`prepareStep` reserves an estimate (input plus the call's maximum output); when the call
finishes, errors or aborts, a hook settles the difference from the provider's reported
usage, so the last call of a turn is settled too.

The input estimate is an upper bound, never a guess: the provider's own token count
where it offers one, otherwise one token per byte of the serialised request, which no
tokenizer exceeds (`assumption:` for each supported provider; a test sends adversarial
text and compares). Where a provider still reports more than was reserved, the actual
is charged, the overrun is audited in `assistant.budget` and the next reservation
refuses, so one call can overshoot and a second cannot.

A reservation records whether its call was sent. The reaper releases a swept
reservation whose call was never sent, and **charges a swept one that was sent in
full**, since the provider's outcome is unknown; a crash cannot make tokens free, and
repeated crashes cannot spend past the limit. At 80% the panel says so; at the limit the turn stops with a message
that names the limit and who can change it, and nothing is silently downgraded to a
cheaper model. A concurrency cap per tenant and a rate limit per administrator
apply. Open defaults are conservative; the paid layer sets tier numbers.

### 5.6 Task profiles in the first scope

| Where                 | Profile                                | Mode       | Notes                                                                                 |
| --------------------- | -------------------------------------- | ---------- | ------------------------------------------------------------------------------------- |
| Anywhere (⌘K)         | Ask anything                           | Ask or Act | page context passed in                                                                |
| Subject               | Why can't this person sign in?         | Ask        | lockout, required actions, sessions, factors, roles                                   |
| Audit                 | Explain this event; what happened here | Ask        | sub-agent for ranges                                                                  |
| Client                | Review this client                     | Ask        | redirects, grants, PKCE, scopes                                                       |
| Clients               | Prepare a client for my app            | Ask        | returns a pre-filled form                                                             |
| Roles, groups, scopes | Design these for …                     | Act        | uses the three create tools, each approved                                            |
| Branding              | Draft a theme from a brand colour      | Act        | `update_theme_draft`, a person publishes                                              |
| Settings, messages    | Translate my wording                   | Act        | message overrides                                                                     |
| Flows                 | Build this flow from a description     | Ask        | only if the flow editor accepts a pre-filled draft; otherwise dropped from this scope |

Open versus paid (ADR 0055): per object, on demand, started by a person is open;
whole-tenant, scheduled and proactive is paid.

### 5.7 The experience

The panel docks at the right, opens from a header button, ⌘K or a screen's AI button,
and keeps its place across routes. It shows: a header with mode switch, model picker
(only if more than one), the token meter and close; the conversation; under each
assistant message a collapsible activity feed whose lines read "Reading 3 subjects",
"Checking lockout state", each with state (running, done, failed), duration and an
expander for the raw call; an approval card for a write with a title, the exact change
as before and after, the approver's two buttons and a countdown to expiry; a stop
button always present while running; an input with the page context chip it will send.

Feedback is stated at every point: connecting, thinking, each tool step, waiting for
approval ("Waiting for you"), stopped by step limit or budget (named), failed
(plain cause, what to do, a trace id), and finished. Errors never show a raw stack.
A first-run notice says where data goes (the provider, or for a self-hosted endpoint
its host) and who can see conversations.
Accessibility: focus moves into the panel and back, a polite live region announces
status, every control is keyboard reachable, and wording is constants in the console's
`services` per its rules, so P4h's localization reaches it. Model text renders as
sanitised markdown with no automatic loading of remote images and no navigable
external links.

### 5.8 Security

Design rule: Meta's Agents Rule of Two. The assistant reads untrusted text (names,
descriptions, audit detail), holds sensitive data and can change state, so it must not
do all three unchecked; approvals restore the third, and it has no outbound tool.
Tool output is fenced as data (the MCP package's existing labelling). The assistant
cannot read, write or switch off its own audit or trace, or change its budget or mode.
Provider key handling as in 5.2. Masking of email addresses before they reach the
provider is a tenant option. Prompt injection is tested against a real model, nightly
(5.10).

### 5.9 Two records and observability (ADR 0058)

**Audit** (long retention, existing `audit_events`): `assistant.turn` (conversation,
turn, profile, slots used, tokens by slot, steps, stop reason), `assistant.approval`,
`assistant.budget`, `assistant.config`, and the existing `agent.tool_call` with the new
ids. No message text. A tool call made in another tenant leaves its
`agent.tool_call` row in that tenant's trail, naming the administrator and the
conversation; the turn, budget and refusal rows stay in the administrator's tenant and name
the target, and an approval is recorded in both. The target's own administrators therefore
see the actions, and never the conversation text.

**Trace** (short retention, default 30 days, tenant-scoped tables):
`assistant_conversations`, `assistant_turns`, `assistant_steps`, `assistant_events`. A
small `Telemetry` integration records the SDK's lifecycle events (model call, step,
tool start and end, errors, aborts) and our own decisions (slot chosen and why,
reservation, narrowing, policy outcome, trimming) under one turn id, with sub-agents
nested under the step that spawned them, the provider's request id and a hash of the
system prompt and profile. OpenTelemetry via `@ai-sdk/otel` goes to the operator's
collector with no content by default. A tool result carrying a one-time secret or key
material is masked before the recorder stores it (ADR 0058). `assumption:` a per-call integration replaces
global ones, so each call passes both; a test proves neither is dropped, and a spike
confirms sub-agent runs nest under their parent.

**The activity screen** (`read-assistant-activity`): filter by person, conversation,
tool, outcome, approvals and budget refusals; open a conversation as a replay of every
step with model, tokens, tool call and result, approval decisions and "why this model"
and "why it stopped"; a "report this answer" control on each turn keeps that
conversation past retention; export a trace as a promptfoo test case so a defect
becomes a permanent regression test. Retention removes traces through a command-first
reaper (ADR 0024).

### 5.9a A person's conversations: list, reopen, hide, export, delete (owner decisions of 2026-11-26)

This adds to 5.9 what the plan's fourth gap (no self-delete) had left out, by the
owner's decision of 2026-11-26, and states 5.9's retention once. What is built is below.

- **The list and the reopen are the caller's own.** `GET .../assistant/conversations`
  lists the caller's conversations, newest activity first, hidden or not by
  `archived`, one indexed page of at most `limit` rows (partial indexes by owner for
  each state; the tenant filter is the key's first column). `GET .../assistant/last-conversation`
  returns the most recent one that is not hidden, with its messages, or null. Both
  take `use-assistant` and filter on the token's subject, so another capability, an
  auditor's included, reads none of it; a conversation made for another tenant lists
  only at that tenant's path (`conversationIsCallers`). The title is derived once, on
  the first message, by `titleOf`: the first line, with emails, links, long numbers
  and masked secrets removed, 60 characters.
- **Hide is `PUT .../archived`.** A timestamp, reversible, removes nothing, and does
  not change retention.
- **Delete is the owner's, with a tombstone.** `DELETE .../conversations/{id}` removes
  messages, trace and approval cards in one transaction and keeps a row in
  `assistant_conversation_tombstones` (ids, owner, times, who deleted it, message and
  turn counts, an HMAC-SHA256 of the messages under a per-tenant key derived from the
  KEK) beside an `assistant.conversation_deleted` audit row written in the same
  transaction. It is refused with `409` while the conversation is reported or a turn
  holds a live lease on it; a delete whose audit row fails deletes nothing. No audit row
  is ever touched by a delete. The conversation's grant is revoked after the commit.
- **Export is the owner's alone.** JSON or Markdown, the first 500 messages, secrets
  hidden, tool names and no tool input or result, each export an
  `assistant.conversation_exported` row. No route lets an operator or an auditor take a
  conversation's text out; auditors read through the activity routes only, where the
  setting and `assistant.text_read` apply.
- **Retention** is unchanged in shape and stated here once: 30 days by default, 1 to 365,
  counted from the last message, a shorter value applying at the next pass, a reported
  conversation kept. Content retention and audit retention are independent: a delete or
  an expiry never touches an audit row. The default of `assistant_auditor_visible` is off
  (migration 0156), so auditors see metadata and read text only where a tenant allows it.
- **Reopening after a sign-in carries the conversation on** (owner ruling of 2026-11-27, ADR 0060's
  amendment). A conversation's grant is derived from the console grant that was live when it began
  and ends with it. A message to a conversation the caller owns that is not archived, whose grant is
  not live from the sign-in the request came on, is answered under a **new** grant made from the
  current console grant by the same derivation as `grantAssistantAccess` (current capabilities only,
  nothing from the old grant; across tenants the caller must still hold `manage-tenants` and
  `use-assistant` and the target must still offer the assistant). The conversation row holds the new
  grant in `grant_id` (null: the grant stored under its id), moves to the next `run_generation` (a new
  agent instance; the lapse retry is unchanged) and the old grant ends, all in one transaction under
  the conversation's row lock, with an `assistant.reattached` row (`admin_mutation`, like
  `assistant.turn`) naming both grant ids, the conversation, the tenant, the target and the actor.
  The model is told in its system instructions that earlier tool data was read under an earlier
  sign-in and may be stale. Budgets and limits count by tenant, person and conversation and are
  unchanged. Updating the revoked grant in place was rejected: it would revive a grant someone
  revoked on purpose and break the budget lineage its instances hang from.
  **The rule for a grant revoked for cause.** `token_grants.revoked_cause` is `sign_out` only where
  the revoking path knows the person ended their own sign-in (the console revoking its own refresh
  token, an RP-initiated logout, a person ending their own sessions); every other revocation leaves it
  null. A conversation is carried on when its grant is live, or ended with the console grant it was
  derived from, which carries `sign_out`, at the same instant (the sign-out's cascade stamps one
  time); a sign-in that lapsed without a revocation is carried on too. Anything else, a grant
  revoked earlier or for another reason, a missing grant or one of another subject, is refused `409`
  `conversation-ended`, with an `assistant.access_refused` row. An archived conversation is refused
  `409` `conversation-archived`, a sign-in that may not hold the new grant `409`
  `conversation-access-refused`; a different owner, a deleted conversation and another tenant's path
  are `404`. `last-conversation`'s `continuable` is true when a message would be answered.
- **Bounds at 1,000,000 subjects and 100,000,000 audit events.** A list page is one read
  by `(tenant_id, owner_subject_id, last_active_at, id)` of at most 201 rows. Reopening is
  one list row and one message read of at most 100. Hiding, titling and a delete's lookup
  are by primary key. A delete or an export walks the messages 50 at a time, so memory
  is bounded by a page and the work by one conversation, which retention and the
  token limits keep small; a delete walks all of it under the row lock and an export stops
  at 500 messages. A tombstone is one row for each deleted conversation, removed with its
  person or tenant, and no list reads it. Nothing here reads the audit table.

### 5.10 Testing and evals

Unit tests with a mock model (`assumption:` the SDK exports mock models from `ai/test`)
and the SDK's own telemetry events; a fixture-driven golden task for each profile with
a token ceiling, so a prompt or model change that raises cost fails CI; a nightly job
runs the golden tasks against a self-hosted model (vLLM or Ollama in a container), and
the models that pass are the published supported list; promptfoo
injection and red-team scenarios for each tool class, run against recorded fixtures on
every PR and against a live model nightly with the owner's key as a repository secret;
integration tests on real PostgreSQL for the ledger under concurrency, the approval
tables and every new table with a foreign-tenant probe; console component and
Playwright tests for the panel states; documentation tests per CLAUDE.md.

### 5.11 Performance and scale

Conversation state lives in PostgreSQL and the server holds none, so any instance can
resume after an approval. History is bounded and compacted. Steps are bounded by the
profile; traces are bounded by retention and indexed by conversation and time; the
activity list is paged under `MAX_LIMIT` and served by an index. Per-tenant
concurrency and per-person rate limits bound load; a provider outage degrades to a
clear message, with an optional fallback model per slot. Model IDs are pinned, never
"latest".

The assistant stream goes through a sibling `forwardStream` use case in the console
gateway, not a streaming mode in `forward`, which every admin call shares. A stream
has no body limit and no retry; its bound is the step cap and `maxTokens`, and a
browser abort reaches the upstream through an `AbortSignal`.

## 6. Documentation owed

Concepts page and a guide to enabling it with Bedrock, Anthropic and OpenAI; a guide
to self-hosting with vLLM and Ollama, with the list of models that passed the golden
tasks and the server flags each needs; the
console area page and tour with screenshots; the configuration reference for the new
variables and settings; the transcripts for the new routes, re-run on a live stack;
the landing page's "Planned" agent band turned into a shipped one; `README.md`;
`CHANGELOG.md`; and the privacy and security notes. The closing pass of CLAUDE.md
applies.

## 7. Increments

0. Spikes: Bedrock bearer key through the SDK; `experimental_toolApprovalSecret`;
   prompt caching; an OpenAI-compatible endpoint (vLLM and Ollama) through the SDK:
   streaming, tool calls and usage with `includeUsage`; sub-agent nesting in traces; streaming through the console
   gateway (`packages/console-gateway/src/usecase/forward.ts` forwards a whole
   buffered `response.body`, so a stream needs either a streaming mode in the proxy
   or a sibling route in the gateway package that resolves the console session the
   same way; the spike picks one, and the other is rejected in the plan with its
   reason; the estimate includes either); `@ai-sdk/react` with React 19.3.
1. Package, configuration, provider port, status route and gating (nothing renders
   without a key).
2. Engine over `ToolLoopAgent` with the read tools, conversations in PostgreSQL, the
   streaming route, mock-model tests.
3. Budget ledger, limits, entitlements interface, settings.
4. Act mode: approvals, the card's server side, the first 12 writes.
5. Trace recorder, audit rows, reaper, activity API.
6. Console panel: chat, activity feed, meter, modes, ⌘K.
7. Task profiles and AI buttons, prefilled drafts.
8. Activity screen, report control, promptfoo export.
9. Sub-agent tool and routing with escalation.
10. Evals, injection suite, golden tasks in CI; documentation; closing pass.
11. The write surface of section 5.3a and the reads' accounting, in the plan
    `2026-11-27-p5c-act-surface.md`: W0 to W6 (door, tiers, the tools), R1a and R1b (reads,
    assistant exclusions, injection coverage) and F1 (prefilled drafts of the human-only
    creates). 66 hours.

Estimate 190 to 230 hours.

## 8. Exit criteria

The MCP endpoint and `odudu mcp` behave as before for outside clients, with or
without an assistant configured; the `mcp` CI job passes with no changed expectation.

With no provider configured the console is unchanged and no AI route acts; with one,
a person completes each profile in section 5.6 with every step visible; a write never
runs without the person's approval and a model cannot approve; budgets are atomic
under concurrent turns, and an approval is consumed by exactly one of any number of
parallel callers; a turn stops with a named limit, the input estimate bounds a call's
actual usage, and a test that kills a process mid-call shows the swept reservation
still counted; swapping the provider is a
configuration change proven by running the golden tasks on two hosted providers and on
one self-hosted model; every turn
leaves an audit row and a trace that the activity screen replays, and if the row
cannot be written the action does not run; the injection suite passes against a real
model; every console write is an assistant tool of a tier or a registered human-only entry
with a reason and a decision, and every read is a tool or a registered exclusion, both held by
`tests/lint/mcp-tool-coverage.test.ts`; every new table is probed with a foreign tenant; documentation, transcripts,
screenshots and `CHANGELOG.md` are current.

## 9. Residual risk stated

A model can still be wrong inside what it may do; approval, the capability ceiling and
the budget bound the cost of that, and the trace makes it findable. Data goes to the
provider the operator chose; the notice and masking are the control. A self-hosted
model may be weaker at multi-step tool use than a hosted one; the supported list is
what the golden tasks proved, and approval and the door bound what a weaker model can
do.

A system administrator's conversation holds the target tenant's data, as masked tool results
in the operator's own messages and trace, under the operator's retention and auditor
visibility; the target's retention and auditor setting are not applied to it yet. The
target's administrators see the actions in their own audit trail and not the text.

## 10. Open decisions (my calls, for the owner to confirm)

- Conversations visible to auditors by default; trace retention 30 days.
- Ask is the default mode.
- No silent model downgrade when a budget is spent.
- First-scope profiles as in 5.6; the flow profile may drop.
- Tokens, not dollars, as the budget unit.
- Provider failover is optional per slot, not default.
- Self-hosted models are supported through any OpenAI-compatible endpoint; "supported"
  means the golden tasks pass; the operator's base URL is trusted configuration.

## 11. What stays for other phases

More tools and the confirmation step for the withheld classes on the MCP endpoint: P5b. The
assistant's secret reveal channel, tenant creation and import, the delegated-administrator
rule for admin-reach changes and sessions without the caller: P5d. The managed
assistant, tiers, proactive work: the paid layer (ADR 0055). Memory across
conversations, voice, files: not scheduled.
