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
the console grant, scope `mcp:read` in Ask mode. It refuses a grant that is not a live
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
- One grant row per conversation. Audit rows name `odudu-assistant`.
- Spec 5.3 loses "No grant is made".

## Rejected

- **Widening `mintAgentToken` for console grants:** any console token could mint an agent
  token, and the mint stops proving that a person authorised an agent client to hold `mcp:*`.
- **A second mint with a bypassed scope check:** the ceiling becomes a constant inside the
  most sensitive function, every conversation of a session shares one root grant and so one
  child limit. It is the fallback if the grant insert is ever unacceptable.
- **An RFC 8693 exchange in process:** it only narrows, and a console token holds no MCP
  scope to keep.
