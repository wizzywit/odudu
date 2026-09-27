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

Every transcript below is captured output, and follows the same discipline
as [docs/request-paths.md](request-paths.md): a fenced block holding a
response carries no language tag, a section whose output depends on the
state of the stack it ran against says which state, and a precondition a
refusal depends on is shown rather than asserted.

**The stack.** One run of `infra/docker/compose.yaml`, brought up from an
empty volume, with `odudu seed admin --username ada` run against it and a
tenant named `demo` created through `POST /admin/tenants` below. The
sections are in the order they were executed, so the ids, secrets, `ETag`s
and timestamps in them are one run's real ones and refer to each other:
`demo` is `01a0d6fc-3626-7e23-94d7-3b1b666e278f`, `ada` in the `system`
tenant is subject `01a0d6fb-0918-7846-b430-0a714b8bf7bf`. Secrets shown
here are that stack's, and it was torn down with `docker compose down -v`
when the capture finished.

**The second stack.** The sections that turn on `If-Match` being
mandatory, and the tenant and SMTP sections that describe endpoints added
after the first capture, ran against a second stack brought up the same
way from an empty volume: `seed admin --username ada`, then `demo` created
through `POST /admin/tenants`, then a subject `grace`, a role
`billing-viewer`, a group `engineering` and a scope `billing` created
through the endpoints below. Its `demo` is
`01a0d7ee-b611-71a0-b223-5a57ecbe83d8` — a different run, so its ids,
`ETag`s and timestamps refer to each other and to nothing in the sections
above. Each such section says so. It was torn down the same way.

**The third stack.** "Getting the token" was captured again, after the
session cookie gained its secret (`0071_session_secret.sql`), against a
stack brought up the same way from an empty volume with only
`seed admin --username ada` run against it. Its password, ids, code and
cookie are that run's own: its `ada` is
`01a0de12-c116-70ee-9cc1-984429980dcc`, not the subject the sections after
it name.

**The fourth stack.** "Getting the token"'s final probe and `GET /whoami`
were recaptured together, after `whoami` started answering `capabilities`
and `crossTenant`, against this branch's own already-running development
stack rather than a fresh one — it was not brought up for this capture and
was not torn down afterward. It carries a tenant also named `demo`, under
its own id, `01a0db22-1c32-7d17-b351-697d7911033c` — a different tenant
from the one the sections above and below this note refer to by that same
name. `seed admin --username ada-whoami` run against it created the
subject behind both probes, `01a0e0a7-0ead-703a-ab34-22bcf5167d46`, rather
than reusing the existing `ada` whose password from this stack's own
history is not known here; its capabilities come from holding
`tenant-admin`, which composites every capability plus `manage-tenants`
(the same account "Getting the token" describes `ada` as). The searches
under `GET /subjects` and the two refusals under `POST /subjects` were
captured against it later, as `ada-whoami`, after its `odudu` service was
rebuilt from this branch; the searches under `GET /admin/tenants` and
`GET /clients` after a further rebuild that applied `0074`; and those under
`GET /roles`, `GET /groups`, `GET /scopes` and `GET /keys` after one that
applied `0075`, against roles and groups created in `demo` for them
through the endpoints below, as each of those sections shows. The counts
under `GET /admin/tenants/count` were captured against it after a further
rebuild, as that section says. The memberships under `GET /subjects/:id/groups` were captured
against it after one more rebuild, in a tenant of their own, as that
section says. So were the composites under `GET /roles/:id/composites` and
the defaults under `PUT /roles/:id/default`, after a further rebuild, in a
tenant `composites-demo`. `DELETE /scopes/:id/clients/:clientId` was
captured against it after one more rebuild, as a new admin subject
`ada-scope-unassign`, in a tenant `scope-unassign-demo` created for it; its
built-in admin client guard and `DELETE /scopes/:id`'s `openid` guard were
captured together after a further rebuild, as the same subject, in a
tenant `scope-guard-demo` created for them.

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
  plus `/admin/tenants` itself. `manage-tenants` authorizes the hop into
  another tenant and nothing more: the route's own capability is checked
  after it, on the same `system` admin client, so reading another tenant's
  subjects takes `manage-tenants` **and** `view-users`, amending its
  settings `manage-tenants` **and** `manage-tenant`, and so on — a system
  admin carrying only `manage-tenants` is refused with `403` by every route
  that names a capability of its own (`authorizeAdmin`,
  `packages/protocol-admin/src/usecase/authorize-admin.ts`). `/admin/tenants`
  and `whoami` are what it reaches alone: the first names `manage-tenants`
  as its own capability, the second names none.

Either way, the token must carry an `aud` naming this admin API,
`urn:odudu:params:admin-api` — an ordinary access token minted for the
protocol surface does not authorize anything here — and the request is refused if the grant behind the token
has been revoked, its session has ended, or its client has since been
disabled. A `client_credentials` token has no session behind it, and is
refused only on the other two counts. `docs/superpowers/specs/2026-09-24-p4c-admin-api-design.md`
section 7 has the full authentication and authorization sequence;
[README.md](../README.md) explains why the built-in admin client is shaped
the way it is, and "Getting the token" below is the run every transcript
here used.

**Every path parameter but `{tenant}` is a row id**, narrowed before the
route runs: an id that is not a canonical hyphenated UUID is refused with
`400`, which a caller can tell apart from the `404` a well-formed id
matching nothing answers. That is narrower than what PostgreSQL itself
accepts — the hyphenless and brace-wrapped forms are refused here. A tenant is addressed by name instead. The published OpenAPI
document declares each of these parameters, so a generated client knows the
shape of what it is filling.

| Method   | Path                                                             | What it is                                |
| -------- | ---------------------------------------------------------------- | ----------------------------------------- |
| `GET`    | `/admin/tenants`                                                 | List tenants                              |
| `GET`    | `/admin/tenants/count`                                           | Count tenants                             |
| `POST`   | `/admin/tenants`                                                 | Create a tenant                           |
| `GET`    | `/admin/tenants/{tenant}`                                        | Read one tenant                           |
| `PATCH`  | `/admin/tenants/{tenant}`                                        | Amend one tenant                          |
| `GET`    | `/admin/tenants/{tenant}/whoami`                                 | Identity probe                            |
| `GET`    | `/admin/tenants/{tenant}/subjects`                               | List subjects                             |
| `GET`    | `/admin/tenants/{tenant}/subjects/count`                         | Count subjects                            |
| `POST`   | `/admin/tenants/{tenant}/subjects`                               | Create a subject                          |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id`                           | Read a subject                            |
| `PATCH`  | `/admin/tenants/{tenant}/subjects/:id`                           | Amend a subject                           |
| `DELETE` | `/admin/tenants/{tenant}/subjects/:id`                           | Delete a subject                          |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/credentials`               | List a subject's credentials              |
| `DELETE` | `/admin/tenants/{tenant}/subjects/:id/credentials/:credentialId` | Remove a credential                       |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/required-actions`          | Read a subject's required actions         |
| `PUT`    | `/admin/tenants/{tenant}/subjects/:id/required-actions`          | Set a subject's required actions          |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/roles`                     | Read a subject's roles                    |
| `PUT`    | `/admin/tenants/{tenant}/subjects/:id/roles`                     | Replace a subject's roles                 |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/groups`                    | Read a subject's groups                   |
| `PUT`    | `/admin/tenants/{tenant}/subjects/:id/groups`                    | Replace a subject's groups                |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/sessions`                  | List a subject's live sessions            |
| `DELETE` | `/admin/tenants/{tenant}/subjects/:id/sessions/:sid`             | End one session                           |
| `GET`    | `/admin/tenants/{tenant}/settings`                               | Read a tenant's settings                  |
| `PATCH`  | `/admin/tenants/{tenant}/settings`                               | Amend a tenant's settings                 |
| `GET`    | `/admin/tenants/{tenant}/clients`                                | List clients                              |
| `GET`    | `/admin/tenants/{tenant}/clients/count`                          | Count clients                             |
| `POST`   | `/admin/tenants/{tenant}/clients`                                | Create a client                           |
| `GET`    | `/admin/tenants/{tenant}/clients/:id`                            | Read a client                             |
| `PATCH`  | `/admin/tenants/{tenant}/clients/:id`                            | Amend a client                            |
| `DELETE` | `/admin/tenants/{tenant}/clients/:id`                            | Delete a client                           |
| `POST`   | `/admin/tenants/{tenant}/clients/:id/secret`                     | Rotate a client's secret                  |
| `GET`    | `/admin/tenants/{tenant}/registration-tokens`                    | List initial access tokens                |
| `POST`   | `/admin/tenants/{tenant}/registration-tokens`                    | Mint an initial access token              |
| `DELETE` | `/admin/tenants/{tenant}/registration-tokens/:id`                | Revoke an initial access token            |
| `GET`    | `/admin/tenants/{tenant}/roles`                                  | List roles                                |
| `GET`    | `/admin/tenants/{tenant}/roles/count`                            | Count roles                               |
| `POST`   | `/admin/tenants/{tenant}/roles`                                  | Create a role                             |
| `GET`    | `/admin/tenants/{tenant}/roles/:id`                              | Read a role                               |
| `PATCH`  | `/admin/tenants/{tenant}/roles/:id`                              | Amend a role                              |
| `DELETE` | `/admin/tenants/{tenant}/roles/:id`                              | Delete a role                             |
| `POST`   | `/admin/tenants/{tenant}/roles/:id/composites`                   | Add a role composite                      |
| `GET`    | `/admin/tenants/{tenant}/roles/:id/composites`                   | List a role's direct composites           |
| `DELETE` | `/admin/tenants/{tenant}/roles/:id/composites/:childId`          | Remove a role composite                   |
| `PUT`    | `/admin/tenants/{tenant}/roles/:id/default`                      | Set whether new subjects get a role       |
| `GET`    | `/admin/tenants/{tenant}/groups`                                 | List groups                               |
| `GET`    | `/admin/tenants/{tenant}/groups/count`                           | Count groups                              |
| `POST`   | `/admin/tenants/{tenant}/groups`                                 | Create a group                            |
| `GET`    | `/admin/tenants/{tenant}/groups/:id`                             | Read a group                              |
| `PATCH`  | `/admin/tenants/{tenant}/groups/:id`                             | Amend a group (reparent)                  |
| `DELETE` | `/admin/tenants/{tenant}/groups/:id`                             | Delete a group                            |
| `GET`    | `/admin/tenants/{tenant}/groups/:id/roles`                       | Read a group's roles                      |
| `PUT`    | `/admin/tenants/{tenant}/groups/:id/roles`                       | Replace a group's roles                   |
| `GET`    | `/admin/tenants/{tenant}/scopes`                                 | List client scopes                        |
| `GET`    | `/admin/tenants/{tenant}/scopes/count`                           | Count client scopes                       |
| `POST`   | `/admin/tenants/{tenant}/scopes`                                 | Create a client scope                     |
| `GET`    | `/admin/tenants/{tenant}/scopes/:id`                             | Read a client scope                       |
| `PATCH`  | `/admin/tenants/{tenant}/scopes/:id`                             | Amend a client scope                      |
| `DELETE` | `/admin/tenants/{tenant}/scopes/:id`                             | Delete a client scope                     |
| `GET`    | `/admin/tenants/{tenant}/scopes/:id/roles`                       | Read a scope's roles                      |
| `PUT`    | `/admin/tenants/{tenant}/scopes/:id/roles`                       | Replace a scope's roles                   |
| `PUT`    | `/admin/tenants/{tenant}/scopes/:id/clients/:clientId`           | Assign a scope to a client                |
| `DELETE` | `/admin/tenants/{tenant}/scopes/:id/clients/:clientId`           | Unassign a scope from a client            |
| `GET`    | `/admin/tenants/{tenant}/scopes/:id/mappers`                     | Read a scope's claim mapper bindings      |
| `PUT`    | `/admin/tenants/{tenant}/scopes/:id/mappers`                     | Replace a scope's claim mapper bindings   |
| `GET`    | `/admin/tenants/{tenant}/keys`                                   | List signing keys                         |
| `POST`   | `/admin/tenants/{tenant}/keys`                                   | Stage a signing key                       |
| `POST`   | `/admin/tenants/{tenant}/keys/:id/promote`                       | Promote a signing key                     |
| `POST`   | `/admin/tenants/{tenant}/keys/:id/retire`                        | Retire a signing key                      |
| `GET`    | `/admin/tenants/{tenant}/flow/executions`                        | Read a tenant's authentication flow       |
| `PUT`    | `/admin/tenants/{tenant}/flow/executions`                        | Replace a tenant's authentication flow    |
| `GET`    | `/admin/tenants/{tenant}/smtp`                                   | Read a tenant's own SMTP configuration    |
| `PUT`    | `/admin/tenants/{tenant}/smtp`                                   | Replace a tenant's own SMTP configuration |
| `DELETE` | `/admin/tenants/{tenant}/smtp`                                   | Remove a tenant's own SMTP configuration  |
| `POST`   | `/admin/tenants/{tenant}/smtp/test`                              | Send one test message                     |
| `GET`    | `/admin/tenants/{tenant}/audit`                                  | List the tenant's audit trail             |
| `GET`    | `/admin/openapi.json`                                            | The OpenAPI reference                     |

## Getting the token

`odudu seed admin` creates the `system` tenant, its `odudu-admin` client
and its signing key, and a subject holding `tenant-admin` there — which
composites every capability plus `manage-tenants`, so this one subject
reaches every route in the table above, in every tenant.

```bash
docker compose exec -T odudu node dist/main.js seed admin --username ada
```

```
27Kfg-JXR64ZjLc9FkJ_0kIERHv-EeuF
This password is shown once and cannot be retrieved again.
{"command":"admin","tenantId":"0199aa00-0000-7000-8000-000000000001","username":"ada","subjectId":"01a0de12-c116-70ee-9cc1-984429980dcc"}
```

The subject is created with an `update-password` required action, so the
first `authorize`/login round trip does not end in a redirect. It ends on
the change-password page, whose form carries the same `auth_session_id`
the login form did:

```
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Change your password</title></head>
<body>
<h1>Change your password</h1>
<p>This account needs a new password before you can continue.</p>
<form method="post" action="/tenants/system/login-actions/required-action?action=update-password">
  <input type="hidden" name="auth_session_id" value="01a0de13-03cf-7df3-bd31-e5086f0926c1">
  <label>New password <input type="password" name="password" autocomplete="new-password"></label>
  <button type="submit">Update password</button>
</form>
</body>
</html>
```

Submitting it **returns the sign-in page, not the redirect** — clearing the
action leaves the authentication session to be completed from the start,
with the new password:

```bash
curl -sS -c jar -b jar \
  --data-urlencode "auth_session_id=01a0de13-03cf-7df3-bd31-e5086f0926c1" \
  --data-urlencode 'password=correct-horse-battery-staple-9' \
  'http://localhost:3000/tenants/system/login-actions/required-action?action=update-password'

curl -sS -D - -c jar -b jar \
  --data-urlencode "auth_session_id=01a0de13-03cf-7df3-bd31-e5086f0926c1" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery-staple-9' \
  'http://localhost:3000/tenants/system/login-actions/authenticate'
```

```
HTTP/1.1 302 Found
set-cookie: system-session=01a0de13-04cb-70b0-8def-e2775efe7bd8:uCLBEyReeXErUxqMZDN-CsA_U44NWLcWDo2fylzaSOo; HttpOnly; SameSite=Lax; Path=/
set-cookie: system-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
location: http://127.0.0.1:8080/callback?code=4uFhKJ34riRIjYzfr-EfMI8filnxus4w7pQe6H1wc6M&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fsystem
```

The cookie's value is `<session id>:<secret>`. The id half is the `sid`
the token below carries, so every client that receives a token holds it;
only the secret, which the server keeps as a sha256 hash, signs anybody in.

The code redeems at `/token` the way any `authorization_code` does. The
access token's `aud` carries `urn:odudu:params:admin-api` **without the
request asking for it** — it comes from the client's own registered
`audiences`, which `provisionAdminClient` sets, so no `resource` parameter
is involved. The block below is that token's payload, base64url-decoded and
indented — it is the one place here where what is shown is not the bytes on
the wire, because the bytes on the wire are a signed JWT:

```
{
  "iss": "http://localhost:3000/tenants/system",
  "sub": "01a0de12-c116-70ee-9cc1-984429980dcc",
  "aud": ["urn:odudu:params:admin-api", "http://localhost:3000/tenants/system"],
  "client_id": "odudu-admin",
  "scope": "openid",
  "iat": 1790432192,
  "exp": 1790432492,
  "jti": "01a0de13-27db-7965-99e5-40acd8f67252",
  "sid": "01a0de13-04cb-70b0-8def-e2775efe7bd8",
  "grant_id": "01a0de13-27db-7965-99e5-40ab0704242c"
}
```

`expires_in` is 300 seconds, so a capture session longer than five minutes
refreshes with the `refresh_token` the same response carried. The probe
that says the token works at all — captured against the fourth stack, so
the subject is `ada-whoami` rather than the `ada` the token payload above
belongs to:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/system/whoami
```

```
{"subjectId":"01a0e0a7-0ead-703a-ab34-22bcf5167d46","issuerTenantId":"0199aa00-0000-7000-8000-000000000001","capabilities":["manage-clients","manage-keys","manage-sessions","manage-tenant","manage-tenants","manage-users","view-audit","view-users"],"crossTenant":false}
```

## `GET /admin/tenants`

Lists tenants — every one, the `system` tenant included: hiding it would
make the one tenant an operator most needs to inspect the one they cannot.
Requires `manage-tenants`, which only a system admin holds, so this is the
one collection with no tenant-local view. Pages by an opaque cursor, `?limit=`
and `?cursor=`, ordered by `id`; a further page is announced by a
`Link: rel="next"` header and a `next` member in the body, both absent once
the collection fits in one page. The response carries no total;
`GET /admin/tenants/count` below answers one.

**Search** works the way `GET /subjects` below describes it: a prefix of one
named field, `?name=` or `?display_name=`, never both, folded by
PostgreSQL's `lower()` and matched as a range over the stored `name_search`
and `display_name_search` columns (`0074_list_indexes_tenants_clients.sql`),
so `%`, `_` and `\` are ordinary characters. A searched listing is ordered
by that folded column, then by `id`; a tenant with no display name never
matches `?display_name=`. **`?enabled=true|false`** is the one exact filter,
`AND`ed with a search. A cursor is bound to every filter it was minted
under, and any other parameter is refused with `400` naming it.

```bash
curl -sS \
  -H "Authorization: Bearer $SYSTEM_ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants?limit=50"
```

Captured after `POST /admin/tenants` below had created `demo`, so both
tenants this stack ever held are in it — the collection fits one page, and
there is no `next`:

```
{"items":[{"id":"0199aa00-0000-7000-8000-000000000001","name":"system","display_name":"System","enabled":true,"created_at":"2026-09-25T05:12:51.138Z"},{"id":"01a0d6fc-3626-7e23-94d7-3b1b666e278f","name":"demo","display_name":"Demo","enabled":true,"created_at":"2026-09-25T05:14:08.294Z"}]}
```

The searches below ran against the fourth stack (the note at the top of
this document), as `ada-whoami`, after its `odudu` service was rebuilt from
this branch with `0074` applied. Its tenants were `acme`, `demo`,
`register-audit`, `registration-audit`, `reset-audit`, `signup-audit` and
`system`, only `system` carrying a display name. `RE` finds three, in
folded order:

```bash
curl -sS \
  -H "Authorization: Bearer $SYSTEM_ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants?name=RE"
```

```
{"items":[{"id":"01a0dc4f-d714-7bef-a239-11d5bd1f2a72","name":"register-audit","display_name":null,"enabled":true,"created_at":"2026-09-26T06:03:35.061Z"},{"id":"01a0dc5e-697a-722f-bbd7-be4e5bbcecf9","name":"registration-audit","display_name":null,"enabled":true,"created_at":"2026-09-26T06:19:30.043Z"},{"id":"01a0dc50-7654-75c9-a070-33faf7d67368","name":"reset-audit","display_name":null,"enabled":true,"created_at":"2026-09-26T06:04:15.831Z"}]}
```

One at a time, the `Link` header carries the search forward:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $SYSTEM_ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants?name=re&limit=1"
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e111-060b-7ac9-ae56-fa8aa1ba87ae
link: </admin/tenants?limit=1&name=re&cursor=eyJhZnRlciI6IjAxYTBkYzRmLWQ3MTQtN2JlZi1hMjM5LTExZDViZDFmMmE3MiIsInNvcnQiOiJyZWdpc3Rlci1hdWRpdCIsImNvbGxlY3Rpb24iOiJ0ZW5hbnRzIiwidGVuYW50SWQiOiIwMTk5YWEwMC0wMDAwLTcwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJmaWx0ZXJzIjoiMUo1ZVF0UmJjX2QtVnhmRjUzNEUzekYtbDVwMGZfVUxMa0JWRm1xNXVjWSJ9.p9t40iB1ExaYswHRfklYb0tEVuUEstFAYbb5vOsM8AE>; rel="next"
content-type: application/json; charset=utf-8
content-length: 478
Date: Sun, 27 Sep 2026 04:13:04 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a0dc4f-d714-7bef-a239-11d5bd1f2a72","name":"register-audit","display_name":null,"enabled":true,"created_at":"2026-09-26T06:03:35.061Z"}],"next":"eyJhZnRlciI6IjAxYTBkYzRmLWQ3MTQtN2JlZi1hMjM5LTExZDViZDFmMmE3MiIsInNvcnQiOiJyZWdpc3Rlci1hdWRpdCIsImNvbGxlY3Rpb24iOiJ0ZW5hbnRzIiwidGVuYW50SWQiOiIwMTk5YWEwMC0wMDAwLTcwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJmaWx0ZXJzIjoiMUo1ZVF0UmJjX2QtVnhmRjUzNEUzekYtbDVwMGZfVUxMa0JWRm1xNXVjWSJ9.p9t40iB1ExaYswHRfklYb0tEVuUEstFAYbb5vOsM8AE"}
```

Following that link, then replaying its cursor with `?enabled=true` added:

```bash
CURSOR='eyJhZnRlciI6IjAxYTBkYzRmLWQ3MTQtN2JlZi1hMjM5LTExZDViZDFmMmE3MiIsInNvcnQiOiJyZWdpc3Rlci1hdWRpdCIsImNvbGxlY3Rpb24iOiJ0ZW5hbnRzIiwidGVuYW50SWQiOiIwMTk5YWEwMC0wMDAwLTcwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJmaWx0ZXJzIjoiMUo1ZVF0UmJjX2QtVnhmRjUzNEUzekYtbDVwMGZfVUxMa0JWRm1xNXVjWSJ9.p9t40iB1ExaYswHRfklYb0tEVuUEstFAYbb5vOsM8AE'
curl -sS \
  -H "Authorization: Bearer $SYSTEM_ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants?limit=1&name=re&cursor=$CURSOR"
curl -sS \
  -H "Authorization: Bearer $SYSTEM_ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants?limit=1&name=re&enabled=true&cursor=$CURSOR"
```

```
{"items":[{"id":"01a0dc5e-697a-722f-bbd7-be4e5bbcecf9","name":"registration-audit","display_name":null,"enabled":true,"created_at":"2026-09-26T06:19:30.043Z"}],"next":"eyJhZnRlciI6IjAxYTBkYzVlLTY5N2EtNzIyZi1iYmQ3LWJlNGU1YmJjZWNmOSIsInNvcnQiOiJyZWdpc3RyYXRpb24tYXVkaXQiLCJjb2xsZWN0aW9uIjoidGVuYW50cyIsInRlbmFudElkIjoiMDE5OWFhMDAtMDAwMC03MDAwLTgwMDAtMDAwMDAwMDAwMDAxIiwiZmlsdGVycyI6IjFKNWVRdFJiY19kLVZ4ZkY1MzRFM3pGLWw1cDBmX1VMTGtCVkZtcTV1Y1kifQ.2b_mHSKhKJFf35rqU4TUNk7_a8uW_CMukEsHGaeft-4"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"cursor is invalid or expired","instance":"01a0e111-2f33-763c-8b75-1b3bca9b9516"}
```

