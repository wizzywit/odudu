# OAuth Client ID Metadata Document (IETF draft)

**Status in Odudu:** in scope, behind a per-tenant setting (`cimd_enabled`, off by
default). Odudu is the authorization server: a `client_id` that is an `https` URL is
resolved to the JSON document served there, which stands in for a registration.
Clause text read 2026-11-05 from `draft-ietf-oauth-client-id-metadata-document-00`
(Parecki and Smith, 8 October 2025; verified: fetched
`https://www.ietf.org/archive/id/draft-ietf-oauth-client-id-metadata-document-00.txt`).
A draft changes: the clause numbers below are that revision's, and a later one needs
this table read again. §1, §2, §7 and the references carry no requirement and are not rowed.

## Reading notes

### What a resolved client is

A document is never trusted as it arrives. `parseCimdDocument`
(`packages/protocol-oidc/src/service/client-id-metadata.ts`) validates it, and only the
validated projection is cached or stored. A tenant that has the setting on keeps the
client as an ordinary public client row (`registration_origin = 'cimd'`, migration 0116) written by `persistCimdClient`, so the token endpoint, consent and userinfo find
it as they find any client. The row is rewritten from the document each time the
document is resolved, holds no secret, asks for consent every time, and holds no
audience: what a token may be for is the tenant's policy, never the document's. A
client that has not been resolved for thirty days is removed by `odudu reap`, unless it
holds a refresh token that can still be used, or lapsed within the longest access token's
life (an access token outlives its refresh token, and removing the client would make it
inactive); a refresh token of a revoked grant does not count; its address brings it back. A tenant holds
at most 1,000 of them. Resolving a document needs no sign-in, so at that count a new
client makes room by removing the one unused longest that never completed anything: no
consent recorded, no refresh token that can still be used, no authorization code that
has not expired. A client an administrator disabled is never removed this way, nor by `odudu reap`. If every row is protected, the new client is refused and the server logs the
tenant and host. Turning the setting off refuses `/authorize` and `/token` only: tokens
already issued stay valid at userinfo and introspection until they expire, and the consent
and post-logout steps still read the stored row. An administrator who disables one is not overruled by the next
resolution. With the setting off, a URL `client_id` is refused at `/authorize` and at
`/token` exactly as an unknown client is, unless a client of another origin already holds
that string.

### Client identifiers

`isCimdClientId` accepts only the form a URL parser would write (so the string fetched
is the string compared): lower-case scheme and host, no trailing dot, no IP literal, no
encoded dot segments, at most 2,048 ASCII characters. A query string is accepted, since
the draft discourages it without forbidding it, and so is a port, which the consent page
shows with the host.

### Fetching

The fetch is `fetchCimdDocument` (`adapter/client-metadata-fetch.ts`): `https` only,
no redirect followed, a five KiB body cap counted in bytes, a three second deadline over
lookup and request together, `application/json` only, the address checked by the same
guard the `jwks_uri` fetch uses and the connection pinned to the checked address. A
host named `localhost` or ending `.localhost` is refused by name. There is no setting
that lifts the guard. A fetch is also limited per host and per tenant
(`createFetchLimiter`, one instance per process).

### Failure leaves the client unusable

If the document cannot be fetched, is invalid, or the fetch is limited, the request is
refused as an unknown client is, even when a row from an earlier resolution exists: a
redirect address the owner has since withdrawn must not keep working because the owner's
server is down. The refusal reason is logged with the tenant and host, never the body.

### Caching

A document is cached per tenant for its `Cache-Control: max-age`, clamped to between one
minute and a day. `no-store`, `no-cache`, and a missing lifetime are not kept; an error
response and a document that fails validation never are. A refetch that finishes after a later one never replaces it; that guard compares the server's own clock stamps taken when each fetch began, not any time the document states. The cache holds at most 1,000
documents per tenant, the oldest fetched leaving first, and `odudu reap` removes expired
rows.

### Redirect addresses

A document must list at least one, each `https` or a loopback `http` address. A request's
`redirect_uri` must equal a listed one as a string. The one exception is RFC 8252 §7.3: a
loopback entry (`localhost`, `127.0.0.1` or `[::1]`) with no port stands for that host at
any port, with the same path and query. `localhost` is accepted here, unlike for the
built-in `odudu-mcp` client, because the document is the client's own statement of where
it listens and what protects the person is the consent page naming the host of the
`client_id`.

### What the consent page shows

The document's `client_name` is the client's own word and can claim anyone's name. The
consent page therefore also shows the host of the `client_id` with its port, and every
redirect address, escaped like every other interpolated value, from catalogue entries
(`consent.source.host`, `consent.source.redirects`).

### Client keys

A document may name `private_key_jwt` with an inline `jwks` or an `https` `jwks_uri`; it
may not carry a private key member. The stored client authenticates through the
existing `private_key_jwt` path, which holds the client to an assertion at the token
endpoint (`docs/protocols/rfc7523.md`). A key set with no key is refused, as is `private_key_jwt` with neither a key nor a `jwks_uri`.
A `jwks_uri` of such a client is fetched only from public addresses, whatever the
deployment allows for the clients it registers by hand, and its cache entries are kept apart.
A changed inline key set takes effect when the document
is next resolved; keys behind a `jwks_uri` are cached for five minutes, so a key removed there stays usable for up to that long after the client's own server drops it; Odudu does not revoke tokens or consent because the keys changed.

### Members not read

Only `client_id`, `client_name`, `redirect_uris`, `token_endpoint_auth_method`, `jwks`
and `jwks_uri` are read. Every other member, `logo_uri` and `client_uri` included, is
dropped before storage, so nothing the document author put elsewhere is kept and no
logo is fetched or shown.

