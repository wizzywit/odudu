# MCP authorization (Model Context Protocol specification)

**Status in Odudu:** in scope. Odudu is the authorization server and, at `/tenants/{tenant}/mcp`
(or `/mcp` on a tenant's own domain), the protected MCP server; `odudu mcp` is an MCP server over
stdio and an OAuth client of the same instance. Clause text read 2026-11-06 from the
specification's `draft` pages (verified: fetched
`https://modelcontextprotocol.io/specification/draft/basic/authorization`, `.../authorization/authorization-server-discovery`,
`.../authorization/client-registration`, `.../authorization/security-considerations` and
`.../basic/transports/streamable-http`). The draft describes the 2026-07-28 revision, whose
stateless transport it documents; earlier revisions are served as the reading note
"Transport eras" says. A draft changes: re-read the pages against this table when a later
revision is published. The `resource`, PKCE and `iss` requirements restate RFC 8707, RFC 7636 and
RFC 9207, whose own notes (`rfc8707.md`, `rfc7636.md`, `rfc9207.md`) hold the clause detail; this
table only says where the MCP profile adds an obligation and which test holds it. Many MUSTs are
addressed to the client: they are rowed `n/a` when no code of ours is the client, and covered
by a test of `odudu mcp` when it is.

## Reading notes

### Who is who

The MCP server is the resource server and checks tokens itself
(`validateMcpToken`, `packages/mcp/src/usecase/validate-mcp-token.ts`): signature against the
tenant's keys, the tenant's issuer (or one it retired inside its window), `typ` of an access
token, the audience, a live grant owned by the subject. It never calls the token endpoint to
find out. The token's audience is the tenant's MCP URL and nothing else
(`mcpResourceUrl`, `packages/mcp/src/service/resource.ts`).

### Audience binding and no passthrough

A token whose audience also names the admin API is refused at the endpoint, so no token serves
both doors. The endpoint calls the admin API with a token it mints for the call in process,
as the agent client, narrowed to what the tool needs and not outliving the presented token
(`exchangeForAdmin`, `packages/mcp/src/usecase/exchange.ts`); the presented token is never
sent anywhere. The tool catalogue calls no third-party API, so there is no upstream
authorization server to hold a separate token for.

### Scope challenge

A request with no token, or one that does not verify, is answered `401` with
`WWW-Authenticate: Bearer resource_metadata="…", scope="mcp:read"` (`error="invalid_token"`
added for a token that was presented). A valid token holding neither MCP scope is answered `403`
with `error="insufficient_scope"`, the scope and the metadata address. One scope is needed per
call, so the single-challenge SHOULD holds trivially. `scopes_supported` is `mcp:read` and
`mcp:write` and never `offline_access`. A token holding `mcp:write` alone may read, since the
admin API admits a read under either scope (`scopeFor`,
`packages/mcp/src/service/admin-access.ts`); no other scope implies another.

### Scope challenges

The MAY that a challenge's scope set differs from `scopes_supported` is not used: the
challenge names `mcp:read`, the least a first request needs, and `scopes_supported` lists the
two scopes the endpoint knows.

### Registration modes

The authorization server offers all three the specification names. Metadata documents (the
CIMD draft, `cimd.md`) are behind the tenant's `cimd_enabled` setting. Dynamic registration
(RFC 7591) exists under the tenant's `mcp` policy, which admits only public clients with
`mcp:read`, loopback or HTTPS redirects and the tenant's MCP URL as audience, and caps the
rate per address and per tenant. A client an administrator creates is the pre-registered
route, and the built-in `odudu-mcp` client serves `odudu mcp`. A client that registered
itself cannot hold `mcp:write`, and a person is asked for consent every time it signs in.
The specification's client-side priority order (pre-registered, then CIMD, then DCR) is
addressed to clients and is not rowed.

### Transport eras

The endpoint answers the 2026-07-28 revision (a request per POST, protocol version and method
in headers that must agree with the body) and by default 2025-11-25 `initialize` traffic
without sessions; 2025-06-18 and 2025-03-26 also negotiate. No session identifier is minted or
echoed, a `GET` or `DELETE` is answered `405` with `Allow: POST`, and a batch or a body over
256 KiB is refused. The SDK's handler does the version and `Mcp-Method` checks; the integration
test of the endpoint ("the protocol") holds them.

### Binding and listening

The server listens where the deployment tells it. With no `ODUDU_PUBLIC_BASE_URL`, the endpoint
accepts only a loopback `Host` and `Origin`, so a rebinding page cannot reach a local
instance; with one, only that host and the tenant's own domains. A request with no `Origin`
(a client that is not a browser) is let through, as the specification's MUST is about a
header that is present.

### TLS

Every authorization server endpoint is served over HTTPS where Odudu is deployed behind a
terminating proxy, as in `rfc9728.md`; the process itself speaks HTTP and does not terminate
TLS. A redirect address that is neither `https` nor loopback is refused at registration.