`?display_name=SYS`, then three refusals: two search fields at once (the
handler's), an `enabled` that is not `true` or `false`, and an unknown
parameter (both the generated schema's):

```bash
curl -sS \
  -H "Authorization: Bearer $SYSTEM_ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants?display_name=SYS"
curl -sS \
  -H "Authorization: Bearer $SYSTEM_ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants?name=a&display_name=b"
curl -sS \
  -H "Authorization: Bearer $SYSTEM_ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants?enabled=yes"
curl -sS \
  -H "Authorization: Bearer $SYSTEM_ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants?search=demo"
```

```
{"items":[{"id":"0199aa00-0000-7000-8000-000000000001","name":"system","display_name":"System","enabled":true,"created_at":"2026-09-26T04:49:29.367Z"}]}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"search one field at a time: name or display_name, not both","instance":"01a0e111-2f5b-7fdc-80a0-19721d415ece"}
{"type":"about:blank","title":"Error","status":400,"detail":"querystring/enabled must be equal to one of the allowed values","instance":"01a0e111-2f6e-797c-93a4-97125df202c8"}
{"type":"about:blank","title":"Error","status":400,"detail":"querystring must NOT have additional properties: search","instance":"01a0e111-2f77-744a-a2f4-25ff48780b0b"}
```

## `POST /admin/tenants`

Creates a tenant: the row, its browser authentication flow
(`provisionTenant`, `@odudu/authn-flows`) and its built-in admin client
(`provisionAdminClient`, `@odudu/protocol-oidc`) in one call, so a tenant
this endpoint returns is one an operator can immediately provision an admin
for. `manage-tenants` is required, the same as the listing above.

A tenant name is a DNS label — 1-63 lowercase letters, digits or hyphens,
never starting or ending with one — because it is minted straight into an
issuer host segment; a shape a resolver would reject is refused with `400`
before it ever becomes one (`isValidTenantName`, `@odudu/domain-tenant`),
and the same CHECK stands behind it at the database
(`tenants_name_dns_label`, `packages/db/drizzle/0072_tenant_name_rule.sql`).
`system` and `count` are refused with `409` on top of that — reserved for
the tenant this API itself administers from, and for the collection route
`GET /admin/tenants/count` would otherwise shadow — rather than left to
surface as a unique-index conflict; `odudu seed tenant --name system` and
`--name count` are refused for the identical reasons
(`isReservedTenantName`, `@odudu/domain-tenant`), as is
`seed({ tenant: 'system', … })`, the options form of the same command. A
name another tenant already holds is refused with `409` too — under
row-level security a tenant carrying it is not visible to this call, so the
unique index is what answers, mapped to the same shape rather than left to
surface as a `500`.

```bash
curl -sS -D - -X POST \
  -H "Authorization: Bearer $SYSTEM_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "demo", "display_name": "Demo"}' \
  http://localhost:3000/admin/tenants
```

```
HTTP/1.1 201 Created
content-type: application/json; charset=utf-8

{"id":"01a0d6fc-3626-7e23-94d7-3b1b666e278f","name":"demo","display_name":"Demo","enabled":true,"created_at":"2026-09-25T05:14:08.294Z"}
```

Both refusals, against that same stack — the reserved name, then the name
the call above had just taken:

```
{"type":"about:blank","title":"Conflict","status":409,"detail":"the name \"system\" is reserved","instance":"01a0d6ff-87ec-7a40-b65e-a2b6205f4428"}
{"type":"about:blank","title":"Conflict","status":409,"detail":"the name \"demo\" is already in use","instance":"01a0d6ff-87ff-7621-bf57-d9d1cdf24dfd"}
```

And the DNS-label refusal, captured against a third stack — the request
above with `Acme` in place of `demo`:

```bash
curl -sS -D - -X POST \
  -H "Authorization: Bearer $SYSTEM_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Acme"}' \
  http://localhost:3000/admin/tenants
```

```
HTTP/1.1 400 Bad Request
content-type: application/problem+json; charset=utf-8

{"type":"about:blank","title":"Bad Request","status":400,"detail":"a tenant name must be 1-63 lowercase letters, digits or hyphens, and must not start or end with a hyphen","instance":"01a0e05c-e39b-7443-965e-2c1ac9f260ff"}
```

## `GET /admin/tenants/{tenant}` and `PATCH /admin/tenants/{tenant}`

Both require `manage-tenant` on the tenant named in the path — the tenant
itself, not the collection, so a tenant-local admin reaches its own and a
system admin reaches any tenant's by holding `manage-tenant` there too.
The `GET` answers the same shape `GET /admin/tenants` lists, with an
`ETag` over it; the `PATCH` accepts `If-Match` and answers `412` on a
mismatch, the same optional concurrency control `PATCH /settings` uses.

Two fields amend: `display_name` and `enabled`. Everything else is refused
with `400` carrying its reason, `name` most of all — it is already in the
issuer URL of every token this tenant has minted and in the path of every
request addressed to it, so renaming through a general amendment would
orphan both. That is a decision rather than a gap: a rename that reissued
nothing would leave every relying party's configured issuer pointing at a
tenant that no longer answers, so it belongs to an operation that migrates
those too, not to a general amendment.

`enabled: false` is how a tenant is taken out of service without deleting
it: its own administrators stop authenticating, so the flag is not one to
set from a token issued by the tenant being disabled. On the **system**
tenant it is refused with `409` — every cross-tenant administrator
authenticates there, so disabling it would lock the whole deployment's
administration out with `psql` the only way back, the same reasoning that
guards the built-in admin client.

Captured against the second stack, whose `demo` was created with
`display_name: "Demo"`. The read, then an amendment, then the two
refusals:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo
```

```
HTTP/1.1 200 OK
x-request-id: 01a0d7ee-d299-79b7-9ab5-cd6648e1d99c
etag: "cf5d154ca41d107fb966ae7e17efdccd41fd93c9da58b8f8ba29543bf9c1d8da"
content-type: application/json; charset=utf-8
content-length: 136

{"id":"01a0d7ee-b611-71a0-b223-5a57ecbe83d8","name":"demo","display_name":"Demo","enabled":true,"created_at":"2026-09-25T09:39:00.754Z"}
```

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"display_name": "Demo Holdings"}' \
  http://localhost:3000/admin/tenants/demo

curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"name": "demo-2"}' \
  http://localhost:3000/admin/tenants/demo

curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"enabled": false}' \
  http://localhost:3000/admin/tenants/system
```

```
{"id":"01a0d7ee-b611-71a0-b223-5a57ecbe83d8","name":"demo","display_name":"Demo Holdings","enabled":true,"created_at":"2026-09-25T09:39:00.754Z"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"name: name is already in the issuer URL of every token this tenant has minted, and in the path of every admin and protocol request addressed to it; renaming it needs its own operation, not a general amendment","instance":"01a0d7ee-d2ca-7bd6-a42d-34908215a08e"}
{"type":"about:blank","title":"Conflict","status":409,"detail":"system is the tenant every cross-tenant administrator authenticates against and cannot be disabled","instance":"01a0d7ee-d2dd-7389-8e92-3c9457c79199"}
```

Replaying the `ETag` from the read above — one generation stale after the
amendment — is refused and changes nothing:

```
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a0d7ef-0287-7c9d-a24c-9fdbc8b1f5d6"}
```

## `GET /settings` and `PATCH /settings`

The 28 columns `tenants` carries beyond identity — everything
`odudu seed tenant --set` can already change — read and amended through one
map, `@odudu/domain-tenant`'s `SETTINGS`
(`packages/domain-tenant/src/service/tenant-settings.ts`): a name a caller
writes and a column a migration owns, never restated a second time. Ranges
are not in that map — they are `CHECK` constraints on `tenants`, so a value
outside one is refused by the database itself, not by a second copy of the
rule here.

Requires `manage-tenant` on the tenant named in the path — a tenant-local
admin's own capability, so a system admin reaches it only by also holding
that role there, `manage-tenants` alone is not enough. A `GET`
carries an `ETag` over the settings as they stand. A `PATCH` may carry
`If-Match`: absent, the write proceeds unconditionally; present and stale,
the request is refused with `412` and nothing is changed — the concurrency
control every amending endpoint in this API shares. The row is locked for
the rest of the amending transaction before its current `ETag` is computed,
so two `PATCH`es sent at once are serialised: the second reads what the
first wrote and its `If-Match` is stale, rather than both matching the same
pre-write row and the later write replacing the earlier one unseen.

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/settings
```

Captured against `demo` as `POST /admin/tenants` had just created it, so
every value but `display_name` is the migration's own default:

```
HTTP/1.1 200 OK
etag: "6aa9aa25fbfe79b1d0b8a345d33642eab1ebd60ce5e3a3f4500a3c8002aa81b2"
content-type: application/json; charset=utf-8

{"display_name":"Demo","enabled":true,"registration_allowed":false,"verify_email":false,"reset_password_allowed":false,"sso_session_idle_seconds":1800,"sso_session_max_seconds":36000,"password_min_length":8,"password_require_digit":false,"password_require_uppercase":false,"password_require_lowercase":false,"password_require_special":false,"password_not_username":true,"password_not_email":true,"password_history_depth":0,"password_max_age_days":0,"otp_required":false,"brute_force_max_failures":5,"brute_force_lockout_seconds":60,"brute_force_max_lockout_seconds":900,"brute_force_failure_reset_seconds":43200,"client_registration_policy":"disabled","max_clients":200,"max_sessions_per_browser":25,"remember_me_allowed":false,"remember_me_idle_seconds":604800,"remember_me_max_seconds":2592000,"audit_retention_days":90}
```

Amending sends only the settings that change, and the response is the whole
object as it now reads, with a fresh `ETag` for the next `If-Match`:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"verify_email": true, "password_min_length": 14}' \
  http://localhost:3000/admin/tenants/demo/settings
```

```
HTTP/1.1 200 OK
etag: "3f8b0bb2e9d80ce1a85d8ca2c4a24d29781110ff96090e5af2baa2a1be4f2f31"
content-type: application/json; charset=utf-8

{"display_name":"Demo","enabled":true,"registration_allowed":false,"verify_email":true,"reset_password_allowed":false,"sso_session_idle_seconds":1800,"sso_session_max_seconds":36000,"password_min_length":14,"password_require_digit":false,"password_require_uppercase":false,"password_require_lowercase":false,"password_require_special":false,"password_not_username":true,"password_not_email":true,"password_history_depth":0,"password_max_age_days":0,"otp_required":false,"brute_force_max_failures":5,"brute_force_lockout_seconds":60,"brute_force_max_lockout_seconds":900,"brute_force_failure_reset_seconds":43200,"client_registration_policy":"disabled","max_clients":200,"max_sessions_per_browser":25,"remember_me_allowed":false,"remember_me_idle_seconds":604800,"remember_me_max_seconds":2592000,"audit_retention_days":90}
```

A name this map does not know is refused with `400`, naming the settings it
does — which is also the one place the whole vocabulary is listed by the
server itself:

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"unknown tenant setting \"nonesuch\"; expected one of display_name, enabled, registration_allowed, verify_email, reset_password_allowed, sso_session_idle_seconds, sso_session_max_seconds, password_min_length, password_require_digit, password_require_uppercase, password_require_lowercase, password_require_special, password_not_username, password_not_email, password_history_depth, password_max_age_days, otp_required, brute_force_max_failures, brute_force_lockout_seconds, brute_force_max_lockout_seconds, brute_force_failure_reset_seconds, client_registration_policy, max_clients, max_sessions_per_browser, remember_me_allowed, remember_me_idle_seconds, remember_me_max_seconds, audit_retention_days","instance":"01a0d6fc-3690-7dd6-b489-cd6055a38719"}
```

A value the map itself coerces but the database's `CHECK` still
refuses — `password_min_length` outside `8..256`, for instance — is also
`400`, naming the setting rather than the constraint that fired: the
database stays the one authority for the range, and the caller still learns
which value it refused. A setting's value may be sent as its JSON type
(`true`, `14`) or as the equivalent string (`"true"`, `"14"`) — both reach
the same `coerceTenantSetting` the CLI uses, which reads a string either
way.

## `GET /clients`, `POST /clients` and `GET /clients/{id}`

Lists, reads and creates clients — the `clients` row and its OIDC
configuration (`client_oidc_config`), joined into one resource keyed by the
client's internal id (`{id}` above is that id, not the OAuth `client_id`
string a token request names). Requires `manage-clients` throughout: there
is no `view-clients`, because client metadata is configuration rather than
a population to browse. A `GET` on a single client carries an `ETag`, which
`PATCH /clients/{id}` below reads back through `If-Match`.

A create body names `client_id` — chosen by the operator, unlike RFC 7591
dynamic registration (`clients-registrations/openid-connect`,
[docs/request-paths.md](request-paths.md#dynamic-client-registration))
where the server assigns it — plus the same RFC 7591 client metadata dynamic
registration accepts, narrowed by the identical validator
(`parseClientMetadata`, `packages/protocol-oidc/src/service/client-metadata.ts`):
a `redirect_uris` entry it rejects, or `jwks` and `jwks_uri` sent together,
is refused here with the identical `400` detail. `odudu-admin` is refused
as a `client_id` with `409` — reserved for the built-in admin client every
tenant is provisioned with, and creation is a door dynamic registration
never opens to it in the first place, since RFC 7591 §2 already assigns
`client_id` there and refuses a caller that names one itself. A `client_id`
that collides with an existing client in the tenant is refused the same
way, also `409`, rather than surfacing as the database's own unique-index
violation.

A create body may also carry any field `PATCH /clients/{id}` below
amends — `audiences`, `web_origins`, `post_logout_redirect_uris`,
`client_credentials_scopes`, `access_token_ttl_seconds`,
`refresh_token_ttl_seconds`, `consent_required`,
`token_exchange_impersonation_allowed`, `enabled`, `full_scope_allowed` and
`name` — each checked by the identical validation `PATCH` runs. A field
`PATCH` refuses to amend, such as `type`, is refused here with `PATCH`'s own
reason; a key that names nothing on the client at all is refused with `400`
and the detail `<field>: <field> is not a client field`, naming it rather
than silently ignoring it; `name` sent alongside a different `client_name`
is refused the same way.

Creating a client that names both, against `demo`:

```bash
curl -sS -D - -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"client_id": "demo-fields-check", "grant_types": ["client_credentials"], "token_endpoint_auth_method": "client_secret_basic", "audiences": ["https://api.demo.example"], "web_origins": ["https://app.demo.example"]}' \
  http://localhost:3000/admin/tenants/demo/clients
```

```
HTTP/1.1 201 Created
content-type: application/json; charset=utf-8
content-length: 1718

{"id":"01a0dee4-3a27-7076-b0d3-d3bd2db632e6","client_id":"demo-fields-check","name":"demo-fields-check","type":"confidential","enabled":true,"full_scope_allowed":false,"registration_origin":"operator","created_at":"2026-09-26T18:04:54.089Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":["https://api.demo.example"],"access_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"client_credentials_scopes":[],"web_origins":["https://app.demo.example"],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"scopes":[{"id":"01a0db22-1c49-77ff-a5fa-142643a0007b","name":"openid","assignment":"default"},{"id":"01a0db22-1c4e-7a48-8315-7c43645f6a9f","name":"profile","assignment":"default"},{"id":"01a0db22-1c50-7331-bf7e-b42d450e2722","name":"email","assignment":"default"},{"id":"01a0db22-1c51-7727-bbbf-0b638aff4a8c","name":"address","assignment":"default"},{"id":"01a0db22-1c52-7250-9cf8-64f1fa48b24b","name":"phone","assignment":"default"},{"id":"01a0db22-1c54-7d81-8481-01d0e0fdfb72","name":"roles","assignment":"default"},{"id":"01a0db22-1c56-7da8-8d78-5c6f6da9846f","name":"groups","assignment":"default"},{"id":"01a0db22-1c57-79be-98ea-a35bc621100b","name":"offline_access","assignment":"optional"}],"client_secret":"gS4SN94EZtV6Rd0W2GelBnN27ZfkWtdyXgAt1gZCjGA"}
```

`GET`ting it back shows both fields still set, from the row rather than the
create response:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/clients/01a0dee4-3a27-7076-b0d3-d3bd2db632e6
```

```
HTTP/1.1 200 OK
etag: "b1e8c1b1b17c7677d4702d00df856af4901eefc1273b2399650b7dab8d4ac1a0"
content-type: application/json; charset=utf-8
content-length: 1656

{"id":"01a0dee4-3a27-7076-b0d3-d3bd2db632e6","client_id":"demo-fields-check","name":"demo-fields-check","type":"confidential","enabled":true,"full_scope_allowed":false,"registration_origin":"operator","created_at":"2026-09-26T18:04:54.089Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":["https://api.demo.example"],"access_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"client_credentials_scopes":[],"web_origins":["https://app.demo.example"],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"scopes":[{"id":"01a0db22-1c49-77ff-a5fa-142643a0007b","name":"openid","assignment":"default"},{"id":"01a0db22-1c4e-7a48-8315-7c43645f6a9f","name":"profile","assignment":"default"},{"id":"01a0db22-1c50-7331-bf7e-b42d450e2722","name":"email","assignment":"default"},{"id":"01a0db22-1c51-7727-bbbf-0b638aff4a8c","name":"address","assignment":"default"},{"id":"01a0db22-1c52-7250-9cf8-64f1fa48b24b","name":"phone","assignment":"default"},{"id":"01a0db22-1c54-7d81-8481-01d0e0fdfb72","name":"roles","assignment":"default"},{"id":"01a0db22-1c56-7da8-8d78-5c6f6da9846f","name":"groups","assignment":"default"},{"id":"01a0db22-1c57-79be-98ea-a35bc621100b","name":"offline_access","assignment":"optional"}]}
```

An unknown field, on the same tenant:

```bash
curl -sS -D - -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"client_id": "demo-bad-field", "grant_types": ["client_credentials"], "token_endpoint_auth_method": "client_secret_basic", "colour": "blue"}' \
  http://localhost:3000/admin/tenants/demo/clients
```

```
HTTP/1.1 400 Bad Request
content-type: application/problem+json; charset=utf-8
content-length: 155

{"type":"about:blank","title":"Bad Request","status":400,"detail":"colour: colour is not a client field","instance":"01a0dee4-4e6c-73bf-a05e-86cf72f751a8"}
```

A tenant at its `max_clients` cap (`GET`/`PATCH /settings` above) refuses
creation here with `403`, the same cap `registerClient`'s own
`lockCapacity` enforces for dynamic registration — `manage-clients` and
`manage-tenant`, which sets the cap, are different capabilities, so this
door locks and counts for itself rather than trusting the two to be held
together.

Every client created through this door is recorded as
`registration_origin: "operator"` — distinct from the CLI's `"seeded"`, RFC
7591 open registration's `"anonymous"` and a registration token's
`"token"` — so the four ways a client came to exist stay told apart in the
one column that records it.

A confidential client (`token_endpoint_auth_method` anything but `none`) is
given a generated secret, returned **exactly once, in the creation
response**. Nothing reads it back afterward — `clients.secret_hash` is the
only thing stored.

```bash
curl -sS -D - -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"client_id": "demo-backend", "grant_types": ["client_credentials"], "token_endpoint_auth_method": "client_secret_basic"}' \
  http://localhost:3000/admin/tenants/demo/clients
```

`201`, the whole client, the tenant's default scope assignments, and the
one-time secret. The `scopes` ids are `demo`'s own, created with the tenant
above:

```
HTTP/1.1 201 Created
content-type: application/json; charset=utf-8

{"id":"01a0d6fc-e5b4-73d4-9162-e2a9893d64b0","client_id":"demo-backend","name":"demo-backend","type":"confidential","enabled":true,"full_scope_allowed":false,"registration_origin":"operator","created_at":"2026-09-25T05:14:53.164Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":[],"access_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"scopes":[{"id":"01a0d6fc-3628-7829-8b29-5697c271d92e","name":"openid","assignment":"default"},{"id":"01a0d6fc-3629-7e64-a89c-2804355f56cf","name":"profile","assignment":"default"},{"id":"01a0d6fc-362a-7075-bcf5-dd0ed3f11a86","name":"email","assignment":"default"},{"id":"01a0d6fc-362a-7075-bcf5-dd0f8bb7530a","name":"address","assignment":"default"},{"id":"01a0d6fc-362b-7e0c-8a4d-4d3d27f20576","name":"phone","assignment":"default"},{"id":"01a0d6fc-362c-7c77-a383-af72e19f1886","name":"roles","assignment":"default"},{"id":"01a0d6fc-362c-7c77-a383-af737fd4358b","name":"groups","assignment":"default"},{"id":"01a0d6fc-362d-7533-bab9-7ea5ea57ba8d","name":"offline_access","assignment":"optional"}],"client_secret":"8ifZC73Id0zHBaQ05QgjVsKl7fTaMHPo6_M92X-Zp1A"}
```

`client_secret` is the only member of that object nothing reads back. Note
what is **not** there: `builtin_admin`. The column the disable and delete
guards below read is not part of a client's representation, so the psql
listing under `PATCH /clients/{id}` is what shows it.

The reserved `client_id`, refused against the same tenant:

```
{"type":"about:blank","title":"Conflict","status":409,"detail":"the client_id \"odudu-admin\" is reserved","instance":"01a0d6ff-8816-7f15-827d-118b7b6ee5ed"}
```

Listing pages the same way `GET /admin/tenants` does — `?limit=`, `?cursor=`,
ordered by `id`, a `Link: rel="next"` header and a `next` body member once a
further page exists, no total (`GET /clients/count` below has one). On this
stack the page held two clients, the tenant's own `odudu-admin` and
`demo-backend` above:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/clients?limit=50
```

**Search and filters** follow `GET /admin/tenants` above: a prefix of
`?client_id=` or `?name=`, never both, over the stored `client_id_search`
and `name_search` columns (`0074_list_indexes_tenants_clients.sql`),
ordered by that folded column then by `id`; exact filters
`?type=public|confidential` and `?enabled=true|false`, `AND`ed with it and
with each other; a cursor bound to every filter; any other parameter
refused with `400` naming it. Captured against the fourth stack, whose
`demo` held `demo-backend`, `demo-exchanger`, `demo-fields-check` and
`demo-operator` (confidential) and `demo-spa` (public):

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/clients?client_id=DEMO&type=confidential&limit=1"
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e111-4389-77ad-8af7-83fe5e2a746c
link: </admin/tenants/demo/clients?limit=1&client_id=DEMO&type=confidential&cursor=eyJhZnRlciI6IjAxYTBkYmQ0LTAxZjgtNzVmZC05YWZmLTFhYmI4NDFjYjRiOSIsInNvcnQiOiJkZW1vLWJhY2tlbmQiLCJjb2xsZWN0aW9uIjoiY2xpZW50cyIsInRlbmFudElkIjoiMDFhMGRiMjItMWMzMi03ZDE3LWIzNTEtNjk3ZDc5MTEwMzNjIiwiZmlsdGVycyI6Ik9BZENoUUxJNEt5UGtUMUhLc05ESld5WDM4NS1YaWFsQktSbkNXOUNPZHMifQ.5eRgvj6hT2_V1Lq6V21m9mTuyo4-4DlrHiWpahxFiIU>; rel="next"
content-type: application/json; charset=utf-8
content-length: 1993
Date: Sun, 27 Sep 2026 04:13:20 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a0dbd4-01f8-75fd-9aff-1abb841cb4b9","client_id":"demo-backend","name":"demo-backend","type":"confidential","enabled":true,"full_scope_allowed":false,"registration_origin":"seeded","created_at":"2026-09-26T03:48:19.537Z","redirect_uris":["http://localhost:8080/callback"],"grant_types":["authorization_code","refresh_token","client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":[],"access_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"scopes":[{"id":"01a0db22-1c49-77ff-a5fa-142643a0007b","name":"openid","assignment":"default"},{"id":"01a0db22-1c4e-7a48-8315-7c43645f6a9f","name":"profile","assignment":"default"},{"id":"01a0db22-1c50-7331-bf7e-b42d450e2722","name":"email","assignment":"default"},{"id":"01a0db22-1c51-7727-bbbf-0b638aff4a8c","name":"address","assignment":"default"},{"id":"01a0db22-1c52-7250-9cf8-64f1fa48b24b","name":"phone","assignment":"default"},{"id":"01a0db22-1c54-7d81-8481-01d0e0fdfb72","name":"roles","assignment":"default"},{"id":"01a0db22-1c56-7da8-8d78-5c6f6da9846f","name":"groups","assignment":"default"},{"id":"01a0db22-1c57-79be-98ea-a35bc621100b","name":"offline_access","assignment":"optional"}]}],"next":"eyJhZnRlciI6IjAxYTBkYmQ0LTAxZjgtNzVmZC05YWZmLTFhYmI4NDFjYjRiOSIsInNvcnQiOiJkZW1vLWJhY2tlbmQiLCJjb2xsZWN0aW9uIjoiY2xpZW50cyIsInRlbmFudElkIjoiMDFhMGRiMjItMWMzMi03ZDE3LWIzNTEtNjk3ZDc5MTEwMzNjIiwiZmlsdGVycyI6Ik9BZENoUUxJNEt5UGtUMUhLc05ESld5WDM4NS1YaWFsQktSbkNXOUNPZHMifQ.5eRgvj6hT2_V1Lq6V21m9mTuyo4-4DlrHiWpahxFiIU"}
```

Following that link, then `?name=Demo-S`, each cut down with `jq` to the
fields that show the point; then the same cursor replayed with `?type=`
dropped:

```bash
CURSOR='eyJhZnRlciI6IjAxYTBkYmQ0LTAxZjgtNzVmZC05YWZmLTFhYmI4NDFjYjRiOSIsInNvcnQiOiJkZW1vLWJhY2tlbmQiLCJjb2xsZWN0aW9uIjoiY2xpZW50cyIsInRlbmFudElkIjoiMDFhMGRiMjItMWMzMi03ZDE3LWIzNTEtNjk3ZDc5MTEwMzNjIiwiZmlsdGVycyI6Ik9BZENoUUxJNEt5UGtUMUhLc05ESld5WDM4NS1YaWFsQktSbkNXOUNPZHMifQ.5eRgvj6hT2_V1Lq6V21m9mTuyo4-4DlrHiWpahxFiIU'
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/clients?limit=1&client_id=DEMO&type=confidential&cursor=$CURSOR" \
  | jq -c '{items: [.items[] | {client_id, name, type}], next}'
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/clients?name=Demo-S" \
  | jq -c '{items: [.items[] | {client_id, name, type}], next}'
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/clients?limit=1&client_id=DEMO&cursor=$CURSOR"
```

```
{"items":[{"client_id":"demo-exchanger","name":"demo-exchanger","type":"confidential"}],"next":"eyJhZnRlciI6IjAxYTBkZTU2LTE4NDYtN2NjMS04ZGUxLWFiODYyMDU1YjhkNiIsInNvcnQiOiJkZW1vLWV4Y2hhbmdlciIsImNvbGxlY3Rpb24iOiJjbGllbnRzIiwidGVuYW50SWQiOiIwMWEwZGIyMi0xYzMyLTdkMTctYjM1MS02OTdkNzkxMTAzM2MiLCJmaWx0ZXJzIjoiT0FkQ2hRTEk0S3lQa1QxSEtzTkRKV3lYMzg1LVhpYWxCS1JuQ1c5Q09kcyJ9.qbB7dvI7emp9gnf9ie4ODmJGJARA4ecoZoex6qda1OQ"}
{"items":[{"client_id":"demo-spa","name":"demo-spa","type":"public"}],"next":null}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"cursor is invalid or expired","instance":"01a0e111-934b-7365-b961-ad77d71f76e6"}
```

A `type` outside the enum, then two search fields at once:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/clients?type=service"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/clients?client_id=a&name=b"
```

```
{"type":"about:blank","title":"Error","status":400,"detail":"querystring/type must be equal to one of the allowed values","instance":"01a0e111-6b64-759a-9718-bc9846e1f418"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"search one field at a time: client_id or name, not both","instance":"01a0e111-6b6e-7aa0-89ab-8b62a99cd765"}
```

Reading one client by its internal id carries an `ETag` and never the
secret, whether or not one was ever generated:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/clients/01a0d6fc-e5b4-73d4-9162-e2a9893d64b0
```

```
HTTP/1.1 200 OK
etag: "721f3544b87c2a93b0160b4b51e95eb0c5107d77fd31fa39a41d1b4afba7907c"
content-type: application/json; charset=utf-8
content-length: 1594
```

The create response above was 1656 bytes and this one is 1594: the
difference is the secret, present there and absent here.

## `PATCH /clients/{id}`

Requires `manage-clients`, as every client route does. Amends the fields a
general-purpose amendment can safely touch — every
column of `clients` and `client_oidc_config` except identity (`id`,
`client_id`, `tenant_id`), history (`created_at`), provenance
(`registration_origin`), the security-model switch (`type`), the secret
(rotated only through `POST /secret` below) and `builtin_admin` itself. A
field this excludes is refused with `400`, naming the field and the reason
(`refusalFor`, `packages/protocol-admin/src/service/client-patch.ts`) —
`client_id` answers "identity: changing it breaks every relying party and
orphans the azp of every issued token", for instance, not merely "refused".

A list field — `redirect_uris`, `post_logout_redirect_uris`, `web_origins`,
`audiences`, `grant_types`, `client_credentials_scopes` — is replaced
**wholesale**, never appended to: the body names the complete list the
field should hold afterward. Because last-write-wins on one of these
silently reinstates exactly what another admin just removed, `If-Match` is
**required** when a request touches any of the six, answered with
`428 Precondition Required` when it is missing;
every other field amends with `If-Match` optional, the same concurrency
control `PATCH /settings` uses, row lock included. A stale `If-Match` is
`412` either way, and nothing is changed.

The RFC 7591 metadata fields among them — `redirect_uris`, `grant_types`,
`token_endpoint_auth_method`, `jwks`, `jwks_uri`, the two logout URIs and
their `_session_required` flags, the three `userinfo_*` response fields,
and `tls_client_auth_subject_dn` — are revalidated through the same
`parseClientMetadata` a create body runs through, against the amended
value merged with what the client already holds: a `redirect_uris` entry
registration would refuse is refused here with the identical `400` detail,
and narrowing `grant_types` takes effect on the very next `/token` request,
since nothing about a grant type is cached anywhere between the two.

Amending `token_endpoint_auth_method` to a value on the other side of the
public/confidential boundary — `none` for a confidential client, or
anything else for a public one — is refused with `409`, naming the
client's current type and the type the new method implies: the same
concern `type` itself being unamendable exists for, reached through a
different field. `client_secret_basic`, `client_secret_post` and
`private_key_jwt` are always confidential and freely amendable into one
another; `tls_client_auth` joins them only when TLS client authentication
is enabled (`ODUDU_TRUST_PROXY`) — `parseClientMetadata` refuses it
otherwise, on a create or an amend alike. `none` is the only public
method.

The built-in admin client (`builtin_admin`) is amended through an
allowlist, not an exclusion list: `name`, `consent_required`, the two
logout URIs and their `_session_required` flags, and the three
`userinfo_*` algorithms. Every other field is refused with `409` naming
the field and the client, because each could leave every administrator of
the tenant locked out while the client stays enabled — `audiences` carries
the admin API's own resource identifier, `grant_types`,
`token_endpoint_auth_method` and `redirect_uris` decide how a token is
obtained at all, and recovery from any of them is through `psql`.
Disabling it (`enabled: false`) carries its own reason. Stated this way
round, a column added to `clients` or `client_oidc_config` later is
refused on this one client until somebody judges it safe, rather than
opening a fresh door by default. The guard reads the `builtin_admin`
column, not `client_id`, so renaming the client does not evade it. An
**ordinary** admin-capable client carries no such guard and may be
disabled even by the caller whose own token runs through it — the built-in
client is the recovery path that makes that permissible.

Amending a list field without `If-Match`, and amending a field the
exclusion list names — the refusal carries the reason, not just the
refusal:

```
{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to amend redirect_uris","instance":"01a0d703-3447-7e19-b584-95b550fd90b0"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"client_id: identity: changing it breaks every relying party and orphans the azp of every issued token","instance":"01a0d703-345c-74db-9618-d6bc257b82af"}
```

The revalidation is not a formality. `demo-backend` was created with
`grant_types: ["client_credentials"]` and no `redirect_uris`; widening the
grants alone, with a good `If-Match`, is refused, because the merged
metadata no longer satisfies the rule that excused the empty list:

```bash
curl -sS -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "721f3544b87c2a93b0160b4b51e95eb0c5107d77fd31fa39a41d1b4afba7907c"' \
  -d '{"grant_types": ["client_credentials","refresh_token"]}' \
  http://localhost:3000/admin/tenants/demo/clients/01a0d6fc-e5b4-73d4-9162-e2a9893d64b0
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"redirect_uris is required unless grant_types is exactly [\"client_credentials\"]","instance":"01a0d703-346f-7951-8f22-3840777b824f"}
```

An amendment that does pass, with that same `ETag`, and the fresh one it
returns:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "721f3544b87c2a93b0160b4b51e95eb0c5107d77fd31fa39a41d1b4afba7907c"' \
  -d '{"audiences": ["https://api.demo.example"]}' \
  http://localhost:3000/admin/tenants/demo/clients/01a0d6fc-e5b4-73d4-9162-e2a9893d64b0
```

```
HTTP/1.1 200 OK
etag: "0d54739bab7b13288c3d6e04be6b179c7cb2303e5d720a864235a643f1e7ef3e"
content-type: application/json; charset=utf-8
content-length: 1620
```

Replaying the identical request — same `If-Match`, now one generation
stale — is refused and changes nothing:

```
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a0d703-349d-786d-9fc1-ac4631a105f5"}
```

**The two `409`s that disabling produces are told apart by one column, and
the admin API does not expose it**, so it is read from the database beside
them rather than asserted. The three clients are `demo`'s own built-in one,
`demo-backend` above, and `demo-app`, which the sessions section below
creates:

```bash
docker compose exec -T postgres psql -U odudu -d odudu -c \
  "select client_id, builtin_admin, enabled from clients
     where tenant_id = '01a0d6fc-3626-7e23-94d7-3b1b666e278f' order by client_id;"
```

```
  client_id   | builtin_admin | enabled
--------------+---------------+---------
 demo-app     | f             | t
 demo-backend | f             | t
 odudu-admin  | t             | t
(3 rows)
```

`demo-backend`, `builtin_admin` false, disables — and the response is the
whole client, so `enabled` can be read back from it:

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"enabled": false}' \
  http://localhost:3000/admin/tenants/demo/clients/01a0d6fc-e5b4-73d4-9162-e2a9893d64b0
```

```
{"id":"01a0d6fc-e5b4-73d4-9162-e2a9893d64b0","client_id":"demo-backend","name":"demo-backend","type":"confidential","enabled":false,"full_scope_allowed":false,"registration_origin":"operator","created_at":"2026-09-25T05:14:53.164Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":["https://api.demo.example"],"access_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"scopes":[{"id":"01a0d6fc-3628-7829-8b29-5697c271d92e","name":"openid","assignment":"default"},{"id":"01a0d6fc-3629-7e64-a89c-2804355f56cf","name":"profile","assignment":"default"},{"id":"01a0d6fc-362a-7075-bcf5-dd0ed3f11a86","name":"email","assignment":"default"},{"id":"01a0d6fc-362a-7075-bcf5-dd0f8bb7530a","name":"address","assignment":"default"},{"id":"01a0d6fc-362b-7e0c-8a4d-4d3d27f20576","name":"phone","assignment":"default"},{"id":"01a0d6fc-362c-7c77-a383-af72e19f1886","name":"roles","assignment":"default"},{"id":"01a0d6fc-362c-7c77-a383-af737fd4358b","name":"groups","assignment":"default"},{"id":"01a0d6fc-362d-7533-bab9-7ea5ea57ba8d","name":"offline_access","assignment":"optional"}]}
```

`odudu-admin`, `builtin_admin` true, the same request against the other id
in that listing, does not:

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"enabled": false}' \
  http://localhost:3000/admin/tenants/demo/clients/01a0d6fc-3632-7d66-b7c1-71695bd9e71f
