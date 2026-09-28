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
tenant `scope-guard-demo` created for them. `GET /subjects/:id/profile`
and `PATCH /subjects/:id/profile` were captured after one more rebuild, as
a new admin subject `ada-profile` in the system tenant, in a tenant
`profile-demo` created for them, on a subject `grace` created there; the
same section was recaptured after a further rebuild fixed the write-order
and locking review found in it, as the same `ada-profile`, in a fresh
tenant `profile-demo2`, on a new subject also named `grace`; the two
resubmit-the-same-number calls at the end of it were added after one more
rebuild narrowed the reset rule to a different number, against that same
`profile-demo2` tenant and subject, continuing where the recapture left
off. `GET /subjects/:id/consents` and `DELETE /subjects/:id/consents/:clientId`
were captured after a further rebuild, as a new admin subject
`ada-consents2` in the system tenant, in a tenant `consents-demo2` created
for it, on a subject `grace` seeded there with `odudu seed user` and a
confidential client `consents-demo-app2` created with `consent_required`
— recaptured entirely, under this tenant, after a further rebuild made
`DELETE` also revoke the subject's grants against the client.
`DELETE /subjects/:id/lockout`, `DELETE /subjects/:id/sessions` and
`POST /subjects/:id/password` were captured in that order after one more
rebuild, with the `odudu` service alone started with
`ODUDU_THROTTLE_LIMIT=1000` so a scripted run of sign-ins is not refused
by the per-origin throttle, as a new admin subject `ada-recovery` in the
system tenant, in a tenant `recovery-demo` created for them, on a subject
`hana` seeded there with `odudu seed user`, and, for the target ceiling,
subjects `mo` and `lin` seeded beside it. The service was restarted
without that override afterwards, so the stack is back to its default
throttle of ten. The `demo-fields-check` create and read under
`POST /clients` were recaptured after a further rebuild added
`builtin_admin` and `service_subject_id` to a client's representation, as
`field-facts-admin`, a new admin subject in the system tenant — the client
was deleted and recreated under the same `client_id` in `demo`, so its row
id, secret and timestamp are later than the rest of this section's.
`GET /settings` and `PATCH /settings`, and the rename under
`PATCH /subjects/:id`, were recaptured after one more rebuild that applied
`0077_username_editable.sql`, as a new admin subject `ada-rename` in the
system tenant, in tenants `settings-demo` and `rename-demo` created for
them, as each section says. `GET /export` was captured after one more
rebuild, as a new admin subject `ada-export`, in a tenant `export-demo`
created for it, as that section says; its audit-trail queries were later
recaptured, scoped by `from=$RUN_START` instead of left unscoped, as a
further admin subject `ada-export2` against that same tenant, without
rebuilding the stack. `POST /admin/tenant-imports` was captured after one
more rebuild, as a new admin subject `ada-import`, from a tenant
`import-source` created for it into a tenant `import-demo`, as that
section says; its own unscoped audit-trail query was later recaptured,
scoped by `resource_type`/`resource_id`, as a further admin subject
`ada-import2` importing into a new tenant `import-demo2` from the same
`import-source`, again without rebuilding the stack. The range refusals
under `PATCH /settings` were captured after a further rebuild, as the same
`ada-import`, in a tenant `settings-range-demo`; the rest of that section
was not re-run.

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

**Every admin API route's response carries `cache-control: no-store`**,
set once for every route in the route table (`registerAdminRoutes`,
`packages/protocol-admin/src/view/routes/router.ts`), refusals included —
`/admin/openapi.json`, which is public and the same for every caller, is
not one of them: each is specific to the caller that asked, and several
carry a secret shown once — a registration token, a client secret, a
one-time password. A handful of header blocks below predate this and were
not re-run — each says so, and why, where it appears.

| Method   | Path                                                             | What it is                                |
| -------- | ---------------------------------------------------------------- | ----------------------------------------- |
| `GET`    | `/admin/tenants`                                                 | List tenants                              |
| `GET`    | `/admin/tenants/count`                                           | Count tenants                             |
| `POST`   | `/admin/tenants`                                                 | Create a tenant                           |
| `POST`   | `/admin/tenant-imports`                                          | Import a tenant from a document           |
| `GET`    | `/admin/tenants/{tenant}`                                        | Read one tenant                           |
| `PATCH`  | `/admin/tenants/{tenant}`                                        | Amend one tenant                          |
| `GET`    | `/admin/tenants/{tenant}/export`                                 | Export a tenant's configuration           |
| `GET`    | `/admin/tenants/{tenant}/whoami`                                 | Identity probe                            |
| `GET`    | `/admin/tenants/{tenant}/subjects`                               | List subjects                             |
| `GET`    | `/admin/tenants/{tenant}/subjects/count`                         | Count subjects                            |
| `POST`   | `/admin/tenants/{tenant}/subjects`                               | Create a subject                          |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id`                           | Read a subject                            |
| `PATCH`  | `/admin/tenants/{tenant}/subjects/:id`                           | Amend a subject                           |
| `DELETE` | `/admin/tenants/{tenant}/subjects/:id`                           | Delete a subject                          |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/profile`                   | Read a subject's profile                  |
| `PATCH`  | `/admin/tenants/{tenant}/subjects/:id/profile`                   | Amend a subject's profile                 |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/credentials`               | List a subject's credentials              |
| `DELETE` | `/admin/tenants/{tenant}/subjects/:id/credentials/:credentialId` | Remove a credential                       |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/consents`                  | List a subject's consents                 |
| `DELETE` | `/admin/tenants/{tenant}/subjects/:id/consents/:clientId`        | Revoke a consent                          |
| `POST`   | `/admin/tenants/{tenant}/subjects/:id/password`                  | Issue a one-time password                 |
| `DELETE` | `/admin/tenants/{tenant}/subjects/:id/lockout`                   | Clear a brute-force lockout               |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/required-actions`          | Read a subject's required actions         |
| `PUT`    | `/admin/tenants/{tenant}/subjects/:id/required-actions`          | Set a subject's required actions          |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/roles`                     | Read a subject's roles                    |
| `PUT`    | `/admin/tenants/{tenant}/subjects/:id/roles`                     | Replace a subject's roles                 |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/groups`                    | Read a subject's groups                   |
| `PUT`    | `/admin/tenants/{tenant}/subjects/:id/groups`                    | Replace a subject's groups                |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/sessions`                  | List a subject's live sessions            |
| `DELETE` | `/admin/tenants/{tenant}/subjects/:id/sessions`                  | End every session                         |
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

_(Not re-run for the `cache-control: no-store` pass: this walks the whole
`/admin/tenants` collection, and later sections have since created more
tenants matching `re` — there is no `DELETE /admin/tenants` route to bring
the set back to the four rows this pagination narrates.)_

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

_(Not re-run for the `cache-control: no-store` pass: this is the first
stack's own creation of `demo`, and that stack was torn down; the `demo`
this document's later sections run against is a different tenant, created
on the fourth stack, so replaying this exact create would only get
`409 name already in use`.)_

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
x-request-id: 01a0e542-e156-726d-ac00-964c8612ed46
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 223
Date: Sun, 27 Sep 2026 23:46:00 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Bad Request","status":400,"detail":"a tenant name must be 1-63 lowercase letters, digits or hyphens, and must not start or end with a hyphen","instance":"01a0e542-e156-726d-ac00-964c8612ed46"}
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

_(Not re-run for the `cache-control: no-store` pass: the second stack's
`demo`, id `01a0d7ee-b611-…`, was torn down along with that stack.)_

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

## `GET /export`

`GET /admin/tenants/{tenant}/export` requires `manage-tenant` and
`manage-clients` — the second because the document carries every client,
which every other route reads with `manage-clients` — and answers
the tenant's configuration as one document of media type
`application/vnd.odudu.tenant+json`, carrying `"version": 1`: its settings,
its authentication flow, its clients, its roles and their composites, its
groups and their roles, its scopes with their role mappings, claim mapper
bindings and client assignments, its registration policy, and its SMTP
host, port, sender, username and STARTTLS. Every reference inside it is by
name — a role as its name and the `client_id` it belongs to, `null` for a
tenant role; a group by its path; a scope by its name; a client by its
`client_id` — and no row id, tenant id or timestamp appears anywhere, so
the document means the same thing in whichever tenant it is imported into.
`registration_allowed`, `verify_email` and `client_registration_policy`
travel under `registration_policy`; every other tenant setting is under
`settings`.

