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