```

```
{"type":"about:blank","title":"Conflict","status":409,"detail":"odudu-admin is this tenant's built-in admin client and cannot be disabled","instance":"01a0d703-358b-7e86-8398-16a5d3936196"}
```

## `DELETE /clients/{id}`

Requires `manage-clients`. Deletes the client and its OIDC configuration in
one statement — the
foreign key from `client_oidc_config` to `clients` cascades, so nothing
here deletes the config row a second time. `204` with no body on success,
`404` for an id that does not exist, and the same `409` built-in-admin
guard `PATCH` uses: the built-in client cannot be deleted any more than it
can be disabled.

All three outcomes against `demo`, in that order: the built-in client, an
id nothing holds, then `demo-backend`. A `404` carries no `detail` at all,
only the status and the request id:

```bash
curl -sS -D - -X DELETE \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/clients/01a0d6fc-e5b4-73d4-9162-e2a9893d64b0
```

```
{"type":"about:blank","title":"Conflict","status":409,"detail":"odudu-admin is this tenant's built-in admin client and cannot be deleted","instance":"01a0d708-7b5e-7443-b462-7af170e24808"}
{"type":"about:blank","title":"Not Found","status":404,"instance":"01a0d708-7b71-7e3b-8a95-a58ed9456ef2"}

HTTP/1.1 204 No Content
x-request-id: 01a0d708-7b86-7dfe-9913-5ea326976017
```

## `POST /clients/{id}/secret`

Requires `manage-clients`. Rotates a confidential client's secret: generates a fresh one, stores only
its hash, and returns the plaintext **exactly once, in this response** —
the same guarantee `POST /clients` makes for a client's first secret.
Nothing reads it back afterward, and the previous secret stops
authenticating at `/token` immediately, since only the current hash is ever
compared against. A public client (`token_endpoint_auth_method: "none"`)
has no secret to rotate, refused with `409`.

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/clients/01a0d6fc-e5b4-73d4-9162-e2a9893d64b0/secret
```

Captured immediately after the disable above, which is why `enabled` reads
`false` here: rotating a disabled client's secret is allowed, the guard
being on the built-in client rather than on a disabled one.

```
{"id":"01a0d6fc-e5b4-73d4-9162-e2a9893d64b0","client_id":"demo-backend","name":"demo-backend","type":"confidential","enabled":false,"full_scope_allowed":false,"registration_origin":"operator","created_at":"2026-09-25T05:14:53.164Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":["https://api.demo.example"],"access_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"scopes":[{"id":"01a0d6fc-3628-7829-8b29-5697c271d92e","name":"openid","assignment":"default"},{"id":"01a0d6fc-3629-7e64-a89c-2804355f56cf","name":"profile","assignment":"default"},{"id":"01a0d6fc-362a-7075-bcf5-dd0ed3f11a86","name":"email","assignment":"default"},{"id":"01a0d6fc-362a-7075-bcf5-dd0f8bb7530a","name":"address","assignment":"default"},{"id":"01a0d6fc-362b-7e0c-8a4d-4d3d27f20576","name":"phone","assignment":"default"},{"id":"01a0d6fc-362c-7c77-a383-af72e19f1886","name":"roles","assignment":"default"},{"id":"01a0d6fc-362c-7c77-a383-af737fd4358b","name":"groups","assignment":"default"},{"id":"01a0d6fc-362d-7533-bab9-7ea5ea57ba8d","name":"offline_access","assignment":"optional"}],"client_secret":"_0B83ooNdhzevzQk9fj_7VuvRSFhldgaE6kdDd8Zy4Y"}
```

## `GET /registration-tokens`, `POST /registration-tokens` and `DELETE /registration-tokens/:id`

All three require `manage-clients`, the same capability the client routes
above need — an initial access token is configuration for dynamic
registration, not a population of its own. `POST` mints one:
`{"uses": <int, 1–2147483647>, "ttl_seconds": <int, 60–31536000>}` — a
year is this project's own ceiling on how long a bootstrap credential may
outlive the operator who minted it, not a protocol or storage limit —
answering `201` with `id`, `token`, `remaining_uses` and `expires_at`.
**This is the only response, from any route, that ever carries `token`** —
a following `GET` lists `id`, `remaining_uses`, `created_at` and
`expires_at` and nothing else, the plaintext is never logged, and it never
appears in an audit `detail`. `DELETE` revokes one by `id`, answering
`204`, or `404` if the id names no _live_ token — one already spent to
zero uses or expired answers `404` the same way an id nothing ever minted
does, since `GET` was already hiding it from the caller.

`GET` never lists a token that has been spent to zero uses or has expired
— the same two conditions `spend`
(`packages/domain-tenant/src/repository/client-registration-tokens.ts`)
already refuses under, so the list a caller sees is exactly the set of
tokens that would still redeem. It pages in SQL, like every other listing
here: a page anchored on a token that has since expired, been spent out or
been revoked still resumes from the same place, because the cursor is a
plain `id` comparison rather than a position inside a snapshot of the
whole set. Minting records `uses` and `ttl_seconds` in the audit trail;
revoking records what was revoked (`remaining_uses`, `expires_at`) the
same way a client's own amendment does, through the same allowlisted diff
— never the token or its hash, on either action.

`demo`'s own policy is `disabled`; this capture opens it to `token` first,
the same door `PATCH /settings` opens to `open` for the sections above,
and closes it again at the end, in the same transcript:

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"client_registration_policy": "token"}' \
  http://localhost:3000/admin/tenants/demo/settings > /dev/null

curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"uses": 1, "ttl_seconds": 3600}' \
  http://localhost:3000/admin/tenants/demo/registration-tokens
```

```
{"id":"01a0e1bd-1658-7dd7-a886-e6d701026191","token":"iMpoXXUt6YF1ioil8i0eI8b912sLAHPjNLISdtXG1Eo","remaining_uses":1,"expires_at":"2026-09-27T08:21:00.760Z"}
```

Listing right after shows the same token with no `token` field, and
presenting it at `/tenants/demo/clients-registrations/openid-connect`
registers a client:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/registration-tokens
curl -sS -X POST \
  -H "Authorization: Bearer iMpoXXUt6YF1ioil8i0eI8b912sLAHPjNLISdtXG1Eo" \
  -H "Content-Type: application/json" \
  -d '{"redirect_uris": ["https://rp.example/cb"]}' \
  http://localhost:3000/tenants/demo/clients-registrations/openid-connect
```

```
{"items":[{"id":"01a0e1bd-1658-7dd7-a886-e6d701026191","remaining_uses":1,"created_at":"2026-09-27T07:21:00.759Z","expires_at":"2026-09-27T08:21:00.760Z"}]}
{"client_id":"01a0e1bd-2763-78a3-bf18-de64780558d8","client_id_issued_at":1790493665,"client_secret":"BvxM_Jnw2jU3gWyhMo-1tOVdAIJoOaBdqTdT7TCXTmM","client_secret_expires_at":0,"redirect_uris":["https://rp.example/cb"],"grant_types":["authorization_code"],"token_endpoint_auth_method":"client_secret_basic"}
```

A second, freshly minted token demonstrates the other half — `DELETE`,
then a registration attempt with the now-revoked token:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"uses": 1, "ttl_seconds": 3600}' \
  http://localhost:3000/admin/tenants/demo/registration-tokens
```

```
{"id":"01a0e1bd-36f3-7e51-84a5-25d4b0b2d50e","token":"CCsWyDsal7TdxscIypKk4s0kG7Id6fsTTD2JW719oxU","remaining_uses":1,"expires_at":"2026-09-27T08:21:09.108Z"}
```

```bash
curl -sS -D - -o /dev/null -X DELETE \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/registration-tokens/01a0e1bd-36f3-7e51-84a5-25d4b0b2d50e \
  | grep -iE '^HTTP'
curl -sS -D - -o /dev/null -X POST \
  -H "Authorization: Bearer CCsWyDsal7TdxscIypKk4s0kG7Id6fsTTD2JW719oxU" \
  -H "Content-Type: application/json" \
  -d '{"redirect_uris": ["https://rp.example/cb"]}' \
  http://localhost:3000/tenants/demo/clients-registrations/openid-connect \
  | grep -iE '^HTTP|www-authenticate'
```

```
HTTP/1.1 204 No Content
HTTP/1.1 401 Unauthorized
www-authenticate: Bearer realm="client-registration", error="invalid_token"
```

The audit trail for that mint and that revoke, each scoped to the second
token's own `resource_id` so this prints only the row it describes rather
than every mint or revoke `demo` has ever recorded:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/audit?action=registration_token.mint&resource_type=registration_token&resource_id=01a0e1bd-36f3-7e51-84a5-25d4b0b2d50e"
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/audit?action=registration_token.revoke&resource_type=registration_token&resource_id=01a0e1bd-36f3-7e51-84a5-25d4b0b2d50e"
```

```
{"items":[{"id":"01a0e1bd-36f7-70a8-b075-0f63ba51ff19","occurred_at":"2026-09-27T07:21:09.106Z","event_type":"admin_mutation","action":"registration_token.mint","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0e1ac-87e9-7e58-bb85-d4cb7c6535b1","actor_client_id":"01a0dc0c-0130-7dd6-a9d5-c867c3577f62","resource_type":"registration_token","resource_id":"01a0e1bd-36f3-7e51-84a5-25d4b0b2d50e","request_id":"01a0e1bd-36cf-7549-a184-629a614157d1","ip":"172.20.0.1","detail":{"uses":1,"ttl_seconds":3600}}]}
{"items":[{"id":"01a0e1bd-4a55-75e2-a75f-48529fd60b9f","occurred_at":"2026-09-27T07:21:14.065Z","event_type":"admin_mutation","action":"registration_token.revoke","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0e1ac-87e9-7e58-bb85-d4cb7c6535b1","actor_client_id":"01a0dc0c-0130-7dd6-a9d5-c867c3577f62","resource_type":"registration_token","resource_id":"01a0e1bd-36f3-7e51-84a5-25d4b0b2d50e","request_id":"01a0e1bd-4a39-7bef-bac1-4d92c2a1274e","ip":"172.20.0.1","detail":{"expires_at":{"before":"2026-09-27T08:21:09.108Z"},"remaining_uses":{"before":1}}}]}
```

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"client_registration_policy": "disabled"}' \
  http://localhost:3000/admin/tenants/demo/settings | head -c 60