### stdio takes its credentials from the environment

The authorization pages say a stdio server should not follow them and should take credentials
from the environment. `odudu mcp` does: a service-account key in `ODUDU_MCP_KEY` (or a file,
refused when others can read it) with `ODUDU_MCP_CLIENT_ID`, or a browser sign-in through the
authorization code flow with PKCE on a loopback listener, the refresh token kept in the
operating system's credential store. It talks to the admin API with `resource` set to the admin
API audience, not the MCP URL, because it is not the HTTP endpoint.

## Clause table

Clause names are the specification's own section headings, since the pages carry no numbers.

| Clause                     | Level  | Requirement                                                                                | Test ID               | Status                                                                  |
| -------------------------- | ------ | ------------------------------------------------------------------------------------------ | --------------------- | ----------------------------------------------------------------------- |
| AS location                | MUST   | the MCP server implements Protected Resource Metadata (RFC 9728)                           | `RFC9728-3-01`        | covered                                                                 |
| AS location                | MUST   | the metadata names at least one authorization server                                       | `MCP-AUTH-DISC-01`    | covered                                                                 |
| PRM discovery              | MUST   | the resource metadata URL is in `WWW-Authenticate` on a `401`                              | `MCP-AUTH-DISC-02`    | covered                                                                 |
| PRM discovery              | MUST   | or the metadata is served at the well-known URI of the endpoint's path                     | `MCP-AUTH-DISC-03`    | covered                                                                 |
| PRM discovery              | MUST   | a client supports both mechanisms and falls back from header to well-known URIs            | —                     | n/a: addressed to the client                                            |
| AS metadata discovery      | MUST   | the authorization server provides RFC 8414 or OpenID Connect metadata                      | `RFC8414-3-01`        | covered                                                                 |
| AS metadata discovery      | MUST   | a client tries the RFC 8414 and OpenID Connect well-known endpoints in order               | —                     | n/a: addressed to the client                                            |
| AS metadata discovery      | MUST   | a client uses the metadata only when its `issuer` equals the issuer it built the URL from  | `MCP-AUTH-DISC-04`    | covered                                                                 |
| Scope selection            | SHOULD | `WWW-Authenticate` carries a `scope` parameter                                             | `MCP-AUTH-DISC-02`    | covered                                                                 |
| Scope selection            | MAY    | the challenged scopes differ from `scopes_supported`                                       | —                     | accepted: "Scope challenges"                                            |
| Authorization response     | MUST   | a client checks `iss` against the recorded issuer before sending the code                  | `MCP-AUTH-ISS-01`     | covered                                                                 |
| Authorization response     | SHOULD | the authorization server includes `iss` in authorization responses                         | `RFC9207-2-01`        | covered                                                                 |
| Authorization response     | MUST   | a server that includes `iss` advertises `authorization_response_iss_parameter_supported`   | `MCP-AUTH-ASMETA-01`  | covered                                                                 |
| Resource parameter         | MUST   | a client sends `resource` in the authorization request                                     | `MCP-AUTH-RES-01`     | covered                                                                 |
| Resource parameter         | MUST   | a client sends `resource` in the token request                                             | `MCP-AUTH-RES-02`     | covered                                                                 |
| Resource parameter         | SHOULD | the authorization server restricts the token's audience to the resource asked for          | `RFC8707-2-06`        | covered                                                                 |
| Access token usage         | MUST   | a client sends the token in the `Authorization` header on every request                    | —                     | n/a: addressed to the client                                            |
| Access token usage         | MUST   | the token is never read from the URI query string                                          | `MCP-AUTH-TOKEN-04`   | covered                                                                 |
| Token handling             | MUST   | the server validates the token (signature, issuer, expiry, type)                           | `MCP-AUTH-TOKEN-02`   | covered                                                                 |
| Token handling             | MUST   | the server validates that the token was issued for it as the audience                      | `MCP-AUTH-TOKEN-02`   | covered                                                                 |
| Token handling             | MUST   | an invalid or expired token is answered `401`                                              | `MCP-AUTH-TOKEN-01`   | covered                                                                 |
| Token handling             | MUST   | a client sends no token the authorization server did not issue                             | —                     | n/a: addressed to the client                                            |
| Token handling             | MUST   | the server accepts only tokens valid for its own resources                                 | `MCP-AUTH-TOKEN-02`   | covered                                                                 |
| Token handling             | MUST   | the server accepts or transits no other token                                              | `MCP-AUTH-TOKEN-03`   | covered                                                                 |
| Access token restriction   | MUST   | the server does not pass the token it received to an upstream API                          | `MCP-AUTH-TOKEN-06`   | covered                                                                 |
| Refresh tokens             | MUST   | a client keeps refresh tokens confidential in storage                                      | `MCP-AUTH-REFRESH-01` | covered                                                                 |
| Refresh tokens             | SHOULD | the server leaves `offline_access` out of its challenge and `scopes_supported`             | `MCP-AUTH-DISC-01`    | covered                                                                 |
| Token theft                | MUST   | the authorization server rotates refresh tokens of public clients                          | `RFC6749-10.4-01`     | covered                                                                 |
| Token theft                | SHOULD | access tokens are short-lived                                                              | `MCP-AUTH-TOKEN-05`   | covered                                                                 |
| Error handling             | MUST   | an insufficient token is answered `403`                                                    | `MCP-AUTH-ERR-01`     | covered                                                                 |
| Scope challenge            | SHOULD | the `403` carries `error="insufficient_scope"`, the `scope` and `resource_metadata`        | `MCP-AUTH-ERR-01`     | covered                                                                 |
| Scope challenge            | SHOULD | a challenge holds every scope the operation needs, in one                                  | `MCP-AUTH-ERR-02`     | covered                                                                 |
| Scope challenge            | MUST   | the server accounts for scope hierarchies when judging a token                             | `MCP-AUTH-ERR-03`     | covered                                                                 |
| Client registration        | SHOULD | the authorization server supports Client ID Metadata Documents and advertises it           | `CIMD-5-01`           | covered                                                                 |
| Client registration        | MUST   | the document's `client_id` equals its URL                                                  | `CIMD-4.1-01`         | covered                                                                 |
| Client registration        | MUST   | the redirect address of a request is validated against the document                        | `CIMD-4.5-03`         | covered                                                                 |
| Client registration        | MAY    | the authorization server supports Dynamic Client Registration                              | `MCP-AUTH-REG-01`     | covered                                                                 |
| Client registration        | SHOULD | pre-registered clients are supported                                                       | —                     | accepted: "Registration modes"                                          |
| Client registration        | MUST   | a client states an `application_type` when it registers dynamically                        | —                     | n/a: addressed to the client                                            |
| AS binding                 | MUST   | a client keeps credentials per authorization server issuer                                 | —                     | n/a: addressed to the client                                            |
| Communication security     | MUST   | authorization server endpoints are served over HTTPS                                       | —                     | accepted: "TLS"                                                         |
| Communication security     | MUST   | redirect addresses are `localhost` or HTTPS                                                | `MCP-AUTH-REDIR-01`   | covered                                                                 |
| Open redirection           | MUST   | the authorization server matches redirect addresses exactly                                | `RFC6749-3.1.2.3-01`  | covered                                                                 |
| Authorization code         | MUST   | a client verifies PKCE support in the metadata and refuses to proceed without it           | `MCP-AUTH-PKCE-01`    | covered                                                                 |
| Authorization code         | MUST   | a client uses the `S256` method                                                            | `MCP-AUTH-PKCE-02`    | covered                                                                 |
| Authorization code         | MUST   | a server that provides OpenID Connect metadata includes `code_challenge_methods_supported` | `MCP-AUTH-ASMETA-01`  | covered                                                                 |
| CIMD security              | MUST   | the redirect address host is shown clearly on the consent page                             | `CIMD-6.4-03`         | covered                                                                 |
| CIMD security              | SHOULD | the fetch of a document is protected against request forgery                               | `CIMD-6.5-01`         | covered                                                                 |
| Confused deputy            | MUST   | a proxy with a static client id obtains consent for each dynamically registered client     | —                     | n/a: Odudu is not a proxy to a third-party authorization server         |
| Streamable HTTP security   | MUST   | an `Origin` that is present and invalid is answered `403`                                  | `MCP-AUTH-ORIGIN-01`  | covered                                                                 |
| Streamable HTTP security   | SHOULD | a local server accepts only local hosts, and none by default from elsewhere                | `MCP-AUTH-ORIGIN-02`  | covered                                                                 |
| Streamable HTTP security   | SHOULD | a server authenticates every connection                                                    | `MCP-AUTH-DISC-02`    | covered                                                                 |
| Streamable HTTP versioning | MUST   | `MCP-Protocol-Version` agrees with the request body, else `400`                            | —                     | n/a: answered by the SDK handler, held by the endpoint integration test |
| Streamable HTTP versioning | MUST   | `Mcp-Method` agrees with the body, else `400` `HeaderMismatch`                             | —                     | n/a: answered by the SDK handler, held by the endpoint integration test |
| Streamable HTTP versioning | SHOULD | `GET` and `DELETE` are answered `405`                                                      | `MCP-AUTH-ORIGIN-03`  | covered                                                                 |
| Streamable HTTP versioning | MAY    | earlier revisions are served beside this one                                               | —                     | accepted: "Transport eras"                                              |
| stdio                      | SHOULD | a stdio server takes its credentials from the environment                                  | `MCP-AUTH-STDIO-01`   | covered                                                                 |
