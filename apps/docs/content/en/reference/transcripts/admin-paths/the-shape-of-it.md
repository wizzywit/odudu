---
title: 'Admin API: the shape of it'
description: "Most of the admin endpoint lives under /admin/tenants/{tenant}/, mirroring the protocol surface's own /tenants/{tenant}/ convention: the tenant…"
---

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
  `manage-tenants`. Reaches every tenant's `/admin/tenants/{tenant}/**`, plus
  `/admin/tenants` itself. `manage-tenants` authorizes the hop into another
  tenant and nothing more: the route's own capability is checked after it, on
  the same `system` admin client, so reading another tenant's subjects takes
  `manage-tenants` **and** `view-users`, amending its settings `manage-tenants`
  **and** `manage-tenant`, and so on — a system admin carrying only
  `manage-tenants` is refused with `403` by every route that names a capability
  of its own (`authorizeAdmin`). `/admin/tenants` and `whoami` are what it
  reaches alone: the first names `manage-tenants` as its own capability, the
  second names none.

Either way, the token must carry an `aud` naming this admin API,
`urn:odudu:params:admin-api` — an ordinary access token minted for the protocol
surface does not authorize anything here — and the request is refused if the
grant behind the token has been revoked, its session has ended, its client has
since been disabled, or its subject has. A `client_credentials` token has no
session behind it, and is refused only on the other three counts. [The admin
API's
design](https://github.com/wizzywit/odudu/blob/main/docs/archive/specs/2026-09-24-p4c-admin-api-design.md)
section 7 has the full authentication and authorization sequence; [Run it from a
checkout](../../../contributing/run-from-a-checkout.md) explains why the
built-in admin client is shaped the way it is, and "Getting the token" below is
the run every transcript here used.

**Disabling a subject ends nothing it holds**, so without that last check an
access token issued before would reach this API for the rest of its lifetime;
with it, the next request is refused exactly as a token that was never valid is.
After [`GET /subjects/username-policy`](./get-subjectsusername-policy.md) below,
with `vera` still enabled: `vera`'s token read, then `vera` disabled with
`$ADMIN_TOKEN`, then the same token again, then a string that is no token at
all:

```bash
P=http://localhost:3080/admin/tenants/policy-demo
curl -sS -H "Authorization: Bearer $VERA_TOKEN" "$P/whoami"
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"enabled":false}' "$P/subjects/01a0ed2f-31a5-7d73-87ba-7eab105cb48e"
curl -sS -D - -H "Authorization: Bearer $VERA_TOKEN" "$P/whoami"
curl -sS -H "Authorization: Bearer not-a-token" "$P/whoami"
```

```
{"subjectId":"01a0ed2f-31a5-7d73-87ba-7eab105cb48e","issuerTenantId":"01a0ed2f-2f91-7465-9b04-3440992c210e","capabilities":["view-users"],"crossTenant":false}
{"id":"01a0ed2f-31a5-7d73-87ba-7eab105cb48e","type":"user","username":"vera","email":null,"enabled":false,"created_at":"2026-09-29T12:41:28.224Z"}
HTTP/1.1 401 Unauthorized
x-request-id: 01a0ed2f-67f7-714b-9a20-82edd90aebaa
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 108
Date: Tue, 29 Sep 2026 12:41:42 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Unauthorized","status":401,"instance":"01a0ed2f-67f7-714b-9a20-82edd90aebaa"}
{"type":"about:blank","title":"Unauthorized","status":401,"instance":"01a0ed2f-845b-7cda-bc47-6b5157abf3a0"}
```

The console gateway reads such a `401` as the end of its session once the
same token is refused at its own tenant's `whoami` too, so a console session
whose subject is disabled ends at its next request
([the console paths](../console-paths/index.md)).

**Every path parameter but `{tenant}` is a row id**, narrowed before the
route runs: an id that is not a canonical hyphenated UUID is refused with
`400`, which a caller can tell apart from the `404` a well-formed id
matching nothing answers. That is narrower than what PostgreSQL itself
accepts — the hyphenless and brace-wrapped forms are refused here. A tenant is addressed by name instead. The published OpenAPI
document declares each of these parameters, so a generated client knows the
shape of what it is filling.

**Every admin API route's response carries `cache-control: no-store`**, set once
for every route in the route table (`registerAdminRoutes`), refusals included —
`/admin/openapi.json`, which is public and the same for every caller, is not one
of them: each is specific to the caller that asked, and several carry a secret
shown once — a registration token, a client secret, a one-time password.

| Method   | Path                                                                    | What it is                                 |
| -------- | ----------------------------------------------------------------------- | ------------------------------------------ |
| `GET`    | `/admin/tenants`                                                        | List tenants                               |
| `GET`    | `/admin/tenants/count`                                                  | Count tenants                              |
| `POST`   | `/admin/tenants`                                                        | Create a tenant                            |
| `POST`   | `/admin/tenant-imports`                                                 | Import a tenant from a document            |
| `GET`    | `/admin/tenants/{tenant}`                                               | Read one tenant                            |
| `PATCH`  | `/admin/tenants/{tenant}`                                               | Amend one tenant                           |
| `DELETE` | `/admin/tenants/{tenant}`                                               | Delete a tenant and all it holds           |
| `GET`    | `/admin/tenants/{tenant}/export`                                        | Export a tenant's configuration            |
| `GET`    | `/admin/tenants/{tenant}/whoami`                                        | Identity probe                             |
| `GET`    | `/admin/tenants/{tenant}/subjects`                                      | List subjects                              |
| `GET`    | `/admin/tenants/{tenant}/subjects/count`                                | Count subjects                             |
| `POST`   | `/admin/tenants/{tenant}/subjects/bulk`                                 | Act on many subjects at once               |
| `GET`    | `/admin/tenants/{tenant}/subjects/username-policy`                      | Whether a username can be renamed          |
| `POST`   | `/admin/tenants/{tenant}/subjects`                                      | Create a subject                           |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id`                                  | Read a subject                             |
| `PATCH`  | `/admin/tenants/{tenant}/subjects/:id`                                  | Amend a subject                            |
| `DELETE` | `/admin/tenants/{tenant}/subjects/:id`                                  | Delete a subject                           |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/profile`                          | Read a subject's profile                   |
| `PATCH`  | `/admin/tenants/{tenant}/subjects/:id/profile`                          | Amend a subject's profile                  |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/credentials`                      | List a subject's credentials               |
| `DELETE` | `/admin/tenants/{tenant}/subjects/:id/credentials/:credentialId`        | Remove a credential                        |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/consents`                         | List a subject's consents                  |
| `DELETE` | `/admin/tenants/{tenant}/subjects/:id/consents/:clientId`               | Revoke a consent                           |
| `POST`   | `/admin/tenants/{tenant}/subjects/:id/password`                         | Issue a one-time password                  |
| `POST`   | `/admin/tenants/{tenant}/subjects/:id/password-reset`                   | Send a reset-password link                 |
| `POST`   | `/admin/tenants/{tenant}/subjects/:id/verification`                     | Resend a verification link                 |
| `POST`   | `/admin/tenants/{tenant}/subjects/:id/actions-email`                    | Email a link through required actions      |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/lockout`                          | Read a subject's brute-force lockout       |
| `DELETE` | `/admin/tenants/{tenant}/subjects/:id/lockout`                          | Clear a brute-force lockout                |
| `DELETE` | `/admin/tenants/{tenant}/lockouts`                                      | Clear every lockout in the tenant          |
| `DELETE` | `/admin/tenants/{tenant}/subjects/:id/recovery-codes`                   | Revoke a subject's recovery codes          |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/required-actions`                 | Read a subject's required actions          |
| `PUT`    | `/admin/tenants/{tenant}/subjects/:id/required-actions`                 | Set a subject's required actions           |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/roles`                            | Read a subject's roles                     |
| `PUT`    | `/admin/tenants/{tenant}/subjects/:id/roles`                            | Replace a subject's roles                  |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/effective-roles`                  | Read a subject's effective roles           |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/admin-capabilities`               | Read a subject's admin capabilities        |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/groups`                           | Read a subject's groups                    |
| `PUT`    | `/admin/tenants/{tenant}/subjects/:id/groups`                           | Replace a subject's groups                 |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/sessions`                         | List a subject's live sessions             |
| `DELETE` | `/admin/tenants/{tenant}/subjects/:id/sessions`                         | End every session                          |
| `DELETE` | `/admin/tenants/{tenant}/subjects/:id/sessions/:sid`                    | End one session                            |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/grants`                           | List a subject's token grants              |
| `DELETE` | `/admin/tenants/{tenant}/subjects/:id/grants/:clientId`                 | Revoke a subject's grants through a client |
| `GET`    | `/admin/tenants/{tenant}/sessions`                                      | List every live session                    |
| `GET`    | `/admin/tenants/{tenant}/sessions/count`                                | Count live sessions                        |
| `DELETE` | `/admin/tenants/{tenant}/sessions`                                      | End every session in the tenant            |
| `GET`    | `/admin/tenants/{tenant}/settings`                                      | Read a tenant's settings                   |
| `PATCH`  | `/admin/tenants/{tenant}/settings`                                      | Amend a tenant's settings                  |
| `GET`    | `/admin/tenants/{tenant}/message-catalogue`                             | List the page messages overrides may name  |
| `GET`    | `/admin/tenants/{tenant}/message-overrides`                             | List a locale's message overrides          |
| `PUT`    | `/admin/tenants/{tenant}/message-overrides/:locale/:key`                | Set a message override                     |
| `DELETE` | `/admin/tenants/{tenant}/message-overrides/:locale/:key`                | Remove a message override                  |
| `GET`    | `/admin/tenants/{tenant}/theme`                                         | Read a tenant's draft and published theme  |
| `PUT`    | `/admin/tenants/{tenant}/theme`                                         | Save a tenant's draft theme                |
| `DELETE` | `/admin/tenants/{tenant}/theme`                                         | Reset a tenant's theme to the default      |
| `POST`   | `/admin/tenants/{tenant}/theme/publish`                                 | Publish a tenant's draft theme             |
| `POST`   | `/admin/tenants/{tenant}/theme/assets`                                  | Upload an image for a tenant's themes      |
| `GET`    | `/admin/tenants/{tenant}/theme/assets/:assetId/content`                 | Read an uploaded image's bytes             |
| `DELETE` | `/admin/tenants/{tenant}/theme/assets/:assetId`                         | Delete an uploaded image                   |
| `GET`    | `/admin/tenants/{tenant}/theme/stylesheet-hooks`                        | List what a stylesheet's rules may name    |
| `GET`    | `/admin/tenants/{tenant}/theme/preview`                                 | Preview a page of a tenant's draft theme   |
| `GET`    | `/admin/tenants/{tenant}/theme/preview/info`                            | Say what a tenant's preview shows and why  |
| `GET`    | `/admin/tenants/{tenant}/mail/preview`                                  | Preview the verification mail              |
| `GET`    | `/admin/tenants/{tenant}/mail/branding`                                 | Read the branding a mail inherits          |
| `GET`    | `/admin/tenants/{tenant}/theme/versions`                                | List a tenant's theme versions             |
| `POST`   | `/admin/tenants/{tenant}/theme/versions/:versionId/restore`             | Restore a tenant's earlier theme           |
| `GET`    | `/admin/tenants/{tenant}/clients/:id/theme`                             | Read a client's draft and published theme  |
| `PUT`    | `/admin/tenants/{tenant}/clients/:id/theme`                             | Save a client's draft theme                |
| `DELETE` | `/admin/tenants/{tenant}/clients/:id/theme`                             | Reset a client's theme to its tenant's     |
| `POST`   | `/admin/tenants/{tenant}/clients/:id/theme/publish`                     | Publish a client's draft theme             |
| `GET`    | `/admin/tenants/{tenant}/clients/:id/theme/preview`                     | Preview a page of a client's draft theme   |
| `GET`    | `/admin/tenants/{tenant}/clients/:id/theme/preview/info`                | Say what a client's preview shows and why  |
| `GET`    | `/admin/tenants/{tenant}/clients/:id/theme/versions`                    | List a client's theme versions             |
| `POST`   | `/admin/tenants/{tenant}/clients/:id/theme/versions/:versionId/restore` | Restore a client's earlier theme           |
| `GET`    | `/admin/tenants/{tenant}/clients`                                       | List clients                               |
| `GET`    | `/admin/tenants/{tenant}/clients/count`                                 | Count clients                              |
| `POST`   | `/admin/tenants/{tenant}/clients`                                       | Create a client                            |
| `GET`    | `/admin/tenants/{tenant}/clients/:id`                                   | Read a client                              |
| `PATCH`  | `/admin/tenants/{tenant}/clients/:id`                                   | Amend a client                             |
| `DELETE` | `/admin/tenants/{tenant}/clients/:id`                                   | Delete a client                            |
| `POST`   | `/admin/tenants/{tenant}/clients/:id/secret`                            | Rotate a client's secret                   |
| `GET`    | `/admin/tenants/{tenant}/clients/:id/sessions`                          | List a client's live sessions              |
| `DELETE` | `/admin/tenants/{tenant}/clients/:id/grants`                            | Revoke every grant a client holds          |
| `GET`    | `/admin/tenants/{tenant}/clients/:id/logout-deliveries`                 | List a client's logout deliveries          |
| `GET`    | `/admin/tenants/{tenant}/clients/:id/evaluate`                          | Evaluate the claims a client would issue   |
| `GET`    | `/admin/tenants/{tenant}/clients/:id/installation`                      | Read a client's installation               |
| `GET`    | `/admin/tenants/{tenant}/registration-tokens`                           | List initial access tokens                 |
| `POST`   | `/admin/tenants/{tenant}/registration-tokens`                           | Mint an initial access token               |
| `DELETE` | `/admin/tenants/{tenant}/registration-tokens/:id`                       | Revoke an initial access token             |
| `GET`    | `/admin/tenants/{tenant}/roles`                                         | List roles                                 |
| `GET`    | `/admin/tenants/{tenant}/roles/count`                                   | Count roles                                |
| `POST`   | `/admin/tenants/{tenant}/roles`                                         | Create a role                              |
| `GET`    | `/admin/tenants/{tenant}/roles/:id`                                     | Read a role                                |
| `PATCH`  | `/admin/tenants/{tenant}/roles/:id`                                     | Amend a role                               |
| `DELETE` | `/admin/tenants/{tenant}/roles/:id`                                     | Delete a role                              |
| `POST`   | `/admin/tenants/{tenant}/roles/:id/composites`                          | Add a role composite                       |
| `GET`    | `/admin/tenants/{tenant}/roles/:id/composites`                          | List a role's direct composites            |
| `DELETE` | `/admin/tenants/{tenant}/roles/:id/composites/:childId`                 | Remove a role composite                    |
| `PUT`    | `/admin/tenants/{tenant}/roles/:id/default`                             | Set whether new subjects get a role        |
| `GET`    | `/admin/tenants/{tenant}/groups`                                        | List groups                                |
| `GET`    | `/admin/tenants/{tenant}/groups/count`                                  | Count groups                               |
| `POST`   | `/admin/tenants/{tenant}/groups`                                        | Create a group                             |
| `GET`    | `/admin/tenants/{tenant}/groups/:id`                                    | Read a group                               |
| `PATCH`  | `/admin/tenants/{tenant}/groups/:id`                                    | Amend a group (reparent)                   |
| `DELETE` | `/admin/tenants/{tenant}/groups/:id`                                    | Delete a group                             |
| `GET`    | `/admin/tenants/{tenant}/groups/:id/roles`                              | Read a group's roles                       |
| `PUT`    | `/admin/tenants/{tenant}/groups/:id/roles`                              | Replace a group's roles                    |
| `PUT`    | `/admin/tenants/{tenant}/groups/:id/default`                            | Set whether new subjects join a group      |
| `GET`    | `/admin/tenants/{tenant}/scopes`                                        | List client scopes                         |
| `GET`    | `/admin/tenants/{tenant}/scopes/count`                                  | Count client scopes                        |
| `POST`   | `/admin/tenants/{tenant}/scopes`                                        | Create a client scope                      |
| `GET`    | `/admin/tenants/{tenant}/scopes/builtins`                               | List the built-in scopes a tenant has      |
| `POST`   | `/admin/tenants/{tenant}/scopes/restore-builtins`                       | Create the missing built-in scopes         |
| `GET`    | `/admin/tenants/{tenant}/scopes/:id`                                    | Read a client scope                        |
| `PATCH`  | `/admin/tenants/{tenant}/scopes/:id`                                    | Amend a client scope                       |
| `DELETE` | `/admin/tenants/{tenant}/scopes/:id`                                    | Delete a client scope                      |
| `GET`    | `/admin/tenants/{tenant}/scopes/:id/impact`                             | Count what deleting a scope would take     |
| `GET`    | `/admin/tenants/{tenant}/scopes/:id/roles`                              | Read a scope's roles                       |
| `PUT`    | `/admin/tenants/{tenant}/scopes/:id/roles`                              | Replace a scope's roles                    |
| `GET`    | `/admin/tenants/{tenant}/scopes/:id/clients`                            | List the clients a scope is assigned to    |
| `PUT`    | `/admin/tenants/{tenant}/scopes/:id/clients/:clientId`                  | Assign a scope to a client                 |
| `DELETE` | `/admin/tenants/{tenant}/scopes/:id/clients/:clientId`                  | Unassign a scope from a client             |
| `GET`    | `/admin/tenants/{tenant}/scopes/:id/mappers`                            | Read a scope's claim mapper bindings       |
| `PUT`    | `/admin/tenants/{tenant}/scopes/:id/mappers`                            | Replace a scope's claim mapper bindings    |
| `GET`    | `/admin/tenants/{tenant}/keys`                                          | List signing keys                          |
| `POST`   | `/admin/tenants/{tenant}/keys`                                          | Stage a signing key                        |
| `POST`   | `/admin/tenants/{tenant}/keys/:id/promote`                              | Promote a signing key                      |
| `POST`   | `/admin/tenants/{tenant}/keys/:id/retire`                               | Retire a signing key                       |
| `DELETE` | `/admin/tenants/{tenant}/keys/:id`                                      | Delete a retired signing key               |
| `GET`    | `/admin/tenants/{tenant}/flow/executions`                               | Read a tenant's authentication flow        |
| `PUT`    | `/admin/tenants/{tenant}/flow/executions`                               | Replace a tenant's authentication flow     |
| `GET`    | `/admin/tenants/{tenant}/smtp`                                          | Read a tenant's own SMTP configuration     |
| `PUT`    | `/admin/tenants/{tenant}/smtp`                                          | Replace a tenant's own SMTP configuration  |
| `DELETE` | `/admin/tenants/{tenant}/smtp`                                          | Remove a tenant's own SMTP configuration   |
| `POST`   | `/admin/tenants/{tenant}/smtp/test`                                     | Send one test message                      |
| `GET`    | `/admin/tenants/{tenant}/mail`                                          | List the tenant's outgoing mail            |
| `GET`    | `/admin/tenants/{tenant}/audit`                                         | List the tenant's audit trail              |
| `GET`    | `/admin/tenants/{tenant}/audit/count`                                   | Count audit events                         |
| `GET`    | `/admin/tenants/{tenant}/audit/export`                                  | Export audit events as NDJSON              |
| `GET`    | `/admin/openapi.json`                                                   | The OpenAPI reference                      |

### A refusal names its field

A `400` that names something in the request carries `errors` beside `detail`,
one entry per field: `path` is the field's JSON path within the query string or
body — `port`, `document.clients[0].redirect_uris`, `[1].authenticator` for the
second step of a flow — and `message` is what is wrong with it. An entry may
also carry a `code`, a stable name a client can act on without reading the
message; the only one today is `bidi_control_refused`. `detail` is unchanged
prose, so a caller that reads it still can. A refusal of the request as a whole,
such as a flow with no steps or a test send to a tenant with no SMTP
configuration, names no field and carries no `errors`. In a tenant `fields-demo`
created for it, as `ada-t2`:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3080/admin/tenants/fields-demo/subjects?username=a&email=b'
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3080/admin/tenants/fields-demo/subjects?cursor=not-a-cursor'
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3080/admin/tenants/fields-demo/roles?colour=blue'
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"host":"smtp.example","port":70000,"from_address":"noreply@example.com"}' \
  http://localhost:3080/admin/tenants/fields-demo/smtp
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"name":"billing-viewer","client_id":"0199aa00-0000-7000-8000-0000000000ff"}' \
  http://localhost:3080/admin/tenants/fields-demo/roles
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"search one field at a time: username or email, not both","errors":[{"path":"email","message":"search one field at a time: username or email, not both"}],"instance":"01a0e9e0-b4bf-7038-880c-de9e0e279933"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"cursor is invalid or expired","errors":[{"path":"cursor","message":"is invalid or expired"}],"instance":"01a0e9e0-b4dd-7120-b5c4-ccf14a074c3e"}
{"type":"about:blank","title":"Error","status":400,"detail":"querystring must NOT have additional properties: colour","errors":[{"path":"colour","message":"must NOT have additional properties"}],"instance":"01a0e9e0-b4f4-769a-bd3a-11cfe8ccddbf"}
{"type":"about:blank","title":"Error","status":400,"detail":"body/port must be <= 65535","errors":[{"path":"port","message":"must be <= 65535"}],"instance":"01a0e9e0-849b-742a-93a3-d4e80f81a5d8"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"client_id names no client","errors":[{"path":"client_id","message":"names no client"}],"instance":"01a0e9e0-84ab-7569-97ef-e3290a9211bd"}
```

The last two in the order they ran: a subject `grace`'s roles replaced
with a role id that names nothing, under the `ETag` its `GET …/roles`
answered, and a flow naming `password` twice, under its own:

```bash
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -H 'If-Match: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"' \
  -d '{"role_ids":["0199aa00-0000-7000-8000-0000000000ff"]}' \
  http://localhost:3080/admin/tenants/fields-demo/subjects/01a17aef-6c47-78e0-8a28-5fa8a095319b/roles
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -H 'If-Match: "2e028692eeb04a65ef6a06be482c11d71247d243b5929007716ee0f4eb2324db"' \
  -d '[{"authenticator":"password","requirement":"required"},{"authenticator":"password","requirement":"alternative"}]' \
  http://localhost:3080/admin/tenants/fields-demo/flow/executions
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"unknown role id(s): 0199aa00-0000-7000-8000-0000000000ff","errors":[{"path":"role_ids","message":"names no role 0199aa00-0000-7000-8000-0000000000ff"}],"instance":"01a0e9e0-b564-7765-81f0-d8ddb655a845"}
{"type":"about:blank#flow-duplicate-authenticator","title":"Bad Request","status":400,"detail":"authenticator \"password\" appears more than once; a step is addressed by its authenticator, so a repeat has no unambiguous meaning","errors":[{"path":"[1].authenticator","message":"repeats an earlier step"}],"instance":"01a13029-15ad-7ad4-9099-2d491b806386"}
```

### A create answers its `ETag`

Every `POST` that creates a record answers `ETag` beside its `201` — the same
one the record's own `GET` answers, so the first save after a create needs no
read first. A signing key and a registration token have no read of their own;
theirs is the one their entry in the list is taken over, never over the one-time
`token`. `POST /subjects/:id/password` creates no record, and answers none. In a
tenant `etags-demo` created for it:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"name":"billing-viewer"}' http://localhost:3082/admin/tenants/etags-demo/roles \
  | grep -E '^(HTTP/|etag:|\{)'
curl -sS -D - -o /dev/null -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3082/admin/tenants/etags-demo/roles/01a10bd4-90e5-79e8-92bd-8f9024ae8829 \
  | grep -E '^(HTTP/|etag:)'
```

The status line, the `etag` header and the body of each, as the `grep` keeps them:

```
HTTP/1.1 201 Created
etag: "aaa46b5cbb2af2891ff756bc81a28da18d1281e7fafa665df9106fc345c044a0"
{"id":"01a10bd4-90e5-79e8-92bd-8f9024ae8829","name":"billing-viewer","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-10-05T11:30:42.533Z","admin_reach":[]}
HTTP/1.1 200 OK
etag: "aaa46b5cbb2af2891ff756bc81a28da18d1281e7fafa665df9106fc345c044a0"
```