```

```
{"display_name":null,"enabled":true,"registration_allo
```

## `GET /whoami`

The identity probe: what an operator reaches for when a token is not
working and they need to know what the server thinks it is, before
debugging anything else. It requires an authenticated caller and no
capability beyond that — any admin token good enough to reach this tenant's
admin surface at all can call it, the one route the capability matrix
(`packages/protocol-admin/tests/capability-matrix.int.test.ts`) proves
every `TenantCapability` admits.

It answers `subjectId` (the token's `sub`), `issuerTenantId` — the tenant
that **issued** the token, not the tenant named in the URL — `capabilities`
and `crossTenant`. `capabilities` is the caller's own effective admin-client
roles, resolved on its issuing tenant exactly the way `authorizeAdmin`
resolves them (`callerCapabilities`, `packages/protocol-admin/src/index.ts`)
— composites expanded, so a `manage-users` holder sees `view-users`
alongside it — narrowed to the seven `TenantCapability` names plus
`manage-tenants` and sorted. A composite role itself, `tenant-admin` among
them, is never a member of that list: holding one expands to what it
composites, never to its own name, and the published schema enforces the
narrowing with a `z.enum` over that fixed vocabulary rather than an open
`string[]`. The set is the same regardless of which tenant is named in the
path: what a caller may do is fixed by where its roles live, not by what it
is asking about. `crossTenant` is `true` when the path tenant differs from
the issuing one, which is exactly when reaching a capability-gated route
here also needs `manage-tenants` ("The shape of it" above).

The captured run is under "Getting the token" above, against
`/admin/tenants/system/whoami` (`crossTenant: false`, the caller's own
tenant). The same token against `demo` — a tenant `ada-whoami` never
issued from — answers identical `capabilities`, `crossTenant` now `true`:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/whoami
```

```
{"subjectId":"01a0e0a7-0ead-703a-ab34-22bcf5167d46","issuerTenantId":"0199aa00-0000-7000-8000-000000000001","capabilities":["manage-clients","manage-keys","manage-sessions","manage-tenant","manage-tenants","manage-users","view-audit","view-users"],"crossTenant":true}
```

## `GET /subjects`

Requires `view-users`. `manage-users` also reaches it: `provisionAdminClient`
(`packages/domain-tenant/src/usecase/provision-admin-client.ts`) composites
every `manage-*` role to its `view-*` counterpart through `role_composites`,
so a caller holding only `manage-users` already holds `view-users` by the
time `authorizeAdmin` resolves its effective roles — nothing in the route
special-cases it. Pages by an opaque cursor, `?limit=` and `?cursor=`,
ordered by `id`, the same convention every other listing in this API
follows.

**Search** is a prefix of one named field, case-insensitive: `?username=`
or `?email=`, never both at once. The prefix is folded by PostgreSQL's
`lower()`, the same function that fills the stored `username_search` and
`email_search` columns (`0073_list_indexes_subjects.sql`), and matched as a
range between two bounds rather than with `LIKE`, so `%`, `_` and `\` are
ordinary characters. A searched listing is ordered by that folded column,
in code-point order, then by `id`, and its cursor carries the folded value
of the last row. A subject with no `users` row (`type: "service"`,
provisioned for a confidential client's service account) never matches a
search and is only ever reached by an unsearched page.

**Exact filters** are `?enabled=true|false`, `?role=<id>` (subjects the
role is assigned to directly, not through a group or a composite) and
`?group=<id>` (the group's direct members). Every parameter given is
`AND`ed. A cursor is bound to the filters it was minted under, so replaying
it with any other set is refused, and any parameter not named here is
refused with `400` naming it — `?search=`, which this listing once took,
among them.

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/subjects?limit=50"
```

Three subjects by the time this ran, and the first is the point of the
paragraph above: `demo-backend`'s service account, created with the client
and carrying no `users` row, so `username` and `email` are `null` and no
search would ever return it. `ada` is `POST /subjects` below; `bob` is
the seeded user the sessions section needs:

```
{"items":[{"id":"01a0d6fc-e571-7685-b843-00be9303dd03","type":"service","username":null,"email":null,"enabled":true,"created_at":"2026-09-25T05:14:53.164Z"},{"id":"01a0d6fd-9453-7bf0-9823-a5fc6ea34836","type":"user","username":"ada","email":"ada@demo.example","enabled":true,"created_at":"2026-09-25T05:15:37.939Z"},{"id":"01a0d6fd-ede7-704b-8d83-fa3801d427a0","type":"user","username":"bob","email":"bob@demo.example","enabled":true,"created_at":"2026-09-25T05:16:00.867Z"}]}
```

The searches below ran against the fourth stack (the note at the top of
this document), whose `demo` held `ada` (`ada@example.com`) and four
service subjects; `Adaline` and `adam` were created through
`POST /subjects` just before, with no email. `ADA` finds all three, in
folded order:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/subjects?username=ADA"
```

```
{"items":[{"id":"01a0db22-1c92-7730-9d37-4085f28eca2c","type":"user","username":"ada","email":"ada@example.com","enabled":true,"created_at":"2026-09-26T00:34:00.903Z"},{"id":"01a0e0eb-90c0-75a7-96ec-4694cd78a76a","type":"user","username":"Adaline","email":null,"enabled":true,"created_at":"2026-09-27T03:32:09.534Z"},{"id":"01a0e0eb-90e2-743b-9d26-6507c4c813f6","type":"user","username":"adam","email":null,"enabled":true,"created_at":"2026-09-27T03:32:09.569Z"}]}
```

One at a time, the `Link` header carries the search forward:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/subjects?username=ADA&limit=1"
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e0eb-ae5c-797f-b148-b9216b567fab
link: </admin/tenants/demo/subjects?limit=1&username=ADA&cursor=eyJhZnRlciI6IjAxYTBkYjIyLTFjOTItNzczMC05ZDM3LTQwODVmMjhlY2EyYyIsInNvcnQiOiJhZGEiLCJjb2xsZWN0aW9uIjoic3ViamVjdHMiLCJ0ZW5hbnRJZCI6IjAxYTBkYjIyLTFjMzItN2QxNy1iMzUxLTY5N2Q3OTExMDMzYyIsImZpbHRlcnMiOiJzWGl1TzdkZGVoRzhlYVUyUWkySWotRnJjVVAyMWVwTUJBWmxEc3FQYUVVIn0.B6FJzxJCoNTpoBieeq3YyEMKs61JZhl0gdcXVbNv8m0>; rel="next"
content-type: application/json; charset=utf-8
content-length: 478
Date: Sun, 27 Sep 2026 03:32:17 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a0db22-1c92-7730-9d37-4085f28eca2c","type":"user","username":"ada","email":"ada@example.com","enabled":true,"created_at":"2026-09-26T00:34:00.903Z"}],"next":"eyJhZnRlciI6IjAxYTBkYjIyLTFjOTItNzczMC05ZDM3LTQwODVmMjhlY2EyYyIsInNvcnQiOiJhZGEiLCJjb2xsZWN0aW9uIjoic3ViamVjdHMiLCJ0ZW5hbnRJZCI6IjAxYTBkYjIyLTFjMzItN2QxNy1iMzUxLTY5N2Q3OTExMDMzYyIsImZpbHRlcnMiOiJzWGl1TzdkZGVoRzhlYVUyUWkySWotRnJjVVAyMWVwTUJBWmxEc3FQYUVVIn0.B6FJzxJCoNTpoBieeq3YyEMKs61JZhl0gdcXVbNv8m0"}
```

Following that link, then replaying its cursor under `?username=b`,
captured later against the same stack once its `odudu` service had been
rebuilt again (the cursor is the `next` above, unchanged, since the rows it
points past had not changed):

```bash
CURSOR='eyJhZnRlciI6IjAxYTBkYjIyLTFjOTItNzczMC05ZDM3LTQwODVmMjhlY2EyYyIsInNvcnQiOiJhZGEiLCJjb2xsZWN0aW9uIjoic3ViamVjdHMiLCJ0ZW5hbnRJZCI6IjAxYTBkYjIyLTFjMzItN2QxNy1iMzUxLTY5N2Q3OTExMDMzYyIsImZpbHRlcnMiOiJzWGl1TzdkZGVoRzhlYVUyUWkySWotRnJjVVAyMWVwTUJBWmxEc3FQYUVVIn0.B6FJzxJCoNTpoBieeq3YyEMKs61JZhl0gdcXVbNv8m0'
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/subjects?limit=1&username=ADA&cursor=$CURSOR"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/subjects?limit=1&username=b&cursor=$CURSOR"
```

```
{"items":[{"id":"01a0e0eb-90c0-75a7-96ec-4694cd78a76a","type":"user","username":"Adaline","email":null,"enabled":true,"created_at":"2026-09-27T03:32:09.534Z"}],"next":"eyJhZnRlciI6IjAxYTBlMGViLTkwYzAtNzVhNy05NmVjLTQ2OTRjZDc4YTc2YSIsInNvcnQiOiJhZGFsaW5lIiwiY29sbGVjdGlvbiI6InN1YmplY3RzIiwidGVuYW50SWQiOiIwMWEwZGIyMi0xYzMyLTdkMTctYjM1MS02OTdkNzkxMTAzM2MiLCJmaWx0ZXJzIjoic1hpdU83ZGRlaEc4ZWFVMlFpMklqLUZyY1VQMjFlcE1CQVpsRHNxUGFFVSJ9.pBJNTcIKfIaq2jODL-u1jbjCB0X6CajQ5Nq3UWCwYMY"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"cursor is invalid or expired","instance":"01a0e110-6f89-715f-865c-a0d6ac67383c"}
```

`?email=ADA%40`, then the retired `?search=ada`, then `?username=a&email=b`,
in the same later run. The first refusal is the generated schema's, hence
its generic `title`; the second is the handler's:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/subjects?email=ADA%40"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/subjects?search=ada"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/subjects?username=a&email=b"
```

```
{"items":[{"id":"01a0db22-1c92-7730-9d37-4085f28eca2c","type":"user","username":"ada","email":"ada@example.com","enabled":true,"created_at":"2026-09-26T00:34:00.903Z"}]}
{"type":"about:blank","title":"Error","status":400,"detail":"querystring must NOT have additional properties: search","instance":"01a0e110-6fb6-7795-84e2-b1ea313de848"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"search one field at a time: username or email, not both","instance":"01a0e110-6fc2-7de3-8d00-d3537702334f"}
```

## `POST /subjects`

Requires `manage-users`. Creates a `type: "user"` subject: the subject
itself, its `users` row and the tenant's `default_for_new_subjects` roles —
the same composition self-registration performs
(`composeUserSubject`, `packages/protocol-admin/src/usecase/subjects.ts`,
shared with `createAccount` in `apps/server/src/app.ts` so the two doors
cannot drift on what "a new subject" means). **There is no `password`
field**, and that is a rule, not an omission: creating a subject through
this door writes an `update-password` required action instead, so no
operator ever handles a user's password, and the created subject cannot
complete a login until an out-of-band channel sets one. A body carrying
`password` is refused with `400` before the usecase ever runs — Zod's
generated schema already sets `additionalProperties: false`.

```bash
curl -sS -D - -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username": "ada", "email": "ada@demo.example"}' \
  http://localhost:3000/admin/tenants/demo/subjects
```

```
HTTP/1.1 201 Created
content-type: application/json; charset=utf-8

{"id":"01a0d6fd-9453-7bf0-9823-a5fc6ea34836","type":"user","username":"ada","email":"ada@demo.example","enabled":true,"created_at":"2026-09-25T05:15:37.939Z"}
```

A body carrying `password` and a username already in use, in that order,
recaptured against the fourth stack once a closed schema's refusal started
naming the field it refused. The first refusal is the generated schema's,
so its `title` is the framework's generic one rather than a `Bad Request`
the usecase chose — that is what "refused before the usecase ever runs"
looks like from outside:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username": "ada", "password": "hunter2"}' \
  http://localhost:3000/admin/tenants/demo/subjects
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username": "ada"}' \
  http://localhost:3000/admin/tenants/demo/subjects
```

```
{"type":"about:blank","title":"Error","status":400,"detail":"body must NOT have additional properties: password","instance":"01a0e0eb-ee9f-710d-8825-4b816bc13ae3"}
{"type":"about:blank","title":"Conflict","status":409,"detail":"the username \"ada\" is already in use","instance":"01a0e0eb-eeac-786d-a01a-3c5ee8028b64"}
```

## `GET /subjects/:id`

Requires `view-users`, the same capability the listing does. Carries an
`ETag` computed over the response body, the same convention every other
single-resource read in this API follows; an unknown id answers `404`.

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/subjects/01a0d6fd-9453-7bf0-9823-a5fc6ea34836
```

```
HTTP/1.1 200 OK
etag: "da3eb48382f6ee2d1dba5ab0257b85618325684e6073d398d382992fd751164c"
content-type: application/json; charset=utf-8

{"id":"01a0d6fd-9453-7bf0-9823-a5fc6ea34836","type":"user","username":"ada","email":"ada@demo.example","enabled":true,"created_at":"2026-09-25T05:15:37.939Z"}
```

## `PATCH /subjects/:id`

Requires `manage-users`. Amends `email` and `enabled` — the only two
general fields a subject exposes; everything else about a subject
(credentials, required actions, roles) has its own door below. Honours
`If-Match`, answering `412` on a mismatch, the same convention every other
amendment in this API follows — locked with `SELECT … FOR UPDATE` before
the `ETag` is computed, so two concurrent amendments cannot both pass the
precondition.

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}' \
  http://localhost:3000/admin/tenants/demo/subjects/01a0d6fd-9453-7bf0-9823-a5fc6ea34836
```

```
HTTP/1.1 200 OK
etag: "e0aa2da695d68cf78750779f56f4003957282bd6a88ddab5b3aa117e2efa7a19"
content-type: application/json; charset=utf-8

{"id":"01a0d6fd-9453-7bf0-9823-a5fc6ea34836","type":"user","username":"ada","email":"ada@demo.example","enabled":false,"created_at":"2026-09-25T05:15:37.939Z"}
```

The `ETag` is the one `GET /subjects/:id` above returned, recomputed — a
caller that read before this write holds a stale one.

## `DELETE /subjects/:id`

Requires `manage-users`. Removes the subject; every table that names one
(`users`, `user_credentials`, `sessions`, `token_grants`,
`subject_roles`, …) cascades, except a client whose service account named
it — `clients_service_subject_fk` (`packages/db/drizzle/0063_service_subject_fk.sql`)
detaches the client (`service_subject_id` goes `null`) rather than failing
or deleting it. An unknown id answers `404`.

## `GET /subjects/:id/credentials`

Requires `view-users`. Metadata only — `type`, `created_at`, and, for a
`password` credential, whether it is expired under the tenant's
`password_max_age_days`. Never a hash, never `secret_data`: the response is
built from an explicit field list, so a column added to `user_credentials`
later is absent by default rather than exposed by default.
`recovery-code` rows are collapsed into one entry carrying
`recovery_code_count` — ADR 0021 keeps a spent code's row, so a per-row
listing would answer "how many were ever issued" rather than "how many
still work"; that entry carries no `id`, since it names no single row a
caller could delete. `password-history` never appears: it is not a
credential a caller reads or deletes.

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/subjects/01a0d6fd-9453-7bf0-9823-a5fc6ea34836/credentials
```

Against `ada`, created through `POST /subjects` above, the list is empty —
and that is the rule the section states, seen from outside: a subject this
API creates has no password to list, only the `update-password` action
waiting for one.

```
{"items":[]}
```

## `DELETE /subjects/:id/credentials/:credentialId`

Requires `manage-users`. Removes one credential — a TOTP enrolment or a
WebAuthn credential, most operationally — so the subject's next login no
longer offers or requires it. Refuses a `password` or `password-history`
row with `409`: a password has its own rotation surface, never a bare
delete, and history is not a credential this door exposes at all. An
unknown id, or one belonging to a different subject, answers `404`.

## `GET /subjects/:id/required-actions` and `PUT /subjects/:id/required-actions`

The read requires `view-users`, the write `manage-users`. Sets a subject's
required actions wholesale — an action left out of the list is one the
caller clears, not one left alone.

**`If-Match` is mandatory here, not optional.** This route replaces an
authorization-bearing list whole, so a stale write reinstates exactly what
another administrator has just removed; the header comes from the matching
`GET`, which answers an `ETag` over the same list. Absent, the request is
refused with `428 Precondition Required` and nothing is changed; stale,
with `412`. The list is read under the same lock the replacement runs
under, so two callers sent at once are serialised — the second sees what
the first wrote rather than matching the same pre-write state.

Captured against the second stack, on `grace`, who was created through
`POST /subjects` and so carries `update-password` and nothing else. The
read first, for the `ETag` the write needs:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/subjects/01a0d7ef-2be7-7a2e-bbc5-4646e22c3169/required-actions
```

```
HTTP/1.1 200 OK
x-request-id: 01a0d7ef-47de-7e63-b9e4-f21b023efd84
etag: "b6a877586a3e8e6eec8a74fd3ec35d6463a777d4a4f379aa095140acd8edcc10"
content-type: application/json; charset=utf-8
content-length: 31

{"actions":["update-password"]}
```

The same write twice: without the header, then with it.

```bash
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"actions": ["configure-totp"]}' \
  http://localhost:3000/admin/tenants/demo/subjects/01a0d7ef-2be7-7a2e-bbc5-4646e22c3169/required-actions

curl -sS -D - -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "b6a877586a3e8e6eec8a74fd3ec35d6463a777d4a4f379aa095140acd8edcc10"' \
  -d '{"actions": ["configure-totp"]}' \
  http://localhost:3000/admin/tenants/demo/subjects/01a0d7ef-2be7-7a2e-bbc5-4646e22c3169/required-actions
```

The reply to the second is the set as it now stands — `update-password` is
gone, cleared by being left out — and a fresh `ETag` for the next write:

```
{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to replace a subject’s required actions","instance":"01a0d7ef-47f4-770e-84d7-b7570de8508e"}

HTTP/1.1 200 OK
x-request-id: 01a0d7ef-62d6-749d-815d-05486997038e
etag: "eef964de74a02f6ce5f1ed1b1aa5e6a4f65aee68bfd955a4db04374af8ec513b"
content-type: application/json; charset=utf-8
content-length: 30

{"actions":["configure-totp"]}
```

Replaying the first `ETag`, now one generation stale, changes nothing:

```
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a0d7ef-62f8-7819-a402-6a7987acd136"}
```

## `GET /subjects/:id/roles` and `PUT /subjects/:id/roles`

The read requires `view-users`. The write requires `manage-users`, and
enforces a capability ceiling beyond it: a
caller may never assign authority it does not itself hold. The requested
role set and the caller's own are each expanded through `role_composites`
to the admin-client capability names they actually grant — not merely the
role names given — before the comparison, so a role that nests
`tenant-admin` rather than naming it cannot smuggle the assignment past a
name check. A caller whose expanded set is not a subset of its own is
refused with `403`; this is what stops `manage-users` alone from assigning
`tenant-admin` — or `manage-tenants` in the system tenant — to any subject,
itself included (CWE-269). Replaces the subject's role assignments
wholesale, the same convention `required-actions` follows: a role left out
is one the caller clears, and stops appearing in the subject's
`effectiveRoles` immediately.

**`If-Match` is mandatory here, not optional.** This route replaces an
authorization-bearing list whole, so a stale write reinstates exactly what
another administrator has just removed; the header comes from the matching
`GET`, which answers an `ETag` over the same list. Absent, the request is
refused with `428 Precondition Required` and nothing is changed; stale,
with `412`. The list is read under the same lock the replacement runs
under, so two callers sent at once are serialised — the second sees what
the first wrote rather than matching the same pre-write state.

Captured against the second stack, on `grace` and its `billing-viewer`
role. The read, then the write carrying what the read answered:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/subjects/01a0d7ef-2be7-7a2e-bbc5-4646e22c3169/roles

curl -sS -D - -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"' \
  -d '{"role_ids": ["01a0d7ef-2c44-7f99-9fbb-e9f05075340c"]}' \
  http://localhost:3000/admin/tenants/demo/subjects/01a0d7ef-2be7-7a2e-bbc5-4646e22c3169/roles
```

```
etag: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"
{"items":[]}

HTTP/1.1 200 OK
x-request-id: 01a0d7ef-81b5-7dd3-9d62-c8567db4dcf0
etag: "d7978c210e861d05f88ea7ba801911708de321021641d1ef93b1a21b3e888003"
content-type: application/json; charset=utf-8
content-length: 81

{"items":[{"id":"01a0d7ef-2c44-7f99-9fbb-e9f05075340c","name":"billing-viewer"}]}
```

**The tag is over the list, not over the resource.** An empty assignment
hashes to `"eef46741…"` whichever subject, group or scope it belongs to —
the three sections that follow show the same value — so a tag is not an
identifier and carries no authority to write anywhere. It still does its
one job: a write only lands when the list is what its holder last read.

## `GET /subjects/:id/groups` and `PUT /subjects/:id/groups`

The read requires `view-users`; the write requires `manage-users`. Both
answer the groups the subject **directly** belongs to — the same set the
`groups` claim of its next token carries
([ADR 0022](adr/0022-group-claims-carry-direct-memberships.md)) — and the
write replaces that set wholesale: a group left out is one the subject
leaves. An unknown group id, or one from another tenant, answers `400`
naming it.

**Joining a group is granting its roles**, and its ancestors' too, since
role resolution walks up the tree. So the write carries the same
capability ceiling `PUT /subjects/:id/roles` does: every role mapped to a
requested group or any of its ancestors, expanded through
`role_composites`, is compared with the caller's own capabilities, and a
set reaching past them is refused with `403`, leaves the membership
unchanged, and writes a `refused` row to the audit trail. The ceiling is
measured over the whole resulting set, as it is for roles — a caller
cannot resubmit a membership it could not itself have granted, and a
removal lands only when what remains is within its reach.

**`If-Match` is mandatory here, not optional**, for the reason it is on
`PUT /subjects/:id/roles`: absent, `428`; stale, `412`. The tag is over
the list exactly as the `GET` answers it, so reparenting a member group,
which rewrites its `path`, changes the tag even though the membership did
not; an empty membership answers the same `"eef46741…"` every empty list
here does.

Captured against the fourth stack after a rebuild from this branch, in a
tenant `groups-demo` created through `POST /admin/tenants` for it. There,
`platform-admins` is mapped to `tenant-admin` through
`PUT /groups/:id/roles`, `oncall` is its child with no role of its own,
`support` has none either, and `mei` is a subject created through
`POST /subjects`. `$HELPDESK_TOKEN` belongs to `helpdesk`, a user of that
tenant created with `seed user` and granted `manage-users` alone through
`PUT /subjects/:id/roles`; `$ADMIN_TOKEN` is `ada-whoami`'s. The refusal
below turns on two facts, shown first — what `helpdesk` holds, and that
`oncall` carries nothing itself while its parent carries `tenant-admin`:

```bash
curl -sS -H "Authorization: Bearer $HELPDESK_TOKEN" \
  http://localhost:3000/admin/tenants/groups-demo/whoami

curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/groups-demo/groups/01a0e1e2-e2e0-7809-8ac4-debf2d93bc4e/roles

curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/groups-demo/groups/01a0e1e2-c43e-7bd8-bd89-bdd9b8a88245/roles
```

```
{"subjectId":"01a0e1e2-5d2c-7676-8177-2fb711b0eac0","issuerTenantId":"01a0e1e2-208f-7b7e-a30f-a2ce461cd164","capabilities":["manage-users","view-users"],"crossTenant":false}
{"items":[]}
{"items":[{"id":"01a0e1e2-20a3-743d-823b-1e7f502ce11b","name":"tenant-admin"}]}
```

The read, then a write with no `If-Match`, then `helpdesk` putting `mei`
in `oncall`:

```bash
curl -sS -D - -H "Authorization: Bearer $HELPDESK_TOKEN" \
  http://localhost:3000/admin/tenants/groups-demo/subjects/01a0e1eb-ffde-78c4-a87d-7da336c3763a/groups

curl -sS -D - -X PUT \
  -H "Authorization: Bearer $HELPDESK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"group_ids": ["01a0e1e2-c454-7927-aedb-05021d226885"]}' \
  http://localhost:3000/admin/tenants/groups-demo/subjects/01a0e1eb-ffde-78c4-a87d-7da336c3763a/groups

curl -sS -D - -X PUT \
  -H "Authorization: Bearer $HELPDESK_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"' \
  -d '{"group_ids": ["01a0e1e2-e2e0-7809-8ac4-debf2d93bc4e"]}' \
  http://localhost:3000/admin/tenants/groups-demo/subjects/01a0e1eb-ffde-78c4-a87d-7da336c3763a/groups
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e1ec-004a-74cf-8807-f7aeec5e0f93
etag: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"
content-type: application/json; charset=utf-8
content-length: 12

{"items":[]}

HTTP/1.1 428 Precondition Required
x-request-id: 01a0e1ec-0062-76c9-9cee-9a82fde460d7
content-type: application/problem+json; charset=utf-8
content-length: 181

{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to replace a subject’s groups","instance":"01a0e1ec-0062-76c9-9cee-9a82fde460d7"}

HTTP/1.1 403 Forbidden
x-request-id: 01a0e1ec-0083-737b-8c88-ac45ffbcc960
content-type: application/problem+json; charset=utf-8
content-length: 228

{"type":"about:blank","title":"Forbidden","status":403,"detail":"the caller does not hold: tenant-admin, manage-clients, manage-tenant, manage-keys, manage-sessions, view-audit","instance":"01a0e1ec-0083-737b-8c88-ac45ffbcc960"}
```

`oncall` names no role, and is refused for everything `tenant-admin`
composites that `helpdesk` does not hold — reached through its parent.
The membership is still empty, under the same tag, so the same `If-Match`
then puts `mei` in `support`, and replaying it once that has landed is
stale:

```bash
curl -sS -D - -H "Authorization: Bearer $HELPDESK_TOKEN" \
  http://localhost:3000/admin/tenants/groups-demo/subjects/01a0e1eb-ffde-78c4-a87d-7da336c3763a/groups

curl -sS -D - -X PUT \
  -H "Authorization: Bearer $HELPDESK_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"' \
  -d '{"group_ids": ["01a0e1e2-c454-7927-aedb-05021d226885"]}' \
  http://localhost:3000/admin/tenants/groups-demo/subjects/01a0e1eb-ffde-78c4-a87d-7da336c3763a/groups

curl -sS -D - -X PUT \
  -H "Authorization: Bearer $HELPDESK_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"' \
  -d '{"group_ids": []}' \
  http://localhost:3000/admin/tenants/groups-demo/subjects/01a0e1eb-ffde-78c4-a87d-7da336c3763a/groups
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e1ec-00b4-7fd3-a752-1f265427d705
etag: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"
content-type: application/json; charset=utf-8
content-length: 12

{"items":[]}

HTTP/1.1 200 OK
x-request-id: 01a0e1ec-00ce-74fa-b206-52e8358e4bfd
etag: "aaafe7626c56bdd2b2064141ca8f224733f7aa8d3b87a77ac22357774cb65700"
content-type: application/json; charset=utf-8
content-length: 149

{"items":[{"id":"01a0e1e2-c454-7927-aedb-05021d226885","name":"support","parent_id":null,"path":"/support","created_at":"2026-09-27T08:02:10.132Z"}]}

HTTP/1.1 412 Precondition Failed
x-request-id: 01a0e1ec-00ed-7f35-b795-f915e209b3ed
content-type: application/problem+json; charset=utf-8
content-length: 153

{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a0e1ec-00ed-7f35-b795-f915e209b3ed"}
```

Both writes that reached the ceiling are in the trail, scoped here to
`mei` — the refusal naming what was denied, the replacement the ids
before and after:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3000/admin/tenants/groups-demo/audit?action=subject.groups_set&resource_type=subject&resource_id=01a0e1eb-ffde-78c4-a87d-7da336c3763a'
```

```
{"items":[{"id":"01a0e1ec-00e1-72a2-840f-f28c436542ea","occurred_at":"2026-09-27T08:12:15.449Z","event_type":"admin_mutation","action":"subject.groups_set","outcome":"allowed","actor_tenant_id":"01a0e1e2-208f-7b7e-a30f-a2ce461cd164","actor_subject_id":"01a0e1e2-5d2c-7676-8177-2fb711b0eac0","actor_client_id":"01a0e1e2-209b-7b1d-9bc2-07b9bec41a60","resource_type":"subject","resource_id":"01a0e1eb-ffde-78c4-a87d-7da336c3763a","request_id":"01a0e1ec-00ce-74fa-b206-52e8358e4bfd","ip":"172.20.0.1","detail":{"group_ids":{"after":["01a0e1e2-c454-7927-aedb-05021d226885"],"before":[]}}},{"id":"01a0e1ec-00a7-7ae1-9e42-6597227c7148","occurred_at":"2026-09-27T08:12:15.392Z","event_type":"admin_mutation","action":"subject.groups_set","outcome":"refused","actor_tenant_id":"01a0e1e2-208f-7b7e-a30f-a2ce461cd164","actor_subject_id":"01a0e1e2-5d2c-7676-8177-2fb711b0eac0","actor_client_id":"01a0e1e2-209b-7b1d-9bc2-07b9bec41a60","resource_type":"subject","resource_id":"01a0e1eb-ffde-78c4-a87d-7da336c3763a","request_id":"01a0e1ec-0083-737b-8c88-ac45ffbcc960","ip":"172.20.0.1","detail":{"denied":["tenant-admin","manage-clients","manage-tenant","manage-keys","manage-sessions","view-audit"]}}]}
```

## `GET /subjects/:id/sessions` and `DELETE /subjects/:id/sessions/:sid`

Both require `manage-sessions`; there is no `view-sessions`, the same
reasoning that leaves clients with no `view-clients` — a session is reached
only by an operator who can also end one.

`GET` lists the subject's **live** sessions — the same liveness arithmetic
every other session consumer applies, each session measured against the
idle window its own `remembered` column picks. This is the one read keyed
on the subject rather than on a browser's cookie, so it is also the one
place an operator can see a session the cookie no longer names — a second
concurrent login can orphan one, and a remembered orphan idles for
`remember_me_idle_seconds` before it stops appearing (ADR 0033's
amendment). Each entry carries `id`, `created_at`, `last_active_at`,
`remembered`, and `client_ids` — the OAuth `client_id` of every enabled
client the session holds a grant for. Paginated the same way every other
list in this API is: `?limit=` and `?cursor=`, a `Link: rel="next"` header
and a body `next` while more remain, ordered by `id` — a subject's sessions
are bounded per browser by `max_sessions_per_browser`, but unbounded across
however many browsers hold one, so this listing pages exactly like the
others rather than trusting that bound.

`DELETE` ends one session through the same call the RP-Initiated Logout
usecase makes (`endSession`, `packages/protocol-oidc/src/usecase/end-session.ts`) —
there is one path that ends a session, not two. It revokes every grant the
session holds and enqueues a Back-Channel Logout Token for each registered
client that used it and has a `backchannel_logout_uri` configured (§2.5 of
the spec). **Front-Channel Logout does not apply here**: §3 renders an
iframe per relying party in the End-User's own browser, and an
admin-initiated end has no browser to render one in, so only the
back-channel delivery is attempted. Beside its own `admin_mutation` row,
`session.end`, it writes the `session.ended` row every session end writes,
with `detail.via` `admin` ([request paths](request-paths.md#what-a-session-leaves-in-the-audit-log)).
A second `DELETE` of the same session is idempotent and answers `204`:
ending an already-ended session moves neither stamp, and a repeat delivery
for the same client is deduped by `backchannel_logout_deliveries_dedupe`.
`expires_at` moves only while it is still ahead of now, and
`coalesce(revoked_at, now)` keeps the first revocation — a bare assignment
would push both stamps forward on every repeat, so a second `DELETE` at a
later moment would delay the reaping the first one started rather than
changing nothing. The repeat writes its own `admin_mutation` row, since it
is a request an administrator made, but no second `session.ended`. An
unknown session id, or one belonging to a different subject, answers `404`.

A session needs a login, and a subject this API created has no password, so
this section runs against `bob` — seeded with
`seed user --tenant demo --username bob --password …`, subject
`01a0d6fd-ede7-704b-8d83-fa3801d427a0` — signing in through `demo-app`, a
public `authorization_code` client created for it. **`verify_email` was set
back to `false` first**: `PATCH /settings` above had turned it on, and with
it on the login ends on "Can't sign in yet" rather than in a session.

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/subjects/01a0d6fd-ede7-704b-8d83-fa3801d427a0/sessions
```

```
{"items":[{"id":"01a0d6fe-9d8f-783b-b244-ea4a85ab9bfb","created_at":"2026-09-25T05:16:45.837Z","last_active_at":"2026-09-25T05:16:45.837Z","remembered":false,"client_ids":["demo-app"]}]}
```

`DELETE` twice over the same id, then the listing again — `204` both times,
and nothing left:

```bash
curl -sS -D - -X DELETE \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/subjects/01a0d6fd-ede7-704b-8d83-fa3801d427a0/sessions/01a0d6fe-9d8f-783b-b244-ea4a85ab9bfb
```

```
HTTP/1.1 204 No Content
x-request-id: 01a0d6fe-9df1-760b-8e13-7763f4c28a3d

HTTP/1.1 204 No Content
x-request-id: 01a0d6fe-9e09-7004-9844-b3c1b3abb219

{"items":[]}
```

## `GET /roles`, `POST /roles`, `GET /roles/:id`, `PATCH /roles/:id` and `DELETE /roles/:id`

All five require `manage-tenant`. A role is either a tenant role
(`client_id` is `null`) or scoped to one client, in which case a token's
`roles` claim carries it qualified by that client's own name rather than
plain — `packages/domain-authz/src/service/role-name.ts` has the format.
`PATCH` amends only `description`; every other field, `name`,
`client_id` and `default_for_new_subjects` included, is refused with a
reason — the last naming `PUT /roles/:id/default`, which is where it is
set — the same shape `PATCH /subjects/:id` refuses `id`, `type` and
`username`. A duplicate name — per tenant for a tenant role, per client for
a client-scoped one — answers `409`, and a `client_id` naming no client
answers `400`. `DELETE` cascades: every
`role_composites` edge, `subject_roles` assignment and `client_scope_roles`
mapping naming the role goes with it.

That cascade is why **a role belonging to the tenant's built-in admin
client cannot be deleted at all** — `409`, naming the role and the client.
The capability roles live on that client, and `subject_roles_role_fk` would
strip a deleted one from every administrator holding it: a caller with
`manage-tenant` and nothing else could delete `tenant-admin`, or
`manage-tenant` itself, and lock the tenant out of its own admin API. It is
the same guard `PATCH /clients/{id}` puts on that client's own lockout
fields, on the roles the client owns. The check reads the `builtin_admin`
column, so renaming the client in the database does not evade it.

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "billing-viewer", "description": "read-only access to invoices"}' \
  http://localhost:3000/admin/tenants/demo/roles
```

```
{"id":"01a0d6fd-9471-7012-89c1-36ac3403705f","name":"billing-viewer","description":"read-only access to invoices","client_id":null,"default_for_new_subjects":false,"created_at":"2026-09-25T05:15:37.968Z"}
```

**Search and filters** follow `GET /subjects`: `?name=` is a prefix,
matched case-insensitively as a range over the stored `name_search` column
(`0075_list_indexes_roles_groups_scopes.sql`), and a searched listing is
ordered by that folded name, then by `id`. **`?client=`** is the one exact
filter, `AND`ed with it: `tenant` for the tenant roles alone, or a client's
id for the roles scoped to that client. A cursor is bound to every filter
it was minted under, and any other parameter is refused with `400` naming
it. Captured against the fourth stack, whose `demo` held no roles until
these four were created, the last scoped to `demo-spa`
(`01a0db22-1c61-714b-be3a-3d5234477dff`):

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "billing-viewer"}' \
  http://localhost:3000/admin/tenants/demo/roles
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Billing-Admin"}' \
  http://localhost:3000/admin/tenants/demo/roles
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "support"}' \
  http://localhost:3000/admin/tenants/demo/roles
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "billing-spa", "client_id": "01a0db22-1c61-714b-be3a-3d5234477dff"}' \
  http://localhost:3000/admin/tenants/demo/roles
```

```
{"id":"01a0e12f-22df-73e7-9575-977e1bd046a7","name":"billing-viewer","description":null,"client_id":null,"default_for_new_subjects":false,"created_at":"2026-09-27T04:45:57.853Z"}
{"id":"01a0e12f-2305-79ce-a215-9178cd2965f3","name":"Billing-Admin","description":null,"client_id":null,"default_for_new_subjects":false,"created_at":"2026-09-27T04:45:57.892Z"}
{"id":"01a0e12f-2338-742f-b4d2-d6cb846f2416","name":"support","description":null,"client_id":null,"default_for_new_subjects":false,"created_at":"2026-09-27T04:45:57.943Z"}
{"id":"01a0e12f-2358-79bd-874b-430a64b26b8c","name":"billing-spa","description":null,"client_id":"01a0db22-1c61-714b-be3a-3d5234477dff","default_for_new_subjects":false,"created_at":"2026-09-27T04:45:57.975Z"}
```

`BILLING` finds all three `billing` roles in folded order, tenant and
client alike; `?client=tenant` keeps the two tenant roles, and the client's
id keeps its one:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/roles?name=BILLING"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/roles?name=billing&client=tenant"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/roles?client=01a0db22-1c61-714b-be3a-3d5234477dff"
```

```
{"items":[{"id":"01a0e12f-2305-79ce-a215-9178cd2965f3","name":"Billing-Admin","description":null,"client_id":null,"default_for_new_subjects":false,"created_at":"2026-09-27T04:45:57.892Z"},{"id":"01a0e12f-2358-79bd-874b-430a64b26b8c","name":"billing-spa","description":null,"client_id":"01a0db22-1c61-714b-be3a-3d5234477dff","default_for_new_subjects":false,"created_at":"2026-09-27T04:45:57.975Z"},{"id":"01a0e12f-22df-73e7-9575-977e1bd046a7","name":"billing-viewer","description":null,"client_id":null,"default_for_new_subjects":false,"created_at":"2026-09-27T04:45:57.853Z"}]}
{"items":[{"id":"01a0e12f-2305-79ce-a215-9178cd2965f3","name":"Billing-Admin","description":null,"client_id":null,"default_for_new_subjects":false,"created_at":"2026-09-27T04:45:57.892Z"},{"id":"01a0e12f-22df-73e7-9575-977e1bd046a7","name":"billing-viewer","description":null,"client_id":null,"default_for_new_subjects":false,"created_at":"2026-09-27T04:45:57.853Z"}]}
{"items":[{"id":"01a0e12f-2358-79bd-874b-430a64b26b8c","name":"billing-spa","description":null,"client_id":"01a0db22-1c61-714b-be3a-3d5234477dff","default_for_new_subjects":false,"created_at":"2026-09-27T04:45:57.975Z"}]}
```

One at a time, the `Link` header carries the search forward:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/roles?name=billing&limit=1"
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e12f-56f7-713c-a7ad-f34cf6e53d6e
link: </admin/tenants/demo/roles?limit=1&name=billing&cursor=eyJhZnRlciI6IjAxYTBlMTJmLTIzMDUtNzljZS1hMjE1LTkxNzhjZDI5NjVmMyIsInNvcnQiOiJiaWxsaW5nLWFkbWluIiwiY29sbGVjdGlvbiI6InJvbGVzIiwidGVuYW50SWQiOiIwMWEwZGIyMi0xYzMyLTdkMTctYjM1MS02OTdkNzkxMTAzM2MiLCJmaWx0ZXJzIjoiM0w4aEJkRGMyWVZnelVseHhtSlVYZGluWHJDMG10NHZMTXF1TlNTdEdOdyJ9.iZoSKcoDG6ddEPmuwpJz9_8HnSzithN61rivI_t-R24>; rel="next"
content-type: application/json; charset=utf-8
content-length: 507
Date: Sun, 27 Sep 2026 04:46:11 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a0e12f-2305-79ce-a215-9178cd2965f3","name":"Billing-Admin","description":null,"client_id":null,"default_for_new_subjects":false,"created_at":"2026-09-27T04:45:57.892Z"}],"next":"eyJhZnRlciI6IjAxYTBlMTJmLTIzMDUtNzljZS1hMjE1LTkxNzhjZDI5NjVmMyIsInNvcnQiOiJiaWxsaW5nLWFkbWluIiwiY29sbGVjdGlvbiI6InJvbGVzIiwidGVuYW50SWQiOiIwMWEwZGIyMi0xYzMyLTdkMTctYjM1MS02OTdkNzkxMTAzM2MiLCJmaWx0ZXJzIjoiM0w4aEJkRGMyWVZnelVseHhtSlVYZGluWHJDMG10NHZMTXF1TlNTdEdOdyJ9.iZoSKcoDG6ddEPmuwpJz9_8HnSzithN61rivI_t-R24"}
```

Following that link, then replaying its cursor with `?client=tenant` added:

```bash
CURSOR='eyJhZnRlciI6IjAxYTBlMTJmLTIzMDUtNzljZS1hMjE1LTkxNzhjZDI5NjVmMyIsInNvcnQiOiJiaWxsaW5nLWFkbWluIiwiY29sbGVjdGlvbiI6InJvbGVzIiwidGVuYW50SWQiOiIwMWEwZGIyMi0xYzMyLTdkMTctYjM1MS02OTdkNzkxMTAzM2MiLCJmaWx0ZXJzIjoiM0w4aEJkRGMyWVZnelVseHhtSlVYZGluWHJDMG10NHZMTXF1TlNTdEdOdyJ9.iZoSKcoDG6ddEPmuwpJz9_8HnSzithN61rivI_t-R24'
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/roles?limit=1&name=billing&cursor=$CURSOR"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/roles?limit=1&name=billing&client=tenant&cursor=$CURSOR"
```

```
{"items":[{"id":"01a0e12f-2358-79bd-874b-430a64b26b8c","name":"billing-spa","description":null,"client_id":"01a0db22-1c61-714b-be3a-3d5234477dff","default_for_new_subjects":false,"created_at":"2026-09-27T04:45:57.975Z"}],"next":"eyJhZnRlciI6IjAxYTBlMTJmLTIzNTgtNzliZC04NzRiLTQzMGE2NGIyNmI4YyIsInNvcnQiOiJiaWxsaW5nLXNwYSIsImNvbGxlY3Rpb24iOiJyb2xlcyIsInRlbmFudElkIjoiMDFhMGRiMjItMWMzMi03ZDE3LWIzNTEtNjk3ZDc5MTEwMzNjIiwiZmlsdGVycyI6IjNMOGhCZERjMllWZ3pVbHh4bUpVWGRpblhyQzBtdDR2TE1xdU5TU3RHTncifQ.WYWPqmvKgH2Pw5TWztjAOSya171GQixAbOmKQhTvTJw"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"cursor is invalid or expired","instance":"01a0e12f-817a-7083-ae48-1df59515116b"}
```

A `client` that is neither `tenant` nor an id, an unknown parameter, and
the stored `name_search` column named in a create body and in an amendment
— the first three refused by the generated schema, the last by the
amendment allowlist, which knows only the fields a role's wire shape
carries:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/roles?client=spa"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/roles?search=billing"
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "auditor", "name_search": "x"}' \
  http://localhost:3000/admin/tenants/demo/roles
curl -sS -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name_search": "x"}' \
  http://localhost:3000/admin/tenants/demo/roles/01a0e12f-2338-742f-b4d2-d6cb846f2416
```

```
{"type":"about:blank","title":"Error","status":400,"detail":"querystring/client must be equal to constant, querystring/client must match pattern \"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$\", querystring/client must match a schema in anyOf","instance":"01a0e12f-8196-78a0-abe4-04aea4c3b03c"}
{"type":"about:blank","title":"Error","status":400,"detail":"querystring must NOT have additional properties: search","instance":"01a0e12f-81a5-7fea-a0f6-f0e2afbbf559"}
{"type":"about:blank","title":"Error","status":400,"detail":"body must NOT have additional properties: name_search","instance":"01a0e12f-81b0-7042-bb99-b72fddaa2b6a"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"name_search: name_search is not a role field","instance":"01a0e12f-81c0-7b76-822a-dab3fa665a43"}
```

## `POST /roles/:id/composites`

Requires `manage-tenant`, and enforces the same capability ceiling
`PUT /subjects/:id/roles` does: nesting `child_role_id` under the role
named by `:id` must never hand that role a capability the caller does not
itself hold, checked by expanding `child_role_id` through
`role_composites` (`rolesReachableFrom`,
`packages/domain-authz/src/repository/effective-roles.ts`) rather than
comparing names, so a composite that nests a capability instead of naming
it cannot smuggle the escalation past a check on the request body. A cycle
— nesting a role under one it already (transitively) contains — answers
`409` rather than the generic `500` a raw constraint violation would leave
this as; `role_composite_cycle` is raised and caught in the domain
(`roleRepository.addComposite`, `packages/domain-authz/src/repository/roles.ts`),
never re-derived here. Nesting any admin capability at all under a role a
default role reaches is refused with `403` too, whoever the caller is —
see `PUT /roles/:id/default` below.

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"child_role_id": "01a0d6fd-9471-7012-89c1-36ac3403705f"}' \
  http://localhost:3000/admin/tenants/demo/roles/01a0d708-2df9-74c8-ae36-b9181d5b5b11/composites
```

`billing-viewer` nested under a second role, `billing-admin`, then the
reverse nesting attempted on the pair that now exists:

```
HTTP/1.1 204 No Content
x-request-id: 01a0d708-2e22-71ab-8a25-e41d970f8e2d

{"type":"about:blank","title":"Conflict","status":409,"detail":"would create a role composite cycle","instance":"01a0d708-2e41-73a0-be98-e03b41380809"}
```

## `GET /roles/:id/composites` and `DELETE /roles/:id/composites/:childId`

Both require `manage-tenant`. The read answers the role's **direct**
children only, each in the same shape `GET /roles/:id` answers, ordered by
name — not what those children in turn include, which is what a subject
holding the role actually receives. It is not paged, the same as
`GET /groups/:id/roles`: the list is one role's own edges, edited one edge
at a time, not a tenant-wide collection. `DELETE` removes one edge and
answers `204`, then `404` once there is no such edge; it is audited as
`role.composite_remove`, with the child's id in `detail`. A subject holding
the parent loses the child on its next token.

**A role belonging to the tenant's built-in admin client keeps its
composites**: removing one answers `409`, naming the role and the client.
Taking `manage-users` out of `tenant-admin`, or `view-users` out of
`manage-users`, strips that capability from every administrator holding the
parent — the same lockout `DELETE /roles/:id` refuses for the role itself,
and read from the same `builtin_admin` column. That includes an edge an
operator added under a built-in capability role through
`POST /roles/:id/composites`: it cannot be removed, and goes only when its child is deleted.
An edge between ordinary roles is removed whatever it nests, a capability
included.

Captured against the fourth stack in `composites-demo`, created through
`POST /admin/tenants` for it. `billing-admin` nests `billing-viewer` and
`invoice-editor`, each nested through `POST /roles/:id/composites` above:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/composites-demo/roles/01a0e200-e915-73be-ac2d-5408ba17401f/composites
```

```
{"items":[{"id":"01a0e200-e929-7766-aa36-a3e32a889c02","name":"billing-viewer","description":null,"client_id":null,"default_for_new_subjects":false,"created_at":"2026-09-27T08:35:05.641Z"},{"id":"01a0e200-e940-79e0-8e90-e06ecfbce38d","name":"invoice-editor","description":null,"client_id":null,"default_for_new_subjects":false,"created_at":"2026-09-27T08:35:05.663Z"}]}
```

`invoice-editor` removed, the same removal repeated, then the read again:

```bash
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/composites-demo/roles/01a0e200-e915-73be-ac2d-5408ba17401f/composites/01a0e200-e940-79e0-8e90-e06ecfbce38d
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/composites-demo/roles/01a0e200-e915-73be-ac2d-5408ba17401f/composites/01a0e200-e940-79e0-8e90-e06ecfbce38d
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/composites-demo/roles/01a0e200-e915-73be-ac2d-5408ba17401f/composites
```

```
HTTP/1.1 204 No Content
x-request-id: 01a0e201-617f-77c6-acad-fb3753ebfc56
Date: Sun, 27 Sep 2026 08:35:36 GMT
Connection: keep-alive
Keep-Alive: timeout=72

HTTP/1.1 404 Not Found
x-request-id: 01a0e201-6195-716e-bdfe-b349affe29f2
content-type: application/problem+json; charset=utf-8
content-length: 214
Date: Sun, 27 Sep 2026 08:35:36 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Not Found","status":404,"detail":"no composite 01a0e200-e940-79e0-8e90-e06ecfbce38d under role 01a0e200-e915-73be-ac2d-5408ba17401f","instance":"01a0e201-6195-716e-bdfe-b349affe29f2"}
{"items":[{"id":"01a0e200-e929-7766-aa36-a3e32a889c02","name":"billing-viewer","description":null,"client_id":null,"default_for_new_subjects":false,"created_at":"2026-09-27T08:35:05.641Z"}]}
```

The guard. `tenant-admin` does nest `manage-users` — so a refusal is not a
`404` for a missing edge — and every child's `client_id` is the tenant's
built-in admin client; removing that edge, as `ada-whoami`, who holds
`tenant-admin` itself:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/composites-demo/roles/01a0e200-e8e2-7a11-b9df-3b61602c9ce3/composites
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/composites-demo/roles/01a0e200-e8e2-7a11-b9df-3b61602c9ce3/composites/01a0e200-e8e7-721f-8493-289260dce880
```

```
{"items":[{"id":"01a0e200-e8ea-75e4-b83e-2592d7c1cde1","name":"manage-clients","description":null,"client_id":"01a0e200-e8d8-70e4-aafc-f3352d920280","default_for_new_subjects":false,"created_at":"2026-09-27T08:35:05.530Z"},{"id":"01a0e200-e8ef-7f3d-941e-bd03009b6264","name":"manage-keys","description":null,"client_id":"01a0e200-e8d8-70e4-aafc-f3352d920280","default_for_new_subjects":false,"created_at":"2026-09-27T08:35:05.530Z"},{"id":"01a0e200-e8f1-7633-9840-d7cf7d632f3b","name":"manage-sessions","description":null,"client_id":"01a0e200-e8d8-70e4-aafc-f3352d920280","default_for_new_subjects":false,"created_at":"2026-09-27T08:35:05.530Z"},{"id":"01a0e200-e8ed-7b9a-80ea-d2e48d5276dd","name":"manage-tenant","description":null,"client_id":"01a0e200-e8d8-70e4-aafc-f3352d920280","default_for_new_subjects":false,"created_at":"2026-09-27T08:35:05.530Z"},{"id":"01a0e200-e8e7-721f-8493-289260dce880","name":"manage-users","description":null,"client_id":"01a0e200-e8d8-70e4-aafc-f3352d920280","default_for_new_subjects":false,"created_at":"2026-09-27T08:35:05.530Z"},{"id":"01a0e200-e8f4-7691-aa01-24d881374b0d","name":"view-audit","description":null,"client_id":"01a0e200-e8d8-70e4-aafc-f3352d920280","default_for_new_subjects":false,"created_at":"2026-09-27T08:35:05.530Z"},{"id":"01a0e200-e8e4-733c-89c0-640f39ad46d4","name":"view-users","description":null,"client_id":"01a0e200-e8d8-70e4-aafc-f3352d920280","default_for_new_subjects":false,"created_at":"2026-09-27T08:35:05.530Z"}]}
HTTP/1.1 409 Conflict
x-request-id: 01a0e201-61d3-77f3-81e9-b471a73e5446
content-type: application/problem+json; charset=utf-8
content-length: 283
Date: Sun, 27 Sep 2026 08:35:36 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"tenant-admin is a capability of odudu-admin, this tenant's built-in admin client, and removing a composite from it would strip that from every administrator holding it","instance":"01a0e201-61d3-77f3-81e9-b471a73e5446"}
```

The trail holds the one removal that landed; the guarded one wrote nothing:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3000/admin/tenants/composites-demo/audit?action=role.composite_remove'
```