### No development service

The draft suggests a service for developers whose redirect addresses a server restricts.
Odudu restricts redirect addresses to `https` and loopback, and loopback, `localhost`
included, is allowed, so a developer's local client needs none.

## Clause table

| Clause | Level  | Requirement                                                                                | Test ID       | Status                                                                 |
| ------ | ------ | ------------------------------------------------------------------------------------------ | ------------- | ---------------------------------------------------------------------- |
| 3      | MUST   | the identifier uses the `https` scheme                                                     | `CIMD-3-01`   | covered                                                                |
| 3      | MUST   | the identifier includes a path component                                                   | `CIMD-3-02`   | covered                                                                |
| 3      | MUST   | the identifier contains single-dot or double-dot path segments                             | `CIMD-3-03`   | covered                                                                |
| 3      | MUST   | the identifier contains a fragment                                                         | `CIMD-3-04`   | covered                                                                |
| 3      | MUST   | the identifier contains a username or password                                             | `CIMD-3-05`   | covered                                                                |
| 3      | SHOULD | the identifier includes a query string                                                     | —             | accepted: "Client identifiers"                                         |
| 3      | MAY    | the identifier includes a port                                                             | `CIMD-3-06`   | covered                                                                |
| 4      | SHOULD | the server fetches the document at the `client_id` for registration information            | `CIMD-4-01`   | covered                                                                |
| 4.1    | MUST   | the document's `client_id` equals the document's URL by simple string comparison           | `CIMD-4.1-01` | covered                                                                |
| 4.1    | MAY    | the document defines further properties                                                    | —             | accepted: "Members not read"                                           |
| 4.1    | MAY    | the document is served with a more specific JSON media type                                | —             | accepted: "Fetching"                                                   |
| 4.1    | MUST   | `token_endpoint_auth_method` is a shared-secret method                                     | `CIMD-4.1-02` | covered                                                                |
| 4.1    | MUST   | the document uses `client_secret` or `client_secret_expires_at`                            | `CIMD-4.1-03` | covered                                                                |
| 4.1    | MAY    | further restrictions are placed on accepted metadata                                       | —             | accepted: "What a resolved client is"                                  |
| 4.2    | SHOULD | a development service is provided where redirect addresses are restricted                  | —             | accepted: "No development service"                                     |
| 4.2    | MAY    | such a service lets its clients expire                                                     | —             | n/a: no development service is provided                                |
| 4.2    | MAY    | such a service asks for extra information about the client                                 | —             | n/a: no development service is provided                                |
| 4.3    | SHOULD | the authorization request is aborted when the metadata cannot be fetched                   | `CIMD-4.3-01` | covered                                                                |
| 4.4    | MAY    | discovered metadata is cached                                                              | `CIMD-4.4-01` | covered                                                                |
| 4.4    | SHOULD | HTTP cache headers are respected when caching                                              | `CIMD-4.4-02` | covered                                                                |
| 4.4    | MAY    | the server sets its own bounds on the cache lifetime                                       | —             | accepted: "Caching"                                                    |
| 4.4    | MUST   | an error response is cached                                                                | `CIMD-4.4-03` | covered                                                                |
| 4.4    | MUST   | an invalid or malformed document is cached                                                 | `CIMD-4.4-04` | covered                                                                |
| 4.5    | MUST   | redirect addresses are registered                                                          | `CIMD-4.5-01` | covered                                                                |
| 4.5    | MUST   | a request's redirect address exactly matches a registered one                              | `CIMD-4.5-03` | covered                                                                |
| 5      | MUST   | `client_id_metadata_document_supported` is included in the server's metadata               | `CIMD-5-01`   | covered                                                                |
| 6.1    | MAY    | restrictions relate the redirect addresses to the `client_id` or `client_uri`              | —             | n/a: Odudu imposes none; the consent page names the host and redirects |
| 6.2    | MAY    | the document establishes credentials by publishing a public key                            | —             | accepted: "Client keys"                                                |
| 6.2    | MAY    | the document carries `private_key_jwt` and `jwks_uri` to set up key authentication         | —             | accepted: "Client keys"                                                |
| 6.2    | MUST   | a client that established credentials authenticates in the registered way on every request | `CIMD-6.2-01` | covered                                                                |
| 6.3    | MAY    | tokens or consent are revoked when the keys change                                         | —             | accepted: "Client keys"                                                |
| 6.4    | SHOULD | the document is fetched to show the person more about the request                          | `CIMD-6.4-01` | covered                                                                |
| 6.4    | SHOULD | the person is told more when the document was not fetched                                  | —             | n/a: a request is never continued without the document                 |
| 6.4    | SHOULD | the hostname of the `client_id` is displayed                                               | `CIMD-6.4-03` | covered                                                                |
| 6.5    | SHOULD | URLs that resolve to private or loopback addresses are not fetched                         | `CIMD-6.5-01` | covered                                                                |
| 6.5    | SHOULD | network policy also prevents such fetches                                                  | `CIMD-6.5-02` | covered                                                                |
| 6.5    | SHOULD | non-HTTP URI schemes that could enable request forgery are watched for                     | —             | n/a: only `https` is fetched                                           |
| 6.6    | SHOULD | the response size is limited                                                               | `CIMD-6.6-01` | covered                                                                |
| 6.7    | SHOULD | a `logo_uri` file is prefetched and cached for the document's cache duration               | —             | n/a: `logo_uri` is not read and no logo is shown                       |
| 6.8    | MAY    | the server applies its own trust heuristics to `client_id` domains                         | —             | n/a: the tenant's setting is the only policy                           |
