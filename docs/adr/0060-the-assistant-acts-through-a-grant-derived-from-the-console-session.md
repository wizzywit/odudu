# 0060 — The assistant acts through a grant derived from the console session

**Status:** Accepted · 2026-11-26

## Context

The console assistant's tool calls need the agent identity P5 gives an agent: an
instance as `act.sub`, an expiry, a budget slice and a revoke that ends it. P5's
`mintAgentToken` takes a grant that holds `mcp:read` and belongs to an agent-type client
(`agent-token-rules.ts`, `mint-agent-token.ts`). A console sign-in is a grant of
`odudu-admin` holding `openid`, and `odudu-admin` is not an agent type. Offered that
grant, the mint refuses `scope_widened`; with the refusal waived it would write no
instance and every audit row would name the client a person's own console actions use.
The ceiling cannot come from narrowing either: a token exchange only narrows (ADR 0050).

## Decision

**Each tenant has a built-in client `odudu-assistant`.** It is public, an agent type,
registers no redirect URI and holds `client_credentials` alone, which a public client is
refused, so no protocol endpoint can issue anything to it. It is marked
`builtin_assistant`, one per tenant, reserved at creation, never deleted through the
admin API, left out of a tenant export, and added to existing tenants by a backfill.

**A conversation holds a grant of that client**, made when the conversation is created by
`grantAssistantAccess`, from the verified console principal and in the transaction that
creates the conversation: the console grant's subject and session, `exchangedFromGrantId`
the console grant, scope `mcp:read` in Ask mode and, until a write has a grant of its own, in Act mode too. It refuses a grant that is not a live
sign-in of the built-in admin client in this tenant, that another subject owns, whose
session has ended, or that asks for a scope past the mode's ceiling. The grant's id is the
conversation's id, so nothing else has to remember it. `mintAgentToken` is not changed and
keeps refusing any scope the grant does not hold.

## Consequences

- Ending the console session, or revoking the console grant, revokes the derived grant and
  the instances rooted on it through P5's lineage; no new revoke code.
- The administrator's own capabilities still gate every call at the admin API, whatever the
  token's client; an operator who lists `delegated_actors` on the console client must name
  `odudu-assistant`, or the mint refuses the run.
- One grant row per conversation. Audit rows name `odudu-assistant`, and a refusal of a
  grant or of a call's token writes an `assistant.access_refused` row naming the person and
  a fixed refusal code.
- An instance that lapses from idleness is never revived for its old run key, so a
  conversation carries a run generation (`run_generation`); the next call after a lapse
  moves it on once and mints a new instance, and every other refusal leaves it where it is.
- The built-in client can be renamed, described and disabled, and nothing else: its redirect
  URIs, grants and agent type are what keep it unusable at the protocol endpoints.
- Spec 5.3 loses "No grant is made".

## Rejected

- **Widening `mintAgentToken` for console grants:** any console token could mint an agent
  token, and the mint stops proving that a person authorised an agent client to hold `mcp:*`.
- **A second mint with a bypassed scope check:** the ceiling becomes a constant inside the
  most sensitive function, every conversation of a session shares one root grant and so one
  child limit. It is the fallback if the grant insert is ever unacceptable.
- **An RFC 8693 exchange in process:** it only narrows, and a console token holds no MCP
  scope to keep.

## Amendment: an approved write has a grant of its own

The conversation's grant stays `mcp:read` in both modes, as this decision says. What
"until a write has a grant of its own" comes to is one more grant, made for one approved
change: `grantAssistantWrite`, in the transaction that spends the approval
(`consumeApproval`, for the digest of the call about to run), of the built-in client, for
the console grant's subject and session, `exchangedFromGrantId` the console grant, scope
`mcp:write` alone, and the approval's id as its own id, so one approval makes at most one.
`mintAgentToken` is called with it unchanged and no `run`, so the token's `act.sub` is the
client and no instance is made. The call goes through `callMcpTool` with `holdsWrite` and the
grant's write budget, which an exchanged grant draws from its root, and the grant is revoked
when the call returns. The decision that spends nothing but a person's attention is the
approval's, written only by `decideApproval` for the person it names, from their console
sign-in. The design and what was rejected are in `docs/phases/p5c-spikes.md`, "P5c act-mode
design". No P5 invariant changes.

