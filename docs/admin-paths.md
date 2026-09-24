# Admin paths

The admin API: the endpoints under `/admin/tenants/{tenant}/` that let an
operator manage a tenant instead of reaching for `psql`.

Three artifacts describe this API and each has one job. The published
OpenAPI document, served unauthenticated at `/admin/openapi.json`, is the
**reference** — generated, and the place every endpoint and every field is
listed exhaustively. This document is the **narrative** — an operator's
journey through a task, in the order they would actually hit it, with the
shape of each request and, once a live stack has been brought up to capture
it against, the real response. [README.md](../README.md) is the **entry
point** — how to get a token that can call any of this at all.

There is one "What is not implemented" list for the whole server, and it
stays in [docs/request-paths.md](request-paths.md#what-is-not-implemented);
this document never starts a second one. An admin endpoint that does not do
yet what its name suggests says so in its own section below, and points at
that list rather than duplicating it.

Same transcript discipline as `docs/request-paths.md`: a fenced block
holding a response carries no language tag, a section whose output depends
on the state of the stack it ran against says which state, and a
precondition a refusal depends on is shown rather than asserted. Nothing
here is reconstructed from what the code looks like it should do.

## The shape of it

Most of the admin endpoint lives under `/admin/tenants/{tenant}/`, mirroring
the protocol surface's own `/tenants/{tenant}/` convention: the tenant being
administered is chosen by the URL. `/admin/tenants` itself is the one
exception — it has no `{tenant}` segment, because it administers the
collection of tenants rather than any one of them. The caller authenticates
with a bearer access token — the same kind `/token` mints for the protocol
surface — sent as `Authorization: Bearer …`. Two authorities can hold one:

- **A tenant-local admin.** A subject in the target tenant itself, holding
  a capability role on that tenant's built-in admin client. Reaches this
  tenant's `/admin/tenants/{tenant}/**` and nothing else — there is no
  tenant-local view of `/admin/tenants`, since a tenant-local admin already
  knows which tenant they administer.
- **A system admin.** A subject in the `system` tenant, holding
  `manage-tenants`. Reaches every tenant's `/admin/tenants/{tenant}/**`,
  plus `/admin/tenants` itself.

Either way, the token must carry an `aud` naming this admin API,
`urn:odudu:params:admin-api` — an ordinary access token minted for the
protocol surface does not authorize anything here — and the request is refused if the grant behind the token
has been revoked, its session has ended, or its client has since been
disabled. A `client_credentials` token has no session behind it, and is
refused only on the other two counts. `docs/superpowers/specs/2026-09-24-p4c-admin-api-design.md`
section 7 has the full authentication and authorization sequence; getting
a token to test with is [README.md](../README.md)'s job, not this
document's.

| Method | Path                               | What it is            |
| ------ | ---------------------------------- | --------------------- |
| `GET`  | `/admin/tenants`                   | List tenants          |
| `POST` | `/admin/tenants`                   | Create a tenant       |
| `GET`  | `/admin/tenants/{tenant}/whoami`   | Identity probe        |
| `GET`  | `/admin/tenants/{tenant}/subjects` | List subjects         |
| `GET`  | `/admin/openapi.json`              | The OpenAPI reference |

## `GET /admin/tenants`

Lists tenants — every one, the `system` tenant included: hiding it would
make the one tenant an operator most needs to inspect the one they cannot.
Requires `manage-tenants`, which only a system admin holds, so this is the
one collection with no tenant-local view. Pages by an opaque cursor, `?limit=`
and `?cursor=`, ordered by `id`; a further page is announced by a
`Link: rel="next"` header and a `next` member in the body, both absent once
the collection fits in one page. The response carries no total.

A request shape:

```bash
curl -sS \
  -H "Authorization: Bearer $SYSTEM_ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants?limit=50"
```

The response shape, not a captured run — a live stack replaces this with
the real bytes, including real ids:

```json
{
  "items": [
    {
      "id": "<tenant id>",
      "name": "system",
      "display_name": "System",
      "enabled": true,
      "created_at": "<timestamp>"
    }
  ]
}
```

## `POST /admin/tenants`

Creates a tenant: the row, its browser authentication flow
(`provisionTenant`, `@odudu/authn-flows`) and its built-in admin client
(`provisionAdminClient`, `@odudu/protocol-oidc`) in one call, so a tenant
this endpoint returns is one an operator can immediately provision an admin
for. `manage-tenants` is required, the same as the listing above. The name
`system` is refused with `409` — reserved for the tenant this API itself
administers from — rather than left to surface as a unique-index conflict;
`odudu seed tenant --name system` is refused for the identical reason
(`refuseSystemTenantName`, `apps/server/src/cli/seed.ts`).

A request shape:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $SYSTEM_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "acme", "display_name": "Acme"}' \
  http://localhost:3000/admin/tenants
```

The response shape, not a captured run — `201` with the created tenant:

```json
{
  "id": "<tenant id>",
  "name": "acme",
  "display_name": "Acme",
  "enabled": true,
  "created_at": "<timestamp>"
}
```

## `GET /whoami`

The identity probe: what an operator reaches for when a token is not
working and they need to know what the server thinks it is, before
debugging anything else. It requires an authenticated caller and no
capability beyond that — any admin token good enough to reach this tenant's
admin surface at all can call it.

A request shape:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/whoami
```

The response shape, not a captured run. Running this against a live stack
replaces it with the real bytes: the caller's own identity as
the server resolved it, `subjectId` (the token's `sub`) and
`issuerTenantId` (the tenant that issued the token, which for a system
admin calling into another tenant is `system`, not the tenant named in the
URL).

```json
{ "subjectId": "<subject id>", "issuerTenantId": "<tenant id>" }
```

## `GET /subjects`

Requires the `view-users` capability. **Subject listing is not implemented
yet** — this endpoint exists so the authentication and authorization chain
in front of it is exercisable, and unconditionally, for every authorized
caller, it answers with an empty array — never the tenant's actual
subjects:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/subjects
```

The response, every time, no matter how many subjects the tenant has:

```json
[]
```

That is a documented gap, not a claim about what the tenant contains — see
[What is not implemented](request-paths.md#what-is-not-implemented) in
`docs/request-paths.md` for where the real listing lands.

## `GET /admin/openapi.json`

The reference this document points at: an OpenAPI 3.1 description of every
route above, generated from the same route table the router registers from,
so the two cannot drift. It takes no `{tenant}` — it describes the API
rather than reaching into one — and is served without authentication, since
a client that cannot read it cannot generate against it:

```bash
curl -sS http://localhost:3000/admin/openapi.json
```

Every other endpoint in it requires a bearer token whose `aud` names
`urn:odudu:params:admin-api`, declared as this document's `bearerAuth`
security scheme.

## What to do next, from wherever you are

**From here, for anything this document does not yet cover** — creating a
client, rotating a signing key, editing a tenant's authentication flow —
[docs/request-paths.md](request-paths.md) is where the rest of the server's
behaviour is documented, and its own "What to do next" section covers the
protocol surface this API sits beside.