```
{"items":[{"id":"01a0e201-618a-71fb-95af-8810ed9a2812","occurred_at":"2026-09-27T08:35:36.457Z","event_type":"admin_mutation","action":"role.composite_remove","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0e0a7-0ead-703a-ab34-22bcf5167d46","actor_client_id":"01a0dc0c-0130-7dd6-a9d5-c867c3577f62","resource_type":"role","resource_id":"01a0e200-e915-73be-ac2d-5408ba17401f","request_id":"01a0e201-617f-77c6-acad-fb3753ebfc56","ip":"172.20.0.1","detail":{"child_role_id":"01a0e200-e940-79e0-8e90-e06ecfbce38d"}}]}
```

## `PUT /roles/:id/default`

Requires `manage-tenant`. The body is `{"default": true}` or
`{"default": false}`, and the answer is the role with its `ETag`. A role
marked default is granted to **every subject created afterwards** —
through `POST /subjects` and through self-registration alike, which share
`composeUserSubject` (`packages/protocol-admin/src/usecase/subjects.ts`) —
and to none that already exist; unmarking it takes it from nobody who
already holds it. Each change is audited as `role.default_set`, with the
flag's before and after in `detail`.

**A default role may reach no admin capability at all.** `true` is refused
with `403`, and a `refused` row written to the trail naming what it would
reach, when the role — expanded through `role_composites`, as the ceiling
on `POST /roles/:id/composites` expands a child — reaches any role of the
tenant's built-in admin client. That holds **whoever the caller is**: the
capability ceiling elsewhere admits what the caller holds, but a default
role is handed to strangers when registration is open, and no caller can
hold authority on their behalf. The same rule closes the other two doors
into that state: `POST /roles/:id/composites` refuses to nest a capability
under a role a default role reaches, and `POST /roles` refuses
`default_for_new_subjects: true` on a role of the built-in admin client,
each with a `refused` row too — the create's with no `resource_id`, since
no role came of it.
`false` is never refused.

Captured against the fourth stack in `composites-demo`. `member` marked
default, then a subject `rosa` created and its roles read:

```bash
curl -sS -D - -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"default": true}' \
  http://localhost:3000/admin/tenants/composites-demo/roles/01a0e200-e957-7d56-99cb-7e27217d00d4/default
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username": "rosa"}' \
  http://localhost:3000/admin/tenants/composites-demo/subjects
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/composites-demo/subjects/01a0e201-839d-7d01-abea-59f4e85817c3/roles
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e201-8376-7b28-8303-fc94e6b69839
etag: "62cc8c5e3e079f49b1b4686b6e667a740239a7857a86cc68fee65ac1e890f549"
content-type: application/json; charset=utf-8
content-length: 169
Date: Sun, 27 Sep 2026 08:35:45 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a0e200-e957-7d56-99cb-7e27217d00d4","name":"member","description":null,"client_id":null,"default_for_new_subjects":true,"created_at":"2026-09-27T08:35:05.687Z"}
{"id":"01a0e201-839d-7d01-abea-59f4e85817c3","type":"user","username":"rosa","email":null,"enabled":true,"created_at":"2026-09-27T08:35:45.180Z"}
{"items":[{"id":"01a0e200-e957-7d56-99cb-7e27217d00d4","name":"member"}]}
```

Unmarked, then a second subject `sven`, who does not get it:

```bash
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"default": false}' \
  http://localhost:3000/admin/tenants/composites-demo/roles/01a0e200-e957-7d56-99cb-7e27217d00d4/default
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username": "sven"}' \
  http://localhost:3000/admin/tenants/composites-demo/subjects
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/composites-demo/subjects/01a0e201-a311-7f3a-bf62-62fde1593ac5/roles
```

```
{"id":"01a0e200-e957-7d56-99cb-7e27217d00d4","name":"member","description":null,"client_id":null,"default_for_new_subjects":false,"created_at":"2026-09-27T08:35:05.687Z"}
{"id":"01a0e201-a311-7f3a-bf62-62fde1593ac5","type":"user","username":"sven","email":null,"enabled":true,"created_at":"2026-09-27T08:35:53.232Z"}
{"items":[]}
```