A pending request is signed with a key derived from `ODUDU_KEK`. Rotating the KEK makes every
outstanding approval fail verification: unspent ones expire within 15 minutes, and a
conversation stuck on an approved request is cleared by the person's next message, which
closes it as not run. Nothing is lost.

## Amendment: a system administrator in another tenant

Decided by the owner on 2026-11-26: a system administrator acting in another tenant has the
assistant for that tenant. This reverses P5a's decision 3 (no cross-tenant reach for an
agent) **for the console assistant only**. `odudu mcp`, the MCP endpoint and every external
agent keep the rule that an agent acts only in the tenant that issued its token.

The conversation, its grant, its instance, its approvals, its budget and its trace are rows of
the administrator's own tenant (the system tenant), because the console grant they derive
from, the subject that owns them and the tenant-composite keys of every table involved are
there. `assistant_conversations.target_tenant_id` and `token_grants.target_tenant_id` name the
tenant the conversation acts in; both are null for a conversation in the administrator's own
tenant, which is unchanged, and neither can equal the row's own tenant. `grantAssistantAccess`
writes the target and refuses unless the console grant's tenant is the system tenant, the
target exists and is enabled and offers the assistant. `mintAgentToken` is not changed: the
token is issued by the system tenant, for the administrator, with the instance as `act.sub`.

The admin API's rule that an agent acts only in the tenant its token names gains one
exception, and only one (`agentReaches`, `@odudu/protocol-admin`): an agent token whose grant
is the built-in assistant client's, whose grant names a target, that carries the endpoint
marker and whose issuer is the system tenant, is admitted at the path of that target, which
must be enabled, and at no other tenant, the system tenant included. It was first admitted for
`mcp:read` alone; the amendment below admits the write grant of one approved change too. The
administrator's `manage-tenants` and the route's capability are then checked on every call, as
for the console, so a role removed mid-conversation takes effect on the next call. The
binding is a database row read from the grant, not a claim in the token, so a leaked
five-minute token reaches one tenant. A grant with no target, any other agent client and any
other tenant keep the rule as it was.

The target is fixed when the conversation is created, from the verified path, and never from
the request body or the model. A tool names no tenant, and a conversation in another tenant is
not offered the two reads whose route has none (`list_tenants`, `count_tenants`). A
conversation bound to one tenant is answered as a path never served at any other, the
administrator's own included. Where a system administrator uses the assistant in another
tenant, that tenant's switch, email masking and Act setting apply as well as their own tenant's
and the stricter wins; the token limits and the four budget levels are the administrator's
tenant's, which pays. Trace retention and auditor visibility follow the administrator's
tenant, where the text lives, until the trace pass applies the shorter retention of the two.

A tool call's `agent.tool_call` row is written in the target's trail with the administrator as
actor and the system tenant as actor tenant, so the target's own administrators can see that an
operator used the assistant there and which tools, never the conversation. The assistant's own
rows (`assistant.turn`, `.budget`, `.access_refused`) are in the administrator's trail and name
the target in `detail.target_tenant`.

Rejected, beside the list above: **a conversation in the target tenant with a foreign owner**
(it gives up the single transaction and the rule that a token's issuer is its subject's
tenant); **a stand-in subject per tenant** (its authority is kept equal to the operator's by a
sync, not by the door); **the console token as the agent's** (no ceiling, no instance, the
audit names `odudu-admin`). The design and the failing paths it replaces are in
`docs/phases/p5c-spikes.md`, "P5c spike: the assistant for a system administrator in another
tenant".

## Amendment: an approved change in another tenant

