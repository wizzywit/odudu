# 0050 — The MCP server acts through an exchanged token, and the admin API enforces what that token may do

**Status:** Accepted · 2026-11-05

## Context

Odudu serves an MCP endpoint so an AI agent can administer a tenant on behalf
of a person. The endpoint has to reach what the admin API reaches, without
becoming a second way in: the capability ceiling of ADR 0040, the audit trail
and the tenant boundary were all built at the admin API's door.

An agent is a confused deputy by construction. It holds a person's authority,
reads text it did not write (names, descriptions, audit detail), and acts on
what it reads. The authority it holds therefore has to be narrower than the
person's, and the narrowing cannot live only in the agent's own tool list,
which is the thing prompt injection attacks.

## Decision

**The MCP endpoint is a resource server.** It validates tokens whose audience
is the MCP endpoint and refuses every other. It never passes a token through
to anything, and it holds no credential of its own.

**For each tool call it mints, in process, an admin-audience token** by the
RFC 8693 exchange the token endpoint already implements: the subject is the
person (`sub` stays theirs), `act` names the agent client, `scope` is the MCP
scope narrowed to `mcp:read` or `mcp:write`, and the lifetime is the shorter of
the person's token and a few minutes. The call then goes through the admin API
as an ordinary bearer request. A public client that presents an MCP token at
`/token` cannot mint an admin-audience token by default: it needs the exchange
grant, `token_exchange_allowed_for_public` and impersonation switched on, and
the admin API in its audience ceiling, all of them an operator's choice and off
for every client. A client an operator did configure so can exchange an MCP
access token for an admin-audience one, and the other rules still hold for it:
the agent marker (`act`) is preserved, the MCP scope the presented token holds
stays (an exchange that drops it is refused), and the admin API admits a call
only by the owner's capability and the scope.

**The admin API enforces the narrowing, not the MCP layer alone.** The
principal reads `scope` and `act`. A call is admitted only if the owner's
capability holds and the scope admits the route: `mcp:read` admits GET routes
except the bulk exports, `mcp:write` adds the descriptive fields of a client
and a scope, by field, and never the name of a built-in client. A token that
names an agent but holds no MCP scope is refused. The MCP layer's own check is
a second line.

**Every tool call is one audit row**, reads included (see the amendment to
ADR 0040), and an admin mutation an agent makes carries the agent's client row
as its actor client and the owner as its actor subject.

**Two paths run beside it.** A local client over stdio has no MCP endpoint in
its path: `odudu mcp` is a public client registered for the tenant with the
admin API as its audience and a scope of `mcp:read` or `mcp:write`, and its
token is issued directly, so the token's client and subject are the
attribution and the principal reads the client as the agent marker where there
is no `act`. A machine (a client holding the `client_credentials` grant, a key
of its own and a role on the tenant's admin client) presents a token for the
endpoint with its `resource` and `scope`; its subject is the client's service
account, so its ceiling is the role it was given and no wider. Both reach the
same tool catalogue and the same admin API checks.

## Consequences

- The ceiling of ADR 0040, the tenant boundary and the audit trail are the
  admin API's own, unchanged; the agent cannot reach a route the person could
  not.
- One in-process exchange per call, which a request may cache.
- The scope allowlist is a security surface. A route is not an agent route
  until it is named; a new field on an allowlisted PATCH is refused until it is
  added.
- A token minted by an exchange that drops the agent marker would be an
  ordinary token; the exchange that mints agent tokens must propagate `act` and
  the MCP scope.

## Alternatives rejected

- **Handlers called in process with a principal the MCP layer builds itself.**
  Cheapest, with no exchange; but it is a new door into the admin handlers that
  skips token validation, so ADR 0040's ceiling and the tenant boundary would
  each have to be proven again for it.
- **A separate package calling the admin API over HTTP.** It works against a
  remote instance, but the HTTP form would be its own deployment and its own
  resource server, and the instance's URL would no longer be the MCP URL. Its
  shape is what the stdio command uses, behind the same tool catalogue and one
  `AdminCaller` interface with two adapters (in process for HTTP, `fetch` for
  stdio).

- **Token passthrough:** the MCP token, or the person's own admin token, sent
  to the admin API. The MCP audience would then be meaningless, the token would
  carry the person's whole authority, and a resource server forwarding a token
  it received is what RFC 8707 and the MCP authorization spec forbid.
- **A second admin API for agents:** a parallel door with its own checks. It
  would have to re-prove ADR 0040's ceiling and the tenant boundary, and would
  drift from the first.
- **Credentials held by the MCP server:** a service account the server acts as
  for everyone. Every call would run with one identity, so the audit could not
  name the person and the ceiling would be the server's, not theirs.

## Amendment, 2026-11-06

The admin-audience token is not made by the RFC 8693 exchange at the token
endpoint. `mintAgentToken` (`@odudu/protocol-oidc`) signs it directly, in
process, from the owner's grant: no `/token` request is made and no client
authenticates. It shares `mintSubjectAccessToken` with the exchange, so claims,
role reach and the signing key are one path, and it refuses a token whose
subject is not the grant's owner. The decision above stands: `sub` stays the
person's, `act` names the agent client, the scope is the MCP scope narrowed to
the call, and the life is the shorter of the presented token's and five minutes.
