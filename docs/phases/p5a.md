# P5a — the MCP server, first release

The running record of what building the phase found. The argument is in
[the spec](../superpowers/specs/2026-11-05-p5a-mcp-server-design.md) and
[the plan](../superpowers/plans/2026-11-05-p5a-mcp-server.md).

## The spike (Increment 0), 2026-11-05

Three claims the plan rested on were about libraries and about this
repository's token exchange. Each was run, not read.

### The SDK serves both eras and mounts on Fastify

verified: `npm view @modelcontextprotocol/server version time` — 2.4.0,
published 2026-10-23. `@modelcontextprotocol/node` 2.1.2 and
`@modelcontextprotocol/fastify` 2.0.1 exist and are older than the 24-hour
release-age floor. The Inspector's latest (2.14.0) was ten hours old, so the
version the floor allows is 2.13.0.

- `createMcpHandler(factory, { legacy })` from `@modelcontextprotocol/server`
  serves 2026-07-28, and by default 2025-11-25 `initialize` traffic **without
  sessions** (`legacy: 'stateless'`). `legacy: 'reject'` answers a 2025 request
  400 `-32022` with `data.supported: ["2026-07-28"]`. A session-keeping legacy
  mode is not provided. The spike did not test 2025-06-18.
- It mounts on plain Fastify 5 at `/tenants/:tenant/mcp`:
  `reply.hijack()` then `toNodeHandler(handler)(req.raw, reply.raw, req.body)`.
  The factory runs per HTTP request (about three times per legacy tool call),
  so per-tenant state comes from `ctx.requestInfo` or a cache.
- `@modelcontextprotocol/fastify` is a thin layer of Host and Origin hooks.
  Its lists are static, but a hook built inside the server's own `onRequest`
  from the tenant's accepted hosts works. The Origin check compares hostname
  only and lets a request with no Origin through. GET and DELETE answer 405.
- The handler verifies no token. A principal is passed in as
  `req.raw.auth = { token, clientId, scopes, resource }` and reaches tool
  handlers as `ctx.http.authInfo`. The 401 and its `WWW-Authenticate`
  challenge are Odudu's own `onRequest` work.
- The Inspector CLI (`--cli`, `--protocol-era modern`) runs headless with
  `--header 'Authorization: Bearer …'` and exits non-zero on failure. A
  headless full OAuth flow was not run; `--stored-auth-only` exits 3 with
  `auth_required` on a 401.

### The exchange works in-process, with three changes

verified by a scratch integration test (deleted) through the real `/token` and
the admin fixture:

- Delegation (an `actor_token`) mints `sub = owner`, a narrowed `scope`,
  `aud = [ADMIN_API_AUDIENCE, issuer]` and `act = { sub: <actor token's
  subject> }`, with no `may_act` anywhere. Impersonation mints no `act`.
- **The admin API ignores `scope` and `act`.** A token narrowed to `openid`
  listed clients (`authenticate-admin.ts` checks issuer, audience, `typ`,
  grant, session, client and subject only). The plan's increment 5 owns this.
- **A public client with the exchange grant reaches it at `/token`** with any
  valid actor token, since `/token` needs no secret for a public client, and
  the actor token is not bound to the requesting client. Another client's
  `client_credentials` token worked as actor.
- `issueTokens` is not exported and always authenticates the client; the inner
  functions take an already-resolved client but are not exported either.

Consequences written into the plan: an in-process entry point that sets `act`
to the agent client directly (no actor token, no `/token` request); a refusal
of the exchange for public clients and a binding of an actor token to the
requesting client, both as settings an operator controls.