Decided by the owner on 2026-11-27: a system administrator who may Ask in another tenant may
also Act there, with the same approval card. The rules of the amendments above do not move; what
follows is the one place each now reaches across.

`grantAssistantWrite` takes the same `target` as `grantAssistantAccess` and passes it to the
same checks, so the write grant of one approved change is stored under the administrator's
tenant, names the target in `token_grants.target_tenant_id` and is refused unless the target
exists, is enabled and offers the assistant and the owner still holds `manage-tenants` and
`use-assistant`. That column is what lets the door admit the write: `agentReaches` no longer
refuses the write scope for the assistant's target grant, and the route's own capability is
checked as for any call. Every other agent token, and a grant without a target, keep the
tenant of the token. The approval, its card, the decision and the budget stay rows of the
administrator's tenant, decided only by the administrator's own console sign-in as before.

The approval's digest gains the target tenant when there is one, so an approval cannot be
spent for a call at another tenant; an own-tenant digest is unchanged. `assistant.approval`
carries `target_tenant`, and an approved decision is also written to the target's trail (the
administrator as actor, the system tenant as actor tenant, the approval, the tool and the
state, never the conversation or any text), because it authorises a change there. Where the
write of that row fails the decision stands and the failure is logged, as for a tool call's own
row.

Act is offered in another tenant only where both tenants offer it: `setConversationMode` and
`createConversation` read the target's limits in a transaction of its own, and a refusal for
the target's sake is `409` with the detail "the tenant this conversation acts in does not
offer Act", so the console can say which tenant. `readHead` applies the same stricter-of-two
rule on every turn, so a tenant that stops offering Act turns an Act conversation into Ask at
its next message.

Rejected: **a second write path with its own door rule** (the grant row is already the
binding, and a second rule would have to be kept equal to it); **approvals stored in the
target** (it gives up the single transaction and the single writer, as the conversation does).

## Amendment: a conversation is carried on after a new sign-in

A conversation's grant ends with the sign-in it was derived from, and the owner has ruled
that a person may carry an old conversation on after signing in again. A message to a
conversation of the caller's that is not archived, whose grant is not live from the sign-in
the request came on, gets a new grant made from that sign-in alone, under every check a first
grant meets, so the current capabilities apply and nothing the old grant held carries over.
The conversation row records the new grant in `grant_id` (null still means the grant stored
under its id), moves to the next `run_generation` so its agent instance is a new one, and the
old grant ends in the same transaction, with an `assistant.reattached` row. The row is locked
for the step, so two messages at once make one grant. Updating the revoked grant in place was
rejected: it would revive a grant someone revoked on purpose and break the budget lineage its
instances hang from.

The rule that decides it is the cause of the old grant's end. `token_grants.revoked_cause` is
set to `sign_out` only where the path knows the person ended their own sign-in: the console
revoking its own refresh token, an RP-initiated logout, and a person ending their own
sessions. Every other revocation leaves it empty (a reused refresh token, an administrator
ending a session, a recovered account, a removed client, a revocation of the conversation's
own grant), and a conversation under one is never carried on: it is refused `409`
(`about:blank#conversation-ended`) with an `assistant.access_refused` row. The conversation's
grant must also have ended at the same instant as the console grant did, which is what a
sign-out's cascade stamps; a grant that ended earlier for another reason does not match. A
sign-in that lapsed without a revocation, or one still held by another sign-in of the owner,
is carried on, and the old grant is ended as superseded. Default deny: a grant revoked before
the column existed has no cause and is not carried on. The server tells the model, in its
instructions and not in user text, that what its tools returned earlier may be out of date.

The console revoking its own refresh token is taken as the person's sign-out whatever made the
gateway do it, so a session the gateway cleaned up after a refusal the server did not itself
revoke is carried on like a lapse; the new sign-in's own checks (subject, tenant, assistant,
capabilities) still apply. A message to an archived conversation is refused whether or not its
grant is live, and a send that is refused as busy or limited never replaces a grant: the
replacement happens only once the turn is admitted, with the two grants it reads locked.