The refusal. `helpdesk-lead` is a tenant role that nests `manage-users`,
which in turn composites `view-users`; marking it default as `ada-whoami`,
who holds both and more, then reading it back:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/composites-demo/roles/01a0e200-e96e-7966-b576-b0af1d3dac8c/composites
curl -sS -D - -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"default": true}' \
  http://localhost:3000/admin/tenants/composites-demo/roles/01a0e200-e96e-7966-b576-b0af1d3dac8c/default
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/composites-demo/roles/01a0e200-e96e-7966-b576-b0af1d3dac8c
```

```
{"items":[{"id":"01a0e200-e8e7-721f-8493-289260dce880","name":"manage-users","description":null,"client_id":"01a0e200-e8d8-70e4-aafc-f3352d920280","default_for_new_subjects":false,"created_at":"2026-09-27T08:35:05.530Z"}]}
HTTP/1.1 403 Forbidden
x-request-id: 01a0e201-ceae-7b05-82f9-70e09ff27d90
content-type: application/problem+json; charset=utf-8
content-length: 233
Date: Sun, 27 Sep 2026 08:36:04 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Forbidden","status":403,"detail":"a role handed to every new subject may reach no admin capability, and this one would reach: manage-users, view-users","instance":"01a0e201-ceae-7b05-82f9-70e09ff27d90"}
{"id":"01a0e200-e96e-7966-b576-b0af1d3dac8c","name":"helpdesk-lead","description":null,"client_id":null,"default_for_new_subjects":false,"created_at":"2026-09-27T08:35:05.710Z"}
```

`PATCH` still refuses the field, and says where it is set:

```bash
curl -sS -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"default_for_new_subjects": true}' \
  http://localhost:3000/admin/tenants/composites-demo/roles/01a0e200-e957-7d56-99cb-7e27217d00d4
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"default_for_new_subjects: default_for_new_subjects changes who a role is silently handed to at signup; set it with PUT /admin/tenants/{tenant}/roles/{id}/default, not a general amendment","instance":"01a0e201-ced9-7449-a755-6b55769e2d95"}
```

The trail, newest first — the refusal naming what `helpdesk-lead` would
have handed out, and `member`'s two changes:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3000/admin/tenants/composites-demo/audit?action=role.default_set'
```

```
{"items":[{"id":"01a0e201-ceb8-7e8a-8d64-13ca0220ec89","occurred_at":"2026-09-27T08:36:04.406Z","event_type":"admin_mutation","action":"role.default_set","outcome":"refused","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0e0a7-0ead-703a-ab34-22bcf5167d46","actor_client_id":"01a0dc0c-0130-7dd6-a9d5-c867c3577f62","resource_type":"role","resource_id":"01a0e200-e96e-7966-b576-b0af1d3dac8c","request_id":"01a0e201-ceae-7b05-82f9-70e09ff27d90","ip":"172.20.0.1","detail":{"denied":["manage-users","view-users"]}},{"id":"01a0e201-a2fe-70ed-bdfa-b0c984907637","occurred_at":"2026-09-27T08:35:53.212Z","event_type":"admin_mutation","action":"role.default_set","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0e0a7-0ead-703a-ab34-22bcf5167d46","actor_client_id":"01a0dc0c-0130-7dd6-a9d5-c867c3577f62","resource_type":"role","resource_id":"01a0e200-e957-7d56-99cb-7e27217d00d4","request_id":"01a0e201-a2f4-7565-9f55-41b06bad661f","ip":"172.20.0.1","detail":{"default_for_new_subjects":{"after":false,"before":true}}},{"id":"01a0e201-8387-7c8e-b125-4f6d9b381be6","occurred_at":"2026-09-27T08:35:45.156Z","event_type":"admin_mutation","action":"role.default_set","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0e0a7-0ead-703a-ab34-22bcf5167d46","actor_client_id":"01a0dc0c-0130-7dd6-a9d5-c867c3577f62","resource_type":"role","resource_id":"01a0e200-e957-7d56-99cb-7e27217d00d4","request_id":"01a0e201-a2f4-7565-9f55-41b06bad661f","ip":"172.20.0.1","detail":{"default_for_new_subjects":{"after":true,"before":false}}}]}
```

After that trail was read, the composite door: `member` marked default
again, `view-users` nested under it refused, and `member` unmarked:

```bash
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"default": true}' \
  http://localhost:3000/admin/tenants/composites-demo/roles/01a0e200-e957-7d56-99cb-7e27217d00d4/default
curl -sS -D - -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"child_role_id": "01a0e200-e8e4-733c-89c0-640f39ad46d4"}' \
  http://localhost:3000/admin/tenants/composites-demo/roles/01a0e200-e957-7d56-99cb-7e27217d00d4/composites
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"default": false}' \
  http://localhost:3000/admin/tenants/composites-demo/roles/01a0e200-e957-7d56-99cb-7e27217d00d4/default
```

```
{"id":"01a0e200-e957-7d56-99cb-7e27217d00d4","name":"member","description":null,"client_id":null,"default_for_new_subjects":true,"created_at":"2026-09-27T08:35:05.687Z"}
HTTP/1.1 403 Forbidden
x-request-id: 01a0e201-f580-7a0a-9a12-33906a3ba5ae
content-type: application/problem+json; charset=utf-8
content-length: 219
Date: Sun, 27 Sep 2026 08:36:14 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Forbidden","status":403,"detail":"a role handed to every new subject may reach no admin capability, and this one would reach: view-users","instance":"01a0e201-f580-7a0a-9a12-33906a3ba5ae"}
{"id":"01a0e200-e957-7d56-99cb-7e27217d00d4","name":"member","description":null,"client_id":null,"default_for_new_subjects":false,"created_at":"2026-09-27T08:35:05.687Z"}
```

## `GET /groups`, `POST /groups`, `GET /groups/:id`, `PATCH /groups/:id` and `DELETE /groups/:id`

All five require `manage-tenant`. `path` is derived, never accepted: a root
group's is `/name`, a child's is its parent's with `/name` appended, and
`groupRepository` (`packages/domain-authz/src/repository/groups.ts`) is the
only writer of it. `PATCH` amends only `parent_id` — reparenting, which
recomputes `path` for the group and every descendant — every other field
is refused with a reason. A `parent_id` naming no group answers `400`, the
same refusal `POST /groups` gives for the same input. Reparenting into the
group's own subtree answers `409` (`group_reparent_cycle`), the same way a
role composite's cycle does.
Both doors that choose a parent carry the same capability ceiling: naming
a parent whose own roles — or any ancestor's — reach a capability the
caller does not hold answers `403`, on `POST /groups` as on `PATCH`, since
every subject later placed in the group would inherit it.
`DELETE` **deletes the whole subtree**, not one group: `groups_parent_fk`
cascades on the parent, so every descendant is deleted with it, and each
of those takes its own `group_roles` mappings and `subject_groups`
memberships along. A child does not survive as a new root, and there is no
confirmation step — a `DELETE` of a group near the top of a tree removes
everything under it.

```bash
curl -sS -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"parent_id": "01a0d708-2e61-7569-8143-4d8ac66c4b6c"}' \
  http://localhost:3000/admin/tenants/demo/groups/01a0d708-2e77-75f4-8458-1a6b6dedc8d7
```

Two roots, `engineering` and `platform`, then `platform` reparented under
`engineering` — `path` is recomputed by the write, never sent — then the
reverse, refused:

```
{"id":"01a0d708-2e61-7569-8143-4d8ac66c4b6c","name":"engineering","parent_id":null,"path":"/engineering","created_at":"2026-09-25T05:27:12.736Z"}
{"id":"01a0d708-2e77-75f4-8458-1a6b6dedc8d7","name":"platform","parent_id":null,"path":"/platform","created_at":"2026-09-25T05:27:12.759Z"}
{"id":"01a0d708-2e77-75f4-8458-1a6b6dedc8d7","name":"platform","parent_id":"01a0d708-2e61-7569-8143-4d8ac66c4b6c","path":"/engineering/platform","created_at":"2026-09-25T05:27:12.759Z"}
{"type":"about:blank","title":"Conflict","status":409,"detail":"would create a group reparent cycle","instance":"01a0d708-2ed8-73c7-905f-bb2adf113b10"}
```

**Search** is `?name=`, the same prefix match `GET /roles` above describes,
over `groups.name_search`; it matches a group's own name, not its `path`.
Captured against the fourth stack after `engineering`, `Engineering-Ops` and
`finance` were created there as roots:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "engineering"}' \
  http://localhost:3000/admin/tenants/demo/groups
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Engineering-Ops"}' \
  http://localhost:3000/admin/tenants/demo/groups
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "finance"}' \
  http://localhost:3000/admin/tenants/demo/groups
```

```
{"id":"01a0e12f-237a-7042-8b45-23eaeda52dfc","name":"engineering","parent_id":null,"path":"/engineering","created_at":"2026-09-27T04:45:58.009Z"}
{"id":"01a0e12f-23a6-7156-bbe1-2faf51f13283","name":"Engineering-Ops","parent_id":null,"path":"/Engineering-Ops","created_at":"2026-09-27T04:45:58.053Z"}
{"id":"01a0e12f-23eb-7f9e-953e-0ba8fbc6118c","name":"finance","parent_id":null,"path":"/finance","created_at":"2026-09-27T04:45:58.121Z"}
```

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/groups?name=ENG"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/groups?name=eng&limit=1"
```

```
{"items":[{"id":"01a0e12f-237a-7042-8b45-23eaeda52dfc","name":"engineering","parent_id":null,"path":"/engineering","created_at":"2026-09-27T04:45:58.009Z"},{"id":"01a0e12f-23a6-7156-bbe1-2faf51f13283","name":"Engineering-Ops","parent_id":null,"path":"/Engineering-Ops","created_at":"2026-09-27T04:45:58.053Z"}]}
{"items":[{"id":"01a0e12f-237a-7042-8b45-23eaeda52dfc","name":"engineering","parent_id":null,"path":"/engineering","created_at":"2026-09-27T04:45:58.009Z"}],"next":"eyJhZnRlciI6IjAxYTBlMTJmLTIzN2EtNzA0Mi04YjQ1LTIzZWFlZGE1MmRmYyIsInNvcnQiOiJlbmdpbmVlcmluZyIsImNvbGxlY3Rpb24iOiJncm91cHMiLCJ0ZW5hbnRJZCI6IjAxYTBkYjIyLTFjMzItN2QxNy1iMzUxLTY5N2Q3OTExMDMzYyIsImZpbHRlcnMiOiJzTVFsYy1tTnM3SUxXZHhsYk9YOUJKRlA0dzlSb05MMXlpSVJ0bmxrQnZNIn0.EHY24DUY_3F9Ab5ePyknKZzSnbCTblK5Iso4z3QWztQ"}
```

Following that cursor, then replaying it with `?name=` dropped:

```bash
CURSOR='eyJhZnRlciI6IjAxYTBlMTJmLTIzN2EtNzA0Mi04YjQ1LTIzZWFlZGE1MmRmYyIsInNvcnQiOiJlbmdpbmVlcmluZyIsImNvbGxlY3Rpb24iOiJncm91cHMiLCJ0ZW5hbnRJZCI6IjAxYTBkYjIyLTFjMzItN2QxNy1iMzUxLTY5N2Q3OTExMDMzYyIsImZpbHRlcnMiOiJzTVFsYy1tTnM3SUxXZHhsYk9YOUJKRlA0dzlSb05MMXlpSVJ0bmxrQnZNIn0.EHY24DUY_3F9Ab5ePyknKZzSnbCTblK5Iso4z3QWztQ'
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/groups?limit=1&name=eng&cursor=$CURSOR"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/groups?limit=1&cursor=$CURSOR"
```

```
{"items":[{"id":"01a0e12f-23a6-7156-bbe1-2faf51f13283","name":"Engineering-Ops","parent_id":null,"path":"/Engineering-Ops","created_at":"2026-09-27T04:45:58.053Z"}]}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"cursor is invalid or expired","instance":"01a0e12f-d650-7e6b-bf64-6990fa57907e"}
```

## `GET /groups/:id/roles` and `PUT /groups/:id/roles`

Both require `manage-tenant`. The write replaces the group's role mapping
wholesale — a role left out of the list is one the caller clears, not one
left alone — the same replace-all shape `PUT /subjects/:id/roles` uses for
a subject's own assignments. An unknown role id answers `400`, and a role
set reaching past the caller's own capabilities `403`.

**`If-Match` is mandatory here, not optional.** This route replaces an
authorization-bearing list whole, so a stale write reinstates exactly what
another administrator has just removed; the header comes from the matching
`GET`, which answers an `ETag` over the same list. Absent, the request is
refused with `428 Precondition Required` and nothing is changed; stale,
with `412`. The list is read under the same lock the replacement runs
under, so two callers sent at once are serialised — the second sees what
the first wrote rather than matching the same pre-write state.

Captured against the second stack, on its `engineering` group and
`billing-viewer` role:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/groups/01a0d7ef-2c6b-7447-a9c6-7e710ddf1637/roles

curl -sS -D - -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"' \
  -d '{"role_ids": ["01a0d7ef-2c44-7f99-9fbb-e9f05075340c"]}' \
  http://localhost:3000/admin/tenants/demo/groups/01a0d7ef-2c6b-7447-a9c6-7e710ddf1637/roles
```

```
etag: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"
{"items":[]}

HTTP/1.1 200 OK
x-request-id: 01a0d7ef-81f6-7254-a39d-0876a4f93205
etag: "d7978c210e861d05f88ea7ba801911708de321021641d1ef93b1a21b3e888003"
content-type: application/json; charset=utf-8
content-length: 81

{"items":[{"id":"01a0d7ef-2c44-7f99-9fbb-e9f05075340c","name":"billing-viewer"}]}
```

## `GET /scopes`, `POST /scopes`, `GET /scopes/:id`, `PATCH /scopes/:id` and `DELETE /scopes/:id`

All five require `manage-tenant`. `include_in_id_token` and
`include_in_access_token` (both default `true`) decide which token a
scope's claims land in; `PATCH` amends either, plus `description` — `name`
is refused, since it is the scope token a client requests and a token
carries. A duplicate name answers `409`. `DELETE` cascades:
`client_scope_assignments_scope_fk` and `client_scope_roles_scope_fk`
(`packages/db/drizzle/0016_client_scopes.sql`, `0017_roles.sql`) both name
`ON DELETE CASCADE`, not `RESTRICT`, so deleting an assigned, role-mapped
scope removes it and both dependent rows together rather than refusing —
**except the scope named `openid`**, refused with `409`: the same cascade
would strip it from every client's assignment in the tenant in one stroke,
the built-in admin client's included, which
`DELETE /scopes/:id/clients/:clientId` below refuses for that one client
alone. Every other scope stays deletable whatever it is assigned to or
mapped from — a tenant-wide decision, not a per-client one.

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "billing", "include_in_id_token": false}' \
  http://localhost:3000/admin/tenants/demo/scopes
```

```
{"id":"01a0d708-2ef8-7963-8d7a-3df5dff7cdf6","name":"billing","description":null,"include_in_id_token":false,"include_in_access_token":true,"created_at":"2026-09-25T05:27:12.887Z"}
```

The `openid` guard, against `scope-guard-demo` made for it, on the same
`openid` scope the built-in admin client section above names:

```bash
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/scope-guard-demo/scopes/01a0e236-f087-7c6a-946d-7aa6aea279bc
```

```
HTTP/1.1 409 Conflict
x-request-id: 01a0e237-278a-70a6-b813-5dffb42046c5
content-type: application/problem+json; charset=utf-8
content-length: 285
Date: Sun, 27 Sep 2026 09:34:20 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"openid is deleted along with every client’s assignment of it, this tenant’s built-in admin client’s included, and could lock out every administrator of this tenant","instance":"01a0e237-278a-70a6-b813-5dffb42046c5"}
```

**Search** is `?name=`, the same prefix match `GET /roles` describes, over
`client_scopes.name_search`. Captured against the fourth stack, whose
`demo` held the eight scopes a tenant is provisioned with, each cut down
with `jq` to the fields that show the point; then a cursor minted under
`?name=p` replayed under `?name=o`:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/scopes?name=O" \
  | jq -c '{items: [.items[] | {name}]}'
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/scopes?name=p&limit=1" \
  | jq -c '{items: [.items[] | {name}], next}'
```

```
{"items":[{"name":"offline_access"},{"name":"openid"}]}
{"items":[{"name":"phone"}],"next":"eyJhZnRlciI6IjAxYTBkYjIyLTFjNTItNzI1MC05Y2Y4LTY0ZjFmYTQ4YjI0YiIsInNvcnQiOiJwaG9uZSIsImNvbGxlY3Rpb24iOiJzY29wZXMiLCJ0ZW5hbnRJZCI6IjAxYTBkYjIyLTFjMzItN2QxNy1iMzUxLTY5N2Q3OTExMDMzYyIsImZpbHRlcnMiOiJBbkY0THhTZFRNWjMxMEJpUjZFN3pGYWFCQ1hDcnZIMGFDVjZ2ZzJRUmg4In0.h-Sdj0aRD8W4AhKtRRjnn6bvQRItsYH15_Myn9ykXwg"}
```

```bash
CURSOR='eyJhZnRlciI6IjAxYTBkYjIyLTFjNTItNzI1MC05Y2Y4LTY0ZjFmYTQ4YjI0YiIsInNvcnQiOiJwaG9uZSIsImNvbGxlY3Rpb24iOiJzY29wZXMiLCJ0ZW5hbnRJZCI6IjAxYTBkYjIyLTFjMzItN2QxNy1iMzUxLTY5N2Q3OTExMDMzYyIsImZpbHRlcnMiOiJBbkY0THhTZFRNWjMxMEJpUjZFN3pGYWFCQ1hDcnZIMGFDVjZ2ZzJRUmg4In0.h-Sdj0aRD8W4AhKtRRjnn6bvQRItsYH15_Myn9ykXwg'
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/scopes?limit=1&name=p&cursor=$CURSOR" \
  | jq -c '{items: [.items[] | {name}], next}'
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/scopes?limit=1&name=o&cursor=$CURSOR"
```

```
{"items":[{"name":"profile"}],"next":null}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"cursor is invalid or expired","instance":"01a0e12f-d69a-7961-97c2-7e6bc0dfdfa1"}
```

## `GET /scopes/:id/roles` and `PUT /scopes/:id/roles`

Both require `manage-tenant`. The write replaces the scope's role mapping
wholesale, the same replace-all shape `PUT /groups/:id/roles` uses. An
unknown role id answers `400`.

**`If-Match` is mandatory here, not optional.** This route replaces an
authorization-bearing list whole, so a stale write reinstates exactly what
another administrator has just removed; the header comes from the matching
`GET`, which answers an `ETag` over the same list. Absent, the request is
refused with `428 Precondition Required` and nothing is changed; stale,
with `412`. The list is read under the same lock the replacement runs
under, so two callers sent at once are serialised — the second sees what
the first wrote rather than matching the same pre-write state.

Captured against the second stack, on its `billing` scope and the same
role — the empty list's tag is the one the two sections above answered,
for the reason `PUT /subjects/:id/roles` states:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/scopes/01a0d7ef-2ca0-724f-9815-81273d5ce936/roles

curl -sS -D - -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"' \
  -d '{"role_ids": ["01a0d7ef-2c44-7f99-9fbb-e9f05075340c"]}' \
  http://localhost:3000/admin/tenants/demo/scopes/01a0d7ef-2ca0-724f-9815-81273d5ce936/roles
```

```
etag: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"
{"items":[]}

HTTP/1.1 200 OK
x-request-id: 01a0d7ef-822e-795b-bd8e-6b9a311cc659
etag: "d7978c210e861d05f88ea7ba801911708de321021641d1ef93b1a21b3e888003"
content-type: application/json; charset=utf-8
content-length: 81

{"items":[{"id":"01a0d7ef-2c44-7f99-9fbb-e9f05075340c","name":"billing-viewer"}]}
```

## `PUT /scopes/:id/clients/:clientId`

Requires `manage-tenant`. Assigns the scope to the client as `default` or
`optional`, narrowing or widening any existing assignment rather than
colliding with it (`clientScopeRepository.assignOrUpdate`,
`packages/domain-tenant/src/repository/client-scopes.ts`) — the same
behaviour the seed CLI's own assign-scope command depends on. Answers with
the client's scope assignments — `client_id` and `scopes` — so the result
is visible immediately without a second `GET /clients/:id`, and **nothing
else**: this route asks for `manage-tenant`, where reading a client asks
for the stricter `manage-clients`, so answering with the client's own
representation would hand the weaker holder `redirect_uris`, `jwks`,
`audiences` and every grant setting through a side door. An unknown scope
or client id answers `404`.

Re-captured against the same later stack the SMTP section names, so the
ids below are that run's rather than the ones the sections above show.

```bash
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"assignment": "default"}' \
  http://localhost:3000/admin/tenants/demo/scopes/01a0d767-b5e6-74f8-89a0-f3afa7e2f6c0/clients/01a0d767-a054-7a00-b96d-eea9492c4e4d
```

The assignments come back, with `billing` appended to the eight scopes
`demo-app` already carried — the same `scopes` shape `GET /clients/:id`
carries, and nothing besides:

```
{"client_id":"01a0d767-a054-7a00-b96d-eea9492c4e4d","scopes":[{"id":"01a0d764-e837-75cb-b5eb-bf56c1193e85","name":"openid","assignment":"default"},{"id":"01a0d764-e83b-7c1c-84cc-624bbbe5947d","name":"profile","assignment":"default"},{"id":"01a0d764-e83c-76ee-976a-14b79a5f8c8b","name":"email","assignment":"default"},{"id":"01a0d764-e83d-74c0-a341-bfc8dc17ece7","name":"address","assignment":"default"},{"id":"01a0d764-e83d-74c0-a341-bfc97cd8d0bd","name":"phone","assignment":"default"},{"id":"01a0d764-e83e-778c-8fe8-0b8122e3d178","name":"roles","assignment":"default"},{"id":"01a0d764-e83f-7e65-bb51-c62daaadd27d","name":"groups","assignment":"default"},{"id":"01a0d764-e83f-7e65-bb51-c62e4d176cc8","name":"offline_access","assignment":"optional"},{"id":"01a0d767-b5e6-74f8-89a0-f3afa7e2f6c0","name":"billing","assignment":"default"}]}
```

## `DELETE /scopes/:id/clients/:clientId`

Requires `manage-tenant`. Removes the client's assignment of the scope,
whether it was `default` or `optional` — the inverse of
`PUT /scopes/:id/clients/:clientId` above, and the only way to take a scope
back off a client once assigned; `clientScopeRepository.unassign`
(`packages/domain-tenant/src/repository/client-scopes.ts`) deletes the row
outright rather than narrowing it. Answers `204`; a scope not currently
assigned to the client, an unknown scope id or an unknown client id all
answer `404`.

**The tenant's built-in admin client keeps every scope assignment**:
unassigning one answers `409`, naming the scope and the client. That
client is public, with no secret, and supports no grant but
`authorization_code`/`refresh_token` (`provisionAdminClient`,
`packages/protocol-oidc/src/usecase/provision-admin-client.ts`) — an
administrator's only path to a fresh admin token is `/authorize`, and
`scopesAreGrantable` (`packages/protocol-oidc/src/service/authorize-validation.ts`)
refuses any scope the client is not assigned, `openid` included, which a
request naming no `scope` asks for by default. Unassigning `openid` from
this one client, or any of the others, would lock every administrator of
the tenant out of a fresh login once their existing refresh token expired
— the same lockout `PATCH /clients/{id}` and `DELETE /roles/:id` refuse for
the same client, read from the same `builtin_admin` column. An ordinary
client's own assignments carry no such guard: unassigning its `openid`
narrows what `/authorize` grants it next, exactly as an unknown scope
would.

The guard, against a tenant `scope-guard-demo` made for it, on its
built-in admin client `odudu-admin` and its own `openid` assignment:

```bash
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/scope-guard-demo/scopes/01a0e236-f087-7c6a-946d-7aa6aea279bc/clients/01a0e236-f091-7ca4-a3f4-33841c633cf6
```

```
HTTP/1.1 409 Conflict
x-request-id: 01a0e237-17bb-77d0-9961-5a14d3c4198e
content-type: application/problem+json; charset=utf-8
content-length: 284
Date: Sun, 27 Sep 2026 09:34:16 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"the scope openid on odudu-admin, this tenant’s built-in admin client, cannot be unassigned: it could leave every administrator of this tenant locked out of /authorize","instance":"01a0e237-17bb-77d0-9961-5a14d3c4198e"}
```

Captured against a tenant `scope-unassign-demo` made for this section, on a
public client `scope-unassign-app` registered for `authorization_code`.
`POST /clients` assigned it the tenant's default vocabulary, `openid`
included, so `/authorize` first renders the login form:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  'http://localhost:3000/tenants/scope-unassign-demo/protocol/openid-connect/auth?response_type=code&client_id=scope-unassign-app&redirect_uri=https%3A%2F%2Fapp.example%2Fcallback&scope=openid&state=xyz&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256'
```

```
200
```

Unassigning `openid`, then reading the client back — the scope is gone from
`scopes`, `profile` now first — then the same removal repeated:

```bash
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/scope-unassign-demo/scopes/01a0e227-2504-77b3-8bb0-880aa7cb21fb/clients/01a0e227-7650-759d-af14-bc3503b8344d

curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/scope-unassign-demo/clients/01a0e227-7650-759d-af14-bc3503b8344d

curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/scope-unassign-demo/scopes/01a0e227-2504-77b3-8bb0-880aa7cb21fb/clients/01a0e227-7650-759d-af14-bc3503b8344d
```

```
HTTP/1.1 204 No Content
x-request-id: 01a0e227-a129-7105-b91d-53ce8566a8c7
Date: Sun, 27 Sep 2026 09:17:23 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a0e227-7650-759d-af14-bc3503b8344d","client_id":"scope-unassign-app","name":"scope-unassign-app","type":"public","enabled":true,"full_scope_allowed":false,"registration_origin":"operator","created_at":"2026-09-27T09:17:12.141Z","redirect_uris":["https://app.example/callback"],"grant_types":["authorization_code"],"token_endpoint_auth_method":"none","audiences":[],"access_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"scopes":[{"id":"01a0e227-2505-73bb-8089-4caaa4028c12","name":"profile","assignment":"default"},{"id":"01a0e227-2506-783e-b180-60acaed1c1c9","name":"email","assignment":"default"},{"id":"01a0e227-250a-7a06-a417-18a9e4d8b123","name":"address","assignment":"default"},{"id":"01a0e227-250b-73a5-ae11-e114da20987b","name":"phone","assignment":"default"},{"id":"01a0e227-250c-7d5c-8063-9d2518215319","name":"roles","assignment":"default"},{"id":"01a0e227-250d-7438-aed1-a1f8da08f107","name":"groups","assignment":"default"},{"id":"01a0e227-250e-7407-9493-402eaec43c8b","name":"offline_access","assignment":"optional"}]}
HTTP/1.1 404 Not Found
x-request-id: 01a0e227-b89a-7db8-9c8b-78707a938f58
content-type: application/problem+json; charset=utf-8
content-length: 222
Date: Sun, 27 Sep 2026 09:17:29 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Not Found","status":404,"detail":"scope 01a0e227-2504-77b3-8bb0-880aa7cb21fb is not assigned to client 01a0e227-7650-759d-af14-bc3503b8344d","instance":"01a0e227-b89a-7db8-9c8b-78707a938f58"}
```

`/authorize`, asked for `openid` again, now refuses it the same way an
unregistered scope would — `state` and `iss` still carried back, the same
as any other redirect-side refusal:

```bash
curl -sS -D - -o /dev/null \
  'http://localhost:3000/tenants/scope-unassign-demo/protocol/openid-connect/auth?response_type=code&client_id=scope-unassign-app&redirect_uri=https%3A%2F%2Fapp.example%2Fcallback&scope=openid&state=xyz&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256'
```

```
HTTP/1.1 302 Found
x-request-id: 01a0e227-b8b2-7c4b-b6bb-960a5578210a
location: https://app.example/callback?error=invalid_scope&state=xyz&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fscope-unassign-demo
content-length: 0
Date: Sun, 27 Sep 2026 09:17:29 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

## `GET /scopes/:id/mappers` and `PUT /scopes/:id/mappers`

Both require `manage-tenant`. `GET` returns `available` — every mapper name
the process's `ClaimMapperRegistry` carries, the same registry ID token and
`/userinfo` issuance assemble claims from — and `bound`, the names this
tenant bound to this scope, empty when the scope has no binding rows and
falls back to whichever mappers declare it. `PUT` replaces the whole binding
set; binding a name the registry does not carry answers `400`, listing the
known names.

**`If-Match` is mandatory here, not optional.** This route replaces an
authorization-bearing list whole, so a stale write reinstates exactly what
another administrator has just removed; the header comes from the matching
`GET`, which answers an `ETag` over the same list. Absent, the request is
refused with `428 Precondition Required` and nothing is changed; stale,
with `412`. The list is read under the same lock the replacement runs
under, so two callers sent at once are serialised — the second sees what
the first wrote rather than matching the same pre-write state.

A scope with no bindings is unaffected by another scope's: binding `sub`
to one scope narrows only that scope's own claims, never `email`'s or any
other scope's in the same tenant.

Captured against the second stack, on its `billing` scope. The read, then
the same write twice — without the header, then with it:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/scopes/01a0d7ef-2ca0-724f-9815-81273d5ce936/mappers

curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mapper_names": ["sub"]}' \
  http://localhost:3000/admin/tenants/demo/scopes/01a0d7ef-2ca0-724f-9815-81273d5ce936/mappers

curl -sS -D - -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "59c1141bb2da82132d257ffa8b417c0a7c4e9985057f06388c4d62534ecb2183"' \
  -d '{"mapper_names": ["sub"]}' \
  http://localhost:3000/admin/tenants/demo/scopes/01a0d7ef-2ca0-724f-9815-81273d5ce936/mappers
```

The empty `bound` on the read is the fallback case, not an error. The
`ETag` covers `bound` alone — `available` is the registry's, and no part
of what a caller is replacing:

```
etag: "59c1141bb2da82132d257ffa8b417c0a7c4e9985057f06388c4d62534ecb2183"
{"available":["sub","profile","email","roles","groups","address","phone"],"bound":[]}

{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to replace a scope’s claim mapper bindings","instance":"01a0d7ef-b3c3-72dc-ac54-75e8a608dd7c"}

HTTP/1.1 200 OK
x-request-id: 01a0d7ef-b3de-760a-9640-23ffa5bde2a4
etag: "e853268082f466e074aba6be62bd16b45ac4a0037e40335ae4eaf476c9defcb4"
content-type: application/json; charset=utf-8
content-length: 90

{"available":["sub","profile","email","roles","groups","address","phone"],"bound":["sub"]}
```

A name the registry does not carry, refused with the names it does:

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"unknown mapper name(s): nonesuch; known: sub, profile, email, roles, groups, address, phone","instance":"01a0d6fe-e63f-7986-9ffb-04987c0cf19c"}
```

## `GET /keys`, `POST /keys`, `POST /keys/:id/promote` and `POST /keys/:id/retire`

All four require `manage-keys`, never `manage-tenant` — a tenant admin who
may reconfigure clients need not also be trusted to rotate what signs their
tokens. `GET /keys` lists `id`, `status`, `kid`, `alg`, `created_at` and
`not_after`; it never carries `public_jwk` or `private_jwk_encrypted`, the
signing key's own admin representation being metadata about it rather than
the key itself.

`POST /keys` generates a key of the given `alg` (`RS256` or `ES256`) and
stores it as `rotating`, published in `/certs` (JWKS) immediately —
`signing_keys_one_active` constrains `active` alone, so staging never
collides with it. `POST /keys/:id/promote` demotes the tenant's current
`active` key to `rotating` and promotes this one, in one transaction: no
window has two active keys or none. `POST /keys/:id/retire` answers `409`
in two cases, checked in that order: while the key's own status is
`active` — promote another key first, however well its algorithm is
otherwise covered — and, once that is ruled out, while a client is still
registered with a `userinfo_signed_response_alg` no remaining non-retired
key would produce, naming the offending client id(s) in the response
`detail`.

This ordering exists to dissolve a deadlock: registration itself refuses a
`userinfo_signed_response_alg` no non-retired key produces
(`client-registration.ts`'s own `algorithmsAvailable` check), so a client
cannot move to a new algorithm before something can sign it, and retiring
the old key first would leave nothing able to sign for a client still on
it. Staging a key as `rotating` makes its algorithm producible before it is
default, which is what lets a client migrate ahead of the promotion that
makes the new key the tenant's own.

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"alg": "ES256"}' \
  http://localhost:3000/admin/tenants/demo/keys
```

The whole rotation against `demo`, which was provisioned with one `ES256`
key when the tenant was created. Listing, staging, promoting, listing
again:

```
{"items":[{"id":"01a0d6fc-3654-7f93-817b-bd7f1bb2ff55","status":"active","kid":"01a0d6fc-3654-7f93-817b-bd7eb6490305","alg":"ES256","created_at":"2026-09-25T05:14:08.294Z","not_after":null}]}
{"id":"01a0d6fe-e527-77e6-b71d-57ed1a903cc3","status":"rotating","kid":"01a0d6fe-e526-7caf-9184-e66cbfab9a4b","alg":"ES256","created_at":"2026-09-25T05:17:04.166Z","not_after":null}
{"id":"01a0d6fe-e527-77e6-b71d-57ed1a903cc3","status":"active","kid":"01a0d6fe-e526-7caf-9184-e66cbfab9a4b","alg":"ES256","created_at":"2026-09-25T05:17:04.166Z","not_after":null}
{"items":[{"id":"01a0d6fc-3654-7f93-817b-bd7f1bb2ff55","status":"rotating","kid":"01a0d6fc-3654-7f93-817b-bd7eb6490305","alg":"ES256","created_at":"2026-09-25T05:14:08.294Z","not_after":null},{"id":"01a0d6fe-e527-77e6-b71d-57ed1a903cc3","status":"active","kid":"01a0d6fe-e526-7caf-9184-e66cbfab9a4b","alg":"ES256","created_at":"2026-09-25T05:17:04.166Z","not_after":null}]}
```

The promotion demoted the old key in the same transaction, so the second
listing has exactly one `active`. Retiring the newly promoted key is the
first of the two `409`s; retiring the one it demoted succeeds:

```
{"type":"about:blank","title":"Conflict","status":409,"detail":"signing key 01a0d6fe-e527-77e6-b71d-57ed1a903cc3 is active; promote another key first","instance":"01a0d6fe-e576-778e-90bd-92480ca40cd3"}
{"id":"01a0d6fc-3654-7f93-817b-bd7f1bb2ff55","status":"retired","kid":"01a0d6fc-3654-7f93-817b-bd7eb6490305","alg":"ES256","created_at":"2026-09-25T05:14:08.294Z","not_after":null}
```

The second `409` — a client registered with a
`userinfo_signed_response_alg` no remaining key produces — was not
captured: `demo` held no such client, and creating one to provoke it would
have needed a key of an algorithm this tenant was then to lose.

**Filters.** `?status=active|rotating|retired` and `?alg=RS256|ES256` are
exact, `AND`ed with each other, and bound into the cursor like every other
listing's filters; any other parameter is refused with `400` naming it.
Neither has an index: a tenant holds a handful of keys. Captured against
the fourth stack, whose `demo` held one key, `active` and `RS256`:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/keys?status=active&alg=RS256"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/keys?alg=ES256"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/keys?status=pending"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/keys?kid=x"
```

```
{"items":[{"id":"01a0db22-1c8f-7cd9-b338-6e8b1c6189af","status":"active","kid":"01a0db22-1c8e-7315-b327-6a0baba69321","alg":"RS256","created_at":"2026-09-26T00:34:00.903Z","not_after":null}]}
{"items":[]}
{"type":"about:blank","title":"Error","status":400,"detail":"querystring/status must be equal to one of the allowed values","instance":"01a0e12f-a446-7d4d-95c9-1ac772941b02"}
{"type":"about:blank","title":"Error","status":400,"detail":"querystring must NOT have additional properties: kid","instance":"01a0e12f-a453-74b5-bcc8-174e755e4db8"}
```

## `GET /flow/executions` and `PUT /flow/executions`

Both require `manage-tenant`. `GET` reads the tenant's whole authentication
flow — the ordered list `authn-flows`'s executor dispatches against — as
`index`, `authenticator` and `requirement` per step.

`PUT` replaces the list wholesale; there is no partial edit, because a
flow's meaning is in its order and a flow is short. The request carries no
`index`: the array's own order is the order, and the server renumbers
`index` contiguously from it regardless of what a caller sent, so there is
no gap or duplicate to hand-manage. It refuses with `400`, each naming the
reason in `detail`: an empty list, since a tenant with no flow cannot be
logged into; a list where every step is `disabled`, the same reason; an
`authenticator` name the executor's own registry does not resolve, which
lists the known names; and the same `authenticator` named twice, since a
step is addressed by its authenticator and a repeat leaves whichever one
dispatch reaches first standing for both.

**`If-Match` is mandatory here, not optional.** This route replaces an
authorization-bearing list whole, so a stale write reinstates exactly what
another administrator has just removed; the header comes from the matching
`GET`, which answers an `ETag` over the same list. Absent, the request is
refused with `428 Precondition Required` and nothing is changed; stale,
with `412`. The list is read under the same lock the replacement runs
under, so two callers sent at once are serialised — the second sees what
the first wrote rather than matching the same pre-write state.

A flow has no row to lock when it is empty, so the advisory lock
`replaceForTenant` takes is what serialises two replacements, and this
route takes it before the read rather than after — otherwise two callers
holding the same fresh tag would both pass.

Captured against the second stack. `demo`'s flow as `provisionTenant`
created it — the four steps every tenant starts with — and its `ETag`:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/flow/executions
```

```
etag: "2e028692eeb04a65ef6a06be482c11d71247d243b5929007716ee0f4eb2324db"
{"items":[{"index":0,"authenticator":"passkey","requirement":"alternative"},{"index":1,"authenticator":"password","requirement":"alternative"},{"index":2,"authenticator":"otp","requirement":"conditional"},{"index":3,"authenticator":"recovery-code","requirement":"conditional"}]}
```

Replacing it with a shorter, reordered one — three steps, password first,
passkey off, and `recovery-code` dropped by being left out:

```bash
curl -sS -D - -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "2e028692eeb04a65ef6a06be482c11d71247d243b5929007716ee0f4eb2324db"' \
  -d '[
    {"authenticator": "password", "requirement": "required"},
    {"authenticator": "otp", "requirement": "conditional"},
    {"authenticator": "passkey", "requirement": "disabled"}
  ]' \
  http://localhost:3000/admin/tenants/demo/flow/executions
```

```
HTTP/1.1 200 OK
x-request-id: 01a0d7ef-b40f-72df-bac4-b001431af1ff
etag: "c46d3990450c6fdda560192fb31bb5c43d939d3ec27ba6861173ef4c2992e589"
content-type: application/json; charset=utf-8
content-length: 200

{"items":[{"index":0,"authenticator":"password","requirement":"required"},{"index":1,"authenticator":"otp","requirement":"conditional"},{"index":2,"authenticator":"passkey","requirement":"disabled"}]}
```

A second `PUT` carrying that same, now stale, header changes nothing:

```
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a0d7ef-b429-7b76-83e4-b185216a422e"}
```

`index` is the array's own order renumbered from zero, and the request
carried none. The empty list is refused ahead of the precondition, so it
answers `400` rather than `428` even with no `If-Match` sent — the shape of
the request is wrong whatever generation it is against:

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"a flow needs at least one step; a tenant with no flow cannot be logged into","instance":"01a0d7f1-b0d0-7b73-945b-9e81ad26e17b"}
```

The write reaches the executor immediately, not only the table: the very
next login dispatches against the order this `PUT` wrote, since
`initialChallenge`/`advance` read a tenant's executions fresh on every
attempt rather than caching them.

## `GET /smtp`, `PUT /smtp`, `DELETE /smtp` and `POST /smtp/test`

All four require `manage-tenant`. `DELETE` removes the tenant's own row,
so its mail falls back to the deployment's `ODUDU_SMTP_*` sender and then
the log-only adapter — the one way back from a configuration `PUT` can
only replace. `204` on success, `404` when there was nothing to remove. `GET` reports `configured: false` and
`password_set: false` for a tenant with no row, rather than 404 — the
endpoint always exists, it is the configuration that may not. `PUT`
replaces the whole configuration; omitting `password` clears it, since
`GET` never hands one back for a caller to resend unchanged. The stored
password wraps through the same envelope a signing key's private half does
(`wrapSecret`/`unwrapSecret`, `@odudu/crypto`) — the column never carries
plaintext.

Two refusals bound what may be stored and what may be dialled.

**A configuration that authenticates requires TLS.** A `username` or a
`password` with `starttls` anything but `true` is `400`: `secure: false`
with STARTTLS unenforced puts those credentials on the wire in cleartext
(CWE-319). The transport requires TLS whenever credentials are present
whatever the row says, so this refusal is what keeps the stored row honest
about what will happen, rather than being the only thing between a
password and the network.

**The host is bounded before any connection is opened**, by the rules ADR
0028 puts on a client-supplied `jwks_uri`: the addresses `host` resolves to
are checked in the numeric domain, and loopback, link-local, private,
unspecified, multicast, broadcast and the reserved ranges are refused with
`400` naming the address and why. The connection is then opened to an
address that passed, never by resolving `host` a second time; the tenant's
hostname travels as the TLS server name, so certificate verification still
names the host they configured. Without it, `POST /smtp/test` is a port
scanner — a `manage-tenant` admin stores any host and port, and the
transport's own error answers back whether something is listening.
`ODUDU_ALLOW_PRIVATE_SMTP_HOSTS` re-admits the private ranges for a
deployment whose relay genuinely is internal, the same escape hatch
`ODUDU_ALLOW_PRIVATE_CLIENT_URLS` gives that fetcher; loopback and
link-local stay refused either way.

Neither route carries an `ETag`/`If-Match`, the deliberate deviation from
the resource pattern's default: `PUT` already fully replaces the row, never
a partial amend a concurrent writer could interleave with, and the
password's own write-only shape removes the one case a race would matter
for — a caller can never read the current value to decide whether its own
write should still apply.

Resolution order when this tenant's mail is actually sent
(`apps/server/src/email.ts`'s `resolveSender`): this row first, then the
deployment's own `ODUDU_SMTP_*` sender, then the log-only adapter. ADR
0015 is unaffected — it governs where a deployment's own credentials live,
and this is a credential the deployment itself never holds.

The four transcripts below were captured against a later stack than the
sections above — `seed admin`, then `seed tenant --name demo` and nothing
else — so the tenant they run against starts with no SMTP row at all.

```bash
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"host": "smtp.example.test", "port": 587, "from_address": "noreply@demo.example", "password": "hunter2"}' \
  http://localhost:3000/admin/tenants/demo/smtp
```

`GET` before that `PUT`, then the `PUT`'s own answer. The unconfigured read
is `200` with every field `null`, not `404`; the `PUT` is refused, because
it carries a password and does not ask for TLS:

```
{"configured":false,"host":null,"port":null,"from_address":null,"username":null,"password_set":false,"starttls":null}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"starttls must be true when a username or password is configured","instance":"01a0d767-0819-7b73-b7ae-cf7b170108d3"}
```

The same body with `"starttls": true`, then `GET` again:

```
{"configured":true,"host":"smtp.example.test","port":587,"from_address":"noreply@demo.example","username":null,"password_set":true,"starttls":true}
{"configured":true,"host":"smtp.example.test","port":587,"from_address":"noreply@demo.example","username":null,"password_set":true,"starttls":true}
```

`password_set` is how the password is reported; the value itself is never
in any of these.

`POST /smtp/test` sends one message to the given address synchronously and
reports the transport's own failure as `502`, rather than an operator
discovering a bad configuration only when a user's verification mail
silently fails. That detail is still returned verbatim, now that the
destination check above has taken away what it was an oracle for: with only
public addresses reachable, the failure tells an operator about their own
relay rather than about this server's neighbourhood. `400` for a tenant
with no SMTP configuration at all, and `400` for a host this server will
not connect to.

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to": "ops@demo.example"}' \
  http://localhost:3000/admin/tenants/demo/smtp/test
```

Against a tenant with no row at all, then against the `smtp.example.test`
row the `PUT` above stored, then against the same tenant after its `host`
was re-`PUT` as `127.0.0.1` — the probe this endpoint would otherwise be:

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"this tenant has no SMTP configuration","instance":"01a0d767-0802-7f87-8b85-ff1276001dde"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"this server will not connect to smtp.example.test: it resolves to no address","instance":"01a0d767-0856-7051-b6d1-ef5da413fd73"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"this server will not connect to 127.0.0.1: address 127.0.0.1 is a loopback address","instance":"01a0d767-0887-7e7b-88b3-c1ecf3df5f9a"}
```

No `502` is shown: this stack has no mail server and no host it is willing
to dial, so nothing here reaches a transport for one to be reported from.

`DELETE` was captured on the second stack, against a `demo` with no row,
then after a `PUT` had stored one. `404` first, `204` second, and a `GET`
afterwards showing the tenant back on the deployment's own sender:

```bash
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/smtp

curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"host": "smtp.example.test", "port": 587, "from_address": "noreply@demo.example"}' \
  http://localhost:3000/admin/tenants/demo/smtp

curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/smtp

curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/smtp
```

```
HTTP/1.1 404 Not Found
x-request-id: 01a0d7ef-02cb-780c-ad5a-3738cc84f2dc
content-type: application/problem+json; charset=utf-8
content-length: 154

{"type":"about:blank","title":"Not Found","status":404,"detail":"this tenant has no SMTP configuration","instance":"01a0d7ef-02cb-780c-ad5a-3738cc84f2dc"}
{"configured":true,"host":"smtp.example.test","port":587,"from_address":"noreply@demo.example","username":null,"password_set":false,"starttls":false}

HTTP/1.1 204 No Content
x-request-id: 01a0d7ef-030e-7e73-85f7-75a347bd86c7

{"configured":false,"host":null,"port":null,"from_address":null,"username":null,"password_set":false,"starttls":null}
```

## `GET /audit`

Requires `view-audit`, which carries no `manage-` counterpart: nothing ever
amends a row here, only `reap` deletes one once it is older than the
tenant's own `audit_retention_days` setting. Every admin mutation above
writes exactly one row here, in the same transaction as the change itself —
a client's `POST`, `PATCH`, `DELETE` and secret rotation; a tenant's
`POST` and its own `PATCH /settings`; and the equivalent for subjects,
roles, groups, scopes, scope mappers, sessions, signing keys, the flow and
SMTP configuration. `detail` is a redacted before/after diff, allowlisted
per resource type: a secret, a password hash or a private key never
appears in it, whichever of the two it would have been, and a field on
neither list is absent rather than shown.

`outcome` is `allowed`, `refused` or `failed`. Two kinds of mutation
refusal record an `admin_mutation` row. **`POST /clients`** does — a
reserved `client_id`, metadata `parseClientMetadata` rejects, or a tenant at
its client capacity — and so does **every capability ceiling**:
`POST /groups` and `PATCH /groups/{id}` choosing a parent,
`PUT /subjects/{id}/roles`, `PUT /groups/{id}/roles`,
`PUT /scopes/{id}/roles` and `POST /roles/{id}/composites`, each writing a
row whose `detail` names the capabilities the caller does not hold. An
attempted privilege escalation is the refusal worth recording even while
refusals in general are not. Every other mutation above writes an
`admin_mutation` row only when it succeeds; `?outcome=refused` against a
resource type with neither of those doors returns no `admin_mutation` row,
not because nothing was refused.

The door in front of every route records two refusals of its own, as
`admin_access` rows, whatever the route. A **`403`** to an authenticated
caller writes `capability.refused`, reads included, with `detail.capability`
naming the capability the caller lacked — `manage-tenants` when a system
admin without it reaches another tenant, the route's own otherwise. A
**`401` for a genuine token from another tenant** of this deployment writes
`token.foreign_issuer` into the tenant it was presented at, below. Every
other `401` — no token, a malformed or forged one, an issuer this
deployment does not serve, a dead session — writes no row, only a `warn`
log line naming the reason: the caller has proved nothing, so a row per
request would be theirs to append at will (ADR 0037).

`tenant_id` on a row is the tenant the change was made **to**, not the
tenant of whoever made it. `actor_tenant_id` and `actor_client_id` name the
caller instead — the tenant that issued the caller's own token and the
admin client it authenticated as — so a system admin's change to this
tenant is a row this tenant's own administrators can read, and can see was
made by someone outside it.

Paginated the same way every other list here is, over
`(occurred_at, id)` descending rather than ascending `id`: newest first.
Filters narrow the page rather than requiring one: `event_type`,
`actor_subject_id`, `resource_type`, `resource_id`, `action`, `outcome`, and
a `from`/`to` range on `occurred_at` (ISO 8601, with an offset). `event_type`
must be one of the vocabulary's own six values (`admin_mutation`,
`admin_access`, `authentication`, `session`, `token`, `credential`) and
`actor_subject_id` must be a UUID, since the column is one — either answers
`400` rather than reaching Postgres and failing there. `resource_id` is
text, not a UUID: a reserved-`client_id` refusal names it by the string the
caller sent, and an `authentication_session` row by a sha256 digest, so the
column is never narrower than what it holds
([What a refused login leaves behind](request-paths.md#what-a-refused-login-leaves-behind)).
`resource_id` alone is ambiguous — a client, a role and a group can all
happen to share an id — so it answers `400` naming both fields unless
`resource_type` is given alongside it, the same way a cursor minted under
one filter set is refused when `resource_id` is added to it on replay.
`request_id` and `ip` are never filters. Both default from the request that made the change (`withTenant`'s
own `RequestContext`, `packages/db/src/tx.ts`): `request_id` is the
request's own id, which a caller may supply as `x-request-id` (truncated to
128 characters), and `ip` is `request.ip`, which only `ODUDU_TRUST_PROXY`
lets a forwarded header decide. So `request_id` correlates rows and `ip` is
the evidence: a join on `request_id` holds for requests you made or that
came through a proxy you trust, and shows only what the caller claimed for
anyone else's (ADR 0037's third amendment).

**A third stack.** The examples below — this section only — were re-run
against a third stack, brought up the same way from an empty volume, to
show `request_id`/`ip` filled in and the `event_type` filter working; nothing
elsewhere in this document was recaptured, so this stack's ids refer only
to each other and to nothing in the sections above or below. Its `demo` is
`01a0daef-a94a-7ff3-a8d5-e78a1d2764f8`, `ada` in the `system` tenant is
subject `01a0daee-7bfc-7f6c-90de-d72b0aa3b5d8`, and the `odudu-admin` client
she authenticated as is `01a0daee-7bb4-7abb-99dd-12bbd701c5d4`. Requests
below went from the host into the container over the compose network, so
`ip` is that network's own gateway address rather than `127.0.0.1`.

```bash
curl -sS -G \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  --data-urlencode "resource_type=client" \
  --data-urlencode "action=client.create" \
  --data-urlencode "limit=20" \
  http://localhost:3000/admin/tenants/demo/audit
```

All three `client.create` rows on this stack, newest first: the
reserved-`client_id` refusal, attempted last, then `demo-app` and
`demo-backend` below it — both created directly through `POST /clients`,
oldest last:

```
{"items":[{"id":"01a0daef-c428-73d7-86f7-15d31e7ec3e0","occurred_at":"2026-09-25T23:39:01.543Z","event_type":"admin_mutation","action":"client.create","outcome":"refused","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0daee-7bfc-7f6c-90de-d72b0aa3b5d8","actor_client_id":"01a0daee-7bb4-7abb-99dd-12bbd701c5d4","resource_type":"client","resource_id":"odudu-admin","request_id":"01a0daef-c41f-70ad-ac7a-45d82523ca89","ip":"172.20.0.1","detail":{}},{"id":"01a0daef-c414-763a-ac6e-28e568659122","occurred_at":"2026-09-25T23:39:01.514Z","event_type":"admin_mutation","action":"client.create","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0daee-7bfc-7f6c-90de-d72b0aa3b5d8","actor_client_id":"01a0daee-7bb4-7abb-99dd-12bbd701c5d4","resource_type":"client","resource_id":"01a0daef-c40c-7dac-8d24-bf63c93db1b2","request_id":"01a0daef-c402-7a09-9c9c-4e2d0672b648","ip":"172.20.0.1","detail":{"jwks":{"changed":true},"name":{"after":"demo-app"},"type":{"after":"public"},"enabled":{"after":true},"jwks_uri":{"after":null},"audiences":{"after":[]},"grant_types":{"after":["authorization_code","refresh_token"]},"web_origins":{"after":[]},"redirect_uris":{"after":["http://localhost:3000/cb"]},"full_scope_allowed":{"after":false},"backchannel_logout_uri":{"after":null},"frontchannel_logout_uri":{"after":null},"access_token_ttl_seconds":{"after":300},"client_credentials_scopes":{"after":[]},"post_logout_redirect_uris":{"after":[]},"refresh_token_ttl_seconds":{"after":1209600},"token_endpoint_auth_method":{"after":"none"}}},{"id":"01a0daef-c3f6-7eac-8f6f-908fe252c948","occurred_at":"2026-09-25T23:39:01.441Z","event_type":"admin_mutation","action":"client.create","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0daee-7bfc-7f6c-90de-d72b0aa3b5d8","actor_client_id":"01a0daee-7bb4-7abb-99dd-12bbd701c5d4","resource_type":"client","resource_id":"01a0daef-c3ea-727a-a8d1-57245d276f1c","request_id":"01a0daef-c3b3-73bc-bef7-8350110f08f7","ip":"172.20.0.1","detail":{"jwks":{"changed":true},"name":{"after":"demo-backend"},"type":{"after":"confidential"},"enabled":{"after":true},"jwks_uri":{"after":null},"audiences":{"after":[]},"grant_types":{"after":["client_credentials"]},"web_origins":{"after":[]},"redirect_uris":{"after":[]},"full_scope_allowed":{"after":false},"backchannel_logout_uri":{"after":null},"frontchannel_logout_uri":{"after":null},"access_token_ttl_seconds":{"after":300},"client_credentials_scopes":{"after":[]},"post_logout_redirect_uris":{"after":[]},"refresh_token_ttl_seconds":{"after":1209600},"token_endpoint_auth_method":{"after":"client_secret_basic"}}}]}
```

`actor_tenant_id` is `system` on all three, and `tenant_id` is absent from
the row's own representation — the tenant a row belongs to is the one in
the path. None of the three `detail`s carries a secret: the refusal's is
empty, there being no row to diff, and `demo-backend` was created with
one — the allowlist shows `jwks` as `{"changed": true}` rather than a
value, which is the shape every redacted field takes. Every `request_id`
is a real request id and every `ip` the container's own view of the
caller.

Three signing-key rows from a stage/promote/retire rotation on this same
stack, narrowed by `resource_type` alone. Their `detail` is empty, a key
having no allowlisted field to diff:

```
{"items":[{"id":"01a0daef-ee73-761c-bcf6-238fb5748e87","occurred_at":"2026-09-25T23:39:12.367Z","event_type":"admin_mutation","action":"key.retire","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0daee-7bfc-7f6c-90de-d72b0aa3b5d8","actor_client_id":"01a0daee-7bb4-7abb-99dd-12bbd701c5d4","resource_type":"signing_key","resource_id":"01a0daef-a976-77ad-81e8-bec6ba60d906","request_id":"01a0daef-ee65-71d7-8693-366338b3d3cd","ip":"172.20.0.1","detail":{}},{"id":"01a0daef-ee57-7c06-ba34-229c5f617394","occurred_at":"2026-09-25T23:39:12.340Z","event_type":"admin_mutation","action":"key.promote","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0daee-7bfc-7f6c-90de-d72b0aa3b5d8","actor_client_id":"01a0daee-7bb4-7abb-99dd-12bbd701c5d4","resource_type":"signing_key","resource_id":"01a0daef-dbc4-734b-86a1-6f46504e961d","request_id":"01a0daef-ee47-7a74-b7e2-4c3316d0a916","ip":"172.20.0.1","detail":{}},{"id":"01a0daef-dbc5-76a5-a17b-495d1ee64bd1","occurred_at":"2026-09-25T23:39:07.586Z","event_type":"admin_mutation","action":"key.create","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0daee-7bfc-7f6c-90de-d72b0aa3b5d8","actor_client_id":"01a0daee-7bb4-7abb-99dd-12bbd701c5d4","resource_type":"signing_key","resource_id":"01a0daef-dbc4-734b-86a1-6f46504e961d","request_id":"01a0daef-dbb7-7d36-a27b-c77de68a9cdc","ip":"172.20.0.1","detail":{}}]}
```

And `?outcome=refused`, non-empty for `POST /clients`: the same
reserved-`client_id` row shown above, on its own —
`resource_id` is the `client_id` string, there being no row to name:

```
{"items":[{"id":"01a0daef-c428-73d7-86f7-15d31e7ec3e0","occurred_at":"2026-09-25T23:39:01.543Z","event_type":"admin_mutation","action":"client.create","outcome":"refused","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0daee-7bfc-7f6c-90de-d72b0aa3b5d8","actor_client_id":"01a0daee-7bb4-7abb-99dd-12bbd701c5d4","resource_type":"client","resource_id":"odudu-admin","request_id":"01a0daef-c41f-70ad-ac7a-45d82523ca89","ip":"172.20.0.1","detail":{}}]}
```

Adding `event_type=admin_mutation` to the first query on this stack —
`resource_type=client&action=client.create` — answers the same three rows
byte for byte, since every `client` mutation writes an `admin_mutation`
row and no other kind. The session `DELETE` is the one admin endpoint that
also writes a row of another kind, a `session` row beside its own:

```bash
curl -sS -G -H "Authorization: Bearer $ADMIN_TOKEN" \
  --data-urlencode "event_type=admin_mutation" \
  --data-urlencode "resource_type=client" \
  --data-urlencode "action=client.create" \
  http://localhost:3000/admin/tenants/demo/audit
```

```
{"items":[{"id":"01a0daef-c428-73d7-86f7-15d31e7ec3e0","occurred_at":"2026-09-25T23:39:01.543Z","event_type":"admin_mutation","action":"client.create","outcome":"refused","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0daee-7bfc-7f6c-90de-d72b0aa3b5d8","actor_client_id":"01a0daee-7bb4-7abb-99dd-12bbd701c5d4","resource_type":"client","resource_id":"odudu-admin","request_id":"01a0daef-c41f-70ad-ac7a-45d82523ca89","ip":"172.20.0.1","detail":{}},{"id":"01a0daef-c414-763a-ac6e-28e568659122","occurred_at":"2026-09-25T23:39:01.514Z","event_type":"admin_mutation","action":"client.create","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0daee-7bfc-7f6c-90de-d72b0aa3b5d8","actor_client_id":"01a0daee-7bb4-7abb-99dd-12bbd701c5d4","resource_type":"client","resource_id":"01a0daef-c40c-7dac-8d24-bf63c93db1b2","request_id":"01a0daef-c402-7a09-9c9c-4e2d0672b648","ip":"172.20.0.1","detail":{"jwks":{"changed":true},"name":{"after":"demo-app"},"type":{"after":"public"},"enabled":{"after":true},"jwks_uri":{"after":null},"audiences":{"after":[]},"grant_types":{"after":["authorization_code","refresh_token"]},"web_origins":{"after":[]},"redirect_uris":{"after":["http://localhost:3000/cb"]},"full_scope_allowed":{"after":false},"backchannel_logout_uri":{"after":null},"frontchannel_logout_uri":{"after":null},"access_token_ttl_seconds":{"after":300},"client_credentials_scopes":{"after":[]},"post_logout_redirect_uris":{"after":[]},"refresh_token_ttl_seconds":{"after":1209600},"token_endpoint_auth_method":{"after":"none"}}},{"id":"01a0daef-c3f6-7eac-8f6f-908fe252c948","occurred_at":"2026-09-25T23:39:01.441Z","event_type":"admin_mutation","action":"client.create","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0daee-7bfc-7f6c-90de-d72b0aa3b5d8","actor_client_id":"01a0daee-7bb4-7abb-99dd-12bbd701c5d4","resource_type":"client","resource_id":"01a0daef-c3ea-727a-a8d1-57245d276f1c","request_id":"01a0daef-c3b3-73bc-bef7-8350110f08f7","ip":"172.20.0.1","detail":{"jwks":{"changed":true},"name":{"after":"demo-backend"},"type":{"after":"confidential"},"enabled":{"after":true},"jwks_uri":{"after":null},"audiences":{"after":[]},"grant_types":{"after":["client_credentials"]},"web_origins":{"after":[]},"redirect_uris":{"after":[]},"full_scope_allowed":{"after":false},"backchannel_logout_uri":{"after":null},"frontchannel_logout_uri":{"after":null},"access_token_ttl_seconds":{"after":300},"client_credentials_scopes":{"after":[]},"post_logout_redirect_uris":{"after":[]},"refresh_token_ttl_seconds":{"after":1209600},"token_endpoint_auth_method":{"after":"client_secret_basic"}}}]}
```

`?event_type=token`, a vocabulary event type no admin route writes,
answers an empty page rather than an error:

```bash
curl -sS -G -H "Authorization: Bearer $ADMIN_TOKEN" \
  --data-urlencode "event_type=token" \
  http://localhost:3000/admin/tenants/demo/audit
```

```
{"items":[]}
```

A value the vocabulary does not name answers `400`, the same shape
`querystring` validation already answers elsewhere in this document:

```bash
curl -sS -G -H "Authorization: Bearer $ADMIN_TOKEN" \
  --data-urlencode "event_type=bogus" \
  http://localhost:3000/admin/tenants/demo/audit
```

```
{"type":"about:blank","title":"Error","status":400,"detail":"querystring/event_type must be equal to one of the allowed values","instance":"01a0daf0-0d53-75f1-97d2-504e2737e2f5"}
```

`resource_id` narrows further, and requires `resource_type` alongside it —
captured on the same third stack, rebuilt for this branch, with a fresh
system-tenant admin (`resource-doc`) and a tenant created only for this
subsection, `resource-audit-1790486559`, so its trail holds nothing but
what it did: two clients, `resource-doc-a` and `resource-doc-b`.

```bash
curl -sS -G -H "Authorization: Bearer $ADMIN_TOKEN" \
  --data-urlencode "resource_type=client" \
  --data-urlencode "resource_id=01a0e150-b9ec-70a9-8e34-663280fa0514" \
  http://localhost:3000/admin/tenants/resource-audit-1790486559/audit
```

Only `resource-doc-a`'s own row, not `resource-doc-b`'s:

```
{"items":[{"id":"01a0e150-b9fa-7928-8c6c-fffb14508355","occurred_at":"2026-09-27T05:22:39.206Z","event_type":"admin_mutation","action":"client.create","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0e150-9e32-7d69-9f91-82315e2f6bf2","actor_client_id":"01a0dc0c-0130-7dd6-a9d5-c867c3577f62","resource_type":"client","resource_id":"01a0e150-b9ec-70a9-8e34-663280fa0514","request_id":"01a0e150-b9d5-7a65-8c0a-11474588ecf3","ip":"172.20.0.1","detail":{"jwks":{"changed":true},"name":{"after":"resource-doc-a"},"type":{"after":"public"},"enabled":{"after":true},"jwks_uri":{"after":null},"audiences":{"after":[]},"grant_types":{"after":["authorization_code"]},"web_origins":{"after":[]},"redirect_uris":{"after":["https://app.example/cb"]},"full_scope_allowed":{"after":false},"backchannel_logout_uri":{"after":null},"frontchannel_logout_uri":{"after":null},"access_token_ttl_seconds":{"after":300},"client_credentials_scopes":{"after":[]},"post_logout_redirect_uris":{"after":[]},"refresh_token_ttl_seconds":{"after":1209600},"token_endpoint_auth_method":{"after":"none"}}}]}
```

`resource_id` alone, with no `resource_type`, is refused — a client, a
role and a group could all happen to share this id, so which table it
names is not optional:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/resource-audit-1790486559/audit?resource_id=01a0e150-b9ec-70a9-8e34-663280fa0514"
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"resource_id requires resource_type","instance":"01a0e150-d143-7a2e-83fb-d67891c4fb3f"}
```

No page above needed a `next`: the stack never had more than twenty rows of
any one scope.

### A token from another tenant, and a caller missing a capability

**A fourth stack.** This subsection only ran against the compose stack
[docs/request-paths.md](request-paths.md#what-a-refused-login-leaves-behind)'s
audit transcripts were captured on, whose `demo` is
`01a0db22-1c32-7d17-b351-697d7911033c`. That stack had no `system` tenant
until `seed admin --username ada` was run on it for this section, printing
subject `01a0dc0c-0167-709b-af07-e6eb529e8139`; `ada` then signed in the way
[Getting the token](#getting-the-token) shows, created a tenant `acme`
through `POST /admin/tenants`, and created a client `demo-operator` in
`demo` through `POST /clients` — `client_credentials`,
`client_secret_basic` — then gave it the admin audience through
`PATCH /clients/{id}` with `{"audiences": ["urn:odudu:params:admin-api"]}`.
`demo-operator` is `01a0dc0c-ec33-7e6a-bd79-339e8682bd86`, and holds no
capability in `demo`. Its ids refer only to each other.

`demo-operator`'s `client_credentials` token is a genuine `demo` token for
the admin API. Its payload, decoded as in
[Getting the token](#getting-the-token), and `demo` accepting it:

```
{
  "iss": "http://localhost:3000/tenants/demo",
  "sub": "01a0dc0c-ec16-7566-adfb-a8bf7681149c",
  "aud": [
    "urn:odudu:params:admin-api",
    "http://localhost:3000/tenants/demo"
  ],
  "client_id": "demo-operator",
  "scope": "",
  "iat": 1790398252,
  "exp": 1790398552,
  "jti": "01a0dc0d-4611-7720-b3fc-d5a5e84ba945",
  "grant_id": "01a0dc0d-4611-7720-b3fc-d5a43620011b"
}
```

```bash
curl -sS -H "Authorization: Bearer $DEMO_TOKEN" \
  http://localhost:3000/admin/tenants/demo/whoami