No secret is in it: no client secret, SMTP password, password hash, TOTP
seed, passkey, recovery code or private signing key, and no session,
consent, grant, registration token or audit row. Each secret a reader would
expect is named under `omitted` by its JSON path instead —
`clients[<i>].secret` for each confidential client, `smtp.password` when
one is set and `subjects[<i>].credentials` for each exported subject that
has any — so the gap is visible in the file rather than silent.
A client's `jwks` is exported with any private member (`d`, `p`, `q`,
`dp`, `dq`, `qi`, `k`) removed from each key, and each key that lost one is
named under `omitted` as `clients[<i>].jwks.keys[<j>]`. Registration and
`POST`/`PATCH /clients` refuse such a key
([docs/request-paths.md](request-paths.md#dynamic-client-registration)
shows the refusal), so only a row stored before that check can hold one;
none on this stack does, so no stripped key appears below.

What a new tenant provisions for itself is marked rather than left out:
each role on the built-in `odudu-admin` client and each default scope
(`openid` and the rest) carries `"builtin": true`, so an import can merge
onto its own copies. The `odudu-admin` client itself is not among
`clients`, and no scope lists an assignment to it: an import provisions
its own. A role on it is still referenced as
`{"name": …, "client": "odudu-admin"}`, because a tenant role may carry the
same name as a capability, and a reference that dropped the client would
not tell the two apart.

`?include=subjects` adds `subjects` — each user with a sign-in, its
profile claims and verification flags, its direct roles, its groups by
path and its required actions — and additionally requires `view-users`
(which `manage-users` also reaches), refused with `403` otherwise. Above
10,000 such subjects it is refused with `413` and
`"type": "about:blank#export-too-large"`, naming P7, whose inbound
provisioning is the tool for moving users in bulk; nothing on this stack
holds that many, so that refusal is not shown here —
`packages/protocol-admin/tests/tenant-export.int.test.ts` covers it. Any
other `include` is refused with `400`. Every export writes a
`tenant.export` row into the tenant's trail whose `detail` says whether
subjects were included.

Captured against the fourth stack (the note at the top of this document),
still running and not rebuilt for this recapture, as a new admin subject
`ada-export2` in the system tenant, reusing the `export-demo` tenant an
earlier capture created: its confidential client `billing-app`, tenant role
`billing-reader`, group `finance`, subject `grace` who belongs to it, and
SMTP relay whose password is `relay-password-shown-nowhere`, are all still
there. `tenant-operator`, also still there, was issued a fresh one-time
password through `POST /subjects/:id/password` and signed back in through
the tenant's own `odudu-admin` client, whose token is `$OPERATOR_TOKEN`
below. `RUN_START=$(date -u +%FT%T.000Z)` was captured first, so every
trail read below is scoped to `from=$RUN_START` rather than walking the
whole (and, on a reused tenant, already long) history of exports and
refusals against `export-demo`.

The export, without subjects:

```bash
RUN_START=$(date -u +%FT%T.000Z)
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/export-demo/export
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e5d9-8b57-7c1d-bb96-b5e32edb81b1
cache-control: no-store
content-type: application/vnd.odudu.tenant+json; charset=utf-8
content-length: 5408
Date: Mon, 28 Sep 2026 02:30:34 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"version":1,"settings":{"display_name":null,"enabled":true,"reset_password_allowed":false,"sso_session_idle_seconds":1800,"sso_session_max_seconds":36000,"password_min_length":8,"password_require_digit":false,"password_require_uppercase":false,"password_require_lowercase":false,"password_require_special":false,"password_not_username":true,"password_not_email":true,"password_history_depth":0,"password_max_age_days":0,"otp_required":false,"brute_force_max_failures":5,"brute_force_lockout_seconds":60,"brute_force_max_lockout_seconds":900,"brute_force_failure_reset_seconds":43200,"max_clients":200,"max_sessions_per_browser":25,"remember_me_allowed":false,"remember_me_idle_seconds":604800,"remember_me_max_seconds":2592000,"audit_retention_days":90,"username_editable":false},"flow":[{"authenticator":"passkey","requirement":"alternative"},{"authenticator":"password","requirement":"alternative"},{"authenticator":"otp","requirement":"conditional"},{"authenticator":"recovery-code","requirement":"conditional"}],"clients":[{"client_id":"billing-app","name":"Billing","type":"confidential","enabled":true,"full_scope_allowed":false,"registration_origin":"operator","redirect_uris":["https://billing.example/callback"],"grant_types":["authorization_code"],"token_endpoint_auth_method":"client_secret_basic","audiences":[],"access_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"service_account_roles":[]}],"roles":[{"name":"billing-reader","client":null,"description":null,"default_for_new_subjects":false,"builtin":false,"composites":[]},{"name":"manage-clients","client":"odudu-admin","description":null,"default_for_new_subjects":false,"builtin":true,"composites":[]},{"name":"manage-keys","client":"odudu-admin","description":null,"default_for_new_subjects":false,"builtin":true,"composites":[]},{"name":"manage-sessions","client":"odudu-admin","description":null,"default_for_new_subjects":false,"builtin":true,"composites":[]},{"name":"manage-tenant","client":"odudu-admin","description":null,"default_for_new_subjects":false,"builtin":true,"composites":[]},{"name":"manage-users","client":"odudu-admin","description":null,"default_for_new_subjects":false,"builtin":true,"composites":[{"name":"view-users","client":"odudu-admin"}]},{"name":"tenant-admin","client":"odudu-admin","description":null,"default_for_new_subjects":false,"builtin":true,"composites":[{"name":"manage-clients","client":"odudu-admin"},{"name":"manage-keys","client":"odudu-admin"},{"name":"manage-sessions","client":"odudu-admin"},{"name":"manage-tenant","client":"odudu-admin"},{"name":"manage-users","client":"odudu-admin"},{"name":"view-audit","client":"odudu-admin"},{"name":"view-users","client":"odudu-admin"}]},{"name":"view-audit","client":"odudu-admin","description":null,"default_for_new_subjects":false,"builtin":true,"composites":[]},{"name":"view-users","client":"odudu-admin","description":null,"default_for_new_subjects":false,"builtin":true,"composites":[]}],"groups":[{"path":"/finance","roles":[{"name":"billing-reader","client":null}]}],"scopes":[{"name":"address","description":null,"include_in_id_token":true,"include_in_access_token":false,"builtin":true,"roles":[],"mappers":[],"clients":[{"client_id":"billing-app","assignment":"default"}]},{"name":"email","description":null,"include_in_id_token":true,"include_in_access_token":false,"builtin":true,"roles":[],"mappers":[],"clients":[{"client_id":"billing-app","assignment":"default"}]},{"name":"groups","description":null,"include_in_id_token":false,"include_in_access_token":true,"builtin":true,"roles":[],"mappers":[],"clients":[{"client_id":"billing-app","assignment":"default"}]},{"name":"offline_access","description":null,"include_in_id_token":false,"include_in_access_token":false,"builtin":true,"roles":[],"mappers":[],"clients":[{"client_id":"billing-app","assignment":"optional"}]},{"name":"openid","description":null,"include_in_id_token":true,"include_in_access_token":false,"builtin":true,"roles":[],"mappers":[],"clients":[{"client_id":"billing-app","assignment":"default"}]},{"name":"phone","description":null,"include_in_id_token":true,"include_in_access_token":false,"builtin":true,"roles":[],"mappers":[],"clients":[{"client_id":"billing-app","assignment":"default"}]},{"name":"profile","description":null,"include_in_id_token":true,"include_in_access_token":false,"builtin":true,"roles":[],"mappers":[],"clients":[{"client_id":"billing-app","assignment":"default"}]},{"name":"roles","description":null,"include_in_id_token":false,"include_in_access_token":true,"builtin":true,"roles":[],"mappers":[],"clients":[{"client_id":"billing-app","assignment":"default"}]}],"registration_policy":{"registration_allowed":false,"verify_email":false,"client_registration_policy":"disabled"},"smtp":{"host":"smtp.gmail.com","port":587,"from_address":"noreply@example.com","username":"mailer","starttls":true},"omitted":["clients[0].secret","smtp.password"]}
```

The SMTP password appears nowhere in it, nor in the export with subjects:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/export-demo/export | grep -c relay-password-shown-nowhere
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/export-demo/export?include=subjects" | grep -c relay-password-shown-nowhere
```

```
0
0
```

By the same rule the ceiling-removal block below shows, `tenant-operator`
holding `manage-tenant` alone is refused `manage-clients` for either form
of the export — `?include=subjects` and the export without it both answer
`403`:

```bash
curl -sS -H "Authorization: Bearer $OPERATOR_TOKEN" \
  http://localhost:3000/admin/tenants/export-demo/whoami
curl -sS -H "Authorization: Bearer $OPERATOR_TOKEN" \
  "http://localhost:3000/admin/tenants/export-demo/export?include=subjects"
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  http://localhost:3000/admin/tenants/export-demo/export
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/export-demo/export?include=sessions"
```

```
{"subjectId":"01a0e4c3-4083-7293-8831-26a05de70216","issuerTenantId":"01a0e4c2-de55-724f-8fb7-a92b9af1da21","capabilities":["manage-tenant"],"crossTenant":false}
{"type":"about:blank","title":"Forbidden","status":403,"instance":"01a0e5d9-ee19-720b-a216-800817e3c760"}
403 application/problem+json; charset=utf-8
{"type":"about:blank","title":"Error","status":400,"detail":"querystring/include must be equal to constant","instance":"01a0e5d9-ee50-71b0-a513-0a6e247b84d0"}
```

The trail, scoped to this run — the exports (`$ADMIN_TOKEN`'s, allowed)
and then the two refusals (`tenant-operator`'s, naming `manage-clients`
both times):

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/export-demo/audit?action=tenant.export&from=$RUN_START"
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/export-demo/audit?action=capability.refused&from=$RUN_START"
```

```
{"items":[{"id":"01a0e5d9-ab90-7cf8-aa83-5fa065a45b70","occurred_at":"2026-09-28T02:30:42.821Z","event_type":"admin_mutation","action":"tenant.export","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0e5d9-7862-732b-a27c-0efffe82a3db","actor_client_id":"01a0dc0c-0130-7dd6-a9d5-c867c3577f62","resource_type":"tenant","resource_id":"01a0e4c2-de55-724f-8fb7-a92b9af1da21","request_id":"01a0e5d9-ab7a-7793-aae0-aae5d63f08df","ip":"172.20.0.1","detail":{"include_subjects":true}},{"id":"01a0e5d9-ab6a-7b1f-b4fb-e215f49d4617","occurred_at":"2026-09-28T02:30:42.783Z","event_type":"admin_mutation","action":"tenant.export","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0e5d9-7862-732b-a27c-0efffe82a3db","actor_client_id":"01a0dc0c-0130-7dd6-a9d5-c867c3577f62","resource_type":"tenant","resource_id":"01a0e4c2-de55-724f-8fb7-a92b9af1da21","request_id":"01a0e5d9-ab55-75ec-928f-2b775c8ffebd","ip":"172.20.0.1","detail":{"include_subjects":false}},{"id":"01a0e5d9-ab47-743f-9954-84eb1bdb27a2","occurred_at":"2026-09-28T02:30:42.744Z","event_type":"admin_mutation","action":"tenant.export","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0e5d9-7862-732b-a27c-0efffe82a3db","actor_client_id":"01a0dc0c-0130-7dd6-a9d5-c867c3577f62","resource_type":"tenant","resource_id":"01a0e4c2-de55-724f-8fb7-a92b9af1da21","request_id":"01a0e5d9-ab29-7996-b59d-51008a110a5c","ip":"172.20.0.1","detail":{"include_subjects":true}},{"id":"01a0e5d9-8b76-7b7c-befd-cc591e6e895a","occurred_at":"2026-09-28T02:30:34.599Z","event_type":"admin_mutation","action":"tenant.export","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0e5d9-7862-732b-a27c-0efffe82a3db","actor_client_id":"01a0dc0c-0130-7dd6-a9d5-c867c3577f62","resource_type":"tenant","resource_id":"01a0e4c2-de55-724f-8fb7-a92b9af1da21","request_id":"01a0e5d9-8b57-7c1d-bb96-b5e32edb81b1","ip":"172.20.0.1","detail":{"include_subjects":false}}]}
{"items":[{"id":"01a0e5d9-ee45-7e75-9dd8-51c63b80f954","occurred_at":"2026-09-28T02:30:59.909Z","event_type":"admin_access","action":"capability.refused","outcome":"refused","actor_tenant_id":"01a0e4c2-de55-724f-8fb7-a92b9af1da21","actor_subject_id":"01a0e4c3-4083-7293-8831-26a05de70216","actor_client_id":"01a0e4c2-de61-7157-af81-7cd142b62099","resource_type":null,"resource_id":null,"request_id":"01a0e5d9-ee38-79e3-bd44-7588a226f488","ip":"172.20.0.1","detail":{"reason":"missing_capability","capability":"manage-clients"}},{"id":"01a0e5d9-ee29-7f3a-86cb-fae8e2bebdcc","occurred_at":"2026-09-28T02:30:59.880Z","event_type":"admin_access","action":"capability.refused","outcome":"refused","actor_tenant_id":"01a0e4c2-de55-724f-8fb7-a92b9af1da21","actor_subject_id":"01a0e4c3-4083-7293-8831-26a05de70216","actor_client_id":"01a0e4c2-de61-7157-af81-7cd142b62099","resource_type":null,"resource_id":null,"request_id":"01a0e5d9-ee19-720b-a216-800817e3c760","ip":"172.20.0.1","detail":{"reason":"missing_capability","capability":"manage-clients"}}]}
```

The subjects and `omitted` of the export with subjects, selected with
`jq` — `grace` still owes `update-password`, and `tenant-operator`'s no
longer does, now that the reset above was completed; her password is named
rather than carried:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/export-demo/export?include=subjects" \
  | jq -c '.subjects[], .omitted'
```

```
{"username":"grace","email":"grace@example.com","enabled":true,"profile":{"name":null,"given_name":null,"family_name":null,"middle_name":null,"nickname":null,"preferred_username":null,"profile":null,"picture":null,"website":null,"gender":null,"birthdate":null,"zoneinfo":null,"locale":null,"phone_number":null,"phone_number_verified":false,"email_verified":false,"address_formatted":null,"address_street":null,"address_locality":null,"address_region":null,"address_postal_code":null,"address_country":null},"roles":[],"groups":["/finance"],"required_actions":["update-password"]}
{"username":"tenant-operator","email":null,"enabled":true,"profile":{"name":null,"given_name":null,"family_name":null,"middle_name":null,"nickname":null,"preferred_username":null,"profile":null,"picture":null,"website":null,"gender":null,"birthdate":null,"zoneinfo":null,"locale":null,"phone_number":null,"phone_number_verified":false,"email_verified":false,"address_formatted":null,"address_street":null,"address_locality":null,"address_region":null,"address_postal_code":null,"address_country":null},"roles":[{"name":"manage-tenant","client":"odudu-admin"}],"groups":[],"required_actions":[]}
["clients[0].secret","smtp.password","subjects[1].credentials"]
```

A caller holding `manage-tenant` without `manage-clients` is refused with
`403`, writing the same `capability.refused` row the router writes for a
route's own capability, naming `manage-clients`. Captured against
`ceiling-removal` from
[a removal is judged by what it removes](#a-removal-is-judged-by-what-it-removes),
whose `$TENANT_TOKEN` holds `manage-tenant` alone, with the row read back
as the system administrator:

```bash
RUN_START=$(date -u +%FT%T.000Z)
curl -sS -H "Authorization: Bearer $TENANT_TOKEN" \
  http://localhost:3000/admin/tenants/ceiling-removal/export
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/ceiling-removal/audit?action=capability.refused&from=$RUN_START" \
  | jq -c '.items[] | {action, outcome, actor_subject_id, detail}'
```

```
{"type":"about:blank","title":"Forbidden","status":403,"instance":"01a0e5c9-600a-7aa2-91da-e4cb637c903e"}
{"action":"capability.refused","outcome":"refused","actor_subject_id":"01a0e59a-b35c-7fb5-aa5a-78cdc389b30b","detail":{"reason":"missing_capability","capability":"manage-clients"}}
```

## `POST /admin/tenant-imports`

`POST /admin/tenant-imports` requires `manage-tenants` and always creates a
new tenant, from a document `GET /export` answered. The body is
`{"name": …, "display_name": …, "document": …}`; `display_name` is optional,
and without it the document's own `settings.display_name` is used. Merging
into an existing tenant is not offered.

The whole request is validated before anything is written, and every
problem is answered together in one `400` whose `errors` lists each with
its JSON path from the body — `name`, or `document.clients[0].redirect_uris`.
The checks run in this order: the tenant name, by the same rule
`POST /admin/tenants` applies (`system` and `count` included); the document
against the export's own schema, which stops there if it fails; every
cross-reference, repeated name and composite cycle; each client through
`parseClientMetadata`, the validator registration and `POST /clients` use,
so a `jwks` key carrying a private member is refused here too; and last the
rules every admin API write is held to. A role with
`default_for_new_subjects` may not reach an admin capability through any
depth of composites, as under `PUT /roles/:id/default`. Nothing the document
grants may carry a capability the caller does not hold, the ceiling
`PUT /subjects/:id/roles` applies. A reserved name is a `400` here rather
than the `409` `POST /admin/tenants` answers, so that it is reported
beside the document's own problems. A name another tenant holds is refused
with `409` once the request is otherwise sound, still before any write.
The ranges the database's CHECK constraints hold settings and client token
lifetimes to are checked among the rest, each at its own path —
`document.settings.password_min_length`, or
`document.clients[0].access_token_ttl_seconds` above its ceiling of 3600
(`tenantSettingProblems`, `@odudu/domain-tenant`, and
`clientTokenTtlProblem`, `@odudu/protocol-oidc`, each held to its
constraints by a test that writes the boundary values).

What provisioning creates is matched, never created twice. A role marked
`builtin` is matched by its name on `odudu-admin`, a scope marked `builtin`
by its name, and the attributes the admin API lets an operator edit on
them — a role's `description`, a scope's
`description`, its two `include_in_*` flags, its role mappings, mapper
bindings and client assignments — are applied from the document. A
built-in scope the document leaves out is deleted, as it was where the
document came from; `openid`, which cannot be deleted, is required. A
built-in the new tenant does not provision, such as the system tenant's
`manage-tenants`, is refused, as is any other role on `odudu-admin`: a
document cannot mint a capability. So is leaving out a composite that
provisioning gives a capability role, which `DELETE /roles/:id/composites`
would refuse to remove, and naming one it does not give, which
`POST /roles/:id/composites` would refuse to add: a capability role's shape
is provisioning's in both directions.

Then one transaction creates the tenant the way `POST /admin/tenants` does
— its row, flow, built-in admin client and a signing key of its own, never
the source's — and writes the document into it: settings, flow, clients,
roles and their composites, groups, scopes, service-account roles, SMTP and
subjects, in that order. Each confidential client is given a fresh secret,
answered once under `client_secrets` in the `201` and never logged or
written to the trail. The SMTP relay arrives without a password, since none
travels; `PUT /smtp` sets one. A subject arrives with no credential and an
`update-password` required action, beside any it already owed. The import
writes one `tenant.import` row into the new tenant's trail, whose `detail`
carries the document's `version` and how many clients, roles, groups,
scopes and subjects it held.

So a document exported from the imported tenant equals the one imported,
apart from `settings.display_name` when the request names another, the
`omitted` list — no client secret, SMTP password or credential was carried
across — and each subject's `required_actions`, which gains
`update-password`. `packages/protocol-admin/tests/tenant-import.int.test.ts`
holds a round trip to exactly that.

A document with the export's full 10,000 subjects runs to several
megabytes, so this route admits a body of up to 16 MiB, where every other
route keeps Fastify's default of one; a larger body is refused with `413`.
A document holding more subjects than export would ever write — more than
10,000 — is refused at `document.subjects` among the other problems, with
the same text export's own `413` gives, since a smaller body can still hold
that many.

Captured against the fourth stack (the note at the top of this document),
still running and not rebuilt for this recapture, as a new admin subject
`ada-import2` in the system tenant. `import-source`, from an earlier
capture, is reused unchanged: a confidential `client_credentials` client
`billing-app`, a tenant role `billing-reader`, a group `finance` holding
it, and a subject `grace` who belongs to it. The import below names a new
tenant, `import-demo2`, since `import-demo` from that earlier capture is
still there and a name already in use is refused. Both tenants and the
secret below are throwaway: they hold nothing beyond this and the earlier
capture's demonstrations.

The export, saved, then imported under a new name:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/import-source/export?include=subjects" > source.json
jq -n --slurpfile document source.json \
  '{name: "import-demo2", display_name: "Import demo", document: $document[0]}' \
  | curl -sS -D - -X POST \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      --data-binary @- \
      http://localhost:3000/admin/tenant-imports
```

```
HTTP/1.1 201 Created
x-request-id: 01a0e5dc-7f64-78f5-b090-3c2d73c8ebe8
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 264
Date: Mon, 28 Sep 2026 02:33:48 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"tenant":{"id":"01a0e5dc-7f9c-7e15-b29a-b0ff518792da","name":"import-demo2","display_name":"Import demo","enabled":true,"created_at":"2026-09-28T02:33:48.188Z"},"client_secrets":[{"client_id":"billing-app","secret":"-c-i0PTHXJS0tDeV4xm0ovRlMIMFwgRd-ajVgfug04M"}]}
```

The secret it answered authenticates at the new tenant's `/token`:

```bash
curl -sS -u 'billing-app:-c-i0PTHXJS0tDeV4xm0ovRlMIMFwgRd-ajVgfug04M' \
  --data-urlencode 'grant_type=client_credentials' \
  http://localhost:3000/tenants/import-demo2/protocol/openid-connect/token \
  | jq -c '{token_type, expires_in, has_access_token: (.access_token | length > 0)}'
```

```
{"token_type":"Bearer","expires_in":300,"has_access_token":true}
```

The new tenant exported again, compared with the source's document with
`omitted` and `settings.display_name` set aside — `grace` already owed
`update-password` in the source, so her `required_actions` are unchanged —
and then those two fields side by side:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/import-demo2/export?include=subjects" > imported.json
diff <(jq -S 'del(.omitted, .settings.display_name)' source.json) \
     <(jq -S 'del(.omitted, .settings.display_name)' imported.json) && echo identical
jq -c '{display_name: .settings.display_name, omitted}' source.json imported.json
```

```
identical
{"display_name":"Import source","omitted":["clients[0].secret"]}
{"display_name":"Import demo","omitted":["clients[0].secret"]}
```

Each tenant's signing key, then the import's row in the new tenant's
trail, scoped to the tenant `resource_id` this import created — the only
row it could ever hold, since an import always creates a fresh tenant
rather than writing into one that already exists:

```bash
for tenant in import-source import-demo2; do
  curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
    "http://localhost:3000/admin/tenants/$tenant/keys" | jq -c '[.items[].kid]'
done
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/import-demo2/audit?action=tenant.import&resource_type=tenant&resource_id=01a0e5dc-7f9c-7e15-b29a-b0ff518792da"
```

```
["01a0e4ef-6489-7186-9281-1299d1579a48"]
["01a0e5dc-8011-7e17-ada0-c594fae887de"]
{"items":[{"id":"01a0e5dc-812c-70db-9086-8078ec35d353","occurred_at":"2026-09-28T02:33:48.188Z","event_type":"admin_mutation","action":"tenant.import","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0e5dc-657a-7fa1-b8ce-d718df8d65f5","actor_client_id":"01a0dc0c-0130-7dd6-a9d5-c867c3577f62","resource_type":"tenant","resource_id":"01a0e5dc-7f9c-7e15-b29a-b0ff518792da","request_id":"01a0e5dc-7f64-78f5-b090-3c2d73c8ebe8","ip":"172.20.0.1","detail":{"counts":{"roles":9,"groups":1,"scopes":8,"clients":1,"subjects":1},"source_version":1}}]}
```

A document broken in two places at once — a scope mapping naming a role
that does not exist, and a redirect URI registration would refuse. In the
saved document `scopes[0]` is `address`, mapping no role, and `clients[0]`
is `billing-app`, registering no redirect URI:

```bash
jq -c '{scope: .scopes[0].name, scope_roles: .scopes[0].roles, client: .clients[0].client_id, redirect_uris: .clients[0].redirect_uris}' source.json
```

```
{"scope":"address","scope_roles":[],"client":"billing-app","redirect_uris":[]}
```

Both problems are answered together, and no tenant was created:

```bash
jq '.scopes[0].roles = [{"name": "no-such-role", "client": null}]
    | .clients[0].redirect_uris = ["http://billing.example/callback"]' source.json \
  | jq -c '{name: "import-broken", document: .}' \
  | curl -sS -D - -X POST \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      --data-binary @- \
      http://localhost:3000/admin/tenant-imports
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants?name=import-broken"
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a0e4ef-dd32-77bd-aff1-649ed553a54a
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 390
Date: Sun, 27 Sep 2026 22:15:20 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Bad Request","status":400,"detail":"the import was refused for 2 problem(s), listed under errors","errors":[{"path":"document.scopes[0].roles[0]","message":"names no role no-such-role"},{"path":"document.clients[0].redirect_uris","message":"redirect_uris entry http://billing.example/callback is not valid"}],"instance":"01a0e4ef-dd32-77bd-aff1-649ed553a54a"}
{"items":[]}
```

A name already in use, then a reserved one:

```bash
for name in import-source system; do
  jq -c --arg name "$name" '{name: $name, document: .}' source.json \
    | curl -sS -X POST \
        -H "Authorization: Bearer $ADMIN_TOKEN" \
        -H "Content-Type: application/json" \
        --data-binary @- \
        http://localhost:3000/admin/tenant-imports
  echo
done
```

```
{"type":"about:blank","title":"Conflict","status":409,"detail":"the name \"import-source\" is already in use","instance":"01a0e4ef-ba74-7308-b889-648d797eb195"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"the import was refused for 1 problem(s), listed under errors","errors":[{"path":"name","message":"the name \"system\" is reserved"}],"instance":"01a0e4ef-ba90-7262-bf3e-1c8e86c8b5ab"}
```

And a body over the limit:

```bash
python3 -c 'import json; print(json.dumps({"name": "import-huge", "document": {"padding": "x" * (16 * 1024 * 1024)}}))' > huge.json
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @huge.json \
  http://localhost:3000/admin/tenant-imports
```

```
{"type":"about:blank","title":"FastifyError","status":413,"detail":"Request body is too large","instance":"01a0e4ef-bb76-7124-83a5-7b6d680169cf"}
```

And a document of 10,001 copies of `grace`, each under its own username,
built from a fresh export of `import-source` on the stack this document's
latest sections were captured on — refused, and no tenant created:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/import-source/export?include=subjects" > source.json
jq -c '{name: "import-crowd", document: (.subjects = [range(10001) as $i
    | .subjects[0] + {username: "user-\($i)", email: null}])}' source.json \
  | curl -sS -X POST \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      --data-binary @- \
      http://localhost:3000/admin/tenant-imports
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3000/admin/tenants/count?name=import-crowd'
echo
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"the import was refused for 1 problem(s), listed under errors","errors":[{"path":"document.subjects","message":"the tenant holds more than 10000 subjects, too many to export with ?include=subjects; export without it, and move users in bulk through inbound provisioning (P7)"}],"instance":"01a0e5bf-423c-74c8-9938-4e0f9dfc0f84"}
{"count":0,"capped":false}
```

## `GET /settings` and `PATCH /settings`

The 29 columns `tenants` carries beyond identity — everything
`odudu seed tenant --set` can already change — read and amended through one
map, `@odudu/domain-tenant`'s `SETTINGS`
(`packages/domain-tenant/src/service/tenant-settings.ts`): a name a caller
writes and a column a migration owns, never restated a second time. Ranges
are `CHECK` constraints on `tenants`, restated beside that map as
`tenantSettingProblems` so a value outside one is refused before the write;
`packages/domain-tenant/tests/tenant-setting-checks.int.test.ts` holds the
two in agreement, and the `CHECK` still stands behind it.

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
  http://localhost:3000/admin/tenants/settings-demo/settings
```

Captured against `settings-demo`, a tenant created for this section through
`POST /admin/tenants` with `display_name` "Settings Demo", as the system
admin `ada-rename` the rename walkthrough under `PATCH /subjects/:id` uses,
so every value but `display_name` is the migrations' own default:

```
HTTP/1.1 200 OK
x-request-id: 01a0e37c-7b52-7cfb-bf94-c82a71461949
cache-control: no-store
etag: "541f8ad7127836bb2c79e2c7d499b824c1512ac0fa5713abd8d5952046182645"
content-type: application/json; charset=utf-8
content-length: 857
Date: Sun, 27 Sep 2026 15:29:41 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"display_name":"Settings Demo","enabled":true,"registration_allowed":false,"verify_email":false,"reset_password_allowed":false,"sso_session_idle_seconds":1800,"sso_session_max_seconds":36000,"password_min_length":8,"password_require_digit":false,"password_require_uppercase":false,"password_require_lowercase":false,"password_require_special":false,"password_not_username":true,"password_not_email":true,"password_history_depth":0,"password_max_age_days":0,"otp_required":false,"brute_force_max_failures":5,"brute_force_lockout_seconds":60,"brute_force_max_lockout_seconds":900,"brute_force_failure_reset_seconds":43200,"client_registration_policy":"disabled","max_clients":200,"max_sessions_per_browser":25,"remember_me_allowed":false,"remember_me_idle_seconds":604800,"remember_me_max_seconds":2592000,"audit_retention_days":90,"username_editable":false}
```

Amending sends only the settings that change, and the response is the whole
object as it now reads, with a fresh `ETag` for the next `If-Match`:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"verify_email": true, "password_min_length": 14}' \
  http://localhost:3000/admin/tenants/settings-demo/settings
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e37c-7b66-7f7c-a9aa-f29ffc2d97e8
cache-control: no-store
etag: "a87f22b6be2f43fe4578f8152c877ed31ff804243771fcda82f173b3f09155c6"
content-type: application/json; charset=utf-8
content-length: 857
Date: Sun, 27 Sep 2026 15:29:41 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"display_name":"Settings Demo","enabled":true,"registration_allowed":false,"verify_email":true,"reset_password_allowed":false,"sso_session_idle_seconds":1800,"sso_session_max_seconds":36000,"password_min_length":14,"password_require_digit":false,"password_require_uppercase":false,"password_require_lowercase":false,"password_require_special":false,"password_not_username":true,"password_not_email":true,"password_history_depth":0,"password_max_age_days":0,"otp_required":false,"brute_force_max_failures":5,"brute_force_lockout_seconds":60,"brute_force_max_lockout_seconds":900,"brute_force_failure_reset_seconds":43200,"client_registration_policy":"disabled","max_clients":200,"max_sessions_per_browser":25,"remember_me_allowed":false,"remember_me_idle_seconds":604800,"remember_me_max_seconds":2592000,"audit_retention_days":90,"username_editable":false}
```

A name this map does not know is refused with `400`, naming the settings it
does — which is also the one place the whole vocabulary is listed by the
server itself:

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"unknown tenant setting \"nonesuch\"; expected one of display_name, enabled, registration_allowed, verify_email, reset_password_allowed, sso_session_idle_seconds, sso_session_max_seconds, password_min_length, password_require_digit, password_require_uppercase, password_require_lowercase, password_require_special, password_not_username, password_not_email, password_history_depth, password_max_age_days, otp_required, brute_force_max_failures, brute_force_lockout_seconds, brute_force_max_lockout_seconds, brute_force_failure_reset_seconds, client_registration_policy, max_clients, max_sessions_per_browser, remember_me_allowed, remember_me_idle_seconds, remember_me_max_seconds, audit_retention_days, username_editable","instance":"01a0e37c-7b7c-7b93-a28d-6c6e358a7c92"}
```

A value the map coerces but outside its range — `password_min_length`
outside `8..256`, for instance — is refused with `400` before anything is
written, every such setting listed together under `errors` by its name. An
idle lifetime is judged against the maximum it would sit under once the
patch is applied, the stored one when the patch leaves it alone. The
refusals come in a fixed order: a malformed or unknown setting answers
`400` first, then a stale `If-Match` answers `412`, and only then is an
out-of-range value refused with `400` — so a stale header on an
out-of-range patch is told `412`. Captured
against the fourth stack after its `odudu` service was rebuilt from this
branch, as `ada-import` (the admin `POST /admin/tenant-imports` was
captured as), in a tenant `settings-range-demo` created for it — its stored
values first:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/settings-range-demo/settings \
  | jq -c '{password_min_length, max_sessions_per_browser, sso_session_idle_seconds, sso_session_max_seconds}'
for body in '{"password_min_length": 4}' \
            '{"password_min_length": 4, "max_sessions_per_browser": 99}' \
            '{"sso_session_idle_seconds": 40000}'; do
  curl -sS -X PATCH \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$body" \
    http://localhost:3000/admin/tenants/settings-range-demo/settings
  echo
done
```