```

```
{"subjectId":"01a0dc0c-ec16-7566-adfb-a8bf7681149c","issuerTenantId":"01a0db22-1c32-7d17-b351-697d7911033c"}
```

Presented at `acme` instead, it is refused with the `401` a string that is
not a token at all gets. Both requests carry the same `x-request-id`, so the
two responses differ only in `Date`:

```bash
curl -sS -D - -H "Authorization: Bearer $DEMO_TOKEN" \
  -H 'x-request-id: foreign-issuer-doc' \
  http://localhost:3000/admin/tenants/acme/subjects
curl -sS -D - -H "Authorization: Bearer not-a-token" \
  -H 'x-request-id: foreign-issuer-doc' \
  http://localhost:3000/admin/tenants/acme/subjects
```

```
HTTP/1.1 401 Unauthorized
x-request-id: foreign-issuer-doc
content-type: application/problem+json; charset=utf-8
content-length: 90
Date: Sat, 26 Sep 2026 04:50:58 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Unauthorized","status":401,"instance":"foreign-issuer-doc"}
HTTP/1.1 401 Unauthorized
x-request-id: foreign-issuer-doc
content-type: application/problem+json; charset=utf-8
content-length: 90
Date: Sat, 26 Sep 2026 04:51:03 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Unauthorized","status":401,"instance":"foreign-issuer-doc"}
```

What tells them apart is behind the response. The first names an issuer
this deployment serves, and its signature verifies against `demo`'s own
keys, so it is recorded in `acme`'s trail — the tenant the attempt was made
against — naming `demo` as the caller's tenant, its subject and its client.
The second writes only a `warn` line to the server's log:

```
{"level":40,"time":1790398263230,"pid":1,"hostname":"bd66202e30bc","reqId":"foreign-issuer-doc","reason":"malformed_token","msg":"admin request unauthenticated"}
```

`acme` was created moments before, so its `admin_access` trail holds only
what this subsection did; `demo`'s holds nothing yet:

```bash
curl -sS -G -H "Authorization: Bearer $ADMIN_TOKEN" \
  --data-urlencode "event_type=admin_access" \
  http://localhost:3000/admin/tenants/acme/audit
curl -sS -G -H "Authorization: Bearer $ADMIN_TOKEN" \
  --data-urlencode "event_type=admin_access" \
  http://localhost:3000/admin/tenants/demo/audit
```

```
{"items":[{"id":"01a0dc0d-5c73-74df-80e9-a834a955aacc","occurred_at":"2026-09-26T04:50:58.290Z","event_type":"admin_access","action":"token.foreign_issuer","outcome":"refused","actor_tenant_id":"01a0db22-1c32-7d17-b351-697d7911033c","actor_subject_id":"01a0dc0c-ec16-7566-adfb-a8bf7681149c","actor_client_id":"01a0dc0c-ec33-7e6a-bd79-339e8682bd86","resource_type":null,"resource_id":null,"request_id":"foreign-issuer-doc","ip":"172.20.0.1","detail":{"reason":"foreign_issuer"}}]}
{"items":[]}
```

The same token at `demo`, where it authenticates but holds no capability,
is a `403`, and `demo`'s trail now has the `capability.refused` row naming
what `GET /subjects` needed:

```bash
curl -sS -D - -H "Authorization: Bearer $DEMO_TOKEN" \
  -H 'x-request-id: capability-refused-doc' \
  http://localhost:3000/admin/tenants/demo/subjects
curl -sS -G -H "Authorization: Bearer $ADMIN_TOKEN" \
  --data-urlencode "event_type=admin_access" \
  http://localhost:3000/admin/tenants/demo/audit
```

```
HTTP/1.1 403 Forbidden
x-request-id: capability-refused-doc
content-type: application/problem+json; charset=utf-8
content-length: 91
Date: Sat, 26 Sep 2026 04:51:08 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Forbidden","status":403,"instance":"capability-refused-doc"}
{"items":[{"id":"01a0dc0d-82ec-7888-ab05-4e8c931ffd35","occurred_at":"2026-09-26T04:51:08.139Z","event_type":"admin_access","action":"capability.refused","outcome":"refused","actor_tenant_id":"01a0db22-1c32-7d17-b351-697d7911033c","actor_subject_id":"01a0dc0c-ec16-7566-adfb-a8bf7681149c","actor_client_id":"01a0dc0c-ec33-7e6a-bd79-339e8682bd86","resource_type":null,"resource_id":null,"request_id":"capability-refused-doc","ip":"172.20.0.1","detail":{"reason":"missing_capability","capability":"view-users"}}]}
```

## `GET /admin/tenants/count`, `GET /subjects/count`, `GET /clients/count`, `GET /roles/count`, `GET /groups/count` and `GET /scopes/count`

How many rows a listing would page through, without paging through them.
Each count takes its list's own parameters minus `?cursor=` and `?limit=`,
under the same rules — a search is one field at a time, every filter is
`AND`ed, anything else is refused with `400` naming it — and requires its
list's own capability: `manage-tenants` for the tenant collection, which
carries no `{tenant}` segment for the same reason `GET /admin/tenants`
does; `view-users` for subjects, which `manage-users` also reaches;
`manage-clients` for clients; and `manage-tenant` for roles, groups and
scopes. `count` is a reserved tenant name, so `/admin/tenants/count` never
names a tenant, and a subject or client id is a uuid, so `/count` never
names one either.

The answer is `{"count": n, "capped": false}`, or `{"count": 10000,
"capped": true}` once more than ten thousand rows match: counting stops one
row past that ceiling. A count reads the rows its list would page through,
in its list's order, from the same index — never a pass over the table and
never another tenant's rows. The one read beyond that: a searched subjects
count whose matches fall under the ceiling may read the tenant's whole
subject index to join it, when the planner costs that cheaper than one
probe per match (`docs/phases/p4d.md`, "The plan a bounded count is given",
shows both plans; `tests/list-plans.int.test.ts` in `@odudu/protocol-admin`
holds them). A capped count says only that there are more; it is never an
estimate. No capped response is shown here, since nothing on this stack
holds ten thousand of anything —
`packages/protocol-admin/tests/counts.int.test.ts` covers it with a lowered
ceiling.

Captured against the fourth stack (the note at the top of this document)
as `ada-whoami`, after its `odudu` service was rebuilt from this branch,
with the roles, groups, subjects and clients the sections above created in
its `demo`. The tenant collection first, then the list the second count
agrees with:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/count"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/count?name=demo"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants?name=demo"
```

```
{"count":8,"capped":false}
{"count":1,"capped":false}
{"items":[{"id":"01a0db22-1c32-7d17-b351-697d7911033c","name":"demo","display_name":null,"enabled":true,"created_at":"2026-09-26T00:34:00.885Z"}]}
```

Subjects, unfiltered and then under `?username=ADA` — the three the search
under `GET /subjects` returns — and under `?enabled=false`, which nothing
in `demo` is:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/subjects/count"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/subjects/count?username=ADA"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/subjects/count?enabled=false"
```

```
{"count":7,"capped":false}
{"count":3,"capped":false}
{"count":0,"capped":false}
```

Clients, roles, groups and scopes, each unfiltered or under the searches
their own sections ran:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/clients/count"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/clients/count?type=public"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/roles/count?name=billing"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/roles/count?name=billing&client=tenant"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/groups/count?name=eng"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/scopes/count"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/scopes/count?name=o"
```

```
{"count":5,"capped":false}
{"count":1,"capped":false}
{"count":3,"capped":false}
{"count":2,"capped":false}
{"count":2,"capped":false}
{"count":8,"capped":false}
{"count":2,"capped":false}
```

A page control is not a count parameter, and two search fields are refused
as the list refuses them. The first two refusals are the generated
schema's, hence their generic `title`; the third is the handler's:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/subjects/count?limit=5"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/subjects/count?cursor=x"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/subjects/count?username=a&email=b"
```

```
{"type":"about:blank","title":"Error","status":400,"detail":"querystring must NOT have additional properties: limit","instance":"01a0e17e-02ce-71f8-a88e-ff57e563be16"}
{"type":"about:blank","title":"Error","status":400,"detail":"querystring must NOT have additional properties: cursor","instance":"01a0e17e-02d9-79ae-b3a9-5273bfa53781"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"search one field at a time: username or email, not both","instance":"01a0e17e-02e3-75e6-a189-82af26471b1b"}
```

## `GET /admin/openapi.json`

The reference this document points at: an OpenAPI 3.1 description of every
route above, generated from the same route table the router registers from,
so the two cannot drift. It takes no `{tenant}` — it describes the API
rather than reaching into one — and is served without authentication, since
a client that cannot read it cannot generate against it:

```bash
curl -sS -D - -o openapi.json http://localhost:3000/admin/openapi.json
```

```
HTTP/1.1 200 OK
access-control-allow-origin: *
content-type: application/json; charset=utf-8
content-length: 122868
```

120 KB and 33 paths, which is the whole route table. It is the one admin
response readable from any origin, so a viewer served from another port can
load it — the local stack's optional Swagger UI does exactly that (see
`README.md`, "Browsing the admin API"). No admin route carries that header,
so a page on another origin can read the description but cannot call the
API with it. Its first bytes, and
the `bearerAuth` scheme it declares — `head -c 180 openapi.json` and the
substring at `securitySchemes`:

```
{"openapi":"3.1.0","info":{"title":"Odudu admin API","version":"0.0.0"},"security":[{"bearerAuth":[]}],"paths":{"/admin/tenants/{tenant}/whoami":{"get":{"summary":"Requires an auth
```

```
"securitySchemes":{"bearerAuth":{"type":"http","scheme":"bearer","bearerFormat":"JWT","description":"An access token whose \"aud\" claim names urn:odudu:params:admin-api. A token minted for another audience, including the protocol surface itself, is refused with 401."}}
```

`security` is declared once at the top level, so every path inherits it
rather than repeating it. `/admin/openapi.json` is not among those 33
paths: the document does not describe itself, which is why serving it
unauthenticated does not contradict the blanket `security` above.

Each operation also carries its `requestBody`, generated from the same body
schema the router validates a request against, and its query parameters,
generated from the same querystring schema — before, the document declared
neither, so a generated client had the path and the response shape but not
what to send.

## What to do next, from wherever you are

**From here, for anything this document does not yet cover** — creating a
client, rotating a signing key, editing a tenant's authentication flow —
[docs/request-paths.md](request-paths.md) is where the rest of the server's
behaviour is documented, and its own "What to do next" section covers the
protocol surface this API sits beside.