```
{"password_min_length":8,"max_sessions_per_browser":25,"sso_session_idle_seconds":1800,"sso_session_max_seconds":36000}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"1 tenant setting(s) outside the permitted range, listed under errors","errors":[{"path":"password_min_length","message":"must be between 8 and 256"}],"instance":"01a0e50e-af82-7d71-9707-90c95f5bc100"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"2 tenant setting(s) outside the permitted range, listed under errors","errors":[{"path":"password_min_length","message":"must be between 8 and 256"},{"path":"max_sessions_per_browser","message":"must be between 1 and 32"}],"instance":"01a0e50e-af99-7032-8cb9-ad764a4a3a15"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"1 tenant setting(s) outside the permitted range, listed under errors","errors":[{"path":"sso_session_idle_seconds","message":"must not exceed sso_session_max_seconds"}],"instance":"01a0e50e-afb0-72d3-a667-8e7576e63166"}
```

A setting's value may be sent as its JSON type
(`true`, `14`) or as the equivalent string (`"true"`, `"14"`) — both reach
the same `coerceTenantSetting` the CLI uses, which reads a string either
way.

`seed tenant --set` runs the same check before it writes anything, over the
tenant's stored settings with the new values laid on them — or, for a
tenant it would create, the column defaults — and names every problem at
once. So a refused `--set` leaves no tenant behind: the second command below
creates `range-demo`, which the first did not.

```bash
docker compose exec -T odudu node dist/main.js seed tenant --name range-demo \
  --set password_max_age_days=4000 --set sso_session_max_seconds=600 2>&1 \
  | grep -E '^OduduError|code:'
docker compose exec -T odudu node dist/main.js seed tenant --name range-demo 2>/dev/null
```

```
OduduError: tenant setting password_max_age_days must be between 0 and 3650; tenant setting sso_session_idle_seconds must not exceed sso_session_max_seconds
  code: 'seed_invalid_options'
{"command":"tenant","created":true,"tenant":"range-demo","tenantId":"01a0e5a1-a6ff-7c12-9a71-8b9c81ba450b"}
```

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
is refused the same way. `access_token_ttl_seconds` outside 1 to 3600 and
`refresh_token_ttl_seconds` below 1 are refused with `400`, naming the field,
on a create and a `PATCH` alike — the ranges the database's own CHECK
constraints hold (`0013_access_token_ttl_ceiling.sql`,
`0014_refresh_token_ttl_floor.sql`), which otherwise surfaced as a `500`.
No transcript shows that refusal;
`packages/protocol-admin/tests/client-ttl-check.int.test.ts` covers it.

A `jwks` is served public members only, by the read, the list and every
response that carries a client, the same stripping export applies
(`publicJwks`, `packages/protocol-admin/src/service/public-jwks.ts`).
Registration and this API refuse a private member, so only a row written
before they did can hold one; a `PATCH` that reruns the metadata is judged
on the stripped set, and writes it back without the member. No transcript
shows it, since no stack this document was captured on holds such a row;
`packages/protocol-admin/tests/clients.int.test.ts` writes one directly.

Creating a client that names both, against `demo`. Recaptured after a
rebuild that added `builtin_admin` and `service_subject_id` to a client's
representation, so this id and secret are a later run's than the rest of
this section:

```bash
curl -sS -D - -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"client_id": "demo-fields-check", "grant_types": ["client_credentials"], "token_endpoint_auth_method": "client_secret_basic", "audiences": ["https://api.demo.example"], "web_origins": ["https://app.demo.example"]}' \
  http://localhost:3000/admin/tenants/demo/clients
```

```
HTTP/1.1 201 Created
x-request-id: 01a0e543-7878-71b4-9222-62e149311e9d
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 1800
Date: Sun, 27 Sep 2026 23:46:39 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a0e543-78ac-70c2-8a83-8f3e28c204e4","client_id":"demo-fields-check","name":"demo-fields-check","type":"confidential","enabled":true,"full_scope_allowed":false,"registration_origin":"operator","created_at":"2026-09-27T23:46:39.362Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":["https://api.demo.example"],"access_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"client_credentials_scopes":[],"web_origins":["https://app.demo.example"],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"builtin_admin":false,"service_subject_id":"01a0e543-7887-7984-a3f4-5f597a1cd408","scopes":[{"id":"01a0db22-1c49-77ff-a5fa-142643a0007b","name":"openid","assignment":"default"},{"id":"01a0db22-1c4e-7a48-8315-7c43645f6a9f","name":"profile","assignment":"default"},{"id":"01a0db22-1c50-7331-bf7e-b42d450e2722","name":"email","assignment":"default"},{"id":"01a0db22-1c51-7727-bbbf-0b638aff4a8c","name":"address","assignment":"default"},{"id":"01a0db22-1c52-7250-9cf8-64f1fa48b24b","name":"phone","assignment":"default"},{"id":"01a0db22-1c54-7d81-8481-01d0e0fdfb72","name":"roles","assignment":"default"},{"id":"01a0db22-1c56-7da8-8d78-5c6f6da9846f","name":"groups","assignment":"default"},{"id":"01a0db22-1c57-79be-98ea-a35bc621100b","name":"offline_access","assignment":"optional"}],"client_secret":"vC4lHpmvSJnagQ0RZeaB0TPiY9DQsQp4u3O21XUX1XY"}
```

`GET`ting it back shows both fields still set, from the row rather than the
create response — and now also carries `builtin_admin` and
`service_subject_id`, read from the same row a create response is:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/clients/01a0e543-78ac-70c2-8a83-8f3e28c204e4
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e543-8946-72b8-a38f-31c7ae586a9d
cache-control: no-store
etag: "64e7e5a995c551cc91032a937414575b23c4a7665155927b4c5e7082bddd78ed"
content-type: application/json; charset=utf-8
content-length: 1738
Date: Sun, 27 Sep 2026 23:46:43 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a0e543-78ac-70c2-8a83-8f3e28c204e4","client_id":"demo-fields-check","name":"demo-fields-check","type":"confidential","enabled":true,"full_scope_allowed":false,"registration_origin":"operator","created_at":"2026-09-27T23:46:39.362Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":["https://api.demo.example"],"access_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"client_credentials_scopes":[],"web_origins":["https://app.demo.example"],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"builtin_admin":false,"service_subject_id":"01a0e543-7887-7984-a3f4-5f597a1cd408","scopes":[{"id":"01a0db22-1c49-77ff-a5fa-142643a0007b","name":"openid","assignment":"default"},{"id":"01a0db22-1c4e-7a48-8315-7c43645f6a9f","name":"profile","assignment":"default"},{"id":"01a0db22-1c50-7331-bf7e-b42d450e2722","name":"email","assignment":"default"},{"id":"01a0db22-1c51-7727-bbbf-0b638aff4a8c","name":"address","assignment":"default"},{"id":"01a0db22-1c52-7250-9cf8-64f1fa48b24b","name":"phone","assignment":"default"},{"id":"01a0db22-1c54-7d81-8481-01d0e0fdfb72","name":"roles","assignment":"default"},{"id":"01a0db22-1c56-7da8-8d78-5c6f6da9846f","name":"groups","assignment":"default"},{"id":"01a0db22-1c57-79be-98ea-a35bc621100b","name":"offline_access","assignment":"optional"}]}
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
x-request-id: 01a0e542-e179-7d0a-9b03-1c9fd67cd6c5
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 155
Date: Sun, 27 Sep 2026 23:46:00 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Bad Request","status":400,"detail":"colour: colour is not a client field","instance":"01a0e542-e179-7d0a-9b03-1c9fd67cd6c5"}
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

The disable and delete guards further down read `builtin_admin`, and a
client's representation now carries it and `service_subject_id` too. This
create, the psql listing and the disable/delete/rotate blocks under
`PATCH /clients/{id}`, `DELETE /clients/{id}` and `POST /clients/{id}/secret`
below were recaptured together for that, against a tenant of their own,
`client-facts-demo`, created for them the same way `GET /admin/tenants`
above shows, as a new admin subject `field-facts-admin` in the system
tenant; the `demo`-tenant blocks between them (the amendment and
`If-Match` narrative) are unchanged, from an earlier, already-torn-down
stack, and say so where they appear:

```bash
curl -sS -D - -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"client_id": "demo-backend", "grant_types": ["client_credentials"], "token_endpoint_auth_method": "client_secret_basic"}' \
  http://localhost:3000/admin/tenants/client-facts-demo/clients
```

`201`, the whole client, the tenant's default scope assignments, and the
one-time secret. The `scopes` ids are `client-facts-demo`'s own, created
with the tenant above:

```
HTTP/1.1 201 Created
x-request-id: 01a0e544-4ad4-72ca-8cfd-1527b7764f81
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 1738
Date: Sun, 27 Sep 2026 23:47:33 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a0e544-4b27-7f48-b0ef-8bde8f19c378","client_id":"demo-backend","name":"demo-backend","type":"confidential","enabled":true,"full_scope_allowed":false,"registration_origin":"operator","created_at":"2026-09-27T23:47:33.233Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":[],"access_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"builtin_admin":false,"service_subject_id":"01a0e544-4af7-76d7-8d38-3743f21d1e0c","scopes":[{"id":"01a0e358-cee4-7fba-a335-268c8ab959e9","name":"openid","assignment":"default"},{"id":"01a0e358-cee5-75f5-a535-c5338eb7f2de","name":"profile","assignment":"default"},{"id":"01a0e358-cee6-7128-8632-ee78c48f0871","name":"email","assignment":"default"},{"id":"01a0e358-cee7-7bac-80a9-699c01de36bc","name":"address","assignment":"default"},{"id":"01a0e358-cee8-79a4-bfa3-ccd3f3a6f617","name":"phone","assignment":"default"},{"id":"01a0e358-cee9-7a50-96e3-d123f51b6827","name":"roles","assignment":"default"},{"id":"01a0e358-cee9-7a50-96e3-d1240fcd752d","name":"groups","assignment":"default"},{"id":"01a0e358-ceea-7434-ac57-90739d28612e","name":"offline_access","assignment":"optional"}],"client_secret":"cjbOyM7ptwsZ4F7klPeK9VrIFUJ5P1chXzmaLo3Z0Mg"}
```

`client_secret` is the only member of that object nothing reads back.
`service_subject_id` is a confidential client's own service account,
created alongside it; `builtin_admin` is `false` here and `true` on the
tenant's own `odudu-admin`, read from the same column the disable and
delete guards below check, not asserted — the psql listing under
`PATCH /clients/{id}` shows both rows.

The reserved `client_id`, refused against `demo` (this tenant's own history,
captured separately):

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
`demo-operator` (confidential) and `demo-spa` (public); recaptured after the
rebuild that added `builtin_admin` and `service_subject_id`, which is also
why this block, unlike most below it, shows `cache-control: no-store`:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/clients?client_id=DEMO&type=confidential&limit=1"
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e357-d283-7de4-88d7-766fdeb326d1
cache-control: no-store
link: </admin/tenants/demo/clients?limit=1&client_id=DEMO&type=confidential&cursor=eyJhZnRlciI6IjAxYTBkYmQ0LTAxZjgtNzVmZC05YWZmLTFhYmI4NDFjYjRiOSIsInNvcnQiOiJkZW1vLWJhY2tlbmQiLCJjb2xsZWN0aW9uIjoiY2xpZW50cyIsInRlbmFudElkIjoiMDFhMGRiMjItMWMzMi03ZDE3LWIzNTEtNjk3ZDc5MTEwMzNjIiwiZmlsdGVycyI6Ik9BZENoUUxJNEt5UGtUMUhLc05ESld5WDM4NS1YaWFsQktSbkNXOUNPZHMifQ.5eRgvj6hT2_V1Lq6V21m9mTuyo4-4DlrHiWpahxFiIU>; rel="next"
content-type: application/json; charset=utf-8
content-length: 2075
Date: Sun, 27 Sep 2026 14:49:38 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a0dbd4-01f8-75fd-9aff-1abb841cb4b9","client_id":"demo-backend","name":"demo-backend","type":"confidential","enabled":true,"full_scope_allowed":false,"registration_origin":"seeded","created_at":"2026-09-26T03:48:19.537Z","redirect_uris":["http://localhost:8080/callback"],"grant_types":["authorization_code","refresh_token","client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":[],"access_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"builtin_admin":false,"service_subject_id":"01a0dbd4-01d5-70b7-9523-150335086259","scopes":[{"id":"01a0db22-1c49-77ff-a5fa-142643a0007b","name":"openid","assignment":"default"},{"id":"01a0db22-1c4e-7a48-8315-7c43645f6a9f","name":"profile","assignment":"default"},{"id":"01a0db22-1c50-7331-bf7e-b42d450e2722","name":"email","assignment":"default"},{"id":"01a0db22-1c51-7727-bbbf-0b638aff4a8c","name":"address","assignment":"default"},{"id":"01a0db22-1c52-7250-9cf8-64f1fa48b24b","name":"phone","assignment":"default"},{"id":"01a0db22-1c54-7d81-8481-01d0e0fdfb72","name":"roles","assignment":"default"},{"id":"01a0db22-1c56-7da8-8d78-5c6f6da9846f","name":"groups","assignment":"default"},{"id":"01a0db22-1c57-79be-98ea-a35bc621100b","name":"offline_access","assignment":"optional"}]}],"next":"eyJhZnRlciI6IjAxYTBkYmQ0LTAxZjgtNzVmZC05YWZmLTFhYmI4NDFjYjRiOSIsInNvcnQiOiJkZW1vLWJhY2tlbmQiLCJjb2xsZWN0aW9uIjoiY2xpZW50cyIsInRlbmFudElkIjoiMDFhMGRiMjItMWMzMi03ZDE3LWIzNTEtNjk3ZDc5MTEwMzNjIiwiZmlsdGVycyI6Ik9BZENoUUxJNEt5UGtUMUhLc05ESld5WDM4NS1YaWFsQktSbkNXOUNPZHMifQ.5eRgvj6hT2_V1Lq6V21m9mTuyo4-4DlrHiWpahxFiIU"}
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
difference is the secret, present there and absent here. (This read shows
headers only, from `demo` — a different, already-torn-down stack than
`client-facts-demo` above; the two never share an id.) Not re-run for the
`cache-control: no-store` pass, for the same reason: that stack, and the
client this id names, are gone.

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

_(Not re-run for the `cache-control: no-store` pass: the client this
amends, and the stack it lived on, are gone.)_

Replaying the identical request — same `If-Match`, now one generation
stale — is refused and changes nothing:

```
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a0d703-349d-786d-9fc1-ac4631a105f5"}
```

**The two `409`s that disabling produces are told apart by one column, and
the admin API does not expose it**, so it is read from the database beside
them rather than asserted. `client-facts-demo` holds the two clients this
guard needs: its own built-in one, and `demo-backend` above:

```bash
docker compose exec -T postgres psql -U odudu -d odudu -c \
  "select client_id, builtin_admin, enabled from clients
     where tenant_id = '01a0e358-cee0-763b-8273-558be62ebebb' order by client_id;"
```

```
  client_id   | builtin_admin | enabled
--------------+---------------+---------
 demo-backend | f             | t
 odudu-admin  | t             | t
(2 rows)
```

`demo-backend`, `builtin_admin` false, disables — and the response is the
whole client, so `enabled` can be read back from it, alongside
`builtin_admin` itself:

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"enabled": false}' \
  http://localhost:3000/admin/tenants/client-facts-demo/clients/01a0e544-4b27-7f48-b0ef-8bde8f19c378
```

```
{"id":"01a0e544-4b27-7f48-b0ef-8bde8f19c378","client_id":"demo-backend","name":"demo-backend","type":"confidential","enabled":false,"full_scope_allowed":false,"registration_origin":"operator","created_at":"2026-09-27T23:47:33.233Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":[],"access_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"builtin_admin":false,"service_subject_id":"01a0e544-4af7-76d7-8d38-3743f21d1e0c","scopes":[{"id":"01a0e358-cee4-7fba-a335-268c8ab959e9","name":"openid","assignment":"default"},{"id":"01a0e358-cee5-75f5-a535-c5338eb7f2de","name":"profile","assignment":"default"},{"id":"01a0e358-cee6-7128-8632-ee78c48f0871","name":"email","assignment":"default"},{"id":"01a0e358-cee7-7bac-80a9-699c01de36bc","name":"address","assignment":"default"},{"id":"01a0e358-cee8-79a4-bfa3-ccd3f3a6f617","name":"phone","assignment":"default"},{"id":"01a0e358-cee9-7a50-96e3-d123f51b6827","name":"roles","assignment":"default"},{"id":"01a0e358-cee9-7a50-96e3-d1240fcd752d","name":"groups","assignment":"default"},{"id":"01a0e358-ceea-7434-ac57-90739d28612e","name":"offline_access","assignment":"optional"}]}
```

`odudu-admin`, `builtin_admin` true, the same request against the other id
in that listing, does not:

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"enabled": false}' \
  http://localhost:3000/admin/tenants/client-facts-demo/clients/01a0e358-cef6-78c2-a3fd-51399e4e1b48
```

```
{"type":"about:blank","title":"Conflict","status":409,"detail":"odudu-admin is this tenant's built-in admin client and cannot be disabled","instance":"01a0e359-65c4-754f-afeb-7b0258104fa7"}
```

## `DELETE /clients/{id}`

Requires `manage-clients`. Deletes the client and its OIDC configuration in
one statement — the
foreign key from `client_oidc_config` to `clients` cascades, so nothing
here deletes the config row a second time. `204` with no body on success,
`404` for an id that does not exist, and the same `409` built-in-admin
guard `PATCH` uses: the built-in client cannot be deleted any more than it
can be disabled. Every role scoped to the client goes with it, so a delete
whose roles reach an admin capability the caller does not hold is refused
with `403`
([a removal is judged by what it removes](#a-removal-is-judged-by-what-it-removes)),
as is one whose service account holds more than the caller
([the service account's ceiling](#the-service-accounts-ceiling)).

All three outcomes against `client-facts-demo`, in that order: the built-in
client, an id nothing holds, then `demo-backend` — its secret rotated
below first, since this is the same instance the rest of this section
disabled and rotated. A `404` carries no `detail` at all, only the status
and the request id:

```bash
curl -sS -D - -X DELETE \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/client-facts-demo/clients/01a0e358-cef6-78c2-a3fd-51399e4e1b48
```

```
{"type":"about:blank","title":"Conflict","status":409,"detail":"odudu-admin is this tenant's built-in admin client and cannot be deleted","instance":"01a0e545-18e2-7933-b82a-94a72560ba3a"}
{"type":"about:blank","title":"Not Found","status":404,"instance":"01a0e545-18f9-7fa9-a6c4-dac5e100a05e"}

HTTP/1.1 204 No Content
x-request-id: 01a0e545-190d-7938-8b58-30924a1e8828
cache-control: no-store
Date: Sun, 27 Sep 2026 23:48:26 GMT
Connection: keep-alive
Keep-Alive: timeout=72
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
  http://localhost:3000/admin/tenants/client-facts-demo/clients/01a0e544-4b27-7f48-b0ef-8bde8f19c378/secret
```

Captured immediately after the disable above, which is why `enabled` reads
`false` here: rotating a disabled client's secret is allowed, the guard
being on the built-in client rather than on a disabled one. `demo-backend`
was deleted afterward, in the `DELETE` section above.

```
{"id":"01a0e544-4b27-7f48-b0ef-8bde8f19c378","client_id":"demo-backend","name":"demo-backend","type":"confidential","enabled":false,"full_scope_allowed":false,"registration_origin":"operator","created_at":"2026-09-27T23:47:33.233Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":[],"access_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"builtin_admin":false,"service_subject_id":"01a0e544-4af7-76d7-8d38-3743f21d1e0c","scopes":[{"id":"01a0e358-cee4-7fba-a335-268c8ab959e9","name":"openid","assignment":"default"},{"id":"01a0e358-cee5-75f5-a535-c5338eb7f2de","name":"profile","assignment":"default"},{"id":"01a0e358-cee6-7128-8632-ee78c48f0871","name":"email","assignment":"default"},{"id":"01a0e358-cee7-7bac-80a9-699c01de36bc","name":"address","assignment":"default"},{"id":"01a0e358-cee8-79a4-bfa3-ccd3f3a6f617","name":"phone","assignment":"default"},{"id":"01a0e358-cee9-7a50-96e3-d123f51b6827","name":"roles","assignment":"default"},{"id":"01a0e358-cee9-7a50-96e3-d1240fcd752d","name":"groups","assignment":"default"},{"id":"01a0e358-ceea-7434-ac57-90739d28612e","name":"offline_access","assignment":"optional"}],"client_secret":"-YByClInh-ftcH8ApybVfAyFU66OLzHiLnebGt5F4Uk"}
```

### The service account's ceiling

**A confidential client authenticates as its service account, so every
route that mutates one client is held to the target ceiling on that
subject** — the one the [subjects' target ceiling](#the-target-ceiling)
applies to `/subjects/{id}`. That is `PATCH`, `DELETE` and `POST …/secret`
on `/clients/{id}`, and `PUT` and `DELETE` on
`/scopes/{id}/clients/{clientId}`. Without it, a caller holding only
`manage-clients` could rotate the secret of a client whose service account
holds `tenant-admin`, or swap its `jwks`, and then act as `tenant-admin`
through `client_credentials`. A caller missing any admin capability the
service account holds is refused with `403` naming what it lacks, before
anything else about the request is looked at, and the attempt writes a
`refused` row on the client (on the scope, for the two scope routes) with
`detail.denied`. A client with no service account, or one whose service
account holds no capability, is unaffected. `tests/target-ceiling.int.test.ts`
reads these routes from the route table too.

Captured against a tenant `ceiling-clients` created for it, holding three
`client_credentials` clients with the admin audience, each created through
`POST /clients`: `ops-robot`, whose service account was given
`manage-clients` through `PUT /subjects/:id/roles`, so `$OPS_TOKEN` is its
`client_credentials` token and carries that capability alone;
`root-robot` (`01a0e58a-ac43-7148-8881-6c3fdc6cf1ae`), whose service
account was given `tenant-admin` the same way; and `plain-robot`
(`01a0e58a-aca8-786f-a574-21674f047897`), whose service account holds
nothing. The rotation, a `jwks` swap and the delete on `root-robot` are
refused, a rotation on `plain-robot` is not, and the refused rows are the
three on `root-robot`:

```bash
ROOT=http://localhost:3000/admin/tenants/ceiling-clients/clients/01a0e58a-ac43-7148-8881-6c3fdc6cf1ae
curl -sS -X POST -H "Authorization: Bearer $OPS_TOKEN" "$ROOT/secret"
echo
curl -sS -X PATCH -H "Authorization: Bearer $OPS_TOKEN" -H 'content-type: application/json' \
  -d '{"jwks":{"keys":[]}}' "$ROOT"
echo
curl -sS -X DELETE -H "Authorization: Bearer $OPS_TOKEN" "$ROOT"
echo
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer $OPS_TOKEN" \
  http://localhost:3000/admin/tenants/ceiling-clients/clients/01a0e58a-aca8-786f-a574-21674f047897/secret
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/ceiling-clients/audit?resource_type=client&resource_id=01a0e58a-ac43-7148-8881-6c3fdc6cf1ae&outcome=refused"
echo
```

```
{"type":"about:blank","title":"Forbidden","status":403,"detail":"the client's service account holds what the caller does not: view-audit, manage-sessions, manage-keys, manage-tenant, manage-users, view-users","instance":"01a0e58a-cf29-709d-9802-4f44423e6326"}
{"type":"about:blank","title":"Forbidden","status":403,"detail":"the client's service account holds what the caller does not: view-audit, manage-sessions, manage-keys, manage-tenant, manage-users, view-users","instance":"01a0e58a-cf59-7be6-9f42-f3c8935d7152"}
{"type":"about:blank","title":"Forbidden","status":403,"detail":"the client's service account holds what the caller does not: view-audit, manage-sessions, manage-keys, manage-tenant, manage-users, view-users","instance":"01a0e58a-cf82-7fe7-9b0b-2d1ddc99a45f"}
200
{"items":[{"id":"01a0e58a-cf92-7f1d-8ace-8224c2aab302","occurred_at":"2026-09-28T01:04:34.701Z","event_type":"admin_mutation","action":"client.delete","outcome":"refused","actor_tenant_id":"01a0e58a-ab08-7733-92ed-2e54588af553","actor_subject_id":"01a0e58a-ab8f-7377-a87c-50e28671b6ee","actor_client_id":"01a0e58a-abee-7e81-ab83-51c418d622bd","resource_type":"client","resource_id":"01a0e58a-ac43-7148-8881-6c3fdc6cf1ae","request_id":"01a0e58a-cf82-7fe7-9b0b-2d1ddc99a45f","ip":"172.20.0.1","detail":{"denied":["view-audit","manage-sessions","manage-keys","manage-tenant","manage-users","view-users"]}},{"id":"01a0e58a-cf74-7295-9c54-9abb75615a75","occurred_at":"2026-09-28T01:04:34.670Z","event_type":"admin_mutation","action":"client.amend","outcome":"refused","actor_tenant_id":"01a0e58a-ab08-7733-92ed-2e54588af553","actor_subject_id":"01a0e58a-ab8f-7377-a87c-50e28671b6ee","actor_client_id":"01a0e58a-abee-7e81-ab83-51c418d622bd","resource_type":"client","resource_id":"01a0e58a-ac43-7148-8881-6c3fdc6cf1ae","request_id":"01a0e58a-cf59-7be6-9f42-f3c8935d7152","ip":"172.20.0.1","detail":{"denied":["view-audit","manage-sessions","manage-keys","manage-tenant","manage-users","view-users"]}},{"id":"01a0e58a-cf47-7573-8001-0dc35f83d319","occurred_at":"2026-09-28T01:04:34.626Z","event_type":"admin_mutation","action":"client.rotate_secret","outcome":"refused","actor_tenant_id":"01a0e58a-ab08-7733-92ed-2e54588af553","actor_subject_id":"01a0e58a-ab8f-7377-a87c-50e28671b6ee","actor_client_id":"01a0e58a-abee-7e81-ab83-51c418d622bd","resource_type":"client","resource_id":"01a0e58a-ac43-7148-8881-6c3fdc6cf1ae","request_id":"01a0e58a-cf29-709d-9802-4f44423e6326","ip":"172.20.0.1","detail":{"denied":["view-audit","manage-sessions","manage-keys","manage-tenant","manage-users","view-users"]}}]}
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
x-request-id: 01a0e54f-856d-7358-814e-3ea57c9969a3
cache-control: no-store
link: </admin/tenants/demo/subjects?limit=1&username=ADA&cursor=eyJhZnRlciI6IjAxYTBkYjIyLTFjOTItNzczMC05ZDM3LTQwODVmMjhlY2EyYyIsInNvcnQiOiJhZGEiLCJjb2xsZWN0aW9uIjoic3ViamVjdHMiLCJ0ZW5hbnRJZCI6IjAxYTBkYjIyLTFjMzItN2QxNy1iMzUxLTY5N2Q3OTExMDMzYyIsImZpbHRlcnMiOiJzWGl1TzdkZGVoRzhlYVUyUWkySWotRnJjVVAyMWVwTUJBWmxEc3FQYUVVIn0.B6FJzxJCoNTpoBieeq3YyEMKs61JZhl0gdcXVbNv8m0>; rel="next"
content-type: application/json; charset=utf-8
content-length: 478
Date: Sun, 27 Sep 2026 23:59:49 GMT
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

_(Not re-run for the `cache-control: no-store` pass: this is the first
stack's original creation of `ada`, and `demo` on this stack already holds
a different `ada` — created later, on the fourth stack — so replaying the
same username would conflict rather than reproduce this create.)_

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

_(Not re-run for the `cache-control: no-store` pass: this `ada`, from the
first stack, is gone.)_

## `PATCH /subjects/:id`

Requires `manage-users`. Amends `email` and `enabled` — and `username`,
where the tenant allows it (below) — the only general fields a subject
exposes; everything else about a subject (credentials, required actions,
roles) has its own door below. An `email` another subject in the tenant
already holds is refused with `409`, as on `POST /subjects`. Honours
`If-Match`, answering `412` on a mismatch, the same convention every other
amendment in this API follows — locked with `SELECT … FOR NO KEY UPDATE`
before the `ETag` is computed, so two concurrent amendments cannot both
pass the precondition. `NO KEY UPDATE` rather than `UPDATE`, as on every
admin route that mutates a subject: it still queues a second admin
mutation, but not a sign-in inserting a row that names the subject, which
takes a key-share lock and would otherwise deadlock against it. Held to the target ceiling
([`POST /subjects/:id/password`](#the-target-ceiling)), as every route that
mutates a subject is: refused with `403` when the subject holds an admin
capability the caller does not.

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

_(Not re-run for the `cache-control: no-store` pass: same reason as the
read above.)_

The `ETag` is the one `GET /subjects/:id` above returned, recomputed — a
caller that read before this write holds a stale one.

### Renaming a username

A username is not an identifier a relying party may key on — `sub` is
([ADR 0039](adr/0039-names-relying-parties-match-on-are-identifiers.md)) —
so it is renamable, through this same `PATCH`, behind the tenant setting
`username_editable`, `false` by default. With it off, `username` in the body
is refused with `400` naming the setting. With it on, the new name is held to
the rule creation holds one to (a non-empty string, `usernameSchema` in
`@odudu/contracts`), and `If-Match` is **mandatory** whenever `username` is
in the body — `428` without it, the precedent `redirect_uris` sets on
`PATCH /clients/{id}` — because one administrator's rename silently undoing
another's is what the precondition exists to stop. A name another subject
in the tenant holds refuses the whole request with `409`: the unique index
`users_username_unique` answers, outside the transaction, so nothing else
the same body asked for is applied either. That index is on
`(tenant_id, username)` and case-sensitive, so a case-variant of another
subject's name (`Ada` beside `ada`) is a distinct name and is accepted — as
it is on `POST /subjects` and at sign-in, which match a username exactly. A
rename to the name the subject already has, with nothing else in the body,
writes nothing and no audit row. An actual rename writes one
`subject.amend` row whose `detail` carries the before and after values.

Nothing keyed on the subject moves: sessions and refresh tokens hold `sub`,
so both keep working; the brute-force counter is keyed by subject rather
than by the name submitted, so a `login_failures` row survives the rename;
and `preferred_username` (and `name`, when no display name is set) carries
the new name on the next token issued. The old name stops signing in at
once. A password equal to the new username is not re-checked against
`password_not_username` until it is next changed, which is when every
password policy applies.

Captured against `infra/docker` after a rebuild of the `odudu` service that
applied `0077_username_editable.sql`, as a new system admin `ada-rename`
(`seed admin`), in a tenant `rename-demo` created for it through
`POST /admin/tenants`, on a subject `grace` seeded with a real password
(`odudu seed user`), a second subject `ada` created through
`POST /subjects`, and a confidential client `rename-demo-app` created
through `POST /clients` with `https://app.example/callback` registered and
the `authorization_code` and `refresh_token` grants; `$CLIENT_SECRET` is the
secret that create returned. `$GRACE` is `01a0e37c-9f28-77e3-8579-d0907e90b1c3`, and `signin` is the
helper [`DELETE /subjects/:id/lockout`](#delete-subjectsidlockout) defines,
pointed at this client with `profile` in the scope and taking the username
as its argument:

```bash
AUTHORIZE='http://localhost:3000/tenants/rename-demo/protocol/openid-connect/auth?response_type=code&client_id=rename-demo-app&redirect_uri=https%3A%2F%2Fapp.example%2Fcallback&scope=openid%20profile&state=xyz&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256'
signin() {
  sid=$(curl -sS "$AUTHORIZE" | sed -n 's/.*name="auth_session_id" value="\([^"]*\)".*/\1/p' | head -1)
  curl -sS -D - -o body.html \
    --data-urlencode "auth_session_id=$sid" \
    --data-urlencode "username=$1" \
    --data-urlencode "password=correct horse battery staple" \
    http://localhost:3000/tenants/rename-demo/login-actions/authenticate | grep -iE '^(HTTP|location)'
  grep -o '<title>[^<]*</title>' body.html || true
}
```

With the setting still at its default, the rename is refused:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: *' \
  -d '{"username": "grace-hopper"}' \
  http://localhost:3000/admin/tenants/rename-demo/subjects/$GRACE
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a0e37d-0a3a-718b-89b3-3188904fa3e9
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 193
Date: Sun, 27 Sep 2026 15:30:17 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Bad Request","status":400,"detail":"username: this tenant has not enabled username editing (username_editable)","instance":"01a0e37d-0a3a-718b-89b3-3188904fa3e9"}
```

Turning it on — `PATCH /settings` reaches it too — then signing `grace`
in and redeeming the code, keeping the refresh token:

```bash
docker compose exec -T odudu node dist/main.js seed tenant --name rename-demo --set username_editable=true 2>/dev/null

loc=$(signin grace | tee /dev/stderr | tr -d '\r' | sed -n 's/^location: //p')
code=$(echo "$loc" | sed -n 's/.*code=\([^&]*\).*/\1/p')
REFRESH_TOKEN=$(curl -sS -u "rename-demo-app:$CLIENT_SECRET" \
  --data-urlencode grant_type=authorization_code --data-urlencode "code=$code" \
  --data-urlencode redirect_uri=https://app.example/callback \
  --data-urlencode code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk \
  http://localhost:3000/tenants/rename-demo/protocol/openid-connect/token | sed -n 's/.*"refresh_token":"\([^"]*\)".*/\1/p')
echo "refresh token length ${#REFRESH_TOKEN}"
```

```
{"command":"tenant","created":false,"tenant":"rename-demo","tenantId":"01a0e37c-9ce6-79d3-a088-ba646b0b9917","settings":["username_editable"]}
HTTP/1.1 302 Found
location: https://app.example/callback?code=u7NfghfY65Cv_CMaF2GmK_AibKzovcN84Y0Lz1Nvb7k&state=xyz&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Frename-demo
refresh token length 43
```

Without `If-Match`, the rename is refused and nothing changes:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username": "grace-hopper"}' \
  http://localhost:3000/admin/tenants/rename-demo/subjects/$GRACE
```

```
HTTP/1.1 428 Precondition Required
x-request-id: 01a0e37d-0d3d-71b8-b54b-58bf801044f4
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 181
Date: Sun, 27 Sep 2026 15:30:18 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to replace a subject's username","instance":"01a0e37d-0d3d-71b8-b54b-58bf801044f4"}
```

Reading the subject for its `ETag`, then renaming under it:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/rename-demo/subjects/$GRACE

curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "07c46668d99ac4e0d32d58908d78d5d04ea89d0eaf03470bdd5662d830f63c08"' \
  -d '{"username": "grace-hopper"}' \
  http://localhost:3000/admin/tenants/rename-demo/subjects/$GRACE
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e37d-0d59-7a31-813e-162ee1bb2c3d
cache-control: no-store
etag: "07c46668d99ac4e0d32d58908d78d5d04ea89d0eaf03470bdd5662d830f63c08"
content-type: application/json; charset=utf-8
content-length: 146
Date: Sun, 27 Sep 2026 15:30:18 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a0e37c-9f28-77e3-8579-d0907e90b1c3","type":"user","username":"grace","email":null,"enabled":true,"created_at":"2026-09-27T15:29:50.369Z"}

HTTP/1.1 200 OK
x-request-id: 01a0e37d-0d71-7b2c-8918-ddf9dca2a612
cache-control: no-store
etag: "dc0ac68013546a9ca613220ddfc34b73e5d99e8b681c651bcecb0a6d22c07d81"
content-type: application/json; charset=utf-8
content-length: 153
Date: Sun, 27 Sep 2026 15:30:18 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a0e37c-9f28-77e3-8579-d0907e90b1c3","type":"user","username":"grace-hopper","email":null,"enabled":true,"created_at":"2026-09-27T15:29:50.369Z"}
```

The refresh token `grace` held before the rename still redeems, and the
access token it buys reads the new name back from `/userinfo`:

```bash
ACCESS_TOKEN=$(curl -sS -u "rename-demo-app:$CLIENT_SECRET" \
  --data-urlencode grant_type=refresh_token \
  --data-urlencode "refresh_token=$REFRESH_TOKEN" \
  http://localhost:3000/tenants/rename-demo/protocol/openid-connect/token | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
echo "access token length ${#ACCESS_TOKEN}"
curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" \
  http://localhost:3000/tenants/rename-demo/protocol/openid-connect/userinfo
```

```
access token length 691
{"sub":"01a0e37c-9f28-77e3-8579-d0907e90b1c3","name":"grace-hopper","preferred_username":"grace-hopper"}
```

The old name no longer signs in with the right password; the new one does:

```bash
signin grace
signin grace-hopper
```

```
HTTP/1.1 200 OK
<title>Sign in</title>
HTTP/1.1 302 Found
location: https://app.example/callback?code=tVn0xzcPENRQ4yAfzhtOoiiJ85cWXohi4NgdgtE2eAQ&state=xyz&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Frename-demo
```

Renaming to `ada`, which the other subject holds, with an email change in
the same body — refused, and a read afterwards shows neither applied and
the `ETag` unchanged:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "dc0ac68013546a9ca613220ddfc34b73e5d99e8b681c651bcecb0a6d22c07d81"' \
  -d '{"username": "ada", "email": "grace@rename.example"}' \
  http://localhost:3000/admin/tenants/rename-demo/subjects/$GRACE

curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/rename-demo/subjects/$GRACE
```

```
HTTP/1.1 409 Conflict
x-request-id: 01a0e37d-0e85-76d4-a49e-833f42b3e389
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 154
Date: Sun, 27 Sep 2026 15:30:18 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"the username \"ada\" is already in use","instance":"01a0e37d-0e85-76d4-a49e-833f42b3e389"}

HTTP/1.1 200 OK
x-request-id: 01a0e37d-0eb3-7a56-bfc2-68761f0d90ba
cache-control: no-store
etag: "dc0ac68013546a9ca613220ddfc34b73e5d99e8b681c651bcecb0a6d22c07d81"
content-type: application/json; charset=utf-8
content-length: 153
Date: Sun, 27 Sep 2026 15:30:18 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a0e37c-9f28-77e3-8579-d0907e90b1c3","type":"user","username":"grace-hopper","email":null,"enabled":true,"created_at":"2026-09-27T15:29:50.369Z"}
```

`Ada`, a case-variant of that same name, is a different name to
`users_username_unique`, and is accepted under the same `ETag`:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "dc0ac68013546a9ca613220ddfc34b73e5d99e8b681c651bcecb0a6d22c07d81"' \
  -d '{"username": "Ada"}' \
  http://localhost:3000/admin/tenants/rename-demo/subjects/$GRACE
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e37d-0ecc-7554-bf0c-c15ec0474da2
cache-control: no-store
etag: "59790dd68519f35537ae76289a644b4caf1ebbcd47c933830b8f719b7b1c4501"
content-type: application/json; charset=utf-8
content-length: 144
Date: Sun, 27 Sep 2026 15:30:18 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a0e37c-9f28-77e3-8579-d0907e90b1c3","type":"user","username":"Ada","email":null,"enabled":true,"created_at":"2026-09-27T15:29:50.369Z"}
```

The audit trail for `grace` holds the two renames and nothing for the
refused ones — the `409` rolled back with its transaction, and the `400`
and `428` were refused before anything was written:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/rename-demo/audit?resource_type=subject&resource_id=$GRACE"
```

```
{"items":[{"id":"01a0e37d-0eda-744c-a075-5b44532dba6a","occurred_at":"2026-09-27T15:30:18.966Z","event_type":"admin_mutation","action":"subject.amend","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0e37a-fb97-78b3-91a4-9404635be93e","actor_client_id":"01a0dc0c-0130-7dd6-a9d5-c867c3577f62","resource_type":"subject","resource_id":"01a0e37c-9f28-77e3-8579-d0907e90b1c3","request_id":"01a0e37d-0ecc-7554-bf0c-c15ec0474da2","ip":"172.20.0.1","detail":{"username":{"after":"Ada","before":"grace-hopper"}}},{"id":"01a0e37d-0d81-7dc1-a749-5e486aa7a340","occurred_at":"2026-09-27T15:30:18.619Z","event_type":"admin_mutation","action":"subject.amend","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0e37a-fb97-78b3-91a4-9404635be93e","actor_client_id":"01a0dc0c-0130-7dd6-a9d5-c867c3577f62","resource_type":"subject","resource_id":"01a0e37c-9f28-77e3-8579-d0907e90b1c3","request_id":"01a0e37d-0d71-7b2c-8918-ddf9dca2a612","ip":"172.20.0.1","detail":{"username":{"after":"grace-hopper","before":"grace"}}}]}
```

## `GET /subjects/:id/profile` and `PATCH /subjects/:id/profile`

The read requires `view-users`, the write `manage-users`. Every OIDC
Core §5.1 claim column `users` carries, in the snake_case a claim itself
uses — `email_verified` and `phone_number_verified` beside them, both
writable here, and `profile_updated_at` last, stamped by the write and
never accepted from one. `email` and `username` are refused with `400`,
naming `PATCH /subjects/:id` above, which is the door that owns each; any
other member this schema does not carry is refused the same way, by ajv,
before either usecase runs. `If-Match` is optional, not mandatory: honoured
against a stale value with `412`, but never required with `428` the way a
replace-the-whole-list route requires it — a profile patches field by
field, so nothing here can reinstate what a concurrent write removed. An
id naming a service or `agent_instance` subject — one with no `users`
row — answers `404`, the same as one that does not exist at all.

**Submitting a different `phone_number` without also setting
`phone_number_verified` in the same request resets it to `false`.** A
different number is not a verified one — the same reasoning `updateEmail`
resets `email_verified` to `false` whenever `PATCH /subjects/:id` changes
the address. Resubmitting the same number — an echoed full-object
`PATCH`, say — leaves a verified flag exactly as it was.

Captured against the fourth stack, after a further rebuild, in a tenant of
its own, `profile-demo2`, on a fresh subject `grace`:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/profile-demo2/subjects/01a0e277-e90a-7876-926a-b433ce61d250/profile
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e547-2b15-7670-ae92-02b8e9908ee0
cache-control: no-store
etag: "89eee16f2b512c80447670ad49fb70fe65db78a9c41a4fa4bf5e3db6d43ee154"
content-type: application/json; charset=utf-8
content-length: 481
Date: Sun, 27 Sep 2026 23:50:41 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"name":null,"given_name":null,"family_name":null,"middle_name":null,"nickname":null,"preferred_username":null,"profile":null,"picture":null,"website":null,"gender":null,"birthdate":null,"zoneinfo":null,"locale":null,"phone_number":null,"phone_number_verified":false,"email_verified":false,"address_formatted":null,"address_street":null,"address_locality":null,"address_region":null,"address_postal_code":null,"address_country":null,"profile_updated_at":"2026-09-27T23:50:36.116Z"}
```

Amending `given_name` and `family_name` stamps `profile_updated_at`:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"given_name": "Grace", "family_name": "Hopper"}' \
  http://localhost:3000/admin/tenants/profile-demo2/subjects/01a0e277-e90a-7876-926a-b433ce61d250/profile
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e547-2b2e-778d-9e34-27579c864153
cache-control: no-store
etag: "aefc948e4d8f2d7760fb5c2128aad70532e78b41c0154c739aa7b0fc6fc34378"
content-type: application/json; charset=utf-8
content-length: 488
Date: Sun, 27 Sep 2026 23:50:41 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"name":null,"given_name":"Grace","family_name":"Hopper","middle_name":null,"nickname":null,"preferred_username":null,"profile":null,"picture":null,"website":null,"gender":null,"birthdate":null,"zoneinfo":null,"locale":null,"phone_number":null,"phone_number_verified":false,"email_verified":false,"address_formatted":null,"address_street":null,"address_locality":null,"address_region":null,"address_postal_code":null,"address_country":null,"profile_updated_at":"2026-09-27T23:50:41.728Z"}
```

`email_verified` is set the same way, against the address `PATCH
/subjects/:id` owns (a prior call there set it to `grace@example.com`):

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email_verified": true}' \
  http://localhost:3000/admin/tenants/profile-demo2/subjects/01a0e277-e90a-7876-926a-b433ce61d250/profile
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e547-2b52-728e-8ee6-66c374744e5f
cache-control: no-store
etag: "c259cc5c1665ca05b130f21449a01b5bbcf9c5ccae407ff1c43ed5e0a9dc6985"
content-type: application/json; charset=utf-8
content-length: 487
Date: Sun, 27 Sep 2026 23:50:41 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"name":null,"given_name":"Grace","family_name":"Hopper","middle_name":null,"nickname":null,"preferred_username":null,"profile":null,"picture":null,"website":null,"gender":null,"birthdate":null,"zoneinfo":null,"locale":null,"phone_number":null,"phone_number_verified":false,"email_verified":true,"address_formatted":null,"address_street":null,"address_locality":null,"address_region":null,"address_postal_code":null,"address_country":null,"profile_updated_at":"2026-09-27T23:50:41.782Z"}
```

`email` in the same body is refused, naming the route that owns it instead
of `about:blank`'s usual bare wording:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email": "someone-else@example.com"}' \
  http://localhost:3000/admin/tenants/profile-demo2/subjects/01a0e277-e90a-7876-926a-b433ce61d250/profile
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a0e547-2b84-7f00-bb1c-fe44458667f9
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 221
Date: Sun, 27 Sep 2026 23:50:41 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Bad Request","status":400,"detail":"email: email is amended through PATCH /admin/tenants/{tenant}/subjects/{id}, not a subject’s profile","instance":"01a0e547-2b84-7f00-bb1c-fe44458667f9"}
```

Verifying a well-shaped number:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "+14155552671", "phone_number_verified": true}' \
  http://localhost:3000/admin/tenants/profile-demo2/subjects/01a0e277-e90a-7876-926a-b433ce61d250/profile
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e547-4bb2-740b-9545-5552114faa8c
cache-control: no-store
etag: "79e6637e8dce86bf009affff462a1ab69fa0cf94d21f3fbfae877ec71c0adb26"
content-type: application/json; charset=utf-8
content-length: 496
Date: Sun, 27 Sep 2026 23:50:50 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"name":null,"given_name":"Grace","family_name":"Hopper","middle_name":null,"nickname":null,"preferred_username":null,"profile":null,"picture":null,"website":null,"gender":null,"birthdate":null,"zoneinfo":null,"locale":null,"phone_number":"+14155552671","phone_number_verified":true,"email_verified":true,"address_formatted":null,"address_street":null,"address_locality":null,"address_region":null,"address_postal_code":null,"address_country":null,"profile_updated_at":"2026-09-27T23:50:50.072Z"}
```

Submitting a different number, with no `phone_number_verified` in the
body, resets it — the rule stated above, shown rather than only asserted:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "+442083661177"}' \
  http://localhost:3000/admin/tenants/profile-demo2/subjects/01a0e277-e90a-7876-926a-b433ce61d250/profile
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e547-4bed-7ba2-8f0c-93fcf7f89fee
cache-control: no-store
etag: "7fa28e5a48761a7ec3dee2a5022f92b32fef01fa2a10a0f2ac94c3202833766a"
content-type: application/json; charset=utf-8
content-length: 498
Date: Sun, 27 Sep 2026 23:50:50 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"name":null,"given_name":"Grace","family_name":"Hopper","middle_name":null,"nickname":null,"preferred_username":null,"profile":null,"picture":null,"website":null,"gender":null,"birthdate":null,"zoneinfo":null,"locale":null,"phone_number":"+442083661177","phone_number_verified":false,"email_verified":true,"address_formatted":null,"address_street":null,"address_locality":null,"address_region":null,"address_postal_code":null,"address_country":null,"profile_updated_at":"2026-09-27T23:50:50.114Z"}
```

After re-verifying that same number, resubmitting it — an echoed
full-object `PATCH`, say, which carries `phone_number` on every call
whether or not it changed — leaves `phone_number_verified` exactly as it
was, because the submitted value is compared against the stored one, not
merely checked for presence:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phone_number_verified": true}' \
  http://localhost:3000/admin/tenants/profile-demo2/subjects/01a0e277-e90a-7876-926a-b433ce61d250/profile
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e547-4c11-77a2-b446-fc99f2003d15
cache-control: no-store
etag: "aff9c3a5c78bb68b2afc724e43278c86673c405b56abc4dc47af252e0e9e9799"
content-type: application/json; charset=utf-8
content-length: 497
Date: Sun, 27 Sep 2026 23:50:50 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"name":null,"given_name":"Grace","family_name":"Hopper","middle_name":null,"nickname":null,"preferred_username":null,"profile":null,"picture":null,"website":null,"gender":null,"birthdate":null,"zoneinfo":null,"locale":null,"phone_number":"+442083661177","phone_number_verified":true,"email_verified":true,"address_formatted":null,"address_street":null,"address_locality":null,"address_region":null,"address_postal_code":null,"address_country":null,"profile_updated_at":"2026-09-27T23:50:50.143Z"}
```

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "+442083661177"}' \
  http://localhost:3000/admin/tenants/profile-demo2/subjects/01a0e277-e90a-7876-926a-b433ce61d250/profile
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e547-4c2d-7def-a747-d1dba8d58b68
cache-control: no-store
etag: "aff9c3a5c78bb68b2afc724e43278c86673c405b56abc4dc47af252e0e9e9799"
content-type: application/json; charset=utf-8
content-length: 497
Date: Sun, 27 Sep 2026 23:50:50 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"name":null,"given_name":"Grace","family_name":"Hopper","middle_name":null,"nickname":null,"preferred_username":null,"profile":null,"picture":null,"website":null,"gender":null,"birthdate":null,"zoneinfo":null,"locale":null,"phone_number":"+442083661177","phone_number_verified":true,"email_verified":true,"address_formatted":null,"address_street":null,"address_locality":null,"address_region":null,"address_postal_code":null,"address_country":null,"profile_updated_at":"2026-09-27T23:50:50.143Z"}
```

The `ETag` and `profile_updated_at` are unchanged from the call before —
nothing was written at all, `phone_number` included, since the value it
carried was already there.

`amendProfile` (`packages/protocol-admin/src/usecase/profile.ts`) computes
the row's final state — this patch's values layered over what is already
there — before writing anything, so verifying a malformed number is
refused without ever reaching `users_verified_phone_is_e164`
(`packages/db/drizzle/0024_verified_phone_is_e164.sql`) or writing a
number the caller asked to leave unverified. `isValidE164`
(`packages/domain-identity/src/service/profile.ts`) mirrors that CHECK,
the same way `isValidBirthdate` mirrors `users_birthdate_shape`:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "(415) 555-2671", "phone_number_verified": true}' \
  http://localhost:3000/admin/tenants/profile-demo2/subjects/01a0e277-e90a-7876-926a-b433ce61d250/profile
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a0e547-4c44-74b8-89e5-8a86fb82abc9
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 203
Date: Sun, 27 Sep 2026 23:50:50 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Bad Request","status":400,"detail":"phone_number: phone_number must be E.164-shaped for phone_number_verified to be true","instance":"01a0e547-4c44-74b8-89e5-8a86fb82abc9"}
```

## `DELETE /subjects/:id`

Requires `manage-users`. Removes the subject; every table that names one
(`users`, `user_credentials`, `sessions`, `token_grants`,
`subject_roles`, …) cascades, except a client whose service account named
it — `clients_service_subject_fk` (`packages/db/drizzle/0063_service_subject_fk.sql`)
detaches the client (`service_subject_id` goes `null`) rather than failing
or deleting it. An unknown id answers `404`, and a subject holding an admin
capability the caller does not is refused with `403`
([the target ceiling](#the-target-ceiling)).

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
unknown id, or one belonging to a different subject, answers `404`, and a
subject holding an admin capability the caller does not is refused with
`403` ([the target ceiling](#the-target-ceiling)).

## `GET /subjects/:id/consents` and `DELETE /subjects/:id/consents/:clientId`

The read requires `view-users`, the delete `manage-users`. A consent is what
the consent screen (`packages/protocol-oidc/src/usecase/consent-submission.ts`)
records when a `consent_required` client asks and a subject allows — bounded
per subject the same way `GET /subjects/:id/credentials` is, so this list
carries no cursor either. Each entry names the client by both ids: `client_id`
is its row id, what `:clientId` on the delete names, and `client_key` its own
OAuth `client_id` string, the one an operator actually recognises.
`scope_names` is every scope currently granted, and `granted_at` is when the
grant, as it now reads, was last written — the consent screen replaces the
whole granted set on every submission (`consentRepository.record`'s own
comment, `packages/domain-tenant/src/repository/consents.ts`), so this is
never older than the most recent consent decision. `DELETE` withdraws the
grant outright: the row and every scope under it are gone, `consent_scopes`
cascading on `consents.id` (`packages/db/drizzle/0046_consents.sql`), and the
next `/authorize` that reaches this client finds nothing recorded and asks
again. An unknown subject on the read, or a subject with no consent to that
client on the delete, answers `404`.

**Revoking a consent also revokes every token issued under it, live or
offline.** An `offline_access` family rotates indefinitely — bounded only
by its own TTL per rotation, never by the consent it was first granted
under (`refresh-rotation.ts`'s own comment on `grant.sessionId === null`)
— so leaving it alone would mean a subject who revoked access is still
impersonated by whatever refresh token that client already holds. This
route revokes the grant in the same transaction it deletes the consent:
the next refresh answers `invalid_grant`, and an outstanding access token
introspects `active: false`, immediately, not at its own expiry.
`tokenGrantRepository.revokeForSubjectClient` is the same idempotent
`coalesce(revoked_at, …)` write `revokeForSession` already makes for a
session's own grants (`docs/phases/p4d.md` has why this write scans
`token_grants` with no index on `(subject_id, client_id)`, and why that is
fine here). Demonstrated below, on the same stack.

Captured against a tenant `consents-demo2` made for this section, on a
confidential client `consents-demo-app2` created with `consent_required`
true and a subject `grace` seeded with a real password (`odudu seed user`,
so no `update-password` detour is needed first). `/authorize`, asking for
`offline_access` too, followed by logging in:

```bash
curl -sS \
  'http://localhost:3000/tenants/consents-demo2/protocol/openid-connect/auth?response_type=code&client_id=consents-demo-app2&redirect_uri=https%3A%2F%2Fapp.example%2Fcallback&scope=openid%20offline_access&state=xyz&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256'

curl -sS \
  --data-urlencode "auth_session_id=01a0e558-b0a9-763b-84f8-f348efaacd53" \
  --data-urlencode "username=grace" \
  --data-urlencode "password=correct horse battery staple" \
  'http://localhost:3000/tenants/consents-demo2/login-actions/authenticate'
```

The consent screen, `openid` shown as already implied and `offline_access`
the one box the subject can grant:

```
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Allow access?</title></head>
<body>
<h1>consents-demo-app2 is asking for access</h1>
<form method="post" action="/tenants/consents-demo2/login-actions/consent">
  <input type="hidden" name="auth_session_id" value="01a0e558-b0a9-763b-84f8-f348efaacd53">
  <ul>
  <li>openid</li>
  </ul>
  <label><input type="checkbox" name="scope" value="offline_access"> offline_access — grants ongoing access, even while you are not present</label>
  <button type="submit" name="decision" value="allow">Allow</button>
  <button type="submit" name="decision" value="deny">Deny</button>
</form>
</body>
</html>
```

Allowing both scopes, then redeeming the code for an access and refresh
token:

```bash
curl -sS -D - -c jar -b jar \
  --data-urlencode "auth_session_id=01a0e558-b0a9-763b-84f8-f348efaacd53" \
  --data-urlencode "decision=allow" \
  --data-urlencode "scope=offline_access" \
  'http://localhost:3000/tenants/consents-demo2/login-actions/consent'

curl -sS -X POST \
  --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "code=SInvyBACjbt6xBEec6hT1Way6Fpm4tj_6SEyiZr3dEM" \
  --data-urlencode "redirect_uri=https://app.example/callback" \
  --data-urlencode "code_verifier=a5e606dca6f98d0037ee563f4c510264114ab7bd5b9cc0c5eb3fecbcfbf9f046" \
  -u "consents-demo-app2:PaTErX2vTk6H_-eAP-1xOIh2BHMOp6dPekxmkisf-gg" \
  'http://localhost:3000/tenants/consents-demo2/protocol/openid-connect/token'
```

```
HTTP/1.1 302 Found
x-request-id: 01a0e558-ce27-7849-80eb-a2d2dcf6a18a
set-cookie: consents-demo2-session=01a0e558-ce34-74a4-a8ac-7da0e3702e69:7pi1cgx3w7uKV4Afg2Aq_3M4snQunDoUOl7OmUaLNvc; HttpOnly; SameSite=Lax; Path=/
set-cookie: consents-demo2-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
location: https://app.example/callback?code=SInvyBACjbt6xBEec6hT1Way6Fpm4tj_6SEyiZr3dEM&state=xyz&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fconsents-demo2
content-length: 0
Date: Mon, 28 Sep 2026 00:09:57 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"access_token":"eyJhbGciOiJFUzI1NiIsImtpZCI6IjAxYTBlMmM4LTI1MzQtNzNmZC05ZGY4LThiZTllNmQxODVkNiIsInR5cCI6ImF0K2p3dCJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAvdGVuYW50cy9jb25zZW50cy1kZW1vMiIsInN1YiI6IjAxYTBlMmM4LTRkNDctN2E4NC1iOTQ3LTVlZjFiOTZhN2M2ZSIsImF1ZCI6WyJodHRwOi8vbG9jYWxob3N0OjMwMDAvdGVuYW50cy9jb25zZW50cy1kZW1vMiJdLCJjbGllbnRfaWQiOiJjb25zZW50cy1kZW1vLWFwcDIiLCJzY29wZSI6Im9wZW5pZCBvZmZsaW5lX2FjY2VzcyIsImlhdCI6MTc5MDU1NDE5NywiZXhwIjoxNzkwNTU0NDk3LCJqdGkiOiIwMWEwZTU1OC1jZTZmLTczM2UtOWExYy0zNTkzYmE0MjVkM2YiLCJncmFudF9pZCI6IjAxYTBlNTU4LWNlNmYtNzMzZS05YTFjLTM1OTI3M2ZhMzNlOCJ9.SG-i141R0VlhhniXUdotW7d5S_lcEp_4DMsqjP6fnNA_njayv3T_Va1lTFpEHpfy40kvflSXqSNh6RjfQ1-ZlA","id_token":"eyJhbGciOiJFUzI1NiIsImtpZCI6IjAxYTBlMmM4LTI1MzQtNzNmZC05ZGY4LThiZTllNmQxODVkNiJ9.eyJzdWIiOiIwMWEwZTJjOC00ZDQ3LTdhODQtYjk0Ny01ZWYxYjk2YTdjNmUiLCJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAvdGVuYW50cy9jb25zZW50cy1kZW1vMiIsImF1ZCI6ImNvbnNlbnRzLWRlbW8tYXBwMiIsImlhdCI6MTc5MDU1NDE5NywiZXhwIjoxNzkwNTU0NDk3fQ.ZMBPf8vMkVTBEoARSrjDmzaSu9cD8LWzySTs1sLPpeOoUce8Ox823BPia5FE-TuNfKvSC1U56Nic1VvZapFZvg","refresh_token":"D0_gfIdY5BVJ0_BebFj_wBD_Ze55TFnmc9pBbn1f_l8","token_type":"Bearer","expires_in":300,"scope":"openid offline_access"}
```

`GET /subjects/:id/consents` shows what was granted — `openid` is implied,
never ticked, and appears here anyway:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/consents-demo2/subjects/01a0e2c8-4d47-7a84-b947-5ef1b96a7c6e/consents
```

```
{"items":[{"client_id":"01a0e2c8-35b0-7767-a5ee-d2b6f29258e2","client_key":"consents-demo-app2","scope_names":["openid","offline_access"],"granted_at":"2026-09-28T00:09:57.550Z"}]}
```

Revoking it:

```bash
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/consents-demo2/subjects/01a0e2c8-4d47-7a84-b947-5ef1b96a7c6e/consents/01a0e2c8-35b0-7767-a5ee-d2b6f29258e2
```

```
HTTP/1.1 204 No Content
x-request-id: 01a0e558-e849-7fb9-b904-65507dbb75a1
cache-control: no-store
Date: Mon, 28 Sep 2026 00:10:04 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The refresh token minted before the revoke now answers `invalid_grant` —
the revoke reached it, not only the consent:

```bash
curl -sS -D - -X POST \
  --data-urlencode "grant_type=refresh_token" \
  --data-urlencode "refresh_token=D0_gfIdY5BVJ0_BebFj_wBD_Ze55TFnmc9pBbn1f_l8" \
  -u "consents-demo-app2:PaTErX2vTk6H_-eAP-1xOIh2BHMOp6dPekxmkisf-gg" \
  'http://localhost:3000/tenants/consents-demo2/protocol/openid-connect/token'
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a0e559-025e-7e11-9dc2-daccca70dae4
vary: Origin
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8
content-length: 25
Date: Mon, 28 Sep 2026 00:10:10 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"error":"invalid_grant"}
```

The access token minted alongside it introspects inactive, ahead of its own
`exp`:

```bash
curl -sS -X POST \
  --data-urlencode "token=eyJhbGciOiJFUzI1NiIsImtpZCI6IjAxYTBlMmM4LTI1MzQtNzNmZC05ZGY4LThiZTllNmQxODVkNiIsInR5cCI6ImF0K2p3dCJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAvdGVuYW50cy9jb25zZW50cy1kZW1vMiIsInN1YiI6IjAxYTBlMmM4LTRkNDctN2E4NC1iOTQ3LTVlZjFiOTZhN2M2ZSIsImF1ZCI6WyJodHRwOi8vbG9jYWxob3N0OjMwMDAvdGVuYW50cy9jb25zZW50cy1kZW1vMiJdLCJjbGllbnRfaWQiOiJjb25zZW50cy1kZW1vLWFwcDIiLCJzY29wZSI6Im9wZW5pZCBvZmZsaW5lX2FjY2VzcyIsImlhdCI6MTc5MDU1NDE5NywiZXhwIjoxNzkwNTU0NDk3LCJqdGkiOiIwMWEwZTU1OC1jZTZmLTczM2UtOWExYy0zNTkzYmE0MjVkM2YiLCJncmFudF9pZCI6IjAxYTBlNTU4LWNlNmYtNzMzZS05YTFjLTM1OTI3M2ZhMzNlOCJ9.SG-i141R0VlhhniXUdotW7d5S_lcEp_4DMsqjP6fnNA_njayv3T_Va1lTFpEHpfy40kvflSXqSNh6RjfQ1-ZlA" \
  -u "consents-demo-app2:PaTErX2vTk6H_-eAP-1xOIh2BHMOp6dPekxmkisf-gg" \
  'http://localhost:3000/tenants/consents-demo2/protocol/openid-connect/token/introspect'
```

```
{"active":false}
```

A fresh login for the same client, after the revoke, stops at the consent
screen again rather than redirecting straight to a code:

```bash
curl -sS \
  'http://localhost:3000/tenants/consents-demo2/protocol/openid-connect/auth?response_type=code&client_id=consents-demo-app2&redirect_uri=https%3A%2F%2Fapp.example%2Fcallback&scope=openid%20offline_access&state=xyz&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256'

curl -sS \
  --data-urlencode "auth_session_id=01a0e559-2045-7007-9e06-58a4406e6007" \
  --data-urlencode "username=grace" \
  --data-urlencode "password=correct horse battery staple" \
  'http://localhost:3000/tenants/consents-demo2/login-actions/authenticate'
```

```
<form method="post" action="/tenants/consents-demo2/login-actions/consent">
```

The same read again — the list is empty — and a repeat of the delete
answers `404`:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/consents-demo2/subjects/01a0e2c8-4d47-7a84-b947-5ef1b96a7c6e/consents

curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/consents-demo2/subjects/01a0e2c8-4d47-7a84-b947-5ef1b96a7c6e/consents/01a0e2c8-35b0-7767-a5ee-d2b6f29258e2
```

```
{"items":[]}
HTTP/1.1 404 Not Found
x-request-id: 01a0e559-3dc0-7ac8-8559-3cd7fe3a816f
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 105
Date: Mon, 28 Sep 2026 00:10:26 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Not Found","status":404,"instance":"01a0e559-3dc0-7ac8-8559-3cd7fe3a816f"}
```

An unknown subject on the read answers `404`:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/consents-demo2/subjects/0199aa00-0000-7000-8000-0000000000ff/consents
```

```
HTTP/1.1 404 Not Found
x-request-id: 01a0e559-3dd9-7b6f-8091-e483704fa066
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 164
Date: Mon, 28 Sep 2026 00:10:26 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Not Found","status":404,"detail":"no subject 0199aa00-0000-7000-8000-0000000000ff","instance":"01a0e559-3dd9-7b6f-8091-e483704fa066"}
```

## `DELETE /subjects/:id/lockout`

Requires `manage-users`. Deletes the subject's `login_failures` row — the
same write a correct password accepted by an unlocked account makes — so
the lockout ends and the run of failures behind it with it: the next wrong
password counts from one. It answers `204` whether or not anything was
recorded against the subject, since "nothing against it" is the state the
call exists to reach, and its `subject.lockout_clear` audit row says which
it was in `detail.cleared`. An unknown subject, one in another tenant, or a
subject with no `users` row — a service or `agent_instance` subject, which
has no sign-in to be locked out of — answers `404`.

A locked account refuses its right password with the same sign-in page a
wrong one gets (README.md's brute-force section), so the run below shows
the lock by submitting the right password last. `signin` is a helper
defined for these captures: a fresh `/authorize` against
`recovery-demo-app`, a confidential client created for them with
`https://app.example/callback` registered, then one password submission as
`hana`, printing the status, any `location`, and the page's title.

```bash
AUTHORIZE='http://localhost:3000/tenants/recovery-demo/protocol/openid-connect/auth?response_type=code&client_id=recovery-demo-app&redirect_uri=https%3A%2F%2Fapp.example%2Fcallback&scope=openid&state=xyz&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256'
signin() {
  sid=$(curl -sS "$AUTHORIZE" | sed -n 's/.*name="auth_session_id" value="\([^"]*\)".*/\1/p' | head -1)
  curl -sS -D - -o body.html \
    --data-urlencode "auth_session_id=$sid" \
    --data-urlencode "username=hana" \
    --data-urlencode "password=$1" \
    http://localhost:3000/tenants/recovery-demo/login-actions/authenticate | grep -iE '^(HTTP|location)'
  grep -o '<title>[^<]*</title>' body.html || true
}

for attempt in 1 2 3 4 5; do signin 'not the password'; done
signin 'correct horse battery staple'
```

Five wrong passwords, then the right one, refused the same way:

```
HTTP/1.1 200 OK
<title>Sign in</title>
HTTP/1.1 200 OK
<title>Sign in</title>
HTTP/1.1 200 OK
<title>Sign in</title>
HTTP/1.1 200 OK
<title>Sign in</title>
HTTP/1.1 200 OK
<title>Sign in</title>
HTTP/1.1 200 OK
<title>Sign in</title>
```

Clearing it, then the right password — a code, at once, with no wait —
then a second sign-in, which the section on ending every session below
uses:

```bash
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/recovery-demo/subjects/01a0e303-9db3-712d-9272-98d2c2a04320/lockout
signin 'correct horse battery staple'

signin 'correct horse battery staple'
```

```
HTTP/1.1 204 No Content
x-request-id: 01a0e304-78e0-7003-90f4-53ed807b3fd4
cache-control: no-store
Date: Sun, 27 Sep 2026 13:18:36 GMT
Connection: keep-alive
Keep-Alive: timeout=72

HTTP/1.1 302 Found
location: https://app.example/callback?code=h09v7JRpqx_2QP43pO0iFb-Mi_-y5-uvQ_dLO9R1yEM&state=xyz&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Frecovery-demo
HTTP/1.1 302 Found
location: https://app.example/callback?code=dIaPGsUTiYp47Ypkl8FuoxachQAgewGPjxhS7Uy0nT4&state=xyz&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Frecovery-demo
```

## `POST /subjects/:id/password`

Requires `manage-users`, and takes no body. An administrator restoring a
subject's access never chooses the password: the server generates one —
the same 24 random bytes, base64url, that `odudu seed admin` prints
(`generateOneTimePassword`, `packages/domain-identity/src/service/one-time-password.ts`)
— replaces the subject's password credential with its hash, or creates one
for a subject who had none, and owes `update-password`, so the next sign-in
with it parks on the change-password page. The password is in this `201`
response's body and nowhere else: never stored in the clear, never logged
(the request logger records a response's status and allowlisted headers,
never its body — `apps/server/src/logger.ts`), and the
`subject.password_issue` audit row's `detail` is empty.
`apps/server/tests/seed-admin.int.test.ts` searches every captured log line
and every audit row for it.

Three things are done alongside it. **Any lockout is cleared**: an
administrator restoring access is not the attacker a lockout exists to
slow down, and a password nobody can spend helps nobody. **Every
outstanding reset-password link is retired**, as a redeemed reset retires
its siblings, so a link mailed before the account was recovered cannot
reopen it. And the change it forces is held to the tenant's password
policy, while the issued password itself is not: the policy governs a
password somebody chooses, and a sign-in only verifies a password against
its hash.

Like a redeemed reset link (`completePasswordReset`,
`packages/account/src/usecase/reset-password.ts`), it **ends no session and
revokes no grant**: a subject already signed in somewhere stays signed in
there. **For a compromised account, issue the password and then end every
session** (`DELETE /subjects/:id/sessions`, below). Neither reaches a grant
bound to no session: an `offline_access` refresh token survives both, and
is revoked per client through `DELETE /subjects/:id/consents/:clientId`.

A subject with no `users` row — a service or `agent_instance` subject,
which has no sign-in to restore — answers `404`, the same as an unknown
subject or one in another tenant.

### The target ceiling

**Every route that mutates one subject refuses a caller who does not hold
every admin capability that subject holds.** That is every non-`GET` route
under `/admin/tenants/{tenant}/subjects/{id}`: `PATCH` and `DELETE` on the
subject itself, `PATCH …/profile`, `DELETE …/credentials/{credentialId}`,
`DELETE …/consents/{clientId}`, `POST …/password`, `DELETE …/lockout`,
`PUT …/required-actions`, `PUT …/roles`, `PUT …/groups`, `DELETE …/sessions`
and `DELETE …/sessions/{sid}`. It is the reverse of the ceiling
`PUT /subjects/:id/roles` enforces on what a caller grants, and it applies
to roles and groups as well as that one: a ceiling only on doors that take
an account over would leave the demotion that comes first open, since
`PUT …/roles` with an empty list checks nothing it grants, and a
`tenant-admin` emptied of its roles has nothing left for any later check to
compare. The rule is checked first, under the subject's row lock, by one
function (`targetOverreach`,
`packages/protocol-admin/src/service/capability-ceiling.ts`), which
resolves the target's capabilities through `effectiveRoles` — groups, their
ancestors and composites included — and compares them with the caller's
own. A caller missing any of them is refused with `403` naming what it
lacks, and the attempt writes a `refused` row under the action it
attempted, with `detail.denied`. A caller holding everything the target
holds — a `tenant-admin` acting on another — is admitted, and so is anybody
with the route's own capability acting on a subject holding none.
`tests/target-ceiling.int.test.ts` reads the routes it sweeps from the route
table, so a new mutating route under `/subjects/{id}` without the check
fails it. A client's service account is held to the same ceiling by every
route that mutates the client
([the service account's ceiling](#the-service-accounts-ceiling)).

### Captured

After the two sections on either side of this one, against the same
`hana`, locked out again first — the same five wrong passwords, and the
right one refused:

```bash
for attempt in 1 2 3 4 5; do signin 'not the password'; done
signin 'correct horse battery staple'

curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/recovery-demo/subjects/01a0e303-9db3-712d-9272-98d2c2a04320/password
echo
```

```
HTTP/1.1 200 OK
<title>Sign in</title>
HTTP/1.1 200 OK
<title>Sign in</title>
HTTP/1.1 200 OK
<title>Sign in</title>
HTTP/1.1 200 OK
<title>Sign in</title>
HTTP/1.1 200 OK
<title>Sign in</title>
HTTP/1.1 200 OK
<title>Sign in</title>
HTTP/1.1 201 Created
x-request-id: 01a0e304-e89b-7b63-977c-5ee041f0256a
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 47
Date: Sun, 27 Sep 2026 13:19:04 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"password":"pW6gZTlq-xIQGIYgB9BfvU6NbNyxcrfp"}
```

The password is a throwaway on a development stack, and the rest of this
section spends it. It signs in as far as the change-password page with no
wait, although the account was locked a moment ago; the change returns the
sign-in page, as it does for `seed admin`'s password in "Getting the
token"; the new password gets a code; and neither the issued password nor
the one `hana` had before still signs anybody in. `signin` leaves the
`auth_session_id` it used in `$sid`.

```bash
signin 'pW6gZTlq-xIQGIYgB9BfvU6NbNyxcrfp'
curl -sS -o body.html -w '%{http_code}\n' \
  --data-urlencode "auth_session_id=$sid" \
  --data-urlencode "password=tulip-orbit-harbour-58" \
  'http://localhost:3000/tenants/recovery-demo/login-actions/required-action?action=update-password'
grep -o '<title>[^<]*</title>' body.html
signin 'tulip-orbit-harbour-58'
signin 'pW6gZTlq-xIQGIYgB9BfvU6NbNyxcrfp'
signin 'correct horse battery staple'
```

```
HTTP/1.1 200 OK
<title>Change your password</title>
200
<title>Sign in</title>
HTTP/1.1 302 Found
location: https://app.example/callback?code=kEyYyT7ukiYIwCShkZAUNGJkimfiFQX_7ZArlDzthtQ&state=xyz&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Frecovery-demo
HTTP/1.1 200 OK
<title>Sign in</title>
HTTP/1.1 200 OK
<title>Sign in</title>
```

The ceiling, from `mo` — seeded in `recovery-demo` and given
`manage-users` there through `PUT /subjects/:id/roles`, so `$MO_TOKEN`
carries `manage-users` and the `view-users` it composites — against `lin`,
given `tenant-admin` the same way. The password, disabling the account and
deleting it, each refused, and `lin` left as it was:

```bash
curl -sS -X POST -H "Authorization: Bearer $MO_TOKEN" \
  http://localhost:3000/admin/tenants/recovery-demo/subjects/01a0e303-cd42-76f3-92bd-9f1f860bc8a0/password
echo

curl -sS -X PATCH -H "Authorization: Bearer $MO_TOKEN" -H 'content-type: application/json' \
  -d '{"enabled":false}' \
  http://localhost:3000/admin/tenants/recovery-demo/subjects/01a0e303-cd42-76f3-92bd-9f1f860bc8a0
echo

curl -sS -X DELETE -H "Authorization: Bearer $MO_TOKEN" \
  http://localhost:3000/admin/tenants/recovery-demo/subjects/01a0e303-cd42-76f3-92bd-9f1f860bc8a0
echo
```

```
{"type":"about:blank","title":"Forbidden","status":403,"detail":"the subject holds what the caller does not: manage-clients, manage-tenant, manage-keys, manage-sessions, view-audit","instance":"01a0e305-352c-7c19-98f0-ac995ff67ab6"}
{"type":"about:blank","title":"Forbidden","status":403,"detail":"the subject holds what the caller does not: manage-clients, manage-tenant, manage-keys, manage-sessions, view-audit","instance":"01a0e305-3545-7f28-9e64-6ebcebd9bda8"}
{"type":"about:blank","title":"Forbidden","status":403,"detail":"the subject holds what the caller does not: manage-clients, manage-tenant, manage-keys, manage-sessions, view-audit","instance":"01a0e305-355e-7948-94aa-bd9f7b23958d"}
```

The demotion that would come first, refused the same way, from the same
`mo` against the same `lin` — captured after a further rebuild made the
ceiling uniform — then `lin`'s roles, unchanged, and the two `refused` rows
it and a lockout clear wrote:

```bash
LIN=http://localhost:3000/admin/tenants/recovery-demo/subjects/01a0e303-cd42-76f3-92bd-9f1f860bc8a0
ETAG=$(curl -sS -D - -o /dev/null -H "Authorization: Bearer $MO_TOKEN" "$LIN/roles" | tr -d '\r' | sed -n 's/^etag: //p')
curl -sS -X PUT -H "Authorization: Bearer $MO_TOKEN" -H 'content-type: application/json' \
  -H "If-Match: $ETAG" -d '{"role_ids":[]}' "$LIN/roles"
echo
curl -sS -X DELETE -H "Authorization: Bearer $MO_TOKEN" "$LIN/lockout"
echo
curl -sS -H "Authorization: Bearer $MO_TOKEN" "$LIN/roles"
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3000/admin/tenants/recovery-demo/audit?event_type=admin_mutation&outcome=refused&limit=2'
echo
```

```
{"type":"about:blank","title":"Forbidden","status":403,"detail":"the subject holds what the caller does not: manage-clients, manage-tenant, manage-keys, manage-sessions, view-audit","instance":"01a0e31b-dfd1-7dbe-9d21-1820c8e9b418"}
{"type":"about:blank","title":"Forbidden","status":403,"detail":"the subject holds what the caller does not: manage-clients, manage-tenant, manage-keys, manage-sessions, view-audit","instance":"01a0e31b-dff3-78b3-be4a-18252929ff0e"}
{"items":[{"id":"01a0e2e7-2b82-7a71-85ba-c29a1fda737a","name":"tenant-admin"}]}
{"items":[{"id":"01a0e31b-e016-796a-98cf-0ab185eebe10","occurred_at":"2026-09-27T13:44:09.994Z","event_type":"admin_mutation","action":"subject.lockout_clear","outcome":"refused","actor_tenant_id":"01a0e2e7-2b73-7aa6-9b99-9e959d2ed2af","actor_subject_id":"01a0e303-cb74-73df-a5d4-034c577a4a93","actor_client_id":"01a0e2e7-2b7b-7ee3-af15-f175f6271d5e","resource_type":"subject","resource_id":"01a0e303-cd42-76f3-92bd-9f1f860bc8a0","request_id":"01a0e31b-dff3-78b3-be4a-18252929ff0e","ip":"172.20.0.1","detail":{"denied":["manage-clients","manage-tenant","manage-keys","manage-sessions","view-audit"]}},{"id":"01a0e31b-dfe7-7c3b-ad70-ddb4f9b3af59","occurred_at":"2026-09-27T13:44:09.956Z","event_type":"admin_mutation","action":"subject.roles_set","outcome":"refused","actor_tenant_id":"01a0e2e7-2b73-7aa6-9b99-9e959d2ed2af","actor_subject_id":"01a0e303-cb74-73df-a5d4-034c577a4a93","actor_client_id":"01a0e2e7-2b7b-7ee3-af15-f175f6271d5e","resource_type":"subject","resource_id":"01a0e303-cd42-76f3-92bd-9f1f860bc8a0","request_id":"01a0e31b-dfd1-7dbe-9d21-1820c8e9b418","ip":"172.20.0.1","detail":{"denied":["manage-clients","manage-tenant","manage-keys","manage-sessions","view-audit"]}}],"next":"eyJhZnRlciI6IjIwMjYtMDktMjdUMTM6NDQ6MDkuOTU2WnwwMWEwZTMxYi1kZmU3LTdjM2ItYWQ3MC1kZGI0ZjliM2FmNTkiLCJjb2xsZWN0aW9uIjoiYXVkaXQiLCJ0ZW5hbnRJZCI6IjAxYTBlMmU3LTJiNzMtN2FhNi05Yjk5LTllOTU5ZDJlZDJhZiIsImZpbHRlcnMiOiJVZDFzeWdzd19Oblp0UzJDZ2dXQk91dVc3UE5YT29TVFlRakVMdDlBN1JZIn0.Xa4G3go3J0il9gOWxX1d9GOvvlH7QrqXHwgmCKXvmv8"}
```

`ada-recovery` is a subject of the system tenant, not of `recovery-demo`,
so addressing it here is addressing another tenant's subject:

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/recovery-demo/subjects/01a0e2e6-9e0a-721e-8def-3f749480e8c9/password
echo
```

```
{"type":"about:blank","title":"Not Found","status":404,"detail":"no user subject 01a0e2e6-9e0a-721e-8def-3f749480e8c9","instance":"01a0e305-3574-7a1e-a164-aa64d106082b"}
```

The rows these sections wrote, newest first — the three refusals with
`detail.denied`, then the issue with an empty `detail`, the end of every
session, the lockout clear, and `lin`'s role assignment from the setup —
and the service's own log searched for the issued password. Bounded with
`to=` at a point between this capture and the ceiling demonstration
recaptured further above, since an unscoped `limit=7` now surfaces that
later demonstration's own rows instead of these:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3000/admin/tenants/recovery-demo/audit?event_type=admin_mutation&to=2026-09-27T13:20:00.000Z&limit=7'
echo

docker compose logs odudu | grep -c 'pW6gZTlq-xIQGIYgB9BfvU6NbNyxcrfp'
```

```
{"items":[{"id":"01a0e305-3569-77bd-aeeb-87cf4f51038b","occurred_at":"2026-09-27T13:19:24.519Z","event_type":"admin_mutation","action":"subject.delete","outcome":"refused","actor_tenant_id":"01a0e2e7-2b73-7aa6-9b99-9e959d2ed2af","actor_subject_id":"01a0e303-cb74-73df-a5d4-034c577a4a93","actor_client_id":"01a0e2e7-2b7b-7ee3-af15-f175f6271d5e","resource_type":"subject","resource_id":"01a0e303-cd42-76f3-92bd-9f1f860bc8a0","request_id":"01a0e305-355e-7948-94aa-bd9f7b23958d","ip":"172.20.0.1","detail":{"denied":["manage-clients","manage-tenant","manage-keys","manage-sessions","view-audit"]}},{"id":"01a0e305-3554-7cb6-9005-349e526d3a8e","occurred_at":"2026-09-27T13:19:24.497Z","event_type":"admin_mutation","action":"subject.amend","outcome":"refused","actor_tenant_id":"01a0e2e7-2b73-7aa6-9b99-9e959d2ed2af","actor_subject_id":"01a0e303-cb74-73df-a5d4-034c577a4a93","actor_client_id":"01a0e2e7-2b7b-7ee3-af15-f175f6271d5e","resource_type":"subject","resource_id":"01a0e303-cd42-76f3-92bd-9f1f860bc8a0","request_id":"01a0e305-3545-7f28-9e64-6ebcebd9bda8","ip":"172.20.0.1","detail":{"denied":["manage-clients","manage-tenant","manage-keys","manage-sessions","view-audit"]}},{"id":"01a0e305-353a-71a5-adf9-b3421f5d3c03","occurred_at":"2026-09-27T13:19:24.471Z","event_type":"admin_mutation","action":"subject.password_issue","outcome":"refused","actor_tenant_id":"01a0e2e7-2b73-7aa6-9b99-9e959d2ed2af","actor_subject_id":"01a0e303-cb74-73df-a5d4-034c577a4a93","actor_client_id":"01a0e2e7-2b7b-7ee3-af15-f175f6271d5e","resource_type":"subject","resource_id":"01a0e303-cd42-76f3-92bd-9f1f860bc8a0","request_id":"01a0e305-352c-7c19-98f0-ac995ff67ab6","ip":"172.20.0.1","detail":{"denied":["manage-clients","manage-tenant","manage-keys","manage-sessions","view-audit"]}},{"id":"01a0e304-e8c8-7bf5-9898-590d7c69afb7","occurred_at":"2026-09-27T13:19:04.868Z","event_type":"admin_mutation","action":"subject.password_issue","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0e2e6-9e0a-721e-8def-3f749480e8c9","actor_client_id":"01a0dc0c-0130-7dd6-a9d5-c867c3577f62","resource_type":"subject","resource_id":"01a0e303-9db3-712d-9272-98d2c2a04320","request_id":"01a0e304-e89b-7b63-977c-5ee041f0256a","ip":"172.20.0.1","detail":{}},{"id":"01a0e304-c9a2-7c55-912b-17f4fb999480","occurred_at":"2026-09-27T13:18:56.923Z","event_type":"admin_mutation","action":"session.end_all","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0e2e6-9e0a-721e-8def-3f749480e8c9","actor_client_id":"01a0dc0c-0130-7dd6-a9d5-c867c3577f62","resource_type":"subject","resource_id":"01a0e303-9db3-712d-9272-98d2c2a04320","request_id":"01a0e304-c992-7ce0-a32d-345ffe41df00","ip":"172.20.0.1","detail":{"ended":2}},{"id":"01a0e304-78ea-762f-b1ff-bf39aa9b48ac","occurred_at":"2026-09-27T13:18:36.265Z","event_type":"admin_mutation","action":"subject.lockout_clear","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0e2e6-9e0a-721e-8def-3f749480e8c9","actor_client_id":"01a0dc0c-0130-7dd6-a9d5-c867c3577f62","resource_type":"subject","resource_id":"01a0e303-9db3-712d-9272-98d2c2a04320","request_id":"01a0e304-78e0-7003-90f4-53ed807b3fd4","ip":"172.20.0.1","detail":{"cleared":true}},{"id":"01a0e304-288e-7876-98f1-f6af5d9654fb","occurred_at":"2026-09-27T13:18:15.690Z","event_type":"admin_mutation","action":"subject.roles_set","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0e2e6-9e0a-721e-8def-3f749480e8c9","actor_client_id":"01a0dc0c-0130-7dd6-a9d5-c867c3577f62","resource_type":"subject","resource_id":"01a0e303-cd42-76f3-92bd-9f1f860bc8a0","request_id":"01a0e304-287e-7a72-86a9-39ef6e2e4de2","ip":"172.20.0.1","detail":{}}],"next":"eyJhZnRlciI6IjIwMjYtMDktMjdUMTM6MTg6MTUuNjkwWnwwMWEwZTMwNC0yODhlLTc4NzYtOThmMS1mNmFmNWQ5NjU0ZmIiLCJjb2xsZWN0aW9uIjoiYXVkaXQiLCJ0ZW5hbnRJZCI6IjAxYTBlMmU3LTJiNzMtN2FhNi05Yjk5LTllOTU5ZDJlZDJhZiIsImZpbHRlcnMiOiJWcHJKd0NwQ1FtRHBRR1F2RXEtLW4xYXo2ZTZ4dzZSNXBBSUlOTkFuNFc0In0.ApTkp2G9mTzPCG_hqT_t9bGH8xxr8v6LT-BFAW_Z2H8"}
0
```

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

_(Not re-run for the `cache-control: no-store` pass: this `grace`, and the
second stack she lived on, are gone.)_

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

_(Not re-run for the same reason as the read above.)_

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
`effectiveRoles` immediately. Before any of that, the target ceiling
([`POST /subjects/:id/password`](#the-target-ceiling)) refuses a caller who
does not hold every capability the subject already holds — so an empty
list cannot demote a `tenant-admin` out from under the check that would
otherwise protect it.

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

_(Not re-run for the `cache-control: no-store` pass: this `grace`, and the
second stack she lived on, are gone.)_

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
cannot resubmit a membership it could not itself have granted. And the
target ceiling ([`POST /subjects/:id/password`](#the-target-ceiling))
comes first: a subject holding a capability the caller does not cannot
have any membership changed by that caller, removals included.

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
`PUT /subjects/:id/roles`; `$ADMIN_TOKEN` is `ada-whoami`'s. The two blocks
below that write `mei`'s groups were recaptured, still on this same
tenant and not rebuilt, against a second subject `mei2` created for that
recapture, after a fresh one-time password was issued for `helpdesk`
through `POST /subjects/:id/password` and `$HELPDESK_TOKEN` reminted from
it — the tag over an empty membership list still hashes to the same
`"eef46741…"` either way, so nothing about the demonstration changes. The
refusal
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

The read, then a write with no `If-Match`, then `helpdesk` putting `mei2`
in `oncall`:

```bash
curl -sS -D - -H "Authorization: Bearer $HELPDESK_TOKEN" \
  http://localhost:3000/admin/tenants/groups-demo/subjects/01a0e5e2-07fd-7ecb-95e3-b88f72beea50/groups

curl -sS -D - -X PUT \
  -H "Authorization: Bearer $HELPDESK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"group_ids": ["01a0e1e2-c454-7927-aedb-05021d226885"]}' \
  http://localhost:3000/admin/tenants/groups-demo/subjects/01a0e5e2-07fd-7ecb-95e3-b88f72beea50/groups

curl -sS -D - -X PUT \
  -H "Authorization: Bearer $HELPDESK_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"' \
  -d '{"group_ids": ["01a0e1e2-e2e0-7809-8ac4-debf2d93bc4e"]}' \
  http://localhost:3000/admin/tenants/groups-demo/subjects/01a0e5e2-07fd-7ecb-95e3-b88f72beea50/groups
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e5e2-39e9-7820-8bfe-28ac196fe103
cache-control: no-store
etag: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"
content-type: application/json; charset=utf-8
content-length: 12
Date: Mon, 28 Sep 2026 02:40:03 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[]}

HTTP/1.1 428 Precondition Required
x-request-id: 01a0e5e2-3a0b-7239-94a6-efa7fff79d7f
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 181
Date: Mon, 28 Sep 2026 02:40:03 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to replace a subject’s groups","instance":"01a0e5e2-3a0b-7239-94a6-efa7fff79d7f"}

HTTP/1.1 403 Forbidden
x-request-id: 01a0e5e2-3a30-7e1c-bce2-9f5ec3063c7a
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 228
Date: Mon, 28 Sep 2026 02:40:03 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Forbidden","status":403,"detail":"the caller does not hold: tenant-admin, manage-clients, manage-tenant, manage-keys, manage-sessions, view-audit","instance":"01a0e5e2-3a30-7e1c-bce2-9f5ec3063c7a"}
```

`oncall` names no role, and is refused for everything `tenant-admin`
composites that `helpdesk` does not hold — reached through its parent.
The membership is still empty, under the same tag, so the same `If-Match`
then puts `mei2` in `support`, and replaying it once that has landed is
stale:

```bash
curl -sS -D - -H "Authorization: Bearer $HELPDESK_TOKEN" \
  http://localhost:3000/admin/tenants/groups-demo/subjects/01a0e5e2-07fd-7ecb-95e3-b88f72beea50/groups

curl -sS -D - -X PUT \
  -H "Authorization: Bearer $HELPDESK_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"' \
  -d '{"group_ids": ["01a0e1e2-c454-7927-aedb-05021d226885"]}' \
  http://localhost:3000/admin/tenants/groups-demo/subjects/01a0e5e2-07fd-7ecb-95e3-b88f72beea50/groups

curl -sS -D - -X PUT \
  -H "Authorization: Bearer $HELPDESK_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"' \
  -d '{"group_ids": []}' \
  http://localhost:3000/admin/tenants/groups-demo/subjects/01a0e5e2-07fd-7ecb-95e3-b88f72beea50/groups
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e5e2-5c85-7cb3-a94d-85f99f3c479d
cache-control: no-store
etag: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"
content-type: application/json; charset=utf-8
content-length: 12
Date: Mon, 28 Sep 2026 02:40:12 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[]}

HTTP/1.1 200 OK
x-request-id: 01a0e5e2-5c9e-7c85-b27c-f11dc53e6163
cache-control: no-store
etag: "aaafe7626c56bdd2b2064141ca8f224733f7aa8d3b87a77ac22357774cb65700"
content-type: application/json; charset=utf-8
content-length: 149
Date: Mon, 28 Sep 2026 02:40:12 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a0e1e2-c454-7927-aedb-05021d226885","name":"support","parent_id":null,"path":"/support","created_at":"2026-09-27T08:02:10.132Z"}]}

HTTP/1.1 412 Precondition Failed
x-request-id: 01a0e5e2-5cc0-7940-929b-90d08a10ddc0
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 153
Date: Mon, 28 Sep 2026 02:40:12 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a0e5e2-5cc0-7940-929b-90d08a10ddc0"}
```

Both writes that reached the ceiling are in the trail, scoped here to
`mei2` — the refusal naming what was denied, the replacement the ids
before and after:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3000/admin/tenants/groups-demo/audit?action=subject.groups_set&resource_type=subject&resource_id=01a0e5e2-07fd-7ecb-95e3-b88f72beea50'
```

```
{"items":[{"id":"01a0e5e2-5cb3-75fa-9014-82e12e4803d2","occurred_at":"2026-09-28T02:40:12.458Z","event_type":"admin_mutation","action":"subject.groups_set","outcome":"allowed","actor_tenant_id":"01a0e1e2-208f-7b7e-a30f-a2ce461cd164","actor_subject_id":"01a0e1e2-5d2c-7676-8177-2fb711b0eac0","actor_client_id":"01a0e1e2-209b-7b1d-9bc2-07b9bec41a60","resource_type":"subject","resource_id":"01a0e5e2-07fd-7ecb-95e3-b88f72beea50","request_id":"01a0e5e2-5c9e-7c85-b27c-f11dc53e6163","ip":"172.20.0.1","detail":{"group_ids":{"after":["01a0e1e2-c454-7927-aedb-05021d226885"],"before":[]}}},{"id":"01a0e5e2-3a4a-7cb2-acfa-af378bb43a51","occurred_at":"2026-09-28T02:40:03.648Z","event_type":"admin_mutation","action":"subject.groups_set","outcome":"refused","actor_tenant_id":"01a0e1e2-208f-7b7e-a30f-a2ce461cd164","actor_subject_id":"01a0e1e2-5d2c-7676-8177-2fb711b0eac0","actor_client_id":"01a0e1e2-209b-7b1d-9bc2-07b9bec41a60","resource_type":"subject","resource_id":"01a0e5e2-07fd-7ecb-95e3-b88f72beea50","request_id":"01a0e5e2-3a30-7e1c-bce2-9f5ec3063c7a","ip":"172.20.0.1","detail":{"denied":["tenant-admin","manage-clients","manage-tenant","manage-keys","manage-sessions","view-audit"]}}]}
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

_(Not re-run for the `cache-control: no-store` pass: this `bob`, and the
first stack he lived on, are gone.)_

## `DELETE /subjects/:id/sessions`

Requires `manage-sessions`, like the rest of this family. Ends every live
session the subject holds, each through the same `endSession` the
single-session `DELETE` above calls — so each has every grant it holds
revoked, a Back-Channel Logout Token enqueued for each registered client
that used it and has a `backchannel_logout_uri`, and its own
`session.ended` row with `detail.via` `admin`, exactly as ending it alone
would. The sessions are locked first, so a concurrent single-session end
waits for this one rather than racing it. The answer is how many were
ended, `{"ended": n}`, and the one `session.end_all` row this writes
carries the same count in `detail.ended`, filed on the subject. A subject
with no live session answers `{"ended":0}`; an unknown subject, or one in
another tenant, answers `404`. As with ending one session, a grant bound to
no session — an `offline_access` refresh token — is not a session's to
revoke, and is left alone; `DELETE /subjects/:id/consents/:clientId` is
what reaches it.

Captured after `DELETE /subjects/:id/lockout`, against the same `hana` and
`recovery-demo-app`. The two codes the sign-ins there bought, redeemed,
each response cut to its refresh token:

```bash
redeem() {
  curl -sS \
    --data-urlencode "grant_type=authorization_code" \
    --data-urlencode "code=$1" \
    --data-urlencode "redirect_uri=https://app.example/callback" \
    --data-urlencode "code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk" \
    -u "recovery-demo-app:oNxj0NLDbXAVWohwuHXVUI_sHgnrfIJMuAk28Kl8WCU" \
    'http://localhost:3000/tenants/recovery-demo/protocol/openid-connect/token' | grep -o '"refresh_token":"[^"]*"'
}
redeem h09v7JRpqx_2QP43pO0iFb-Mi_-y5-uvQ_dLO9R1yEM
redeem dIaPGsUTiYp47Ypkl8FuoxachQAgewGPjxhS7Uy0nT4
```

```
"refresh_token":"thiT9DnRT_NtwhsWgwbFHSxBBRXv19484ncl7K1_3Vc"
"refresh_token":"CukLcH9hRCYKI6uWDiTIWP1h6o5MoZdAhwmwgNKAh14"
```

Two live sessions, each holding a grant. Listing them, ending them,
listing again, and both refresh tokens refused:

```bash
refresh() {
  curl -sS \
    --data-urlencode "grant_type=refresh_token" \
    --data-urlencode "refresh_token=$1" \
    -u "recovery-demo-app:oNxj0NLDbXAVWohwuHXVUI_sHgnrfIJMuAk28Kl8WCU" \
    'http://localhost:3000/tenants/recovery-demo/protocol/openid-connect/token'
  echo
}
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/recovery-demo/subjects/01a0e303-9db3-712d-9272-98d2c2a04320/sessions
echo

curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/recovery-demo/subjects/01a0e303-9db3-712d-9272-98d2c2a04320/sessions
echo

curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/recovery-demo/subjects/01a0e303-9db3-712d-9272-98d2c2a04320/sessions
echo

refresh thiT9DnRT_NtwhsWgwbFHSxBBRXv19484ncl7K1_3Vc
refresh CukLcH9hRCYKI6uWDiTIWP1h6o5MoZdAhwmwgNKAh14
```

```
{"items":[{"id":"01a0e304-7933-7d2c-8e6b-ebbe5e34982a","created_at":"2026-09-27T13:18:36.338Z","last_active_at":"2026-09-27T13:18:36.338Z","remembered":false,"client_ids":["recovery-demo-app"]},{"id":"01a0e304-797c-7fe2-b013-c38192ef313b","created_at":"2026-09-27T13:18:36.411Z","last_active_at":"2026-09-27T13:18:36.411Z","remembered":false,"client_ids":["recovery-demo-app"]}]}
HTTP/1.1 200 OK
x-request-id: 01a0e304-c992-7ce0-a32d-345ffe41df00
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 11
Date: Sun, 27 Sep 2026 13:18:56 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"ended":2}
{"items":[]}
{"error":"invalid_grant"}
{"error":"invalid_grant"}
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
column, so renaming the client in the database does not evade it. Any
other role is deleted unless it reaches an admin capability the caller does
not hold ([a removal is judged by what it removes](#a-removal-is-judged-by-what-it-removes)).

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
x-request-id: 01a0e550-5ad4-7342-ad03-4f5ef4921e7f
cache-control: no-store
link: </admin/tenants/demo/roles?limit=1&name=billing&cursor=eyJhZnRlciI6IjAxYTBlMTJmLTIzMDUtNzljZS1hMjE1LTkxNzhjZDI5NjVmMyIsInNvcnQiOiJiaWxsaW5nLWFkbWluIiwiY29sbGVjdGlvbiI6InJvbGVzIiwidGVuYW50SWQiOiIwMWEwZGIyMi0xYzMyLTdkMTctYjM1MS02OTdkNzkxMTAzM2MiLCJmaWx0ZXJzIjoiM0w4aEJkRGMyWVZnelVseHhtSlVYZGluWHJDMG10NHZMTXF1TlNTdEdOdyJ9.iZoSKcoDG6ddEPmuwpJz9_8HnSzithN61rivI_t-R24>; rel="next"
content-type: application/json; charset=utf-8
content-length: 507
Date: Mon, 28 Sep 2026 00:00:43 GMT
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

Every `409` that guards the built-in admin client's roles writes a
`refused` row with the refusal's text under `detail.reason`, the way a
`403` does (ADR 0037's amendment of 2026-09-28): deleting one of those
roles here, and adding or removing a composite of one below. Captured
against `ceiling-removal`, from
[a removal is judged by what it removes](#a-removal-is-judged-by-what-it-removes),
as the system administrator, whose subject the row names:

```bash
RUN_START=$(date -u +%FT%T.000Z)
T=http://localhost:3000/admin/tenants/ceiling-removal
curl -sS -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$T/roles/01a0e59a-b2d6-7148-a179-a3cff021a673"
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$T/audit?resource_type=role&resource_id=01a0e59a-b2d6-7148-a179-a3cff021a673&from=$RUN_START" \
  | jq -c '.items[] | {action, outcome, actor_subject_id, detail}'
```

```
{"type":"about:blank","title":"Conflict","status":409,"detail":"tenant-admin is a capability of odudu-admin, this tenant's built-in admin client, and deleting it would strip it from every administrator holding it","instance":"01a0e5ae-3e45-778c-a2cd-cf0bc8367b4d"}
{"action":"role.delete","outcome":"refused","actor_subject_id":"01a0e0a7-0ead-703a-ab34-22bcf5167d46","detail":{"reason":"tenant-admin is a capability of odudu-admin, this tenant's built-in admin client, and deleting it would strip it from every administrator holding it"}}
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
see `PUT /roles/:id/default` below. **Nothing is nested under a capability
role** — a role of the tenant's built-in admin client — whoever the caller
is: `409`, naming the role, and a `refused` row with `detail.reason`. Its
shape is what provisioning gives it (`capabilityRoleGraph`), and since
`DELETE …/composites` refuses to take an edge off one, an edge added there
could never be removed, and would reach every holder of the capability.
Captured against `ceiling-removal` from
[a removal is judged by what it removes](#a-removal-is-judged-by-what-it-removes),
as the system administrator, nesting a plain tenant role `readers` under
`view-users`; its composites stay empty:

```bash
RUN_START=$(date -u +%FT%T.000Z)
VIEW_USERS=http://localhost:3000/admin/tenants/ceiling-removal/roles/01a0e59a-b2da-713f-9ec0-0e88fc6ac35f
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"child_role_id":"01a0e5a6-f033-7ee3-8cae-d2a498d8e5ae"}' "$VIEW_USERS/composites"
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$VIEW_USERS/composites"
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/ceiling-removal/audit?action=role.composite_add&resource_type=role&resource_id=01a0e59a-b2da-713f-9ec0-0e88fc6ac35f&from=$RUN_START" \
  | jq -c '.items[] | {action, outcome, detail}'
```

```
{"type":"about:blank","title":"Conflict","status":409,"detail":"view-users is a capability of odudu-admin, this tenant's built-in admin client, and nothing is nested under a capability role","instance":"01a0e5a7-1b07-786a-ab97-05e7b15f8a90"}
{"items":[]}
{"action":"role.composite_add","outcome":"refused","detail":{"reason":"view-users is a capability of odudu-admin, this tenant's built-in admin client, and nothing is nested under a capability role"}}
```

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

_(Not re-run for the `cache-control: no-store` pass: these roles, from the
first stack's `demo`, are gone.)_

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
and read from the same `builtin_admin` column. `POST /roles/:id/composites`
refuses to add one there in the first place, so a capability role holds
exactly the edges provisioning gave it.
An edge between ordinary roles is removed whatever it nests, unless what
the child reaches includes an admin capability the caller does not hold
([a removal is judged by what it removes](#a-removal-is-judged-by-what-it-removes)).

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
x-request-id: 01a0e54b-9efd-72e1-8570-e9e93b2a233f
cache-control: no-store
Date: Sun, 27 Sep 2026 23:55:33 GMT
Connection: keep-alive
Keep-Alive: timeout=72

HTTP/1.1 404 Not Found
x-request-id: 01a0e54b-9f15-794e-9aab-94638d13b7d8
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 214
Date: Sun, 27 Sep 2026 23:55:33 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Not Found","status":404,"detail":"no composite 01a0e200-e940-79e0-8e90-e06ecfbce38d under role 01a0e200-e915-73be-ac2d-5408ba17401f","instance":"01a0e54b-9f15-794e-9aab-94638d13b7d8"}
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
x-request-id: 01a0e54b-f4f3-78a8-9e21-de5aef89ccb5
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 283
Date: Sun, 27 Sep 2026 23:55:55 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"tenant-admin is a capability of odudu-admin, this tenant's built-in admin client, and removing a composite from it would strip that from every administrator holding it","instance":"01a0e54b-f4f3-78a8-9e21-de5aef89ccb5"}
```

The trail holds a removal that landed each time this section's own demo was
replayed; the guarded one wrote nothing. Scoped to the parent role's
`resource_id`, since the action alone would also match every other role's
removals in this tenant:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3000/admin/tenants/composites-demo/audit?action=role.composite_remove&resource_type=role&resource_id=01a0e200-e915-73be-ac2d-5408ba17401f'
```

```
{"items":[{"id":"01a0e54b-9f07-7588-9fa2-c0eb03fd788c","occurred_at":"2026-09-27T23:55:33.510Z","event_type":"admin_mutation","action":"role.composite_remove","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0e539-e7b9-7c93-bf92-44517286831d","actor_client_id":"01a0dc0c-0130-7dd6-a9d5-c867c3577f62","resource_type":"role","resource_id":"01a0e200-e915-73be-ac2d-5408ba17401f","request_id":"01a0e54b-9efd-72e1-8570-e9e93b2a233f","ip":"172.20.0.1","detail":{"child_role_id":"01a0e200-e940-79e0-8e90-e06ecfbce38d"}},{"id":"01a0e201-618a-71fb-95af-8810ed9a2812","occurred_at":"2026-09-27T08:35:36.457Z","event_type":"admin_mutation","action":"role.composite_remove","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0e0a7-0ead-703a-ab34-22bcf5167d46","actor_client_id":"01a0dc0c-0130-7dd6-a9d5-c867c3577f62","resource_type":"role","resource_id":"01a0e200-e915-73be-ac2d-5408ba17401f","request_id":"01a0e201-617f-77c6-acad-fb3753ebfc56","ip":"172.20.0.1","detail":{"child_role_id":"01a0e200-e940-79e0-8e90-e06ecfbce38d"}}]}
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
  -d '{"username": "rosa2"}' \
  http://localhost:3000/admin/tenants/composites-demo/subjects
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/composites-demo/subjects/01a0e54c-7a76-7b04-8e4d-33000eadb657/roles
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e54c-7a3a-76b9-b920-57ff921bfb04
cache-control: no-store
etag: "62cc8c5e3e079f49b1b4686b6e667a740239a7857a86cc68fee65ac1e890f549"
content-type: application/json; charset=utf-8
content-length: 169
Date: Sun, 27 Sep 2026 23:56:29 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a0e200-e957-7d56-99cb-7e27217d00d4","name":"member","description":null,"client_id":null,"default_for_new_subjects":true,"created_at":"2026-09-27T08:35:05.687Z"}
{"id":"01a0e54c-7a76-7b04-8e4d-33000eadb657","type":"user","username":"rosa2","email":null,"enabled":true,"created_at":"2026-09-27T23:56:29.685Z"}
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
  -d '{"username": "sven2"}' \
  http://localhost:3000/admin/tenants/composites-demo/subjects
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/composites-demo/subjects/01a0e54d-2437-7b0f-99cc-42c9ada2f08a/roles
```

```
{"id":"01a0e200-e957-7d56-99cb-7e27217d00d4","name":"member","description":null,"client_id":null,"default_for_new_subjects":false,"created_at":"2026-09-27T08:35:05.687Z"}
{"id":"01a0e54d-2437-7b0f-99cc-42c9ada2f08a","type":"user","username":"sven2","email":null,"enabled":true,"created_at":"2026-09-27T23:57:13.142Z"}
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
x-request-id: 01a0e54d-7359-7bd3-9a1c-7a09fb6b4bcd
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 233
Date: Sun, 27 Sep 2026 23:57:33 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Forbidden","status":403,"detail":"a role handed to every new subject may reach no admin capability, and this one would reach: manage-users, view-users","instance":"01a0e54d-7359-7bd3-9a1c-7a09fb6b4bcd"}
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
have handed out, and `member`'s two changes. Two roles are named here, so
`resource_id` alone cannot select both; bounded instead with `to=` at a
point before the composite-door demonstration below repeats
`role.default_set` against the same `member` role:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3000/admin/tenants/composites-demo/audit?action=role.default_set&to=2026-09-27T08:36:05.000Z&limit=3'
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
x-request-id: 01a0e54d-b5fc-7bb4-8ee6-7fc70b30834e
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 219
Date: Sun, 27 Sep 2026 23:57:50 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Forbidden","status":403,"detail":"a role handed to every new subject may reach no admin capability, and this one would reach: view-users","instance":"01a0e54d-b5fc-7bb4-8ee6-7fc70b30834e"}
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
everything under it. Both a reparent and a `DELETE` are also held to what
they take away ([a removal is judged by what it removes](#a-removal-is-judged-by-what-it-removes)).

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
a subject's own assignments. An unknown role id answers `400`, and `403`
refuses a replacement whose **delta** reaches past the caller's own
capabilities: a role it adds, or a role it leaves out. A role kept in both
lists is not counted, so an administrator short of `tenant-admin` may add a
role beside it on a group mapped to it, and may not take it away.

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

_(Not re-run for the `cache-control: no-store` pass: this `engineering`
group, and the second stack it lived on, are gone.)_

### A removal is judged by what it removes

**A write that takes an admin capability away from whoever holds it through
a group, a role, a scope or a client's roles is refused unless the caller
holds that capability.** The reach is what the removed edge or row carries,
expanded through `role_composites` the way every ceiling here expands it,
and it is judged without enumerating the subjects affected. Seven doors:

- `PUT /groups/:id/roles` and `PUT /scopes/:id/roles`, on the roles the new
  list leaves out.
- `DELETE /groups/:id`, on every role mapped to the group, to anything in
  its subtree, and to anything above it, since the subtree's members lose
  all of them.
- `PATCH /groups/:id` with a new `parent_id`, on what the old parent's
  chain handed the group, alongside the ceiling on what the new one hands it.
- `DELETE /roles/:id`, on what the role reaches.
- `DELETE /roles/:id/composites/:childId`, on what the child reaches.
- `DELETE /scopes/:id`, on the roles the scope maps, which the cascade
  takes with it.
- `DELETE /clients/:id`, on every role scoped to the client:
  `roles_client_fk` cascades, so each goes with the client, and with it
  every grant and composite edge naming it.

Without it, a caller holding `manage-tenant` alone could strip
`tenant-admin` from every member of a group mapped to it, although it could
neither grant it nor act on one of those members directly. The refusal is a
`403` naming what the caller lacks — "this removes capabilities the caller
does not hold", apart from what a write would grant, which a reparent or a
replacement names first — and a `refused` row with `detail.denied` under the
action attempted.

Captured against a tenant `ceiling-removal` created for it. `admins` is a
group mapped to `tenant-admin`, with `on-call` beneath it; `ops-bundle` is a
tenant role nesting `tenant-admin`; `ops` is a scope mapped to it; and
`bundle-app` is a client with a role `operator` scoped to it, nesting it.
`$TENANT_TOKEN` and `$CLIENTS_TOKEN` are the `client_credentials` tokens of
two clients whose service accounts were given `manage-tenant` alone and
`manage-clients` alone. Emptying `admins`, deleting it, moving `on-call`
out from under it, deleting `ops-bundle`, taking `tenant-admin` out of it,
deleting `ops` and deleting `bundle-app` are each refused, and the rows
since `RUN_START` are those seven:

```bash
RUN_START=$(date -u +%FT%T.000Z)
T=http://localhost:3000/admin/tenants/ceiling-removal
ADMINS=$T/groups/01a0e59a-b40e-70ab-a0d2-6aee1c1e9e6c
BUNDLE=$T/roles/01a0e59a-b48d-7b81-b9df-2bf4509c07d5
ETAG=$(curl -sS -D - -o /dev/null -H "Authorization: Bearer $TENANT_TOKEN" "$ADMINS/roles" | tr -d '\r' | sed -n 's/^etag: //p')
curl -sS -X PUT -H "Authorization: Bearer $TENANT_TOKEN" -H 'content-type: application/json' \
  -H "If-Match: $ETAG" -d '{"role_ids":[]}' "$ADMINS/roles"
echo
curl -sS -X DELETE -H "Authorization: Bearer $TENANT_TOKEN" "$ADMINS"
echo
curl -sS -X PATCH -H "Authorization: Bearer $TENANT_TOKEN" -H 'content-type: application/json' \
  -d '{"parent_id":null}' "$T/groups/01a0e59a-b430-7684-b079-11c1abfaafa3"
echo
curl -sS -X DELETE -H "Authorization: Bearer $TENANT_TOKEN" "$BUNDLE"
echo
curl -sS -X DELETE -H "Authorization: Bearer $TENANT_TOKEN" \
  "$BUNDLE/composites/01a0e59a-b2d6-7148-a179-a3cff021a673"
echo
curl -sS -X DELETE -H "Authorization: Bearer $TENANT_TOKEN" "$T/scopes/01a0e5f1-d296-7db2-95b9-2ff0f71bc6bf"
echo
curl -sS -X DELETE -H "Authorization: Bearer $CLIENTS_TOKEN" "$T/clients/01a0e5f1-d240-7325-9d2e-3385c81046b6"
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$T/audit?outcome=refused&from=$RUN_START" \
  | jq -c '.items[] | {action, resource_type, resource_id, detail}'
```

```
{"type":"about:blank","title":"Forbidden","status":403,"detail":"this removes capabilities the caller does not hold: tenant-admin, view-users, manage-users, manage-clients, manage-keys, manage-sessions, view-audit","instance":"01a0e5f2-4f98-7076-a47d-70cfc175c24c"}
{"type":"about:blank","title":"Forbidden","status":403,"detail":"this removes capabilities the caller does not hold: tenant-admin, view-users, manage-users, manage-clients, manage-keys, manage-sessions, view-audit","instance":"01a0e5f2-4fb4-74a1-aebe-ef66241284a1"}
{"type":"about:blank","title":"Forbidden","status":403,"detail":"this removes capabilities the caller does not hold: tenant-admin, view-users, manage-users, manage-clients, manage-keys, manage-sessions, view-audit","instance":"01a0e5f2-4fcf-75f1-b711-ceff3dbb7948"}
{"type":"about:blank","title":"Forbidden","status":403,"detail":"this removes capabilities the caller does not hold: tenant-admin, view-users, manage-users, manage-clients, manage-keys, manage-sessions, view-audit","instance":"01a0e5f2-4fea-780b-b058-171cdb51d3b3"}
{"type":"about:blank","title":"Forbidden","status":403,"detail":"this removes capabilities the caller does not hold: tenant-admin, view-users, manage-users, manage-clients, manage-keys, manage-sessions, view-audit","instance":"01a0e5f2-5002-7eff-875f-c6ce20c07899"}
{"type":"about:blank","title":"Forbidden","status":403,"detail":"this removes capabilities the caller does not hold: tenant-admin, view-users, manage-users, manage-clients, manage-keys, manage-sessions, view-audit","instance":"01a0e5f2-501b-773e-802b-d227ea8c5008"}
{"type":"about:blank","title":"Forbidden","status":403,"detail":"this removes capabilities the caller does not hold: tenant-admin, view-users, manage-users, manage-tenant, manage-keys, manage-sessions, view-audit","instance":"01a0e5f2-5031-728d-847e-2a621cba1062"}
{"action":"client.delete","resource_type":"client","resource_id":"01a0e5f1-d240-7325-9d2e-3385c81046b6","detail":{"denied":["tenant-admin","view-users","manage-users","manage-tenant","manage-keys","manage-sessions","view-audit"]}}
{"action":"scope.delete","resource_type":"scope","resource_id":"01a0e5f1-d296-7db2-95b9-2ff0f71bc6bf","detail":{"denied":["tenant-admin","view-users","manage-users","manage-clients","manage-keys","manage-sessions","view-audit"]}}
{"action":"role.composite_remove","resource_type":"role","resource_id":"01a0e59a-b48d-7b81-b9df-2bf4509c07d5","detail":{"denied":["tenant-admin","view-users","manage-users","manage-clients","manage-keys","manage-sessions","view-audit"],"child_role_id":"01a0e59a-b2d6-7148-a179-a3cff021a673"}}
{"action":"role.delete","resource_type":"role","resource_id":"01a0e59a-b48d-7b81-b9df-2bf4509c07d5","detail":{"denied":["tenant-admin","view-users","manage-users","manage-clients","manage-keys","manage-sessions","view-audit"]}}
{"action":"group.amend","resource_type":"group","resource_id":"01a0e59a-b430-7684-b079-11c1abfaafa3","detail":{"denied":["tenant-admin","view-users","manage-users","manage-clients","manage-keys","manage-sessions","view-audit"]}}
{"action":"group.delete","resource_type":"group","resource_id":"01a0e59a-b40e-70ab-a0d2-6aee1c1e9e6c","detail":{"denied":["tenant-admin","view-users","manage-users","manage-clients","manage-keys","manage-sessions","view-audit"]}}
{"action":"group.roles_set","resource_type":"group","resource_id":"01a0e59a-b40e-70ab-a0d2-6aee1c1e9e6c","detail":{"denied":["tenant-admin","view-users","manage-users","manage-clients","manage-keys","manage-sessions","view-audit"]}}
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
alone. Every other scope stays deletable whatever it is assigned to,
unless the roles it maps reach an admin capability the caller does not hold
([a removal is judged by what it removes](#a-removal-is-judged-by-what-it-removes))
— a tenant-wide decision, not a per-client one.

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
x-request-id: 01a0e54e-01a4-7cc2-8360-43e58099b468
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 285
Date: Sun, 27 Sep 2026 23:58:09 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"openid is deleted along with every client’s assignment of it, this tenant’s built-in admin client’s included, and could lock out every administrator of this tenant","instance":"01a0e54e-01a4-7cc2-8360-43e58099b468"}
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
unknown role id answers `400`, and the same `403` refuses a delta that adds
or leaves out a role reaching an admin capability the caller does not hold.

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

_(Not re-run for the `cache-control: no-store` pass: this `billing` scope,
and the second stack it lived on, are gone.)_

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
or client id answers `404`, and a client whose service account holds an
admin capability the caller does not is refused with `403`
([the service account's ceiling](#the-service-accounts-ceiling)).

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
answer `404`; and the same `403` as `PUT` above refuses a client whose
service account holds what the caller does not.

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
x-request-id: 01a0e54e-328a-7b7e-b4c1-59ffbdc17acf
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 284
Date: Sun, 27 Sep 2026 23:58:22 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"the scope openid on odudu-admin, this tenant’s built-in admin client, cannot be unassigned: it could leave every administrator of this tenant locked out of /authorize","instance":"01a0e54e-328a-7b7e-b4c1-59ffbdc17acf"}
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
`scopes`, `profile` now first — then the same removal repeated. The read
was recaptured after a rebuild added `builtin_admin` and
`service_subject_id` to a client's representation; `scope-unassign-app` is
public, so `service_subject_id` reads `null`:

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
x-request-id: 01a0e54e-e2a4-732c-b8c7-83e2109cfdd6
cache-control: no-store
Date: Sun, 27 Sep 2026 23:59:07 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a0e227-7650-759d-af14-bc3503b8344d","client_id":"scope-unassign-app","name":"scope-unassign-app","type":"public","enabled":true,"full_scope_allowed":false,"registration_origin":"operator","created_at":"2026-09-27T09:17:12.141Z","redirect_uris":["https://app.example/callback"],"grant_types":["authorization_code"],"token_endpoint_auth_method":"none","audiences":[],"access_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"builtin_admin":false,"service_subject_id":null,"scopes":[{"id":"01a0e227-2505-73bb-8089-4caaa4028c12","name":"profile","assignment":"default"},{"id":"01a0e227-2506-783e-b180-60acaed1c1c9","name":"email","assignment":"default"},{"id":"01a0e227-250a-7a06-a417-18a9e4d8b123","name":"address","assignment":"default"},{"id":"01a0e227-250b-73a5-ae11-e114da20987b","name":"phone","assignment":"default"},{"id":"01a0e227-250c-7d5c-8063-9d2518215319","name":"roles","assignment":"default"},{"id":"01a0e227-250d-7438-aed1-a1f8da08f107","name":"groups","assignment":"default"},{"id":"01a0e227-250e-7407-9493-402eaec43c8b","name":"offline_access","assignment":"optional"}]}
HTTP/1.1 404 Not Found
x-request-id: 01a0e54e-e2d2-74ed-8d4a-1763ea426806
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 222
Date: Sun, 27 Sep 2026 23:59:07 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Not Found","status":404,"detail":"scope 01a0e227-2504-77b3-8bb0-880aa7cb21fb is not assigned to client 01a0e227-7650-759d-af14-bc3503b8344d","instance":"01a0e54e-e2d2-74ed-8d4a-1763ea426806"}
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
x-request-id: 01a0e561-2aaa-75ca-9b16-34f48904180f
location: https://app.example/callback?error=invalid_scope&state=xyz&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fscope-unassign-demo
content-length: 0
Date: Mon, 28 Sep 2026 00:19:05 GMT
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

_(Not re-run for the `cache-control: no-store` pass: this `billing` scope,
and the second stack it lived on, are gone.)_

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
x-request-id: 01a0e550-c55d-7ed5-84f0-518aa451e8ff
cache-control: no-store
etag: "c46d3990450c6fdda560192fb31bb5c43d939d3ec27ba6861173ef4c2992e589"
content-type: application/json; charset=utf-8
content-length: 200
Date: Mon, 28 Sep 2026 00:01:11 GMT
Connection: keep-alive
Keep-Alive: timeout=72

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
x-request-id: 01a0e551-7c0f-73d4-a398-ebf818b808db
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 154
Date: Mon, 28 Sep 2026 00:01:57 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Not Found","status":404,"detail":"this tenant has no SMTP configuration","instance":"01a0e551-7c0f-73d4-a398-ebf818b808db"}
{"configured":true,"host":"smtp.example.test","port":587,"from_address":"noreply@demo.example","username":null,"password_set":false,"starttls":false}

HTTP/1.1 204 No Content
x-request-id: 01a0e551-7c4f-7a78-ad31-e30c0f3167f0
cache-control: no-store
Date: Mon, 28 Sep 2026 00:01:57 GMT
Connection: keep-alive
Keep-Alive: timeout=72

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

`outcome` is `allowed`, `refused` or `failed`. Three kinds of mutation
refusal record an `admin_mutation` row. **`POST /clients`** does — a
reserved `client_id`, metadata `parseClientMetadata` rejects, or a tenant at
its client capacity. So does **every capability ceiling**: `POST /groups`
and `PATCH /groups/{id}` choosing a parent, `PUT /subjects/{id}/roles`,
`PUT /groups/{id}/roles`, `PUT /scopes/{id}/roles` and
`POST /roles/{id}/composites`; every removal judged by what it removes; the
target ceiling on every non-`GET` route under `/subjects/{id}`; and the
same ceiling on a client's service account — each writing a row whose
`detail.denied` names the capabilities the caller does not hold. And so
does **every `409` guarding the built-in admin surface**
(`builtin_admin_guarded`, the `openid` scope's delete and disabling the
system tenant), with the refusal's text under `detail.reason`, since the
caller is authenticated (ADR 0037's amendment of 2026-09-28). An attempted
privilege escalation is the refusal worth recording even while refusals in
general are not. Every other mutation above writes an `admin_mutation` row
only when it succeeds; `?outcome=refused` against a resource type with none
of those doors returns no `admin_mutation` row, not because nothing was
refused.

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

_(Not re-run for the `cache-control: no-store` pass: this and the two
blocks below share one continuous audit-trail narrative — `acme`'s and
`demo`'s `admin_access` rows accumulate on every real replay, since both
requests deliberately reuse the literal `x-request-id` values above rather
than minting fresh ones. Replaying only this block, or the whole
subsection again, adds another row rather than reproducing the "moments
before" state the prose describes; there is no way to clear an
append-only audit trail from the admin API. Restored to the original
capture.)_

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

_(Not re-run for the `cache-control: no-store` pass, for the same reason
given above the foreign-issuer blocks: `demo`'s `admin_access` trail has
since accumulated the row a real replay just added, so a fresh capture no
longer shows the single row this prose describes. Restored to the
original capture.)_

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
