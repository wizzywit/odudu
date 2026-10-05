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

**The fifth stack.** The sections this note names were captured against a
stack of their own: compose project `odudu-task2`, published on port 3080,
built from this branch and brought up from an empty volume with
`seed admin --username ada-t2`, each section after a rebuild that added
what it describes. It was torn down with `docker compose down -v` when the
capture finished. They are "A refusal names its field", the `ETag`
sections under scope assignment and signing keys, `GET /scopes/:id/clients`,
"Filtering by capability", "The last administrator", "The authenticators a
step may name", "The owning client, by name", and the OpenAPI entry under
`PUT /scopes/:id/clients/:clientId`.

**The sixth stack.** Every transcript whose output changed once a `400`
named its field under `errors`, a create answered its `ETag`, SMTP reported
`effective`, a flow answered `available` and a role named its owning
client was captured again against one more stack: the same compose project
`odudu-task2` on port 3080, brought up from an empty volume built from this
branch, with `seed admin --username ada` run against it and every tenant,
client, role, group, scope and subject a section names created there
through the endpoints below — each section says which. Its `demo` is
`01a0ea4c-0884-74fa-825c-05f6ef568dd0`, a different tenant from the other
stacks' `demo`s. It was torn down with `docker compose down -v` when the
capture finished. A section that says it was captured against it refers
to nothing on the stacks above.

**The seventh stack.** `GET /subjects/:id/lockout` and
`DELETE /subjects/:id/recovery-codes` were captured against a stack of
their own: compose project `odudu-t8` on port 3080, built from this branch
with both routes in it and brought up from an empty volume with
`ODUDU_THROTTLE_LIMIT=1000`, so a scripted run of sign-ins is not refused
by the per-origin throttle, and `seed admin --username ada-t8` run against
it. Each of the two sections says what else it seeded. It was torn down
with `docker compose down -v` when the capture finished.

**The eighth stack.** `GET /subjects/username-policy`, the refusal of a
disabled subject's token under "The shape of it", and `GET /admin/openapi.json`
(recaptured since against the twelfth stack, below) were captured against one more stack of their own: compose project
`odudu-t8b` on port 3080, built from this branch and brought up from an
empty volume, with `seed admin --username ada-t8b` run against it, then a
tenant `policy-demo` made with `odudu seed tenant` and a subject `vera`
seeded there with `odudu seed user` and granted `odudu-admin:view-users`
alone. `$VERA_TOKEN` is `vera`'s own admin access token, got the way
"Getting the token" shows but at `policy-demo`. It was torn down with
`docker compose down -v` when the capture finished.

**The tenth stack.** The sections on routes added for the operator's side of a
tenant — its sessions and grants, its mail and logout deliveries, bulk and
tenant-wide writes, claim evaluation, audit reporting and tenant deletion — the
older `GET /audit` transcripts their notes say were recaptured, and in
[docs/request-paths.md](request-paths.md) "One sign-in's audit trail" and the
back-channel logout queue's `attempts`, ran against one more stack: compose
project `odudu-t8b2` on port 3082, its Postgres on 5464, built from this branch
at `a66cf8df` and brought up from an empty volume with
`ODUDU_OUTBOX_ENABLED=false` and `ODUDU_LOGOUT_SENDER_ENABLED=false`, so that
mail and Logout Tokens leave only when `odudu send-mail` and `odudu
send-logouts` are run by hand, `ODUDU_ALLOW_PRIVATE_SMTP_HOSTS=true` and
`ODUDU_ALLOW_PRIVATE_CLIENT_URLS=true`, so that a relay and a logout endpoint
can name the stack's own `postgres` container, where nothing listens and so
every delivery fails, and `ODUDU_THROTTLE_LIMIT=1000`. Against it: `seed admin
--username ada-t8b2` in `system`, a tenant `ops-demo` made through `POST
/admin/tenants`, subjects `grace` (with an address), `linus` (without), `mona`,
`sam` and `uma` seeded there with `odudu seed user`, `mona` granted
`odudu-admin:manage-tenant`, `sam` `odudu-admin:manage-sessions` and `uma`
`odudu-admin:manage-users`, and a confidential client `ops-app` made through
`POST /clients` with a back-channel logout URI of
`https://postgres:9/backchannel`, row id `01a0ee8a-d1a7-7c3c-a05b-903a2d8fa123`.
`grace` then signed in through `ops-app` twice — once asking for
`offline_access` — and `linus` once. `$ADMIN_TOKEN` is `ada-t8b2`'s token, got
fresh for each section the way "Getting the token" shows, and
`P=http://localhost:3082/admin/tenants/ops-demo` throughout. Each section says
what else it seeded. The two rename refusals, `GET /admin/openapi.json` (since
recaptured against the twelfth stack), `ivy`'s
read under `GET /audit` and the back-channel logout queue ran last, on the image
rebuilt at `1507a6c3`, whose only change is the wording of the
`about:blank#logout-deliveries-pending` detail. The stack was torn down with
`docker compose down -v` when the capture finished. `DELETE
/admin/tenants/{tenant}` was captured again on an eleventh stack, as its section
says.

**The twelfth stack.** Every transcript whose output changed once groups and
roles carried a `description`, groups `default_for_new_subjects`, scopes
their client default and consent fields, a tenant `audit_event_types`, a
client the fields `0084` to `0086` added and `odudu reap` its `cleared`
report, and the sections on the routes and settings those changes added,
ran against one more stack: compose project `odudu-t8c2` on port 3082, its
Postgres on 5464, built from this branch at `15cdb46a` and brought up from
an empty volume with `ODUDU_OUTBOX_ENABLED=false`, `ODUDU_REAP_ENABLED=false`
and `ODUDU_LOGOUT_SENDER_ENABLED=false`, so that mail leaves and `reap` runs
only when run by hand, `ODUDU_ALLOW_PRIVATE_SMTP_HOSTS=true`,
`ODUDU_ALLOW_PRIVATE_CLIENT_URLS=true` and `ODUDU_THROTTLE_LIMIT=1000`, with
`seed admin --username ada-t8c2` run against it. `$ADMIN_TOKEN` is
`ada-t8c2`'s, got fresh for each section the way "Getting the token" shows.
Every tenant, client, role, group, scope and subject a section names was
created there for it through the endpoints below, each section says which,
so its ids refer to nothing on the stacks above. Its `odudu` service was
rebuilt at `6a212077`, whose only change lets a mailed link give a subject
with no password its first, before the required-actions transcripts under
`POST /subjects/:id/actions-email` and the audit types under `GET /audit`
were captured. It was torn down with `docker compose down -v` when the
capture finished.

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
has been revoked, its session has ended, its client has since been
disabled, or its subject has. A `client_credentials` token has no session
behind it, and is refused only on the other three counts. `docs/superpowers/specs/2026-09-24-p4c-admin-api-design.md`
section 7 has the full authentication and authorization sequence;
[README.md](../README.md) explains why the built-in admin client is shaped
the way it is, and "Getting the token" below is the run every transcript
here used.

**Disabling a subject ends nothing it holds**, so without that last check
an access token issued before would reach this API for the rest of its
lifetime; with it, the next request is refused exactly as a token that was
never valid is. Against the eighth stack, after
[`GET /subjects/username-policy`](#get-subjectsusername-policy) below had
been captured with `vera` still enabled: `vera`'s token read, then `vera`
disabled with `$ADMIN_TOKEN`, then the same token again, then a string that
is no token at all:

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
([docs/console-paths.md](console-paths.md)).

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

| Method   | Path                                                             | What it is                                 |
| -------- | ---------------------------------------------------------------- | ------------------------------------------ |
| `GET`    | `/admin/tenants`                                                 | List tenants                               |
| `GET`    | `/admin/tenants/count`                                           | Count tenants                              |
| `POST`   | `/admin/tenants`                                                 | Create a tenant                            |
| `POST`   | `/admin/tenant-imports`                                          | Import a tenant from a document            |
| `GET`    | `/admin/tenants/{tenant}`                                        | Read one tenant                            |
| `PATCH`  | `/admin/tenants/{tenant}`                                        | Amend one tenant                           |
| `DELETE` | `/admin/tenants/{tenant}`                                        | Delete a tenant and all it holds           |
| `GET`    | `/admin/tenants/{tenant}/export`                                 | Export a tenant's configuration            |
| `GET`    | `/admin/tenants/{tenant}/whoami`                                 | Identity probe                             |
| `GET`    | `/admin/tenants/{tenant}/subjects`                               | List subjects                              |
| `GET`    | `/admin/tenants/{tenant}/subjects/count`                         | Count subjects                             |
| `POST`   | `/admin/tenants/{tenant}/subjects/bulk`                          | Act on many subjects at once               |
| `GET`    | `/admin/tenants/{tenant}/subjects/username-policy`               | Whether a username can be renamed          |
| `POST`   | `/admin/tenants/{tenant}/subjects`                               | Create a subject                           |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id`                           | Read a subject                             |
| `PATCH`  | `/admin/tenants/{tenant}/subjects/:id`                           | Amend a subject                            |
| `DELETE` | `/admin/tenants/{tenant}/subjects/:id`                           | Delete a subject                           |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/profile`                   | Read a subject's profile                   |
| `PATCH`  | `/admin/tenants/{tenant}/subjects/:id/profile`                   | Amend a subject's profile                  |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/credentials`               | List a subject's credentials               |
| `DELETE` | `/admin/tenants/{tenant}/subjects/:id/credentials/:credentialId` | Remove a credential                        |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/consents`                  | List a subject's consents                  |
| `DELETE` | `/admin/tenants/{tenant}/subjects/:id/consents/:clientId`        | Revoke a consent                           |
| `POST`   | `/admin/tenants/{tenant}/subjects/:id/password`                  | Issue a one-time password                  |
| `POST`   | `/admin/tenants/{tenant}/subjects/:id/password-reset`            | Send a reset-password link                 |
| `POST`   | `/admin/tenants/{tenant}/subjects/:id/verification`              | Resend a verification link                 |
| `POST`   | `/admin/tenants/{tenant}/subjects/:id/actions-email`             | Email a link through required actions      |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/lockout`                   | Read a subject's brute-force lockout       |
| `DELETE` | `/admin/tenants/{tenant}/subjects/:id/lockout`                   | Clear a brute-force lockout                |
| `DELETE` | `/admin/tenants/{tenant}/lockouts`                               | Clear every lockout in the tenant          |
| `DELETE` | `/admin/tenants/{tenant}/subjects/:id/recovery-codes`            | Revoke a subject's recovery codes          |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/required-actions`          | Read a subject's required actions          |
| `PUT`    | `/admin/tenants/{tenant}/subjects/:id/required-actions`          | Set a subject's required actions           |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/roles`                     | Read a subject's roles                     |
| `PUT`    | `/admin/tenants/{tenant}/subjects/:id/roles`                     | Replace a subject's roles                  |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/effective-roles`           | Read a subject's effective roles           |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/groups`                    | Read a subject's groups                    |
| `PUT`    | `/admin/tenants/{tenant}/subjects/:id/groups`                    | Replace a subject's groups                 |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/sessions`                  | List a subject's live sessions             |
| `DELETE` | `/admin/tenants/{tenant}/subjects/:id/sessions`                  | End every session                          |
| `DELETE` | `/admin/tenants/{tenant}/subjects/:id/sessions/:sid`             | End one session                            |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/grants`                    | List a subject's token grants              |
| `DELETE` | `/admin/tenants/{tenant}/subjects/:id/grants/:clientId`          | Revoke a subject's grants through a client |
| `GET`    | `/admin/tenants/{tenant}/sessions`                               | List every live session                    |
| `GET`    | `/admin/tenants/{tenant}/sessions/count`                         | Count live sessions                        |
| `DELETE` | `/admin/tenants/{tenant}/sessions`                               | End every session in the tenant            |
| `GET`    | `/admin/tenants/{tenant}/settings`                               | Read a tenant's settings                   |
| `PATCH`  | `/admin/tenants/{tenant}/settings`                               | Amend a tenant's settings                  |
| `GET`    | `/admin/tenants/{tenant}/clients`                                | List clients                               |
| `GET`    | `/admin/tenants/{tenant}/clients/count`                          | Count clients                              |
| `POST`   | `/admin/tenants/{tenant}/clients`                                | Create a client                            |
| `GET`    | `/admin/tenants/{tenant}/clients/:id`                            | Read a client                              |
| `PATCH`  | `/admin/tenants/{tenant}/clients/:id`                            | Amend a client                             |
| `DELETE` | `/admin/tenants/{tenant}/clients/:id`                            | Delete a client                            |
| `POST`   | `/admin/tenants/{tenant}/clients/:id/secret`                     | Rotate a client's secret                   |
| `GET`    | `/admin/tenants/{tenant}/clients/:id/sessions`                   | List a client's live sessions              |
| `DELETE` | `/admin/tenants/{tenant}/clients/:id/grants`                     | Revoke every grant a client holds          |
| `GET`    | `/admin/tenants/{tenant}/clients/:id/logout-deliveries`          | List a client's logout deliveries          |
| `GET`    | `/admin/tenants/{tenant}/clients/:id/evaluate`                   | Evaluate the claims a client would issue   |
| `GET`    | `/admin/tenants/{tenant}/clients/:id/installation`               | Read a client's installation               |
| `GET`    | `/admin/tenants/{tenant}/registration-tokens`                    | List initial access tokens                 |
| `POST`   | `/admin/tenants/{tenant}/registration-tokens`                    | Mint an initial access token               |
| `DELETE` | `/admin/tenants/{tenant}/registration-tokens/:id`                | Revoke an initial access token             |
| `GET`    | `/admin/tenants/{tenant}/roles`                                  | List roles                                 |
| `GET`    | `/admin/tenants/{tenant}/roles/count`                            | Count roles                                |
| `POST`   | `/admin/tenants/{tenant}/roles`                                  | Create a role                              |
| `GET`    | `/admin/tenants/{tenant}/roles/:id`                              | Read a role                                |
| `PATCH`  | `/admin/tenants/{tenant}/roles/:id`                              | Amend a role                               |
| `DELETE` | `/admin/tenants/{tenant}/roles/:id`                              | Delete a role                              |
| `POST`   | `/admin/tenants/{tenant}/roles/:id/composites`                   | Add a role composite                       |
| `GET`    | `/admin/tenants/{tenant}/roles/:id/composites`                   | List a role's direct composites            |
| `DELETE` | `/admin/tenants/{tenant}/roles/:id/composites/:childId`          | Remove a role composite                    |
| `PUT`    | `/admin/tenants/{tenant}/roles/:id/default`                      | Set whether new subjects get a role        |
| `GET`    | `/admin/tenants/{tenant}/groups`                                 | List groups                                |
| `GET`    | `/admin/tenants/{tenant}/groups/count`                           | Count groups                               |
| `POST`   | `/admin/tenants/{tenant}/groups`                                 | Create a group                             |
| `GET`    | `/admin/tenants/{tenant}/groups/:id`                             | Read a group                               |
| `PATCH`  | `/admin/tenants/{tenant}/groups/:id`                             | Amend a group (reparent)                   |
| `DELETE` | `/admin/tenants/{tenant}/groups/:id`                             | Delete a group                             |
| `GET`    | `/admin/tenants/{tenant}/groups/:id/roles`                       | Read a group's roles                       |
| `PUT`    | `/admin/tenants/{tenant}/groups/:id/roles`                       | Replace a group's roles                    |
| `PUT`    | `/admin/tenants/{tenant}/groups/:id/default`                     | Set whether new subjects join a group      |
| `GET`    | `/admin/tenants/{tenant}/scopes`                                 | List client scopes                         |
| `GET`    | `/admin/tenants/{tenant}/scopes/count`                           | Count client scopes                        |
| `POST`   | `/admin/tenants/{tenant}/scopes`                                 | Create a client scope                      |
| `GET`    | `/admin/tenants/{tenant}/scopes/:id`                             | Read a client scope                        |
| `PATCH`  | `/admin/tenants/{tenant}/scopes/:id`                             | Amend a client scope                       |
| `DELETE` | `/admin/tenants/{tenant}/scopes/:id`                             | Delete a client scope                      |
| `GET`    | `/admin/tenants/{tenant}/scopes/:id/roles`                       | Read a scope's roles                       |
| `PUT`    | `/admin/tenants/{tenant}/scopes/:id/roles`                       | Replace a scope's roles                    |
| `GET`    | `/admin/tenants/{tenant}/scopes/:id/clients`                     | List the clients a scope is assigned to    |
| `PUT`    | `/admin/tenants/{tenant}/scopes/:id/clients/:clientId`           | Assign a scope to a client                 |
| `DELETE` | `/admin/tenants/{tenant}/scopes/:id/clients/:clientId`           | Unassign a scope from a client             |
| `GET`    | `/admin/tenants/{tenant}/scopes/:id/mappers`                     | Read a scope's claim mapper bindings       |
| `PUT`    | `/admin/tenants/{tenant}/scopes/:id/mappers`                     | Replace a scope's claim mapper bindings    |
| `GET`    | `/admin/tenants/{tenant}/keys`                                   | List signing keys                          |
| `POST`   | `/admin/tenants/{tenant}/keys`                                   | Stage a signing key                        |
| `POST`   | `/admin/tenants/{tenant}/keys/:id/promote`                       | Promote a signing key                      |
| `POST`   | `/admin/tenants/{tenant}/keys/:id/retire`                        | Retire a signing key                       |
| `DELETE` | `/admin/tenants/{tenant}/keys/:id`                               | Delete a retired signing key               |
| `GET`    | `/admin/tenants/{tenant}/flow/executions`                        | Read a tenant's authentication flow        |
| `PUT`    | `/admin/tenants/{tenant}/flow/executions`                        | Replace a tenant's authentication flow     |
| `GET`    | `/admin/tenants/{tenant}/smtp`                                   | Read a tenant's own SMTP configuration     |
| `PUT`    | `/admin/tenants/{tenant}/smtp`                                   | Replace a tenant's own SMTP configuration  |
| `DELETE` | `/admin/tenants/{tenant}/smtp`                                   | Remove a tenant's own SMTP configuration   |
| `POST`   | `/admin/tenants/{tenant}/smtp/test`                              | Send one test message                      |
| `GET`    | `/admin/tenants/{tenant}/mail`                                   | List the tenant's outgoing mail            |
| `GET`    | `/admin/tenants/{tenant}/audit`                                  | List the tenant's audit trail              |
| `GET`    | `/admin/tenants/{tenant}/audit/count`                            | Count audit events                         |
| `GET`    | `/admin/tenants/{tenant}/audit/export`                           | Export audit events as NDJSON              |
| `GET`    | `/admin/openapi.json`                                            | The OpenAPI reference                      |

### A refusal names its field

A `400` that names something in the request carries `errors` beside
`detail`, one entry per field: `path` is the field's JSON path within the
query string or body — `port`, `document.clients[0].redirect_uris`,
`[1].authenticator` for the second step of a flow — and `message` is what
is wrong with it. `detail` is unchanged prose, so a caller that reads it
still can. A refusal of the request as a whole, such as a flow with no
steps or a test send to a tenant with no SMTP configuration, names no
field and carries no `errors`. Captured against the fifth stack, in a
tenant `fields-demo` created for it, as `ada-t2`:

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
  http://localhost:3080/admin/tenants/fields-demo/subjects/01a0e9e0-b50c-79e0-acf2-6b76955f097c/roles
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -H 'If-Match: "2e028692eeb04a65ef6a06be482c11d71247d243b5929007716ee0f4eb2324db"' \
  -d '[{"authenticator":"password","requirement":"required"},{"authenticator":"password","requirement":"alternative"}]' \
  http://localhost:3080/admin/tenants/fields-demo/flow/executions
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"unknown role id(s): 0199aa00-0000-7000-8000-0000000000ff","errors":[{"path":"role_ids","message":"names no role 0199aa00-0000-7000-8000-0000000000ff"}],"instance":"01a0e9e0-b564-7765-81f0-d8ddb655a845"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"authenticator \"password\" appears more than once; a step is addressed by its authenticator, so a repeat has no unambiguous meaning","errors":[{"path":"[1].authenticator","message":"repeats an earlier step"}],"instance":"01a0e9e0-b598-7331-95af-09ef6837a5c3"}
```

### A create answers its `ETag`

Every `POST` that creates a record answers `ETag` beside its `201` — the
same one the record's own `GET` answers, so the first save after a create
needs no read first. A signing key and a registration token have no read
of their own; theirs is the one their entry in the list is taken over,
never over the one-time `token`. `POST /subjects/:id/password` creates no
record, and answers none. Captured against the sixth stack, in a tenant
`etags-demo` created for it:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"name":"billing-viewer"}' http://localhost:3080/admin/tenants/etags-demo/roles
curl -sS -D - -o /dev/null -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3080/admin/tenants/etags-demo/roles/01a0ea4c-4996-7260-b924-f88ed7f2d974
```

The status line, the `etag` header and the body of each, other headers
left out:

```
HTTP/1.1 201 Created
etag: "13a0a2b0291e07a7160f502571cbb69ff6e1fc71e1dab86f24ca0f8899fa24ee"
{"id":"01a0ea4c-4996-7260-b924-f88ed7f2d974","name":"billing-viewer","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-09-28T23:14:23.253Z"}
HTTP/1.1 200 OK
etag: "13a0a2b0291e07a7160f502571cbb69ff6e1fc71e1dab86f24ca0f8899fa24ee"
```

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

### The admin client's registered URIs

`odudu-admin` is registered the loopback redirect URI
`http://127.0.0.1:8080/callback` that the flow above ends on, and — while
the console is on (`ODUDU_CONSOLE`, `true` by default) — two more built
from `ODUDU_PUBLIC_BASE_URL`: the redirect URI
`${ODUDU_PUBLIC_BASE_URL}/console/auth/callback` and the post-logout
redirect URI `${ODUDU_PUBLIC_BASE_URL}/console/`. `seed admin`,
`seed tenant`, `seed --tenant`, `POST /admin/tenants` and
`POST /admin/tenant-imports` write them; none is ever taken from a
request's `Host`. The query is scoped to the `system` tenant's own admin
client, captured on the compose stack with this branch's image, whose
database held 31 tenants. psql ends each header line with a space, trimmed
in every block below:

```bash
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "select c.redirect_uris, c.post_logout_redirect_uris from client_oidc_config c join clients k on k.id = c.client_id join tenants t on t.id = k.tenant_id where t.name = 'system' and k.client_id = 'odudu-admin';"
```

A `system` tenant seeded before the console existed carries the loopback
alone:

```
          redirect_uris           | post_logout_redirect_uris
----------------------------------+---------------------------
 {http://127.0.0.1:8080/callback} | {}
(1 row)
```

`odudu console provision` re-runs `provisionAdminClient` over every
tenant — the command to run after setting or changing the base, since
redirect matching is exact. Its stderr carries only Node's experimental
Web Crypto warnings, discarded here:

```bash
docker compose exec -T odudu node dist/main.js console provision 2>/dev/null
```

```
provisioned 31 tenants
```

and the same query then reads:

```
                                redirect_uris                                 |    post_logout_redirect_uris
------------------------------------------------------------------------------+----------------------------------
 {http://127.0.0.1:8080/callback,http://localhost:3000/console/auth/callback} | {http://localhost:3000/console/}
(1 row)
```

A run under another base replaces both console URIs rather than adding a
second pair, and keeps the loopback. Captured again after rebuilding the
image at this commit:

```bash
docker compose exec -T -e ODUDU_PUBLIC_BASE_URL=http://127.0.0.1:3000 odudu \
  node dist/main.js console provision 2>/dev/null
```

```
provisioned 31 tenants
```

The same psql query then reads:

```
                                redirect_uris                                 |    post_logout_redirect_uris
------------------------------------------------------------------------------+----------------------------------
 {http://127.0.0.1:8080/callback,http://127.0.0.1:3000/console/auth/callback} | {http://127.0.0.1:3000/console/}
(1 row)
```

Running the plain command again, under the stack's own base:

```bash
docker compose exec -T odudu node dist/main.js console provision 2>/dev/null
```

```
provisioned 31 tenants
```

puts the `http://localhost:3000` pair back, and the query reads:

```
                                redirect_uris                                 |    post_logout_redirect_uris
------------------------------------------------------------------------------+----------------------------------
 {http://127.0.0.1:8080/callback,http://localhost:3000/console/auth/callback} | {http://localhost:3000/console/}
(1 row)
```

With the console off the command refuses, since it has nothing to
register, and exits `1`. The refusal is written to stderr, so this block
merges stderr instead of discarding it. It is unfiltered: the refusal comes
before anything loads Web Crypto, so no experimental-feature warning is
printed, and the refusal is the only line:

```bash
docker compose exec -T -e ODUDU_CONSOLE=false odudu node dist/main.js console provision 2>&1
```

```
console provision has nothing to register while ODUDU_CONSOLE=false
```

The server itself refuses to boot with the console on and no base, and
with an `https` base while `ODUDU_TRUST_PROXY` is off — the console
reaches the OIDC endpoints in-process, and only a trusted
`x-forwarded-proto` lets such a request see the `https` issuer the browser
sees. Each was run as a second process inside the running container, so
the guard fires before anything binds a port:

```bash
docker compose exec -T odudu env -u ODUDU_PUBLIC_BASE_URL node dist/main.js 2>&1 | grep '^OduduError'
docker compose exec -T -e ODUDU_PUBLIC_BASE_URL=https://idp.example.test odudu \
  node dist/main.js 2>&1 | grep '^OduduError'
```

```
OduduError: ODUDU_PUBLIC_BASE_URL is required while the administration console is on: its redirect URI is built from that base and never from a request header. Set it, or set ODUDU_CONSOLE=false to serve no console.
OduduError: ODUDU_PUBLIC_BASE_URL is https://idp.example.test, but ODUDU_TRUST_PROXY is off. The console reaches this server in-process, where only a trusted x-forwarded-proto can present the https issuer the browser sees. Set ODUDU_TRUST_PROXY=true behind the TLS-terminating proxy, or set ODUDU_CONSOLE=false.
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

The searches below ran against the sixth stack (the note at the top of
this document), as `ada`. Its tenants were `acme`, `demo`, `etags-demo`,
`register-audit`, `registration-audit`, `reset-audit`, `signup-audit` and
`system`, only `system` carrying a display name. `RE` finds three, in
folded order:

```bash
curl -sS \
  -H "Authorization: Bearer $SYSTEM_ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants?name=RE"
```

```
{"items":[{"id":"01a0ea4d-1647-757b-8635-57ab1ac4d518","name":"register-audit","display_name":null,"enabled":true,"created_at":"2026-09-28T23:15:15.656Z"},{"id":"01a0ea4d-167d-7480-af45-b58c2bf96cbf","name":"registration-audit","display_name":null,"enabled":true,"created_at":"2026-09-28T23:15:15.709Z"},{"id":"01a0ea4d-16b5-70ca-8567-d7268cbcbe18","name":"reset-audit","display_name":null,"enabled":true,"created_at":"2026-09-28T23:15:15.766Z"}]}
```

One at a time, the `Link` header carries the search forward:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $SYSTEM_ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants?name=re&limit=1"
```

```
HTTP/1.1 200 OK
x-request-id: 01a0ea4d-1731-7ef6-9357-282bc886419b
cache-control: no-store
link: </admin/tenants?limit=1&name=re&cursor=eyJhZnRlciI6IjAxYTBlYTRkLTE2NDctNzU3Yi04NjM1LTU3YWIxYWM0ZDUxOCIsInNvcnQiOiJyZWdpc3Rlci1hdWRpdCIsImNvbGxlY3Rpb24iOiJ0ZW5hbnRzIiwidGVuYW50SWQiOiIwMTk5YWEwMC0wMDAwLTcwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJmaWx0ZXJzIjoiMUo1ZVF0UmJjX2QtVnhmRjUzNEUzekYtbDVwMGZfVUxMa0JWRm1xNXVjWSJ9.T5n5x7r9Ix4tq2JdXPzmt4YrS9wiWceZ6I4DKVFub3Y>; rel="next"
content-type: application/json; charset=utf-8
content-length: 478
Date: Mon, 28 Sep 2026 23:15:15 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a0ea4d-1647-757b-8635-57ab1ac4d518","name":"register-audit","display_name":null,"enabled":true,"created_at":"2026-09-28T23:15:15.656Z"}],"next":"eyJhZnRlciI6IjAxYTBlYTRkLTE2NDctNzU3Yi04NjM1LTU3YWIxYWM0ZDUxOCIsInNvcnQiOiJyZWdpc3Rlci1hdWRpdCIsImNvbGxlY3Rpb24iOiJ0ZW5hbnRzIiwidGVuYW50SWQiOiIwMTk5YWEwMC0wMDAwLTcwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJmaWx0ZXJzIjoiMUo1ZVF0UmJjX2QtVnhmRjUzNEUzekYtbDVwMGZfVUxMa0JWRm1xNXVjWSJ9.T5n5x7r9Ix4tq2JdXPzmt4YrS9wiWceZ6I4DKVFub3Y"}
```

Following that link, then replaying its cursor with `?enabled=true` added:

```bash
CURSOR='eyJhZnRlciI6IjAxYTBlYTRkLTE2NDctNzU3Yi04NjM1LTU3YWIxYWM0ZDUxOCIsInNvcnQiOiJyZWdpc3Rlci1hdWRpdCIsImNvbGxlY3Rpb24iOiJ0ZW5hbnRzIiwidGVuYW50SWQiOiIwMTk5YWEwMC0wMDAwLTcwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJmaWx0ZXJzIjoiMUo1ZVF0UmJjX2QtVnhmRjUzNEUzekYtbDVwMGZfVUxMa0JWRm1xNXVjWSJ9.T5n5x7r9Ix4tq2JdXPzmt4YrS9wiWceZ6I4DKVFub3Y'
curl -sS \
  -H "Authorization: Bearer $SYSTEM_ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants?limit=1&name=re&cursor=$CURSOR"
curl -sS \
  -H "Authorization: Bearer $SYSTEM_ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants?limit=1&name=re&enabled=true&cursor=$CURSOR"
```

```
{"items":[{"id":"01a0ea4d-167d-7480-af45-b58c2bf96cbf","name":"registration-audit","display_name":null,"enabled":true,"created_at":"2026-09-28T23:15:15.709Z"}],"next":"eyJhZnRlciI6IjAxYTBlYTRkLTE2N2QtNzQ4MC1hZjQ1LWI1OGMyYmY5NmNiZiIsInNvcnQiOiJyZWdpc3RyYXRpb24tYXVkaXQiLCJjb2xsZWN0aW9uIjoidGVuYW50cyIsInRlbmFudElkIjoiMDE5OWFhMDAtMDAwMC03MDAwLTgwMDAtMDAwMDAwMDAwMDAxIiwiZmlsdGVycyI6IjFKNWVRdFJiY19kLVZ4ZkY1MzRFM3pGLWw1cDBmX1VMTGtCVkZtcTV1Y1kifQ.3HZZKoeW5A2l6WNkxkBsTcirmh8ygRRWXa0lJ5GNs9g"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"cursor is invalid or expired","errors":[{"path":"cursor","message":"is invalid or expired"}],"instance":"01a0ea4d-177f-7a25-9ea3-ba5cf205d873"}
```

`?display_name=SYS`, then three refusals: two search fields at once (the
handler's), an `enabled` that is not `true` or `false`, and an unknown
parameter (both the generated schema's):

```bash
curl -sS \
  -H "Authorization: Bearer $SYSTEM_ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants?display_name=SYS"
curl -sS \
  -H "Authorization: Bearer $SYSTEM_ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants?name=a&display_name=b"
curl -sS \
  -H "Authorization: Bearer $SYSTEM_ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants?enabled=yes"
curl -sS \
  -H "Authorization: Bearer $SYSTEM_ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants?search=demo"
```

```
{"items":[{"id":"0199aa00-0000-7000-8000-000000000001","name":"system","display_name":"System","enabled":true,"created_at":"2026-09-28T23:13:57.123Z"}]}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"search one field at a time: name or display_name, not both","errors":[{"path":"display_name","message":"search one field at a time: name or display_name, not both"}],"instance":"01a0ea4d-17a9-7246-9f2e-e0159658eb36"}
{"type":"about:blank","title":"Error","status":400,"detail":"querystring/enabled must be equal to one of the allowed values","errors":[{"path":"enabled","message":"must be equal to one of the allowed values"}],"instance":"01a0ea4d-17bd-7645-b759-17bea0c113d6"}
{"type":"about:blank","title":"Error","status":400,"detail":"querystring must NOT have additional properties: search","errors":[{"path":"search","message":"must NOT have additional properties"}],"instance":"01a0ea4d-17c7-716b-9c2e-ef4188a269d2"}
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
  -d '{"name": "showcase", "display_name": "Showcase"}' \
  http://localhost:3080/admin/tenants
```

```
HTTP/1.1 201 Created
x-request-id: 01a0ea4d-c754-76a2-bbf6-ec2ae6386937
cache-control: no-store
etag: "2d683197c5f4fe27d0a0d6521f2038605964ad36a6d949d9962050fe63c463dd"
content-type: application/json; charset=utf-8
content-length: 144
Date: Mon, 28 Sep 2026 23:16:01 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a0ea4d-c75e-7ac7-abe7-cdb5a6b2bbad","name":"showcase","display_name":"Showcase","enabled":true,"created_at":"2026-09-28T23:16:00.990Z"}
```

Captured against the sixth stack (the note at the top of this document),
whose `demo` had already been created by then, so the create above names a
tenant of its own, `showcase`. The `etag` header is the one
`GET /admin/tenants/showcase` answers.

Both refusals, against that same stack — the reserved name, then the name
the call above had just taken:

```
{"type":"about:blank","title":"Conflict","status":409,"detail":"the name \"system\" is reserved","instance":"01a0ea4d-e458-716d-b8f4-40f64c2a23d9"}
{"type":"about:blank","title":"Conflict","status":409,"detail":"the name \"showcase\" is already in use","instance":"01a0ea4d-e471-75f2-9cc8-f15b363d1512"}
```

And the DNS-label refusal, against the same stack — the request above
with `Acme` in place of `showcase`:

```bash
{"items":[{"id":"01a0ea4d-1647-757b-8635-57ab1ac4d518","name":"register-audit","display_name":null,"enabled":true,"created_at":"2026-09-28T23:15:15.656Z"},{"id":"01a0ea4d-167d-7480-af45-b58c2bf96cbf","name":"registration-audit","display_name":null,"enabled":true,"created_at":"2026-09-28T23:15:15.709Z"},{"id":"01a0ea4d-16b5-70ca-8567-d7268cbcbe18","name":"reset-audit","display_name":null,"enabled":true,"created_at":"2026-09-28T23:15:15.766Z"}]}
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a0ea4d-e49a-7a63-811d-5bade0233aea
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 367
Date: Mon, 28 Sep 2026 23:16:08 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Bad Request","status":400,"detail":"a tenant name must be 1-63 lowercase letters, digits or hyphens, and must not start or end with a hyphen","errors":[{"path":"name","message":"a tenant name must be 1-63 lowercase letters, digits or hyphens, and must not start or end with a hyphen"}],"instance":"01a0ea4d-e49a-7a63-811d-5bade0233aea"}
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
orphan both. That is a decision rather than a gap, and ADR 0039 makes it
permanent: a rename that reissued nothing would leave every relying party's
configured issuer pointing at a tenant that no longer answers. The refusal
names the way to do it instead — create a new tenant, export this one and
import it under the new name.

`enabled: false` is how a tenant is taken out of service without deleting
it: its own administrators stop authenticating, so the flag is not one to
set from a token issued by the tenant being disabled. On the **system**
tenant it is refused with `409` — every cross-tenant administrator
authenticates there, so disabling it would lock the whole deployment's
administration out with `psql` the only way back, the same reasoning that
guards the built-in admin client. Once a disable
has committed, every live session the tenant holds is ended, 500 to a
transaction, each batch queueing a Back-Channel Logout Token for each client
that registered a URI and writing a `session.end_all` row — the precondition
`DELETE /admin/tenants/{tenant}` below refuses without, which describes the
batches. Sending `{"enabled": false}` to a tenant already disabled ends any
session still live. `PATCH /settings` with `{"enabled": false}` does the same.
Re-enabling restores nothing.

Captured against the sixth stack, on the `showcase` tenant
`POST /admin/tenants` created there with `display_name: "Showcase"`. The
read, then an amendment, then the two refusals:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3080/admin/tenants/showcase
```

```
HTTP/1.1 200 OK
x-request-id: 01a0ea4e-884f-7a0a-8f24-30731b9da1ec
cache-control: no-store
etag: "2d683197c5f4fe27d0a0d6521f2038605964ad36a6d949d9962050fe63c463dd"
content-type: application/json; charset=utf-8
content-length: 144
Date: Mon, 28 Sep 2026 23:16:50 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a0ea4d-c75e-7ac7-abe7-cdb5a6b2bbad","name":"showcase","display_name":"Showcase","enabled":true,"created_at":"2026-09-28T23:16:00.990Z"}
```

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"display_name": "Showcase Holdings"}' \
  http://localhost:3080/admin/tenants/showcase

curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"name": "showcase-2"}' \
  http://localhost:3080/admin/tenants/showcase

curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"enabled": false}' \
  http://localhost:3080/admin/tenants/system
```

```
{"id":"01a0ea4d-c75e-7ac7-abe7-cdb5a6b2bbad","name":"showcase","display_name":"Showcase Holdings","enabled":true,"created_at":"2026-09-28T23:16:00.990Z"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"name: name is already in the issuer URL of every token this tenant has minted, and in the path of every admin and protocol request addressed to it; renaming it needs its own operation, not a general amendment","errors":[{"path":"name","message":"name is already in the issuer URL of every token this tenant has minted, and in the path of every admin and protocol request addressed to it; renaming it needs its own operation, not a general amendment"}],"instance":"01a0ea4e-abe7-7d8b-ab67-3413d1652bfd"}
{"type":"about:blank","title":"Conflict","status":409,"detail":"system is the tenant every cross-tenant administrator authenticates against and cannot be disabled","instance":"01a0ea4e-abfd-77ec-8f27-a082041215b6"}
```

Replaying the `ETag` from the read above — one generation stale after the
amendment — is refused and changes nothing:

```
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a0ea4e-ac11-7806-9118-fbea0bdb05e3"}
```

The name refusal's text was changed after the capture above: a rename is not
offered, permanently, by ADR 0039, and the refusal now says so rather than
pointing at an operation that will never exist. Against the tenth stack, the
tenant's and, for the same reason, a group's:

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"name": "ops-demo-2"}' \
  http://localhost:3082/admin/tenants/ops-demo; echo
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"name": "finance-2"}' \
  http://localhost:3082/admin/tenants/ops-demo/groups/01a0ee8b-2f54-7a5a-9da6-7ba6baacbe13; echo
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"name: name is already in the issuer URL of every token this tenant has minted, and in the path of every admin and protocol request addressed to it; a rename is not offered, by ADR 0039: create a new tenant, export this one and import it under the new name","errors":[{"path":"name","message":"name is already in the issuer URL of every token this tenant has minted, and in the path of every admin and protocol request addressed to it; a rename is not offered, by ADR 0039: create a new tenant, export this one and import it under the new name"}],"instance":"01a0ee9e-a4d8-72b1-9896-b14ad3d19376"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"name: name is embedded in every descendant path and in the groups claim a relying party matches on; a rename is not offered, by ADR 0039: create a new group and move its members","errors":[{"path":"name","message":"name is embedded in every descendant path and in the groups claim a relying party matches on; a rename is not offered, by ADR 0039: create a new group and move its members"}],"instance":"01a0ee9e-a4ed-7b89-9fdd-193dd93a8064"}
```

## `DELETE /admin/tenants/{tenant}`

Requires `manage-tenants`, the capability every other route over the tenant
collection takes, so only a system administrator reaches it. Deletes the
tenant and every row it holds, in one statement: every table holding a
tenant's rows is reached by a cascade from `tenants`, directly or through a
subject or a client, and `packages/protocol-admin/tests/tenant-delete.int.test.ts`
counts every table carrying a `tenant_id`, read from the catalogue, before
and after.
`confirm` must be the tenant's own name — a slip of the path deletes nothing —
refused with `400` naming it otherwise. The `system` tenant is refused with
`409`: every cross-tenant administrator authenticates against it. So is a
caller who does not hold every admin capability some subject of the tenant
holds, with `403`: deleting the tenant takes all of it at once (ADR 0040's
target ceiling, over every subject). The tenant's own trail goes with it, so
`tenant.delete` is recorded in the `system` tenant's, in the same transaction
(`withTenantThen`, `@odudu/db`), and so are its refusals. No
last-administrator guard is needed beside the refusal of `system`: a
system administrator's authority lives in `system`, which no deletion reaches.

No relying party is left signed in without having been sent a Back-Channel
Logout Token. So an enabled tenant is refused with `409`,
`about:blank#tenant-enabled`. Disabling it first — `PATCH /admin/tenants/{tenant}`
or `PATCH /settings` with `{"enabled": false}` — commits the disable on its
own, then ends every live session it holds, with no ceiling, 500 to a
transaction, queueing a Logout Token for each client that registered a
back-channel URI, the way `DELETE /sessions` does; each batch writes a
`session.end_all` row with `via: "tenant_disabled"`. The answer comes once
none is left. Should a batch fail, the disable stands and the answer is `500`,
`about:blank#sessions-not-ended`, saying how many sessions are still live;
sending `{"enabled": false}` again ends the rest. So a tenant that still has a
live session is refused with `409`, `about:blank#sessions-live`, naming how
many. The batches run in the request rather than in a scheduled pass: a
session ends in a few statements, so even a large tenant is done in the
request, the operator learns there whether it finished, and nothing new has
to be enabled, scheduled or watched for it. A tenant whose tokens are still
to be sent is refused with `409`, `about:blank#logout-deliveries-pending`,
naming how many; one that was delivered, or that spent its last attempt, is
not waited for, since it will never be offered again.

A disabled tenant keeps answering its discovery document and `/certs`, and
nothing else: the Logout Tokens its disable queued are signed with its keys,
and a relying party validates each against them (Back-Channel Logout 1.0
§2.6). Deleting the tenant removes them.

One window no deletion can close. A resource server that verifies access
tokens itself, against a cached copy of the tenant's JWKS, accepts one
issued before the tenant was disabled until it expires — at most 3600
seconds, the cap on `access_token_ttl_seconds`. Disabling ends the sessions
and refresh tokens behind it; it cannot recall a token already handed out.

The deletion is one transaction, so a very large tenant cascades inside one
request, holding its locks until the last row is gone. A tenant-scoped write
that raced it and began second fails its foreign-key check once the
deletion commits, and answers `500`; nothing is orphaned, since the row it
needed is gone and it writes nothing.

Against an eleventh stack — compose project `odudu-t8b2` again, on 3082 and
5464, brought up from an empty volume with the tenth's settings and
`ada-t8b2` seeded in `system`, its image built from this branch at `cd930b59`
— a tenant `doomed` created through `POST /admin/tenants`, given a
client through `POST /clients`, its id
`01a0ef1f-415e-75a4-b079-953dc3de7ae0`. `count-rows.sql` counts that id's rows
in every table with a `tenant_id` column, as the database's owner:

```
SELECT table_name,
       (xpath('/row/n/text()', query_to_xml(format(
         'select count(*) as n from %I where tenant_id = %L',
         table_name, '01a0ef1f-415e-75a4-b079-953dc3de7ae0'), false, true, '')))[1]::text::int AS n
  FROM information_schema.columns
 WHERE table_schema = 'public' AND column_name = 'tenant_id'
 ORDER BY n DESC, table_name;
```

`ada` was seeded in it with `odudu seed user` and signed in once through
`doomed-app`, a confidential client with a back-channel logout URI of
`https://postgres:9/backchannel`, where nothing listens. Before, three
refusals — no `confirm`, a wrong one, and `system` — then the refusal of an
enabled tenant; its disabling, which ended `ada`'s session in one batch and
queued one token; the batch's row; the disabled tenant's discovery document
and key set, still served, beside a `/token` it refuses; a session written
straight into the table after the disable, and the refusal it causes; the
disable sent again, which ends it; the refusal while the token is pending;
five passes of the sender a minute apart, each a failure, the fifth its last
attempt; the deletion; a read of the tenant, its discovery document and key
set, now gone; after; and `system`'s trail:

```bash
A="Authorization: Bearer $ADMIN_TOKEN"
T=http://localhost:3082/admin/tenants
O=http://localhost:3082/tenants/doomed
pg() { docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f -'; }
pg < count-rows.sql
curl -sS -X DELETE -H "$A" "$T/doomed"; echo
curl -sS -X DELETE -H "$A" "$T/doomed?confirm=Doomed"; echo
curl -sS -X DELETE -H "$A" "$T/system?confirm=system"; echo
curl -sS -X DELETE -H "$A" "$T/doomed?confirm=doomed"; echo
curl -sS -X PATCH -H "$A" -H 'content-type: application/json' -d '{"enabled":false}' "$T/doomed"; echo
curl -sS -H "$A" "$T/doomed/audit?action=session.end_all" \
  | python3 -c 'import json,sys;[print(json.dumps({k:i[k] for k in ("action","actor_name","detail")})) for i in json.load(sys.stdin)["items"]]'
for p in .well-known/openid-configuration protocol/openid-connect/certs protocol/openid-connect/token; do
  printf '%-40s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "$O/$p")"
done
curl -sS "$O/protocol/openid-connect/certs" | python3 -c 'import json,sys;print([k["kid"] for k in json.load(sys.stdin)["keys"]])'
echo "INSERT INTO sessions (id, tenant_id, subject_id, expires_at, last_active_at, secret_hash)
  SELECT gen_random_uuid(), tenant_id, subject_id, now() + interval '1 hour', now(), md5('late')
    FROM users WHERE tenant_id = '01a0ef1f-415e-75a4-b079-953dc3de7ae0' AND username = 'ada';" | pg
curl -sS -X DELETE -H "$A" "$T/doomed?confirm=doomed"; echo
curl -sS -o /dev/null -w '%{http_code}\n' -X PATCH -H "$A" -H 'content-type: application/json' \
  -d '{"enabled":false}' "$T/doomed"
curl -sS -X DELETE -H "$A" "$T/doomed?confirm=doomed"; echo
for pass in 1 2 3 4 5; do
  docker compose exec -T odudu node dist/main.js send-logouts 2>/dev/null
  [ "$pass" = 5 ] || sleep 61
done
curl -sS -D - -X DELETE -H "$A" "$T/doomed?confirm=doomed"
curl -sS -H "$A" "$T/doomed"; echo
for p in .well-known/openid-configuration protocol/openid-connect/certs; do
  printf '%-40s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "$O/$p")"
done
pg < count-rows.sql
curl -sS -H "$A" "$T/system/audit?action=tenant.delete&resource_type=tenant&resource_id=01a0ef1f-415e-75a4-b079-953dc3de7ae0" \
  | python3 -c 'import json,sys;[print(json.dumps({k:i[k] for k in ("action","outcome","actor_name","resource_id","detail")})) for i in json.load(sys.stdin)["items"]]'
curl -sS -H "$A" "$T/system/audit?action=tenant.delete&outcome=refused&limit=1" \
  | python3 -c 'import json,sys;[print(json.dumps({k:i[k] for k in ("action","outcome","actor_name","resource_id","detail")})) for i in json.load(sys.stdin)["items"]]'
```

```
          table_name           | n
-------------------------------+----
 client_scope_assignments      | 16
 client_scopes                 |  8
 role_composites               |  8
 roles                         |  8
 audit_events                  |  5
 authentication_executions     |  4
 client_oidc_config            |  2
 clients                       |  2
 subjects                      |  2
 authentication_sessions       |  1
 authorization_codes           |  1
 sessions                      |  1
 signing_keys                  |  1
 token_grants                  |  1
 user_credentials              |  1
 users                         |  1
 action_tokens                 |  0
 backchannel_logout_deliveries |  0
 client_assertion_jti          |  0
 client_registration_tokens    |  0
 client_scope_mappers          |  0
 client_scope_roles            |  0
 consent_scopes                |  0
 consents                      |  0
 console_logins                |  0
 console_sessions              |  0
 email_outbox                  |  0
 group_roles                   |  0
 groups                        |  0
 login_failures                |  0
 refresh_tokens                |  0
 subject_groups                |  0
 subject_roles                 |  0
 tenant_smtp                   |  0
 user_required_actions         |  0
(35 rows)

{"type":"about:blank","title":"Error","status":400,"detail":"querystring must have required property 'confirm'","errors":[{"path":"confirm","message":"must have required property 'confirm'"}],"instance":"01a0ef1f-51b7-77cc-a683-bf9043781642"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"confirm: must be the tenant’s own name, doomed","errors":[{"path":"confirm","message":"must be the tenant’s own name, doomed"}],"instance":"01a0ef1f-51ce-7b10-a100-eebf1c4fe3c9"}
{"type":"about:blank","title":"Conflict","status":409,"detail":"the system tenant is where every cross-tenant administrator authenticates, and is never deleted","instance":"01a0ef1f-5203-727b-ae1d-079ca4810cfb"}
{"type":"about:blank#tenant-enabled","title":"Conflict","status":409,"detail":"doomed is enabled: disable it first, which ends its sessions and tells their relying parties","instance":"01a0ef1f-523a-78db-b44d-9c982b92a47f"}
{"id":"01a0ef1f-415e-75a4-b079-953dc3de7ae0","name":"doomed","display_name":null,"enabled":false,"created_at":"2026-09-29T21:43:18.111Z"}
{"action": "session.end_all", "actor_name": null, "detail": {"via": "tenant_disabled", "ended": 1, "remaining": 0}}
.well-known/openid-configuration         200
protocol/openid-connect/certs            200
protocol/openid-connect/token            404
['01a0ef1f-41e5-7509-b721-b3a12b2168e4']
INSERT 0 1
{"type":"about:blank#sessions-live","title":"Conflict","status":409,"detail":"sessions still live: 1; disable doomed again to end them and tell their relying parties","instance":"01a0ef1f-54d2-7a78-b158-df25a7400b30"}
200
{"type":"about:blank#logout-deliveries-pending","title":"Conflict","status":409,"detail":"Back-Channel Logout Tokens still to be sent: 1; deleting the tenant would discard them","instance":"01a0ef1f-554e-7188-ae9b-a2ca513aa10b"}
{"ran":true,"delivered":0,"failed":1}
{"ran":true,"delivered":0,"failed":1}
{"ran":true,"delivered":0,"failed":1}
{"ran":true,"delivered":0,"failed":1}
{"ran":true,"delivered":0,"failed":1}
HTTP/1.1 204 No Content
x-request-id: 01a0ef23-1f57-7e1f-8774-24782c430191
cache-control: no-store
Date: Tue, 29 Sep 2026 21:47:31 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Unauthorized","status":401,"instance":"01a0ef23-1fad-7791-9255-113e6c46a30e"}
.well-known/openid-configuration         404
protocol/openid-connect/certs            404
          table_name           | n
-------------------------------+---
 action_tokens                 | 0
 audit_events                  | 0
 authentication_executions     | 0
 authentication_sessions       | 0
 authorization_codes           | 0
 backchannel_logout_deliveries | 0
 client_assertion_jti          | 0
 client_oidc_config            | 0
 client_registration_tokens    | 0
 client_scope_assignments      | 0
 client_scope_mappers          | 0
 client_scope_roles            | 0
 client_scopes                 | 0
 clients                       | 0
 consent_scopes                | 0
 consents                      | 0
 console_logins                | 0
 console_sessions              | 0
 email_outbox                  | 0
 group_roles                   | 0
 groups                        | 0
 login_failures                | 0
 refresh_tokens                | 0
 role_composites               | 0
 roles                         | 0
 sessions                      | 0
 signing_keys                  | 0
 subject_groups                | 0
 subject_roles                 | 0
 subjects                      | 0
 tenant_smtp                   | 0
 token_grants                  | 0
 user_credentials              | 0
 user_required_actions         | 0
 users                         | 0
(35 rows)

{"action": "tenant.delete", "outcome": "allowed", "actor_name": "ada-t8b2", "resource_id": "01a0ef1f-415e-75a4-b079-953dc3de7ae0", "detail": {"name": "doomed"}}
{"action": "tenant.delete", "outcome": "refused", "actor_name": "ada-t8b2", "resource_id": "0199aa00-0000-7000-8000-000000000001", "detail": {"name": "system", "reason": "system_tenant_guarded"}}
```

The read of `doomed` afterwards answers `401` rather than `404`: the router
resolves the tenant a path names before anything else, and an unknown one is
unauthenticated there, as it is for every route.

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
  http://localhost:3082/admin/tenants/export-demo/export
```

Recaptured against the twelfth stack (the note at the top of this document), in a tenant also named `export-demo` set up there the same way through the endpoints below — the confidential client `billing-app`, the role `billing-reader`, the group `finance` mapping it with `grace` in it, and the same SMTP relay — so its ids and timestamps are that run's, not those of the blocks around it:

```
HTTP/1.1 200 OK
x-request-id: 01a109b5-23bc-7377-9e8f-45413735b988
cache-control: no-store
content-type: application/vnd.odudu.tenant+json; charset=utf-8
content-length: 6598
Date: Mon, 05 Oct 2026 01:37:08 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"version":1,"settings":{"display_name":null,"enabled":true,"reset_password_allowed":false,"sso_session_idle_seconds":1800,"sso_session_max_seconds":36000,"password_min_length":8,"password_require_digit":false,"password_require_uppercase":false,"password_require_lowercase":false,"password_require_special":false,"password_not_username":true,"password_not_email":true,"password_history_depth":0,"password_max_age_days":0,"otp_required":false,"brute_force_max_failures":5,"brute_force_lockout_seconds":60,"brute_force_max_lockout_seconds":900,"brute_force_failure_reset_seconds":43200,"max_clients":200,"max_sessions_per_browser":25,"remember_me_allowed":false,"remember_me_idle_seconds":604800,"remember_me_max_seconds":2592000,"audit_retention_days":90,"username_editable":false,"access_token_ttl_seconds":300,"id_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"authorization_code_ttl_seconds":60,"login_ttl_seconds":1800,"verify_email_ttl_seconds":43200,"reset_password_ttl_seconds":300,"login_with_email":false,"audit_event_types":["admin_mutation","admin_access","authentication","session","token","credential"]},"flow":[{"authenticator":"passkey","requirement":"alternative"},{"authenticator":"password","requirement":"alternative"},{"authenticator":"otp","requirement":"conditional"},{"authenticator":"recovery-code","requirement":"conditional"}],"clients":[{"client_id":"billing-app","name":"Billing","description":null,"type":"confidential","enabled":true,"full_scope_allowed":false,"registration_origin":"operator","redirect_uris":["https://billing.example/callback"],"grant_types":["authorization_code"],"token_endpoint_auth_method":"client_secret_basic","audiences":[],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"service_account_roles":[]}],"roles":[{"name":"billing-reader","client":null,"description":null,"default_for_new_subjects":false,"builtin":false,"composites":[]},{"name":"manage-clients","client":"odudu-admin","description":null,"default_for_new_subjects":false,"builtin":true,"composites":[]},{"name":"manage-keys","client":"odudu-admin","description":null,"default_for_new_subjects":false,"builtin":true,"composites":[]},{"name":"manage-sessions","client":"odudu-admin","description":null,"default_for_new_subjects":false,"builtin":true,"composites":[]},{"name":"manage-tenant","client":"odudu-admin","description":null,"default_for_new_subjects":false,"builtin":true,"composites":[]},{"name":"manage-users","client":"odudu-admin","description":null,"default_for_new_subjects":false,"builtin":true,"composites":[{"name":"view-users","client":"odudu-admin"}]},{"name":"tenant-admin","client":"odudu-admin","description":null,"default_for_new_subjects":false,"builtin":true,"composites":[{"name":"manage-clients","client":"odudu-admin"},{"name":"manage-keys","client":"odudu-admin"},{"name":"manage-sessions","client":"odudu-admin"},{"name":"manage-tenant","client":"odudu-admin"},{"name":"manage-users","client":"odudu-admin"},{"name":"view-audit","client":"odudu-admin"},{"name":"view-users","client":"odudu-admin"}]},{"name":"view-audit","client":"odudu-admin","description":null,"default_for_new_subjects":false,"builtin":true,"composites":[]},{"name":"view-users","client":"odudu-admin","description":null,"default_for_new_subjects":false,"builtin":true,"composites":[]}],"groups":[{"path":"/finance","description":null,"default_for_new_subjects":false,"roles":[{"name":"billing-reader","client":null}]}],"scopes":[{"name":"address","description":null,"include_in_id_token":true,"include_in_access_token":false,"default_client_assignment":"default","consent_text":null,"display_order":0,"builtin":true,"roles":[],"mappers":[],"clients":[{"client_id":"billing-app","assignment":"default"}]},{"name":"email","description":null,"include_in_id_token":true,"include_in_access_token":false,"default_client_assignment":"default","consent_text":null,"display_order":0,"builtin":true,"roles":[],"mappers":[],"clients":[{"client_id":"billing-app","assignment":"default"}]},{"name":"groups","description":null,"include_in_id_token":false,"include_in_access_token":true,"default_client_assignment":"default","consent_text":null,"display_order":0,"builtin":true,"roles":[],"mappers":[],"clients":[{"client_id":"billing-app","assignment":"default"}]},{"name":"offline_access","description":null,"include_in_id_token":false,"include_in_access_token":false,"default_client_assignment":"optional","consent_text":null,"display_order":0,"builtin":true,"roles":[],"mappers":[],"clients":[{"client_id":"billing-app","assignment":"optional"}]},{"name":"openid","description":null,"include_in_id_token":true,"include_in_access_token":false,"default_client_assignment":"default","consent_text":null,"display_order":0,"builtin":true,"roles":[],"mappers":[],"clients":[{"client_id":"billing-app","assignment":"default"}]},{"name":"phone","description":null,"include_in_id_token":true,"include_in_access_token":false,"default_client_assignment":"default","consent_text":null,"display_order":0,"builtin":true,"roles":[],"mappers":[],"clients":[{"client_id":"billing-app","assignment":"default"}]},{"name":"profile","description":null,"include_in_id_token":true,"include_in_access_token":false,"default_client_assignment":"default","consent_text":null,"display_order":0,"builtin":true,"roles":[],"mappers":[],"clients":[{"client_id":"billing-app","assignment":"default"}]},{"name":"roles","description":null,"include_in_id_token":false,"include_in_access_token":true,"default_client_assignment":"default","consent_text":null,"display_order":0,"builtin":true,"roles":[],"mappers":[],"clients":[{"client_id":"billing-app","assignment":"default"}]}],"registration_policy":{"registration_allowed":false,"verify_email":false,"client_registration_policy":"disabled"},"smtp":{"host":"smtp.gmail.com","port":587,"from_address":"noreply@example.com","username":"mailer","starttls":true},"omitted":["clients[0].secret","smtp.password"]}
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
```

```
{"subjectId":"01a0e4c3-4083-7293-8831-26a05de70216","issuerTenantId":"01a0e4c2-de55-724f-8fb7-a92b9af1da21","capabilities":["manage-tenant"],"crossTenant":false}
{"type":"about:blank","title":"Forbidden","status":403,"instance":"01a0e5d9-ee19-720b-a216-800817e3c760"}
403 application/problem+json; charset=utf-8
```

An `include` other than `subjects` is refused by the generated schema,
naming the parameter — captured against the sixth stack, in a tenant also
named `export-demo`, created there for it:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/export-demo/export?include=sessions"
```

```
{"type":"about:blank","title":"Error","status":400,"detail":"querystring/include must be equal to constant","errors":[{"path":"include","message":"must be equal to constant"}],"instance":"01a0ea4f-9898-797d-8d56-525b96b6f6ca"}
```

The trail, scoped to this run — the exports (`$ADMIN_TOKEN`'s, allowed)
and then the two refusals (`tenant-operator`'s, naming `manage-clients`
both times):

Recaptured against the tenth stack, once each row answered `actor_name` and
`actor_origin`, after the same requests were made there in a tenant of the
same name — the same client, role, group, SMTP relay, `grace` and
`tenant-operator` — so the ids are that run's, not those above:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/export-demo/audit?action=tenant.export&from=$RUN_START"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/export-demo/audit?action=capability.refused&from=$RUN_START"; echo
```

```
{"items":[{"id":"01a0ee8d-ef61-7b06-9e71-2e3ae736de6d","occurred_at":"2026-09-29T19:04:34.385Z","event_type":"admin_mutation","action":"tenant.export","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0ee8a-bfb8-763c-ac22-0c8d97b0fada","actor_client_id":"01a0ee8a-bf72-77c9-a423-f61084924d9f","actor_name":null,"actor_origin":"system","resource_type":"tenant","resource_id":"01a0ee8d-dff4-720e-bdb4-15576ad2ebff","request_id":"01a0ee8d-ef48-7511-85ab-1f473209b38b","ip":"172.22.0.1","detail":{"include_subjects":true}},{"id":"01a0ee8d-ef44-7673-b602-460dcbf39665","occurred_at":"2026-09-29T19:04:34.364Z","event_type":"admin_mutation","action":"tenant.export","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0ee8a-bfb8-763c-ac22-0c8d97b0fada","actor_client_id":"01a0ee8a-bf72-77c9-a423-f61084924d9f","actor_name":null,"actor_origin":"system","resource_type":"tenant","resource_id":"01a0ee8d-dff4-720e-bdb4-15576ad2ebff","request_id":"01a0ee8d-ef34-7c17-9279-d86c8afed9c7","ip":"172.22.0.1","detail":{"include_subjects":false}},{"id":"01a0ee8d-ef2f-7aa6-a892-59e9c27d618e","occurred_at":"2026-09-29T19:04:34.339Z","event_type":"admin_mutation","action":"tenant.export","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0ee8a-bfb8-763c-ac22-0c8d97b0fada","actor_client_id":"01a0ee8a-bf72-77c9-a423-f61084924d9f","actor_name":null,"actor_origin":"system","resource_type":"tenant","resource_id":"01a0ee8d-dff4-720e-bdb4-15576ad2ebff","request_id":"01a0ee8d-ef14-77be-acb8-f45139b61f0a","ip":"172.22.0.1","detail":{"include_subjects":false}}]}
{"items":[{"id":"01a0ee8d-ef81-7a9a-9f95-bcd6e4e83f9b","occurred_at":"2026-09-29T19:04:34.433Z","event_type":"admin_access","action":"capability.refused","outcome":"refused","actor_tenant_id":"01a0ee8d-dff4-720e-bdb4-15576ad2ebff","actor_subject_id":"01a0ee8d-e7a7-7728-b5d1-5bac0435926e","actor_client_id":"01a0ee8d-e002-7eb7-859e-f2b6810e1c0f","actor_name":"tenant-operator","actor_origin":"tenant","resource_type":null,"resource_id":null,"request_id":"01a0ee8d-ef75-7140-acff-159dd214780b","ip":"172.22.0.1","detail":{"reason":"missing_capability","capability":"manage-clients"}},{"id":"01a0ee8d-ef71-7dc3-8778-ce07da5bd8e6","occurred_at":"2026-09-29T19:04:34.417Z","event_type":"admin_access","action":"capability.refused","outcome":"refused","actor_tenant_id":"01a0ee8d-dff4-720e-bdb4-15576ad2ebff","actor_subject_id":"01a0ee8d-e7a7-7728-b5d1-5bac0435926e","actor_client_id":"01a0ee8d-e002-7eb7-859e-f2b6810e1c0f","actor_name":"tenant-operator","actor_origin":"tenant","resource_type":null,"resource_id":null,"request_id":"01a0ee8d-ef65-7217-bf0f-f0ac27727a7c","ip":"172.22.0.1","detail":{"reason":"missing_capability","capability":"manage-clients"}}]}
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

The import itself, through its trail row below, was captured against the
sixth stack (the note at the top of this document), as `ada`.
`import-source` was built there for it through the endpoints in this
document: a confidential `client_credentials` client `billing-app`, a
tenant role `billing-reader`, a group `finance` holding it, and a subject
`grace` who belongs to it and owes `update-password`. The import names the
tenant `import-demo2`, as the capture it replaced did. Both tenants and the
secret below are throwaway, and that stack was torn down. The refusals from
the broken document on were captured against the fourth stack and are
unchanged by what the sixth adds.

The export, saved, then imported under a new name:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/import-source/export?include=subjects" > source.json
jq -n --slurpfile document source.json \
  '{name: "import-demo2", display_name: "Import demo", document: $document[0]}' \
  | curl -sS -D - -X POST \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      --data-binary @- \
      http://localhost:3080/admin/tenant-imports
```

```
HTTP/1.1 201 Created
x-request-id: 01a0ea50-3f09-7d61-ae37-ded07c55d6ab
cache-control: no-store
etag: "e484b4b5a55af9db632d4bfd1a78673cdf98b7c3e264d006de5be58f721de3f8"
content-type: application/json; charset=utf-8
content-length: 264
Date: Mon, 28 Sep 2026 23:18:42 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"tenant":{"id":"01a0ea50-3f1f-7f91-b047-452cba78ee10","name":"import-demo2","display_name":"Import demo","enabled":true,"created_at":"2026-09-28T23:18:42.719Z"},"client_secrets":[{"client_id":"billing-app","secret":"aDDFRqLnjfr4hBg9C8l2QQb6vqXn_pjMEe81LPIqTco"}]}
```

The secret it answered authenticates at the new tenant's `/token`:

```bash
curl -sS -u 'billing-app:aDDFRqLnjfr4hBg9C8l2QQb6vqXn_pjMEe81LPIqTco' \
  --data-urlencode 'grant_type=client_credentials' \
  http://localhost:3080/tenants/import-demo2/protocol/openid-connect/token \
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
  "http://localhost:3080/admin/tenants/import-demo2/export?include=subjects" > imported.json
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

Recaptured against the tenth stack, once each row answered `actor_name` and
`actor_origin`, after the same export and import were made there between
tenants of the same names, so the ids are that run's, not those above:

```bash
for tenant in import-source import-demo2; do
  curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
    "http://localhost:3082/admin/tenants/$tenant/keys" | jq -c '[.items[].kid]'
done
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/import-demo2/audit?action=tenant.import&resource_type=tenant&resource_id=01a0ee8e-894a-7532-b53c-436e1bf29d84"; echo
```

```
["01a0ee8e-88bc-73b0-ac5d-e23cf428d01a"]
["01a0ee8e-8967-7770-a633-9779f73c79db"]
{"items":[{"id":"01a0ee8e-89a2-7a21-9fa1-7624eeea8bb3","occurred_at":"2026-09-29T19:05:13.802Z","event_type":"admin_mutation","action":"tenant.import","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0ee8a-bfb8-763c-ac22-0c8d97b0fada","actor_client_id":"01a0ee8a-bf72-77c9-a423-f61084924d9f","actor_name":null,"actor_origin":"system","resource_type":"tenant","resource_id":"01a0ee8e-894a-7532-b53c-436e1bf29d84","request_id":"01a0ee8e-8939-7302-ac14-ae4fc690b455","ip":"172.22.0.1","detail":{"counts":{"roles":8,"groups":0,"scopes":8,"clients":1,"subjects":0},"source_version":1}}]}
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

And a document nesting the tenant role `billing-reader` under `view-users`,
built from a fresh export of `import-source` on this branch's head: refused
at the composite's own path, and no tenant created:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/import-source/export > source.json
jq -c '{name: "import-nested", document: (.roles |= map(
    if .builtin and .name == "view-users"
    then .composites += [{name: "billing-reader", client: null}] else . end))}' source.json \
  | curl -sS -X POST \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      --data-binary @- \
      http://localhost:3000/admin/tenant-imports
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3000/admin/tenants/count?name=import-nested'
echo
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"the import was refused for 1 problem(s), listed under errors","errors":[{"path":"document.roles[8].composites[0]","message":"nests billing-reader under view-users, which a new tenant provisions without it: nothing is nested under a capability role"}],"instance":"01a0e5f4-02ce-7c7b-9ed1-aa602860f2df"}
{"count":0,"capped":false}
```

## `GET /settings` and `PATCH /settings`

The 36 columns `tenants` carries beyond identity — everything
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
Setting `enabled` to `false` ends the tenant's sessions, once the change has
committed, exactly as `PATCH /admin/tenants/{tenant}` does.

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3082/admin/tenants/settings-demo/settings
```

Captured against `settings-demo`, a tenant created for this section through
`POST /admin/tenants` with `display_name` "Settings Demo", on the twelfth
stack, so every value but `display_name` is the migrations' own default:

```
HTTP/1.1 200 OK
x-request-id: 01a109b9-267d-7851-ba04-b8640c51baee
cache-control: no-store
etag: "4b3262c7d6324da17d231325ee0847e71ff7b4615485ffb2a29c35124f335b14"
content-type: application/json; charset=utf-8
content-length: 1205
Date: Mon, 05 Oct 2026 01:41:31 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"display_name":"Settings Demo","enabled":true,"registration_allowed":false,"verify_email":false,"reset_password_allowed":false,"sso_session_idle_seconds":1800,"sso_session_max_seconds":36000,"password_min_length":8,"password_require_digit":false,"password_require_uppercase":false,"password_require_lowercase":false,"password_require_special":false,"password_not_username":true,"password_not_email":true,"password_history_depth":0,"password_max_age_days":0,"otp_required":false,"brute_force_max_failures":5,"brute_force_lockout_seconds":60,"brute_force_max_lockout_seconds":900,"brute_force_failure_reset_seconds":43200,"client_registration_policy":"disabled","max_clients":200,"max_sessions_per_browser":25,"remember_me_allowed":false,"remember_me_idle_seconds":604800,"remember_me_max_seconds":2592000,"audit_retention_days":90,"username_editable":false,"access_token_ttl_seconds":300,"id_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"authorization_code_ttl_seconds":60,"login_ttl_seconds":1800,"verify_email_ttl_seconds":43200,"reset_password_ttl_seconds":300,"login_with_email":false,"audit_event_types":["admin_mutation","admin_access","authentication","session","token","credential"]}
```

Amending sends only the settings that change, and the response is the whole
object as it now reads, with a fresh `ETag` for the next `If-Match`:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"verify_email": true, "password_min_length": 14}' \
  http://localhost:3082/admin/tenants/settings-demo/settings
```

```
HTTP/1.1 200 OK
x-request-id: 01a109b9-268f-7826-9bea-9f78b47886a1
cache-control: no-store
etag: "3e3df2b9af1db77a14c2f4b445b6c4077aa90bf1ed899f5b92cf7e8c68caf21b"
content-type: application/json; charset=utf-8
content-length: 1205
Date: Mon, 05 Oct 2026 01:41:31 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"display_name":"Settings Demo","enabled":true,"registration_allowed":false,"verify_email":true,"reset_password_allowed":false,"sso_session_idle_seconds":1800,"sso_session_max_seconds":36000,"password_min_length":14,"password_require_digit":false,"password_require_uppercase":false,"password_require_lowercase":false,"password_require_special":false,"password_not_username":true,"password_not_email":true,"password_history_depth":0,"password_max_age_days":0,"otp_required":false,"brute_force_max_failures":5,"brute_force_lockout_seconds":60,"brute_force_max_lockout_seconds":900,"brute_force_failure_reset_seconds":43200,"client_registration_policy":"disabled","max_clients":200,"max_sessions_per_browser":25,"remember_me_allowed":false,"remember_me_idle_seconds":604800,"remember_me_max_seconds":2592000,"audit_retention_days":90,"username_editable":false,"access_token_ttl_seconds":300,"id_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"authorization_code_ttl_seconds":60,"login_ttl_seconds":1800,"verify_email_ttl_seconds":43200,"reset_password_ttl_seconds":300,"login_with_email":false,"audit_event_types":["admin_mutation","admin_access","authentication","session","token","credential"]}
```

A name this map does not know is refused with `400`, naming the settings it
does — which is also the one place the whole vocabulary is listed by the
server itself. Captured on the same stack and tenant:

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"nonesuch": true}' \
  http://localhost:3082/admin/tenants/settings-demo/settings
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"unknown tenant setting \"nonesuch\"; expected one of display_name, enabled, registration_allowed, verify_email, reset_password_allowed, sso_session_idle_seconds, sso_session_max_seconds, password_min_length, password_require_digit, password_require_uppercase, password_require_lowercase, password_require_special, password_not_username, password_not_email, password_history_depth, password_max_age_days, otp_required, brute_force_max_failures, brute_force_lockout_seconds, brute_force_max_lockout_seconds, brute_force_failure_reset_seconds, client_registration_policy, max_clients, max_sessions_per_browser, remember_me_allowed, remember_me_idle_seconds, remember_me_max_seconds, audit_retention_days, username_editable, access_token_ttl_seconds, id_token_ttl_seconds, refresh_token_ttl_seconds, authorization_code_ttl_seconds, login_ttl_seconds, verify_email_ttl_seconds, reset_password_ttl_seconds, login_with_email, audit_event_types","errors":[{"path":"nonesuch","message":"is not a tenant setting"}],"instance":"01a109b9-26a8-7436-8e4c-ae8456134de0"}
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

### Lifetimes, and signing in with an email address

Seven of the settings are lifetimes the code used to fix, each defaulting
to the constant it replaced (`0082_tenant_lifetimes.sql`):
`access_token_ttl_seconds` and `id_token_ttl_seconds` (`300`, `1` to
`3600`), `refresh_token_ttl_seconds` (`1209600`, at least `1`),
`authorization_code_ttl_seconds` (`60`, `1` to `600` — RFC 6749 §4.1.2's
ten minutes), `login_ttl_seconds` (`1800`, `60` to `86400`: how long a login
page may stay open), `verify_email_ttl_seconds` (`43200`, `60` to `604800`)
and `reset_password_ttl_seconds` (`300`, `60` to `86400`). The three token
lifetimes are defaults: a client's own `access_token_ttl_seconds`,
`id_token_ttl_seconds` or `refresh_token_ttl_seconds` overrides each, and a
client whose value is `null` takes the tenant's. Each is read where the
token, code, login or link is minted, so a change applies from the next
one. `login_with_email` (default `false`) lets the login form take a
verified email address where it takes a username — [Signing in with an
email address](request-paths.md#signing-in-with-an-email-address) walks
through it. Captured on the same stack and tenant, the response narrowed to
the settings this subsection is about:

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"access_token_ttl_seconds": 600, "id_token_ttl_seconds": 900, "authorization_code_ttl_seconds": 30, "login_ttl_seconds": 600, "reset_password_ttl_seconds": 900, "login_with_email": true}' \
  http://localhost:3082/admin/tenants/settings-demo/settings \
  | jq -c '{access_token_ttl_seconds, id_token_ttl_seconds, refresh_token_ttl_seconds, authorization_code_ttl_seconds, login_ttl_seconds, verify_email_ttl_seconds, reset_password_ttl_seconds, login_with_email}'
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"access_token_ttl_seconds": 7200, "authorization_code_ttl_seconds": 900, "reset_password_ttl_seconds": 30}' \
  http://localhost:3082/admin/tenants/settings-demo/settings
```

```
{"access_token_ttl_seconds":600,"id_token_ttl_seconds":900,"refresh_token_ttl_seconds":1209600,"authorization_code_ttl_seconds":30,"login_ttl_seconds":600,"verify_email_ttl_seconds":43200,"reset_password_ttl_seconds":900,"login_with_email":true}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"3 tenant setting(s) outside the permitted range, listed under errors","errors":[{"path":"access_token_ttl_seconds","message":"must be between 1 and 3600"},{"path":"authorization_code_ttl_seconds","message":"must be between 1 and 600"},{"path":"reset_password_ttl_seconds","message":"must be between 60 and 86400"}],"instance":"01a10930-cffb-71d9-bb78-4c1cacfd308d"}
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
amends — `description`, `client_uri`, `policy_uri`, `tos_uri`, `audiences`, `web_origins`, `post_logout_redirect_uris`,
`client_credentials_scopes`, `access_token_ttl_seconds`,
`id_token_ttl_seconds`, `refresh_token_ttl_seconds`, `consent_required`,
`token_exchange_impersonation_allowed`, `enabled`, `full_scope_allowed` and
`name` — each checked by the identical validation `PATCH` runs. A field
`PATCH` refuses to amend, such as `type`, is refused here with `PATCH`'s own
reason; a key that names nothing on the client at all is refused with `400`
and the detail `<field>: <field> is not a client field`, naming it rather
than silently ignoring it; `name` sent alongside a different `client_name`
is refused the same way. `access_token_ttl_seconds` or `id_token_ttl_seconds`
outside 1 to 3600 and `refresh_token_ttl_seconds` below 1 are refused with
`400`, naming the field, on a create and a `PATCH` alike — the ranges the
database's own CHECK constraints hold (`0013_access_token_ttl_ceiling.sql`,
`0014_refresh_token_ttl_floor.sql`, `0082_tenant_lifetimes.sql`), which
otherwise surfaced as a `500`. Each of the three may be `null`, which a
client created without one already is: the client then takes the tenant's
setting of the same name ([`GET /settings`](#get-settings-and-patch-settings)).
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

Creating a client that names both, against `demo`, then reading it back.
Recaptured against the twelfth stack, in a `demo` created there, which by
then held the four clients the search below names; the `etag` the create
answers is the one the read does:

```bash
curl -sS -D - -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"client_id": "demo-fields-check", "grant_types": ["client_credentials"], "token_endpoint_auth_method": "client_secret_basic", "audiences": ["https://api.demo.example"], "web_origins": ["https://app.demo.example"]}' \
  http://localhost:3082/admin/tenants/demo/clients
```

```
HTTP/1.1 201 Created
x-request-id: 01a109b6-1ef6-7a6d-9ff9-def5b5fc82e3
cache-control: no-store
etag: "6dc2242735aedc4c4bf99f04c2a1daf815a9cfa968efd12044dd8728c3dd1851"
content-type: application/json; charset=utf-8
content-length: 2015
Date: Mon, 05 Oct 2026 01:38:12 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a109b6-1f4b-791e-8e05-536475239e30","client_id":"demo-fields-check","name":"demo-fields-check","description":null,"type":"confidential","enabled":true,"full_scope_allowed":false,"registration_origin":"operator","created_at":"2026-10-05T01:38:12.868Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":["https://api.demo.example"],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":["https://app.demo.example"],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":"01a109b6-1f0b-7a0b-89d2-3a6006154ef9","scopes":[{"id":"01a109b6-1d8f-7df7-a3ef-36164961fbbc","name":"openid","assignment":"default"},{"id":"01a109b6-1d90-79dd-bd97-5ff11a7bdada","name":"profile","assignment":"default"},{"id":"01a109b6-1d91-74f8-b577-6243ce77a609","name":"email","assignment":"default"},{"id":"01a109b6-1d91-74f8-b577-6244f8af75ca","name":"address","assignment":"default"},{"id":"01a109b6-1d92-7ef2-9bb8-58e124a6313a","name":"phone","assignment":"default"},{"id":"01a109b6-1d92-7ef2-9bb8-58e210286ad3","name":"roles","assignment":"default"},{"id":"01a109b6-1d93-7e58-971c-61e1c1e76586","name":"groups","assignment":"default"},{"id":"01a109b6-1d94-7b22-b794-705545e99aeb","name":"offline_access","assignment":"optional"}],"client_secret":"dxCFsBxC72NKaBpbgeg4esoXJVPiAmnxX4VTgQwzJuk"}
```

`GET`ting it back shows both fields still set, from the row rather than the
create response — and now also carries `builtin_admin` and
`service_subject_id`, read from the same row a create response is:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3082/admin/tenants/demo/clients/01a109b6-1f4b-791e-8e05-536475239e30
```

```
HTTP/1.1 200 OK
x-request-id: 01a109b6-1f70-75e5-be6f-a96d7f3859f7
cache-control: no-store
etag: "6dc2242735aedc4c4bf99f04c2a1daf815a9cfa968efd12044dd8728c3dd1851"
content-type: application/json; charset=utf-8
content-length: 1953
Date: Mon, 05 Oct 2026 01:38:12 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a109b6-1f4b-791e-8e05-536475239e30","client_id":"demo-fields-check","name":"demo-fields-check","description":null,"type":"confidential","enabled":true,"full_scope_allowed":false,"registration_origin":"operator","created_at":"2026-10-05T01:38:12.868Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":["https://api.demo.example"],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":["https://app.demo.example"],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":"01a109b6-1f0b-7a0b-89d2-3a6006154ef9","scopes":[{"id":"01a109b6-1d8f-7df7-a3ef-36164961fbbc","name":"openid","assignment":"default"},{"id":"01a109b6-1d90-79dd-bd97-5ff11a7bdada","name":"profile","assignment":"default"},{"id":"01a109b6-1d91-74f8-b577-6243ce77a609","name":"email","assignment":"default"},{"id":"01a109b6-1d91-74f8-b577-6244f8af75ca","name":"address","assignment":"default"},{"id":"01a109b6-1d92-7ef2-9bb8-58e124a6313a","name":"phone","assignment":"default"},{"id":"01a109b6-1d92-7ef2-9bb8-58e210286ad3","name":"roles","assignment":"default"},{"id":"01a109b6-1d93-7e58-971c-61e1c1e76586","name":"groups","assignment":"default"},{"id":"01a109b6-1d94-7b22-b794-705545e99aeb","name":"offline_access","assignment":"optional"}]}
```

An unknown field, on the same tenant:

```bash
curl -sS -D - -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"client_id": "demo-bad-field", "grant_types": ["client_credentials"], "token_endpoint_auth_method": "client_secret_basic", "colour": "blue"}' \
  http://localhost:3080/admin/tenants/demo/clients
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a0ea52-011f-73ba-bd5f-6b38e61d7a99
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 225
Date: Mon, 28 Sep 2026 23:20:37 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Bad Request","status":400,"detail":"colour: colour is not a client field","errors":[{"path":"colour","message":"colour is not a client field"}],"instance":"01a0ea52-011f-73ba-bd5f-6b38e61d7a99"}
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
client's representation carries it and `service_subject_id` too. This
create, the psql listing and the disable/delete/rotate blocks under
`PATCH /clients/{id}`, `DELETE /clients/{id}` and `POST /clients/{id}/secret`
below were captured together against the sixth stack, in a tenant of their
own, `client-facts-demo`, created for them the same way `GET /admin/tenants`
above shows, as `ada`, and recaptured together, in the same order, against
the twelfth stack in a `client-facts-demo` of its own there, so the ids in
them are that run's; the `demo`-tenant blocks between them (the amendment
and `If-Match` narrative) come from an earlier, already-torn-down stack,
and say so where they appear:

```bash
curl -sS -D - -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"client_id": "demo-backend", "grant_types": ["client_credentials"], "token_endpoint_auth_method": "client_secret_basic"}' \
  http://localhost:3082/admin/tenants/client-facts-demo/clients
```

`201`, the whole client, the tenant's default scope assignments, and the
one-time secret. The `scopes` ids are `client-facts-demo`'s own, created
with the tenant above:

```
HTTP/1.1 201 Created
x-request-id: 01a109b6-1f86-7bb5-9871-718e564d3bca
cache-control: no-store
etag: "608cbb937c55671ada467480ebde194cc7ddf52ec4d186428f7382010cc44f55"
content-type: application/json; charset=utf-8
content-length: 1953
Date: Mon, 05 Oct 2026 01:38:13 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a109b6-1fa9-7304-8ae5-f714f746785e","client_id":"demo-backend","name":"demo-backend","description":null,"type":"confidential","enabled":true,"full_scope_allowed":false,"registration_origin":"operator","created_at":"2026-10-05T01:38:13.006Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":[],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":"01a109b6-1f8f-725e-9c2c-53656397b36c","scopes":[{"id":"01a109b6-1dd0-7600-9e14-7816d44df6e6","name":"openid","assignment":"default"},{"id":"01a109b6-1dd0-7600-9e14-7817de7c7d68","name":"profile","assignment":"default"},{"id":"01a109b6-1dd1-715a-b073-4693dd489102","name":"email","assignment":"default"},{"id":"01a109b6-1dd1-715a-b073-4694a189e4be","name":"address","assignment":"default"},{"id":"01a109b6-1dd2-747c-97bd-c431358429af","name":"phone","assignment":"default"},{"id":"01a109b6-1dd2-747c-97bd-c432be4c4a58","name":"roles","assignment":"default"},{"id":"01a109b6-1dd3-7b41-8bf3-e8da34d0a2c0","name":"groups","assignment":"default"},{"id":"01a109b6-1dd3-7b41-8bf3-e8db9126a263","name":"offline_access","assignment":"optional"}],"client_secret":"aqM0FSRyVaFFeminGXB-p7vS9OJvc2NbTiP50ZA1iyk"}
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
refused with `400` naming it. Recaptured against the twelfth stack, whose
`demo` held `demo-backend`, `demo-exchanger`, `demo-fields-check` and
`demo-operator` (confidential) and `demo-spa` (public):

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/demo/clients?client_id=DEMO&type=confidential&limit=1"
```

```
HTTP/1.1 200 OK
x-request-id: 01a109b6-1fbb-7ab9-a8ca-373352d5080c
cache-control: no-store
link: </admin/tenants/demo/clients?limit=1&client_id=DEMO&type=confidential&cursor=eyJhZnRlciI6IjAxYTEwOWI2LTFlMjUtNzE1NC05YTNjLTY4NmQwZTRkOTZkOCIsInNvcnQiOiJkZW1vLWJhY2tlbmQiLCJjb2xsZWN0aW9uIjoiY2xpZW50cyIsInRlbmFudElkIjoiMDFhMTA5YjYtMWQ4ZC03OGRhLTlkZjAtMGQyOGI3MmNlMmU4IiwiZmlsdGVycyI6Ik9BZENoUUxJNEt5UGtUMUhLc05ESld5WDM4NS1YaWFsQktSbkNXOUNPZHMifQ.CQafQT0JjW7vgY0nkERqkXNzPNAFpBYEIfvi3W82pZc>; rel="next"
content-type: application/json; charset=utf-8
content-length: 2223
Date: Mon, 05 Oct 2026 01:38:13 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a109b6-1e25-7154-9a3c-686d0e4d96d8","client_id":"demo-backend","name":"demo-backend","description":null,"type":"confidential","enabled":true,"full_scope_allowed":false,"registration_origin":"operator","created_at":"2026-10-05T01:38:12.614Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":[],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":"01a109b6-1e08-73b5-b63f-7e89c1af0ad1","scopes":[{"id":"01a109b6-1d8f-7df7-a3ef-36164961fbbc","name":"openid","assignment":"default"},{"id":"01a109b6-1d90-79dd-bd97-5ff11a7bdada","name":"profile","assignment":"default"},{"id":"01a109b6-1d91-74f8-b577-6243ce77a609","name":"email","assignment":"default"},{"id":"01a109b6-1d91-74f8-b577-6244f8af75ca","name":"address","assignment":"default"},{"id":"01a109b6-1d92-7ef2-9bb8-58e124a6313a","name":"phone","assignment":"default"},{"id":"01a109b6-1d92-7ef2-9bb8-58e210286ad3","name":"roles","assignment":"default"},{"id":"01a109b6-1d93-7e58-971c-61e1c1e76586","name":"groups","assignment":"default"},{"id":"01a109b6-1d94-7b22-b794-705545e99aeb","name":"offline_access","assignment":"optional"}]}],"next":"eyJhZnRlciI6IjAxYTEwOWI2LTFlMjUtNzE1NC05YTNjLTY4NmQwZTRkOTZkOCIsInNvcnQiOiJkZW1vLWJhY2tlbmQiLCJjb2xsZWN0aW9uIjoiY2xpZW50cyIsInRlbmFudElkIjoiMDFhMTA5YjYtMWQ4ZC03OGRhLTlkZjAtMGQyOGI3MmNlMmU4IiwiZmlsdGVycyI6Ik9BZENoUUxJNEt5UGtUMUhLc05ESld5WDM4NS1YaWFsQktSbkNXOUNPZHMifQ.CQafQT0JjW7vgY0nkERqkXNzPNAFpBYEIfvi3W82pZc"}
```

Following that link, then `?name=Demo-S`, each cut down with `jq` to the
fields that show the point; then the same cursor replayed with `?type=`
dropped:

```bash
CURSOR='eyJhZnRlciI6IjAxYTEwOWI2LTFlMjUtNzE1NC05YTNjLTY4NmQwZTRkOTZkOCIsInNvcnQiOiJkZW1vLWJhY2tlbmQiLCJjb2xsZWN0aW9uIjoiY2xpZW50cyIsInRlbmFudElkIjoiMDFhMTA5YjYtMWQ4ZC03OGRhLTlkZjAtMGQyOGI3MmNlMmU4IiwiZmlsdGVycyI6Ik9BZENoUUxJNEt5UGtUMUhLc05ESld5WDM4NS1YaWFsQktSbkNXOUNPZHMifQ.CQafQT0JjW7vgY0nkERqkXNzPNAFpBYEIfvi3W82pZc'
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/demo/clients?limit=1&client_id=DEMO&type=confidential&cursor=$CURSOR" \
  | jq -c '{items: [.items[] | {client_id, name, type}], next}'
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/demo/clients?name=Demo-S" \
  | jq -c '{items: [.items[] | {client_id, name, type}], next}'
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/demo/clients?limit=1&client_id=DEMO&cursor=$CURSOR"
```

```
{"items":[{"client_id":"demo-exchanger","name":"demo-exchanger","type":"confidential"}],"next":"eyJhZnRlciI6IjAxYTEwOWI2LTFlNjQtNzQzMi1iMmRjLTI5OTQ0NmE1Y2Y1NyIsInNvcnQiOiJkZW1vLWV4Y2hhbmdlciIsImNvbGxlY3Rpb24iOiJjbGllbnRzIiwidGVuYW50SWQiOiIwMWExMDliNi0xZDhkLTc4ZGEtOWRmMC0wZDI4YjcyY2UyZTgiLCJmaWx0ZXJzIjoiT0FkQ2hRTEk0S3lQa1QxSEtzTkRKV3lYMzg1LVhpYWxCS1JuQ1c5Q09kcyJ9.tLAAVx24BFwarLA4v_iYEmP65xZGHu03aBgjzX7-tZw"}
{"items":[{"client_id":"demo-spa","name":"demo-spa","type":"public"}],"next":null}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"cursor is invalid or expired","errors":[{"path":"cursor","message":"is invalid or expired"}],"instance":"01a109b6-b459-7bbd-8cb7-d533f4439711"}
```

A `type` outside the enum, then two search fields at once:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/demo/clients?type=service"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/demo/clients?client_id=a&name=b"
```

```
{"type":"about:blank","title":"Error","status":400,"detail":"querystring/type must be equal to one of the allowed values","errors":[{"path":"type","message":"must be equal to one of the allowed values"}],"instance":"01a109b6-b46c-7c9b-a932-b20917d2eb43"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"search one field at a time: client_id or name, not both","errors":[{"path":"name","message":"search one field at a time: client_id or name, not both"}],"instance":"01a109b6-b477-786a-aebe-4178c81aa673"}
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
`tls_client_auth_subject_dn`, `client_uri`, `policy_uri` and `tos_uri`
— each of those three an absolute https URI, or http on a loopback
host, with no fragment, and linked from the consent screen — and
`id_token_signed_response_alg`, `default_max_age` and `require_auth_time`
are revalidated through the same
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
allowlist, not an exclusion list: `name`, `description`, `client_uri`,
`policy_uri`, `tos_uri`, `consent_required`, the two logout URIs and their
`_session_required` flags, and the three `userinfo_*` algorithms. Every other field is refused with `409` naming
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

Captured against the sixth stack, on `demo`'s `demo-operator`
(`01a0ea51-a1c1-7d69-8096-b390ced5d3ae`), created there with `grant_types: ["client_credentials"]` and no
`redirect_uris`. Amending a list field without `If-Match`, and amending a
field the exclusion list names — the refusal carries the reason, not just
the refusal:

```
{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to amend redirect_uris","instance":"01a0ea53-394d-77b8-8fa9-0ef9dde49b4a"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"client_id: identity: changing it breaks every relying party and orphans the azp of every issued token","errors":[{"path":"client_id","message":"identity: changing it breaks every relying party and orphans the azp of every issued token"}],"instance":"01a0ea53-3967-791d-a6f7-72e8aa69cc7b"}
```

The revalidation is not a formality. Widening `demo-operator`'s grants
alone, with the `ETag` its `GET` answered, is refused, because the merged
metadata no longer satisfies the rule that excused the empty list:

```bash
curl -sS -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "9a99d753974a797db81c3312be5dfd4561b0ce23d6a745327fcd33eb0cb49dd6"' \
  -d '{"grant_types": ["client_credentials","refresh_token"]}' \
  http://localhost:3080/admin/tenants/demo/clients/01a0ea51-a1c1-7d69-8096-b390ced5d3ae
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"redirect_uris is required unless grant_types is exactly [\"client_credentials\"]","errors":[{"path":"redirect_uris","message":"redirect_uris is required unless grant_types is exactly [\"client_credentials\"]"}],"instance":"01a0ea53-3999-799e-9952-cf9f15f5e76d"}
```

An amendment that does pass, with that same `ETag`, and the fresh one it
returns — its headers only:

```bash
curl -sS -D - -o /dev/null -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "9a99d753974a797db81c3312be5dfd4561b0ce23d6a745327fcd33eb0cb49dd6"' \
  -d '{"audiences": ["https://api.demo.example"]}' \
  http://localhost:3080/admin/tenants/demo/clients/01a0ea51-a1c1-7d69-8096-b390ced5d3ae
```

```
HTTP/1.1 200 OK
x-request-id: 01a0ea53-39ba-7146-928f-85dda6dfb19e
cache-control: no-store
etag: "e335431c15716303952cbc244782d48ecc95f6977db109346f1241c3b4d10605"
content-type: application/json; charset=utf-8
content-length: 1704
Date: Mon, 28 Sep 2026 23:21:57 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

Replaying the identical request — same `If-Match`, now one generation
stale — is refused and changes nothing:

```
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a0ea53-39d7-7d1c-ba87-0816be13e08d"}
```

**The two `409`s that disabling produces are told apart by one column, and
the admin API does not expose it**, so it is read from the database beside
them rather than asserted. `client-facts-demo` holds the two clients this
guard needs: its own built-in one, and `demo-backend` above:

```bash
docker compose exec -T postgres psql -U odudu -d odudu -c \
  "select client_id, builtin_admin, enabled from clients
     where tenant_id = '01a109b6-1dce-7bad-9a5c-7e40b43faa4c' order by client_id;"
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
  http://localhost:3082/admin/tenants/client-facts-demo/clients/01a109b6-1fa9-7304-8ae5-f714f746785e
```

```
{"id":"01a109b6-1fa9-7304-8ae5-f714f746785e","client_id":"demo-backend","name":"demo-backend","description":null,"type":"confidential","enabled":false,"full_scope_allowed":false,"registration_origin":"operator","created_at":"2026-10-05T01:38:13.006Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":[],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":"01a109b6-1f8f-725e-9c2c-53656397b36c","scopes":[{"id":"01a109b6-1dd0-7600-9e14-7816d44df6e6","name":"openid","assignment":"default"},{"id":"01a109b6-1dd0-7600-9e14-7817de7c7d68","name":"profile","assignment":"default"},{"id":"01a109b6-1dd1-715a-b073-4693dd489102","name":"email","assignment":"default"},{"id":"01a109b6-1dd1-715a-b073-4694a189e4be","name":"address","assignment":"default"},{"id":"01a109b6-1dd2-747c-97bd-c431358429af","name":"phone","assignment":"default"},{"id":"01a109b6-1dd2-747c-97bd-c432be4c4a58","name":"roles","assignment":"default"},{"id":"01a109b6-1dd3-7b41-8bf3-e8da34d0a2c0","name":"groups","assignment":"default"},{"id":"01a109b6-1dd3-7b41-8bf3-e8db9126a263","name":"offline_access","assignment":"optional"}]}
```

`odudu-admin`, `builtin_admin` true, the same request against the other id
in that listing, does not:

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"enabled": false}' \
  http://localhost:3082/admin/tenants/client-facts-demo/clients/01a109b6-1dd6-7fb7-834f-b09b02db9a21
```

```
{"type":"about:blank","title":"Conflict","status":409,"detail":"odudu-admin is this tenant's built-in admin client and cannot be disabled","instance":"01a109b7-36b0-7956-84af-4f859db85838"}
```

### A client's pages and its ID token settings

`description` is the administrators' own note on the client, at most 1000
characters and shown nowhere else. `client_uri`, `policy_uri` and `tos_uri`
are RFC 7591 §2's pages about the client, which the consent screen links
under the client's name ([The consent screen](request-paths.md#the-consent-screen)).
`id_token_signed_response_alg`, `default_max_age` and `require_auth_time`
are OpenID Connect Dynamic Client Registration §2's: the algorithm the
client's ID tokens are signed with (`RS256` or `ES256`, and only one a
non-retired key of the tenant produces; `null` signs with the active key),
the age past which a session is re-authenticated when a request carries no
`max_age` of its own, and whether every ID token carries `auth_time`.
Dynamic registration accepts the same six and echoes them. Captured in a
tenant `client-pages-demo` created for it, on the stack the settings above
were captured on:

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"client_id": "billing", "redirect_uris": ["https://billing.example/callback"], "grant_types": ["authorization_code", "client_credentials"], "description": "Invoices and payment runs", "client_uri": "https://billing.example/about", "policy_uri": "https://billing.example/privacy", "tos_uri": "https://billing.example/terms", "id_token_signed_response_alg": "ES256", "default_max_age": 3600, "require_auth_time": true}' \
  http://localhost:3082/admin/tenants/client-pages-demo/clients
```

```
{"id":"01a10931-8140-71a8-821f-c964f28b806c","client_id":"billing","name":"billing","description":"Invoices and payment runs","type":"confidential","enabled":true,"full_scope_allowed":false,"registration_origin":"operator","created_at":"2026-10-04T23:13:21.637Z","redirect_uris":["https://billing.example/callback"],"grant_types":["authorization_code","client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":[],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":"https://billing.example/about","policy_uri":"https://billing.example/privacy","tos_uri":"https://billing.example/terms","id_token_signed_response_alg":"ES256","default_max_age":3600,"require_auth_time":true,"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":"01a10931-80eb-7dae-b54e-9fa1635b3c01","scopes":[{"id":"01a10931-8088-7f03-b2a1-02e5841d33fb","name":"openid","assignment":"default"},{"id":"01a10931-8089-78fa-af76-02832be0f387","name":"profile","assignment":"default"},{"id":"01a10931-808a-7df9-b8dd-eef4a7ba67b8","name":"email","assignment":"default"},{"id":"01a10931-808a-7df9-b8dd-eef579ac3d13","name":"address","assignment":"default"},{"id":"01a10931-808b-7b6a-aa6a-cb9a3de3321a","name":"phone","assignment":"default"},{"id":"01a10931-808c-7c37-a054-dcb2bb72400b","name":"roles","assignment":"default"},{"id":"01a10931-808c-7c37-a054-dcb33bbe225d","name":"groups","assignment":"default"},{"id":"01a10931-808d-7164-b419-e79b3fa4803a","name":"offline_access","assignment":"optional"}],"client_secret":"0QtbcTY6v9PH8oi75MThTIvTX8f8HOlb1y0EBpx0mjE"}
```

A page that is not https, or an algorithm no key of the tenant produces,
is refused by name — the tenant holds only the `ES256` key it was created
with:

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"policy_uri": "http://billing.example/privacy"}' \
  http://localhost:3082/admin/tenants/client-pages-demo/clients/01a10931-8140-71a8-821f-c964f28b806c
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"id_token_signed_response_alg": "RS256"}' \
  http://localhost:3082/admin/tenants/client-pages-demo/clients/01a10931-8140-71a8-821f-c964f28b806c
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"policy_uri must be an absolute https URI, or http on a loopback host, with no fragment","errors":[{"path":"policy_uri","message":"policy_uri must be an absolute https URI, or http on a loopback host, with no fragment"}],"instance":"01a10931-8168-7b92-ab09-89bf0be6bfba"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"id_token_signed_response_alg: id_token_signed_response_alg RS256 is not produced by any of this tenant's signing keys (ES256)","errors":[{"path":"id_token_signed_response_alg","message":"id_token_signed_response_alg RS256 is not produced by any of this tenant's signing keys (ES256)"}],"instance":"01a10931-8181-7d3b-b46c-a81077826a7c"}
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
  http://localhost:3082/admin/tenants/client-facts-demo/clients/01a109b6-1dd6-7fb7-834f-b09b02db9a21
```

```
{"type":"about:blank","title":"Conflict","status":409,"detail":"odudu-admin is this tenant's built-in admin client and cannot be deleted","instance":"01a109b7-36fa-7857-a04f-02e4678ff189"}
{"type":"about:blank","title":"Not Found","status":404,"instance":"01a109b7-3711-79b9-86b4-2e4d9f437d1c"}

HTTP/1.1 204 No Content
x-request-id: 01a109b7-3725-751a-8d44-c50879a92140
cache-control: no-store
Date: Mon, 05 Oct 2026 01:39:24 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

## `POST /clients/{id}/secret`

Requires `manage-clients`. Rotates a confidential client's secret: generates a fresh one, stores only
its hash, and returns the plaintext **exactly once, in this response** —
the same guarantee `POST /clients` makes for a client's first secret.
Nothing reads it back afterward. By default the previous secret stops
authenticating at `/token`, `/introspect` and `/revoke` immediately, which is
the answer to a leaked one. `?grace_seconds=N`, from `0` to `604800` (a
week), keeps it authenticating beside the new one for `N` seconds instead,
so a client's deployments can move over without an outage; the response's
`previous_secret_expires_at` says when it stops, and every read of the
client says the same until then. A week covers a weekly deployment picking
up the new secret; a longer window would leave a second standing credential
nobody is tracking. Rotating again inside a window keeps only the secret
that rotation replaced, so at most two ever authenticate. Only the old
secret's hash is kept, never shown, and the audit row records
`grace_seconds` and `previous_secret_expires_at`, never a secret or a hash.
`odudu reap` clears the kept hash once the window has passed and audits
each one as `client.secret_expired`; the secret is refused from the instant
the window ends whether or not that pass has run. A public client
(`token_endpoint_auth_method: "none"`) has no secret to rotate, refused with
`409`.

Captured on the same client, with an hour's grace: the response, narrowed,
then `client_credentials` at `/token` with the secret the create above
answered and with the new one, then a week and a second asked for, then the
audit row the rotation wrote:

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3082/admin/tenants/client-pages-demo/clients/01a10931-8140-71a8-821f-c964f28b806c/secret?grace_seconds=3600' \
  | jq -c '{client_id, previous_secret_expires_at, client_secret}'
for secret in "$OLD_SECRET" "$NEW_SECRET"; do
  curl -sS -o /dev/null -w '%{http_code}\n' -u "billing:$secret" \
    -d grant_type=client_credentials \
    http://localhost:3082/tenants/client-pages-demo/protocol/openid-connect/token
done
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3082/admin/tenants/client-pages-demo/clients/01a10931-8140-71a8-821f-c964f28b806c/secret?grace_seconds=604801'
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3082/admin/tenants/client-pages-demo/audit?action=client.rotate_secret' \
  | jq -c '.items[0] | {action, outcome, detail}'
```

```
{"client_id":"billing","previous_secret_expires_at":"2026-10-05T00:13:29.089Z","client_secret":"msYC9U85SlNkuYyb2bfBKAzYwI5bmqr6CFdlVp3E7yw"}
200
200
{"type":"about:blank","title":"Error","status":400,"detail":"querystring/grace_seconds must be <= 604800","errors":[{"path":"grace_seconds","message":"must be <= 604800"}],"instance":"01a10931-9e9a-7afa-84c4-4ed5807be500"}
{"action":"client.rotate_secret","outcome":"allowed","detail":{"secret_hash":{"changed":true},"grace_seconds":3600,"previous_secret_expires_at":"2026-10-05T00:13:29.089Z"}}
```

A rotation without grace, on `client-facts-demo`'s `demo-backend`:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3082/admin/tenants/client-facts-demo/clients/01a109b6-1fa9-7304-8ae5-f714f746785e/secret
```

Captured immediately after the disable above, which is why `enabled` reads
`false` here: rotating a disabled client's secret is allowed, the guard
being on the built-in client rather than on a disabled one. `demo-backend`
was deleted afterward, in the `DELETE` section above.

```
{"id":"01a109b6-1fa9-7304-8ae5-f714f746785e","client_id":"demo-backend","name":"demo-backend","description":null,"type":"confidential","enabled":false,"full_scope_allowed":false,"registration_origin":"operator","created_at":"2026-10-05T01:38:13.006Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":[],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":"01a109b6-1f8f-725e-9c2c-53656397b36c","scopes":[{"id":"01a109b6-1dd0-7600-9e14-7816d44df6e6","name":"openid","assignment":"default"},{"id":"01a109b6-1dd0-7600-9e14-7817de7c7d68","name":"profile","assignment":"default"},{"id":"01a109b6-1dd1-715a-b073-4693dd489102","name":"email","assignment":"default"},{"id":"01a109b6-1dd1-715a-b073-4694a189e4be","name":"address","assignment":"default"},{"id":"01a109b6-1dd2-747c-97bd-c431358429af","name":"phone","assignment":"default"},{"id":"01a109b6-1dd2-747c-97bd-c432be4c4a58","name":"roles","assignment":"default"},{"id":"01a109b6-1dd3-7b41-8bf3-e8da34d0a2c0","name":"groups","assignment":"default"},{"id":"01a109b6-1dd3-7b41-8bf3-e8db9126a263","name":"offline_access","assignment":"optional"}],"client_secret":"IcaN1Ciqg5Lvi62CjT1hwWAKWl1MDWWUYavbJo97oi8"}
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

Recaptured against the tenth stack, once each row answered `actor_name` and
`actor_origin`, after the same three clients were made there in a tenant of
the same name and their service accounts given the same roles, so the ids
are that run's, not those above:

```bash
ROOT=http://localhost:3082/admin/tenants/ceiling-clients/clients/01a0ee8d-9a7c-7c78-85bd-60906ed648c4
curl -sS -X POST -H "Authorization: Bearer $OPS_TOKEN" "$ROOT/secret"
echo
curl -sS -X PATCH -H "Authorization: Bearer $OPS_TOKEN" -H 'content-type: application/json' \
  -d '{"jwks":{"keys":[]}}' "$ROOT"
echo
curl -sS -X DELETE -H "Authorization: Bearer $OPS_TOKEN" "$ROOT"
echo
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer $OPS_TOKEN" \
  http://localhost:3082/admin/tenants/ceiling-clients/clients/01a0ee8d-9b1f-7e8a-a358-ac868a9d5ff8/secret
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/ceiling-clients/audit?resource_type=client&resource_id=01a0ee8d-9a7c-7c78-85bd-60906ed648c4&outcome=refused"
echo
```

```
{"type":"about:blank","title":"Forbidden","status":403,"detail":"the client's service account holds what the caller does not: view-users, manage-users, manage-tenant, manage-keys, manage-sessions, view-audit","instance":"01a0ee8d-9d72-7aef-b030-5e4e844fb8d0"}
{"type":"about:blank","title":"Forbidden","status":403,"detail":"the client's service account holds what the caller does not: view-users, manage-users, manage-tenant, manage-keys, manage-sessions, view-audit","instance":"01a0ee8d-9e1e-7367-ac27-387c29322f2b"}
{"type":"about:blank","title":"Forbidden","status":403,"detail":"the client's service account holds what the caller does not: view-users, manage-users, manage-tenant, manage-keys, manage-sessions, view-audit","instance":"01a0ee8d-9e6e-7867-b29b-b95bbda04560"}
200
{"items":[{"id":"01a0ee8d-9e95-7c5f-9119-4c27c3f4778a","occurred_at":"2026-09-29T19:04:13.711Z","event_type":"admin_mutation","action":"client.delete","outcome":"refused","actor_tenant_id":"01a0ee8d-9906-7ea0-b0d0-b27c727122fc","actor_subject_id":"01a0ee8d-99a1-7ad9-9e10-15e628d32b27","actor_client_id":"01a0ee8d-99d0-788f-939c-578f783208dc","actor_name":"ops-robot","actor_origin":"tenant","resource_type":"client","resource_id":"01a0ee8d-9a7c-7c78-85bd-60906ed648c4","request_id":"01a0ee8d-9e6e-7867-b29b-b95bbda04560","ip":"172.22.0.1","detail":{"denied":["view-users","manage-users","manage-tenant","manage-keys","manage-sessions","view-audit"]}},{"id":"01a0ee8d-9e46-701d-9e8e-27e1361b03a9","occurred_at":"2026-09-29T19:04:13.624Z","event_type":"admin_mutation","action":"client.amend","outcome":"refused","actor_tenant_id":"01a0ee8d-9906-7ea0-b0d0-b27c727122fc","actor_subject_id":"01a0ee8d-99a1-7ad9-9e10-15e628d32b27","actor_client_id":"01a0ee8d-99d0-788f-939c-578f783208dc","actor_name":"ops-robot","actor_origin":"tenant","resource_type":"client","resource_id":"01a0ee8d-9a7c-7c78-85bd-60906ed648c4","request_id":"01a0ee8d-9e1e-7367-ac27-387c29322f2b","ip":"172.22.0.1","detail":{"denied":["view-users","manage-users","manage-tenant","manage-keys","manage-sessions","view-audit"]}},{"id":"01a0ee8d-9e07-74d8-99ba-e12aab225392","occurred_at":"2026-09-29T19:04:13.533Z","event_type":"admin_mutation","action":"client.rotate_secret","outcome":"refused","actor_tenant_id":"01a0ee8d-9906-7ea0-b0d0-b27c727122fc","actor_subject_id":"01a0ee8d-99a1-7ad9-9e10-15e628d32b27","actor_client_id":"01a0ee8d-99d0-788f-939c-578f783208dc","actor_name":"ops-robot","actor_origin":"tenant","resource_type":"client","resource_id":"01a0ee8d-9a7c-7c78-85bd-60906ed648c4","request_id":"01a0ee8d-9d72-7aef-b030-5e4e844fb8d0","ip":"172.22.0.1","detail":{"denied":["view-users","manage-users","manage-tenant","manage-keys","manage-sessions","view-audit"]}}]}
```

The two scope routes, from `scopes-robot` in the same tenant, a client whose
service account was given `manage-tenant` alone, so `$SCOPES_TOKEN` carries
the capability the scope routes require and nothing else. Assigning `profile` to
`root-robot` and unassigning it are refused, assigning it to `plain-robot`
is not, and the rows on `profile` since `RUN_START` are the two refusals
and that assignment:

```bash
RUN_START=$(date -u +%FT%T.000Z)
PROFILE=http://localhost:3000/admin/tenants/ceiling-clients/scopes/01a0e58a-ab1f-7f4e-9e3e-c4574290cf56
curl -sS -X PUT -H "Authorization: Bearer $SCOPES_TOKEN" -H 'content-type: application/json' \
  -d '{"assignment":"optional"}' "$PROFILE/clients/01a0e58a-ac43-7148-8881-6c3fdc6cf1ae"
echo
curl -sS -X DELETE -H "Authorization: Bearer $SCOPES_TOKEN" \
  "$PROFILE/clients/01a0e58a-ac43-7148-8881-6c3fdc6cf1ae"
echo
curl -sS -o /dev/null -w '%{http_code}\n' -X PUT -H "Authorization: Bearer $SCOPES_TOKEN" \
  -H 'content-type: application/json' -d '{"assignment":"default"}' \
  "$PROFILE/clients/01a0e58a-aca8-786f-a574-21674f047897"
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/ceiling-clients/audit?resource_type=scope&resource_id=01a0e58a-ab1f-7f4e-9e3e-c4574290cf56&from=$RUN_START" \
  | jq -c '.items[] | {action, outcome, detail}'
```

```
{"type":"about:blank","title":"Forbidden","status":403,"detail":"the client's service account holds what the caller does not: view-users, manage-users, manage-clients, manage-keys, manage-sessions, view-audit","instance":"01a0e5f3-37b7-7731-ab4c-f6f314031a4f"}
{"type":"about:blank","title":"Forbidden","status":403,"detail":"the client's service account holds what the caller does not: view-users, manage-users, manage-clients, manage-keys, manage-sessions, view-audit","instance":"01a0e5f3-37d3-76c0-b950-7753abe49ebb"}
200
{"action":"scope.assign_to_client","outcome":"allowed","detail":{}}
{"action":"scope.unassign_from_client","outcome":"refused","detail":{"denied":["view-users","manage-users","manage-clients","manage-keys","manage-sessions","view-audit"]}}
{"action":"scope.assign_to_client","outcome":"refused","detail":{"denied":["view-users","manage-users","manage-clients","manage-keys","manage-sessions","view-audit"]}}
```

## `GET /clients/:id/logout-deliveries`

Requires `manage-clients`. The Back-Channel Logout Tokens queued for the
client, most recent first and cursored: `pending`, `delivered`, or `failed`
once every attempt `send-logouts` makes is spent
(`BACKCHANNEL_LOGOUT_MAX_ATTEMPTS`), with the attempts, the last error and the
endpoint. Never the token itself. `?status=` narrows it; an unknown client
answers `404`.

Against the tenth stack, after `DELETE /sessions` above queued a token for each
of `ops-app`'s two sessions it ended, and one pass of the sender, run by hand:

```bash
docker compose exec -T odudu node dist/main.js send-logouts 2>/dev/null
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/clients/01a0ee8a-d1a7-7c3c-a05b-903a2d8fa123/logout-deliveries"; echo
```

```
{"ran":true,"delivered":0,"failed":2}
{"items":[{"id":"01a0ee8c-5536-7104-abd0-6c8afe2c2850","session_id":"01a0ee8b-28f4-79df-bbe5-95698666977b","endpoint":"https://postgres:9/backchannel","status":"pending","attempts":1,"last_error":"connect ECONNREFUSED 172.22.0.2:9","created_at":"2026-09-29T19:02:49.371Z","next_attempt_at":"2026-09-29T19:03:50.227Z","delivered_at":null},{"id":"01a0ee8c-552f-7614-bf53-93c13eeca916","session_id":"01a0ee8b-27fa-7271-bb21-8bf1dec2d0fa","endpoint":"https://postgres:9/backchannel","status":"pending","attempts":1,"last_error":"connect ECONNREFUSED 172.22.0.2:9","created_at":"2026-09-29T19:02:49.371Z","next_attempt_at":"2026-09-29T19:03:50.227Z","delivered_at":null}]}
```

Each pass spends one attempt on each token it offers, so a token one failed
pass has offered answers `attempts: 1`, and a token is offered
`BACKCHANNEL_LOGOUT_MAX_ATTEMPTS` times before it is `failed`.

## `DELETE /clients/:id/grants`

Requires `manage-sessions`, the capability every other grant revocation takes.
Revokes every grant issued through the client that nothing has revoked,
whoever holds it, so no refresh token the client holds is honoured again —
for a leaked secret or a compromised relying party, without disabling the
client, which a re-enable would undo. It ends no session, so a session still
signed in can be issued a fresh grant; `DELETE /sessions` is that door. A
grant whose subject holds an admin capability the caller does not is left
alone and counted under `beyond_ceiling`, and the route is held to the
ceiling on the client's service account, as every client mutation is.
`client.grants_revoke` carries both counts. An unknown client answers `404`.

Against the tenth stack, after `linus` signed in again asking for
`offline_access`, and `sam` again (`$SAM_TOKEN`): `sam` first, then
`$ADMIN_TOKEN`, then `mona`'s grants:

```bash
curl -sS -X DELETE -H "Authorization: Bearer $SAM_TOKEN" \
  "$P/clients/01a0ee8a-d1a7-7c3c-a05b-903a2d8fa123/grants"; echo
curl -sS -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/clients/01a0ee8a-d1a7-7c3c-a05b-903a2d8fa123/grants"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/subjects/01a0ee8a-c8f6-7450-b486-861a66a87684/grants"; echo
```

```
{"revoked":1,"beyond_ceiling":1}
{"revoked":1,"beyond_ceiling":0}
{"items":[]}
```

## `GET /clients/:id/evaluate`

Requires `manage-clients` and `view-users`, since what it answers is the
subject's data; without the second it is refused with `403` and a
`capability.refused` row. The claims an authorization-code exchange for the
client and `subject` would put in the ID token, the access token and the
UserInfo response: `scope` resolved against the client's assignments as the
exchange resolves it, the subject's roles narrowed to what that scope reaches,
each artefact gated by its own scope flags — computed by the same functions
the exchange and `/userinfo` call (`mappedClaims` and `idTokenScopeOf`,
`@odudu/protocol-oidc`), never a copy of them. Mapped claims only: none of the
envelope a signer adds (`iss`, `aud`, `exp`, …), and nothing is signed.
`id_token` is `null` without `openid`; `scope` absent means the client's
default scopes. It assumes every scope asked for is consented to: for a
client with `consent_required`, a real code carries only the scopes the
subject has consented to, which may be fewer. `scope` is at most 2048
characters. Each evaluation is audited as `client.evaluate`. An unknown
client or subject answers `404`.

Against the tenth stack, for `grace`, her profile given its name claims
through `PATCH /subjects/:id/profile` beforehand; once naming a scope, once
not, and the row it left:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/clients/01a0ee8a-d1a7-7c3c-a05b-903a2d8fa123/evaluate?subject=01a0ee8a-c58a-716c-96a6-edcab4ca1a70&scope=openid%20profile%20email%20roles"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/clients/01a0ee8a-d1a7-7c3c-a05b-903a2d8fa123/evaluate?subject=01a0ee8a-c58a-716c-96a6-edcab4ca1a70"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/audit?action=client.evaluate&limit=1"; echo
```

```
{"scope":"openid profile email roles","id_token":{"sub":"01a0ee8a-c58a-716c-96a6-edcab4ca1a70","name":"Grace Hopper","given_name":"Grace","family_name":"Hopper","preferred_username":"grace","updated_at":1790708493,"email":"grace@navy.example","email_verified":false},"access_token":{},"userinfo":{"sub":"01a0ee8a-c58a-716c-96a6-edcab4ca1a70","name":"Grace Hopper","given_name":"Grace","family_name":"Hopper","preferred_username":"grace","updated_at":1790708493,"email":"grace@navy.example","email_verified":false}}
{"scope":"openid profile email address phone roles groups","id_token":{"sub":"01a0ee8a-c58a-716c-96a6-edcab4ca1a70","name":"Grace Hopper","given_name":"Grace","family_name":"Hopper","preferred_username":"grace","updated_at":1790708493,"email":"grace@navy.example","email_verified":false},"access_token":{"groups":["/finance/payables"]},"userinfo":{"sub":"01a0ee8a-c58a-716c-96a6-edcab4ca1a70","name":"Grace Hopper","given_name":"Grace","family_name":"Hopper","preferred_username":"grace","updated_at":1790708493,"email":"grace@navy.example","email_verified":false,"groups":["/finance/payables"]}}
{"items":[{"id":"01a0ee8b-36e3-7657-8294-ea4e0498f059","occurred_at":"2026-09-29T19:01:36.085Z","event_type":"admin_mutation","action":"client.evaluate","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0ee8a-bfb8-763c-ac22-0c8d97b0fada","actor_client_id":"01a0ee8a-bf72-77c9-a423-f61084924d9f","actor_name":null,"actor_origin":"system","resource_type":"client","resource_id":"01a0ee8a-d1a7-7c3c-a05b-903a2d8fa123","request_id":"01a0ee8b-36c5-7315-bb6f-d5c0b7732ca2","ip":"172.22.0.1","detail":{"scope":"openid profile email address phone roles groups","subject_id":"01a0ee8a-c58a-716c-96a6-edcab4ca1a70"}}],"next":"eyJhZnRlciI6IjIwMjYtMDktMjlUMTk6MDE6MzYuMDg1WnwwMWEwZWU4Yi0zNmUzLTc2NTctODI5NC1lYTRlMDQ5OGYwNTkiLCJjb2xsZWN0aW9uIjoiYXVkaXQiLCJ0ZW5hbnRJZCI6IjAxYTBlZThhLWMzOTQtN2I0OS05NDJiLTNkZWE3MGE5NjJlNyIsImZpbHRlcnMiOiI1V1p5R0tkUVJIX3VEUTNNRkpGclFtYzFDdWt4UllCcV9XSDhFc1dWd1ZBIn0.L9X-Z6lPk9dhSI-ZVeSTnwzC4owFeLuOMZdoJGBw-RI"}
```

Neither answer carries `roles`, though `grace` holds two and asked for the
scope: `ops-app` is not full-scope, and the `roles` scope maps neither of hers,
so a real token would carry none either. `groups` reaches the access token and
UserInfo but not the ID token, whose `include_in_id_token` it has off.

## `GET /clients/:id/installation`

Requires `manage-clients`. What a relying party is configured with: the issuer
and its discovery URL, as this request's own host names them — the issuer a
relying party configured from here will check `iss` against — and the client's
`client_id`, type, authentication method, redirect and post-logout URIs, grant
types and default scopes. Never the secret, which is shown once, at creation
or rotation. An unknown client answers `404`.

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/clients/01a0ee8a-d1a7-7c3c-a05b-903a2d8fa123/installation"; echo
```

```
{"issuer":"http://localhost:3082/tenants/ops-demo","discovery_url":"http://localhost:3082/tenants/ops-demo/.well-known/openid-configuration","client_id":"ops-app","client_type":"confidential","token_endpoint_auth_method":"client_secret_basic","redirect_uris":["https://app.example/callback"],"post_logout_redirect_uris":[],"grant_types":["authorization_code","refresh_token"],"default_scope":"openid profile email address phone roles groups"}
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

Recaptured against the tenth stack, once each row answered `actor_name` and
`actor_origin`, after a token was minted in its `demo` and revoked the same
way, so the id is that run's, not the one above:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/demo/audit?action=registration_token.mint&resource_type=registration_token&resource_id=01a0ee8f-0361-755d-b510-c9d6fde88a03"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/demo/audit?action=registration_token.revoke&resource_type=registration_token&resource_id=01a0ee8f-0361-755d-b510-c9d6fde88a03"; echo
```

```
{"items":[{"id":"01a0ee8f-0362-7553-addc-3f32813a6ac1","occurred_at":"2026-09-29T19:05:45.056Z","event_type":"admin_mutation","action":"registration_token.mint","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0ee8a-bfb8-763c-ac22-0c8d97b0fada","actor_client_id":"01a0ee8a-bf72-77c9-a423-f61084924d9f","actor_name":null,"actor_origin":"system","resource_type":"registration_token","resource_id":"01a0ee8f-0361-755d-b510-c9d6fde88a03","request_id":"01a0ee8f-0356-773a-bb66-91367ea0bff9","ip":"172.22.0.1","detail":{"uses":1,"ttl_seconds":3600}}]}
{"items":[{"id":"01a0ee8f-036e-7d81-bda1-1a6bc375bfde","occurred_at":"2026-09-29T19:05:45.068Z","event_type":"admin_mutation","action":"registration_token.revoke","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0ee8a-bfb8-763c-ac22-0c8d97b0fada","actor_client_id":"01a0ee8a-bf72-77c9-a423-f61084924d9f","actor_name":null,"actor_origin":"system","resource_type":"registration_token","resource_id":"01a0ee8f-0361-755d-b510-c9d6fde88a03","request_id":"01a0ee8f-0366-718b-a606-cbb01d9513c9","ip":"172.22.0.1","detail":{"expires_at":{"before":"2026-09-29T20:05:45.057Z"},"remaining_uses":{"before":1}}}]}
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

**Search** is a prefix of one named field, case-insensitive: `?username=`,
`?email=`, or one of the name claims `?name=`, `?given_name=` and
`?family_name=` — as stored, never the username a `name` claim falls back
to — one at a time. The prefix is folded by PostgreSQL's
`lower()`, the same function that fills the stored `username_search`,
`email_search` and name-claim search columns (`0073_list_indexes_subjects.sql`,
`0079_list_indexes_subject_claims.sql`), and matched as a
range between two bounds rather than with `LIKE`, so `%`, `_` and `\` are
ordinary characters. A searched listing is ordered by that folded column,
in code-point order, then by `id`, and its cursor carries the folded value
of the last row. A subject with no `users` row (`type: "service"`,
provisioned for a confidential client's service account) never matches a
search and is only ever reached by an unsearched page.

**Exact filters** are `?enabled=true|false`, `?type=user|service|agent_instance`,
`?locked=true|false` (locked out now, by the clock `GET /subjects/:id/lockout`
judges with), `?role=<id>` (subjects the role is assigned to directly, not
through a group or a composite) and `?group=<id>` (the group's direct
members). `GET /subjects/count` takes every one of them. `?capability=<name>` is the
one that is not direct: subjects holding that capability — or
`tenant-admin` — however they hold it, directly, through a group or one of
its ancestors, or through a role that nests it, which is how the console
lists a tenant's administrators. Every parameter given is `AND`ed. A cursor is bound to the filters it was minted under, so replaying
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

The searches below ran against the sixth stack (the note at the top of
this document), whose `demo` held `ada` (`ada@example.com`, created by
`POST /subjects` below) and the service subjects of its confidential
clients; `Adaline` and `adam` were created through `POST /subjects` just
before, with no email. `ADA` finds all three, in folded order:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/demo/subjects?username=ADA"
```

```
{"items":[{"id":"01a0ea54-2519-7513-8bf7-c105e0cfd9dd","type":"user","username":"ada","email":"ada@example.com","enabled":true,"created_at":"2026-09-28T23:22:58.200Z"},{"id":"01a0ea54-2556-7831-8443-acf0d9ac9f1d","type":"user","username":"Adaline","email":null,"enabled":true,"created_at":"2026-09-28T23:22:58.262Z"},{"id":"01a0ea54-256c-7e66-a2f7-ab933f2e09c8","type":"user","username":"adam","email":null,"enabled":true,"created_at":"2026-09-28T23:22:58.284Z"}]}
```

One at a time, the `Link` header carries the search forward:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/demo/subjects?username=ADA&limit=1"
```

```
HTTP/1.1 200 OK
x-request-id: 01a0ea54-2592-7a2c-999b-fef1b77df6be
cache-control: no-store
link: </admin/tenants/demo/subjects?limit=1&username=ADA&cursor=eyJhZnRlciI6IjAxYTBlYTU0LTI1MTktNzUxMy04YmY3LWMxMDVlMGNmZDlkZCIsInNvcnQiOiJhZGEiLCJjb2xsZWN0aW9uIjoic3ViamVjdHMiLCJ0ZW5hbnRJZCI6IjAxYTBlYTRjLTA4ODQtNzRmYS04MjVjLTA1ZjZlZjU2OGRkMCIsImZpbHRlcnMiOiJzWGl1TzdkZGVoRzhlYVUyUWkySWotRnJjVVAyMWVwTUJBWmxEc3FQYUVVIn0.H-WwEeA2mcgEbcO-pWwMqoinmct5oyuEKm8zQFMWF3U>; rel="next"
content-type: application/json; charset=utf-8
content-length: 478
Date: Mon, 28 Sep 2026 23:22:58 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a0ea54-2519-7513-8bf7-c105e0cfd9dd","type":"user","username":"ada","email":"ada@example.com","enabled":true,"created_at":"2026-09-28T23:22:58.200Z"}],"next":"eyJhZnRlciI6IjAxYTBlYTU0LTI1MTktNzUxMy04YmY3LWMxMDVlMGNmZDlkZCIsInNvcnQiOiJhZGEiLCJjb2xsZWN0aW9uIjoic3ViamVjdHMiLCJ0ZW5hbnRJZCI6IjAxYTBlYTRjLTA4ODQtNzRmYS04MjVjLTA1ZjZlZjU2OGRkMCIsImZpbHRlcnMiOiJzWGl1TzdkZGVoRzhlYVUyUWkySWotRnJjVVAyMWVwTUJBWmxEc3FQYUVVIn0.H-WwEeA2mcgEbcO-pWwMqoinmct5oyuEKm8zQFMWF3U"}
```

Following that link, then replaying its cursor under `?username=b`:

```bash
CURSOR='eyJhZnRlciI6IjAxYTBlYTU0LTI1MTktNzUxMy04YmY3LWMxMDVlMGNmZDlkZCIsInNvcnQiOiJhZGEiLCJjb2xsZWN0aW9uIjoic3ViamVjdHMiLCJ0ZW5hbnRJZCI6IjAxYTBlYTRjLTA4ODQtNzRmYS04MjVjLTA1ZjZlZjU2OGRkMCIsImZpbHRlcnMiOiJzWGl1TzdkZGVoRzhlYVUyUWkySWotRnJjVVAyMWVwTUJBWmxEc3FQYUVVIn0.H-WwEeA2mcgEbcO-pWwMqoinmct5oyuEKm8zQFMWF3U'
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/demo/subjects?limit=1&username=ADA&cursor=$CURSOR"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/demo/subjects?limit=1&username=b&cursor=$CURSOR"
```

```
{"items":[{"id":"01a0ea54-2556-7831-8443-acf0d9ac9f1d","type":"user","username":"Adaline","email":null,"enabled":true,"created_at":"2026-09-28T23:22:58.262Z"}],"next":"eyJhZnRlciI6IjAxYTBlYTU0LTI1NTYtNzgzMS04NDQzLWFjZjBkOWFjOWYxZCIsInNvcnQiOiJhZGFsaW5lIiwiY29sbGVjdGlvbiI6InN1YmplY3RzIiwidGVuYW50SWQiOiIwMWEwZWE0Yy0wODg0LTc0ZmEtODI1Yy0wNWY2ZWY1NjhkZDAiLCJmaWx0ZXJzIjoic1hpdU83ZGRlaEc4ZWFVMlFpMklqLUZyY1VQMjFlcE1CQVpsRHNxUGFFVSJ9.B1M9m1juGcg_CLMgO130ZSYKZswaUbDMFkdGAQYhP4o"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"cursor is invalid or expired","errors":[{"path":"cursor","message":"is invalid or expired"}],"instance":"01a0ea54-25c0-797c-8b91-812c43b272ba"}
```

`?email=ADA%40`, then the retired `?search=ada`, then
`?username=a&email=b`. The first refusal is the generated schema's, hence
its generic `title`; the second is the handler's:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/demo/subjects?email=ADA%40"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/demo/subjects?search=ada"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/demo/subjects?username=a&email=b"
```

```
{"items":[{"id":"01a0ea54-2519-7513-8bf7-c105e0cfd9dd","type":"user","username":"ada","email":"ada@example.com","enabled":true,"created_at":"2026-09-28T23:22:58.200Z"}]}
{"type":"about:blank","title":"Error","status":400,"detail":"querystring must NOT have additional properties: search","errors":[{"path":"search","message":"must NOT have additional properties"}],"instance":"01a0ea54-25eb-75d3-ad5e-7aaa463f9644"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"search one field at a time: username or email, not both","errors":[{"path":"email","message":"search one field at a time: username or email, not both"}],"instance":"01a0ea54-25f5-763a-8556-6c0f71c15a6f"}
```

### Filtering by capability

Captured against the fifth stack, in a tenant `admins-demo` created for it,
as `ada-t2` — a system administrator, so no holder of anything in
`admins-demo` itself. `grace`
(`01a0ea0f-36a4-7377-b18e-c6e48982a5cf`) was created there and given
`tenant-admin` alone, which nests `view-users`, so she is listed under
both:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3080/admin/tenants/admins-demo/subjects?capability=tenant-admin'
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3080/admin/tenants/admins-demo/subjects?capability=view-users'
```

```
{"items":[{"id":"01a0ea0f-36a4-7377-b18e-c6e48982a5cf","type":"user","username":"grace","email":null,"enabled":true,"created_at":"2026-09-28T22:07:40.707Z"}]}
{"items":[{"id":"01a0ea0f-36a4-7377-b18e-c6e48982a5cf","type":"user","username":"grace","email":null,"enabled":true,"created_at":"2026-09-28T22:07:40.707Z"}]}
```

Holding through a group or a composite is what
`packages/protocol-admin/tests/administrators.int.test.ts` shows; it was
not captured.

### Filtering by type, lockout and name

Against the tenth stack, after `grace`'s profile was given `name`,
`given_name` and `family_name` through `PATCH /subjects/:id/profile` and five
wrong passwords were submitted for `linus` inside a minute: two name
searches, the refusal of two at once, `linus`'s lockout as the per-subject
read answers it, the locked subjects and their count, and the one subject
of type `service`, `ops-app`'s service account, beside the count of users:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/subjects?name=grace%20h"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/subjects?family_name=HOP"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/subjects?name=grace&username=grace"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/subjects/01a0ee8a-c748-743d-b60e-9b0ed48221a3/lockout"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/subjects?locked=true"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/subjects/count?locked=true"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/subjects?type=service"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/subjects/count?type=user"; echo
```

```
{"items":[{"id":"01a0ee8a-c58a-716c-96a6-edcab4ca1a70","type":"user","username":"grace","email":"grace@navy.example","enabled":true,"created_at":"2026-09-29T19:01:07.075Z"}]}
{"items":[{"id":"01a0ee8a-c58a-716c-96a6-edcab4ca1a70","type":"user","username":"grace","email":"grace@navy.example","enabled":true,"created_at":"2026-09-29T19:01:07.075Z"}]}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"search one field at a time: username or name, not both","errors":[{"path":"name","message":"search one field at a time: username or name, not both"}],"instance":"01a0ee8b-2d91-7207-9ff0-5667db14c7c8"}
{"locked":true,"locked_until":"2026-09-29T19:02:33.177Z","failure_count":5,"last_failure_at":"2026-09-29T19:01:33.177Z"}
{"items":[{"id":"01a0ee8a-c748-743d-b60e-9b0ed48221a3","type":"user","username":"linus","email":null,"enabled":true,"created_at":"2026-09-29T19:01:07.522Z"}]}
{"count":1,"capped":false}
{"items":[{"id":"01a0ee8a-d189-7b39-b7b4-e37a483b6268","type":"service","username":null,"email":null,"enabled":true,"created_at":"2026-09-29T19:01:10.146Z"}]}
{"count":5,"capped":false}
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
  -d '{"username": "ada", "email": "ada@example.com"}' \
  http://localhost:3080/admin/tenants/demo/subjects
```

```
HTTP/1.1 201 Created
x-request-id: 01a0ea54-250f-791a-a610-c67bd0c2f3b0
cache-control: no-store
etag: "6d421703daec2dfafa43124a92e862b052fde60549b94a1a3b22285a6d02b126"
content-type: application/json; charset=utf-8
content-length: 157
Date: Mon, 28 Sep 2026 23:22:58 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a0ea54-2519-7513-8bf7-c105e0cfd9dd","type":"user","username":"ada","email":"ada@example.com","enabled":true,"created_at":"2026-09-28T23:22:58.200Z"}
```

Captured against the sixth stack, in its `demo`; the `etag` is the one
`GET /subjects/:id` answers for the new subject.

A body carrying `password` and a username already in use, in that order,
against the same stack. The first refusal is the generated schema's,
so its `title` is the framework's generic one rather than a `Bad Request`
the usecase chose — that is what "refused before the usecase ever runs"
looks like from outside:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username": "ada", "password": "hunter2"}' \
  http://localhost:3080/admin/tenants/demo/subjects
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username": "ada"}' \
  http://localhost:3080/admin/tenants/demo/subjects
```

```
{"type":"about:blank","title":"Error","status":400,"detail":"body must NOT have additional properties: password","errors":[{"path":"password","message":"must NOT have additional properties"}],"instance":"01a0ea54-2528-7865-9797-ddba85f9256d"}
{"type":"about:blank","title":"Conflict","status":409,"detail":"the username \"ada\" is already in use","instance":"01a0ea54-2532-7ded-a4a1-78972123db93"}
```

## `GET /subjects/username-policy`

Requires `view-users`. Whether this tenant accepts a rename — its
`username_editable` setting, alone, for whoever can read subjects:
[`GET /settings`](#get-settings-and-patch-settings) holds the same value but
needs `manage-tenant`, which an operator who manages subjects may not hold,
and a form that could not read it would have to offer the username and let
[`PATCH /subjects/:id`](#patch-subjectsid) refuse it. It answers no `ETag`:
nothing is written against it.

Against the eighth stack, as `vera`, who holds `view-users` alone, captured
before the disable run under "The shape of it" above: the
policy, then the settings it comes from, refused to her, then the policy
again once `$ADMIN_TOKEN` turned renaming on (`PATCH /settings` with
`{"username_editable":true}`, printing only its status):

```bash
P=http://localhost:3080/admin/tenants/policy-demo
curl -sS -H "Authorization: Bearer $VERA_TOKEN" "$P/subjects/username-policy"
curl -sS -H "Authorization: Bearer $VERA_TOKEN" "$P/settings"
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"username_editable":true}' "$P/settings" -o /dev/null -w '%{http_code}\n'
curl -sS -D - -H "Authorization: Bearer $VERA_TOKEN" "$P/subjects/username-policy"
```

```
{"username_editable":false}
{"type":"about:blank","title":"Forbidden","status":403,"instance":"01a0ed2f-677d-795d-a102-4b8fd7b8f163"}
200
HTTP/1.1 200 OK
x-request-id: 01a0ed2f-67af-7ea4-928b-e8468e49d211
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 26
Date: Tue, 29 Sep 2026 12:41:42 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"username_editable":true}
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

With the setting still at its default, the rename is refused. This one
refusal was captured against the sixth stack, in a tenant also named
`rename-demo` created there for it, on its own `grace`
(`01a0ea54-d24b-7445-9226-9123b58e9e4e`), since the first stack's `rename-demo` is gone; the rest
of this section is that first capture:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: *' \
  -d '{"username": "grace-hopper"}' \
  http://localhost:3080/admin/tenants/rename-demo/subjects/$GRACE
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a0ea54-d25b-70fa-baab-fa89b03dea50
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 301
Date: Mon, 28 Sep 2026 23:23:42 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Bad Request","status":400,"detail":"username: this tenant has not enabled username editing (username_editable)","errors":[{"path":"username","message":"this tenant has not enabled username editing (username_editable)"}],"instance":"01a0ea54-d25b-70fa-baab-fa89b03dea50"}
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

Recaptured against the tenth stack, once each row answered `actor_name` and
`actor_origin`, after the same renames and refusals were made there against
a `grace` seeded in a tenant of the same name, `username_editable` on, so the
ids are that run's, not those above:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/rename-demo/audit?resource_type=subject&resource_id=$GRACE"; echo
```

```
{"items":[{"id":"01a0ee8f-5fb5-792d-b8a6-34c2673e2c04","occurred_at":"2026-09-29T19:06:08.688Z","event_type":"admin_mutation","action":"subject.amend","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0ee8a-bfb8-763c-ac22-0c8d97b0fada","actor_client_id":"01a0ee8a-bf72-77c9-a423-f61084924d9f","actor_name":null,"actor_origin":"system","resource_type":"subject","resource_id":"01a0ee8f-5d26-7a80-b7c9-3c64c4f582cf","request_id":"01a0ee8f-5fa4-7964-85ce-e82236b46ff3","ip":"172.22.0.1","detail":{"username":{"after":"Ada","before":"grace-hopper"}}},{"id":"01a0ee8f-5f83-702a-858a-e775655db38b","occurred_at":"2026-09-29T19:06:08.639Z","event_type":"admin_mutation","action":"subject.amend","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0ee8a-bfb8-763c-ac22-0c8d97b0fada","actor_client_id":"01a0ee8a-bf72-77c9-a423-f61084924d9f","actor_name":null,"actor_origin":"system","resource_type":"subject","resource_id":"01a0ee8f-5d26-7a80-b7c9-3c64c4f582cf","request_id":"01a0ee8f-5f73-7961-bb79-d4978fb330e7","ip":"172.22.0.1","detail":{"username":{"after":"grace-hopper","before":"grace"}}}]}
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
of `about:blank`'s usual bare wording. Captured against the sixth stack, in
a tenant also named `profile-demo2` created there for it, on its own
`grace` (`01a0ea55-4091-7b5b-b743-8a713272538b`):

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email": "someone-else@example.com"}' \
  http://localhost:3080/admin/tenants/profile-demo2/subjects/01a0ea55-4091-7b5b-b743-8a713272538b/profile
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a0ea55-40a0-7046-b712-f0de1859b263
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 357
Date: Mon, 28 Sep 2026 23:24:10 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Bad Request","status":400,"detail":"email: email is amended through PATCH /admin/tenants/{tenant}/subjects/{id}, not a subject’s profile","errors":[{"path":"email","message":"email is amended through PATCH /admin/tenants/{tenant}/subjects/{id}, not a subject’s profile"}],"instance":"01a0ea55-40a0-7046-b712-f0de1859b263"}
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
the same way `isValidBirthdate` mirrors `users_birthdate_shape`. Captured
against the sixth stack, on the `grace` the `email` refusal above names:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "(415) 555-2671", "phone_number_verified": true}' \
  http://localhost:3080/admin/tenants/profile-demo2/subjects/01a0ea55-4091-7b5b-b743-8a713272538b/profile
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a0ea55-40bc-756b-a601-8dff990c69fd
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 321
Date: Mon, 28 Sep 2026 23:24:10 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Bad Request","status":400,"detail":"phone_number: phone_number must be E.164-shaped for phone_number_verified to be true","errors":[{"path":"phone_number","message":"phone_number must be E.164-shaped for phone_number_verified to be true"}],"instance":"01a0ea55-40bc-756b-a601-8dff990c69fd"}
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

## `POST /subjects/bulk`

Requires `manage-users`. Applies one action to at most 100 subjects:
`disable`, `enable`, `delete`, or `end-sessions`, which additionally requires
`manage-sessions` and is refused whole with `403` without it. Each id goes
through the single-subject door exactly — `PATCH /subjects/:id` with
`{"enabled": …}`, `DELETE /subjects/:id`, `DELETE /subjects/:id/sessions` —
in a transaction of its own, so its target ceiling, its last-administrator
guard and its audit row apply to it alone, and one refused id leaves the
others as they were. The answer is `200` with one item per distinct id, in
the order given: the status that door would have answered, and a refusal's
problem `type` and `detail`; `end-sessions` adds how many were `ended`. More
than 100 ids, none, an id that is not a UUID or an action not in the list is
refused with `400`.

Against the tenth stack, as `uma`, a subject seeded in `ops-demo` and granted
`odudu-admin:manage-users` alone (`$UMA_TOKEN`), after `temp-1`
(`01a0ee8c-67c6-7752-904b-584bbc614619`) and `temp-2`
(`01a0ee8c-67ea-7049-b5d2-57c68046736c`) were created through
`POST /subjects`: a disable of `temp-1`, of `mona`, who holds
`manage-tenant`, and of an id no subject holds; `end-sessions` without
`manage-sessions`; then a delete by `$ADMIN_TOKEN`, and the rows the first
request left, each naming its id:

```bash
curl -sS -X POST -H "Authorization: Bearer $UMA_TOKEN" -H 'content-type: application/json' \
  -d '{"action":"disable","ids":["01a0ee8c-67c6-7752-904b-584bbc614619","01a0ee8a-c8f6-7450-b486-861a66a87684","0199aa00-0000-7000-8000-0000000000ff"]}' \
  "$P/subjects/bulk"; echo
curl -sS -X POST -H "Authorization: Bearer $UMA_TOKEN" -H 'content-type: application/json' \
  -d '{"action":"end-sessions","ids":["01a0ee8c-67c6-7752-904b-584bbc614619"]}' \
  "$P/subjects/bulk"; echo
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"action":"delete","ids":["01a0ee8c-67c6-7752-904b-584bbc614619","01a0ee8c-67ea-7049-b5d2-57c68046736c"]}' \
  "$P/subjects/bulk"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/audit/count?action=subject.delete"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/audit?action=subject.amend&limit=2" \
  | python3 -c 'import json,sys;[print(json.dumps({k:i[k] for k in ("action","outcome","actor_name","resource_id","detail")})) for i in json.load(sys.stdin)["items"]]'
```

```
{"items":[{"id":"01a0ee8c-67c6-7752-904b-584bbc614619","status":204},{"id":"01a0ee8a-c8f6-7450-b486-861a66a87684","status":403,"type":"about:blank","detail":"the subject holds what the caller does not: manage-tenant"},{"id":"0199aa00-0000-7000-8000-0000000000ff","status":404,"type":"about:blank","detail":"no subject 0199aa00-0000-7000-8000-0000000000ff"}]}
{"type":"about:blank","title":"Forbidden","status":403,"instance":"01a0ee8c-69e5-74a5-bb6e-e50bd8569a6b"}
{"items":[{"id":"01a0ee8c-67c6-7752-904b-584bbc614619","status":204},{"id":"01a0ee8c-67ea-7049-b5d2-57c68046736c","status":204}]}
{"count":2,"capped":false}
{"action": "subject.amend", "outcome": "refused", "actor_name": "uma", "resource_id": "01a0ee8a-c8f6-7450-b486-861a66a87684", "detail": {"denied": ["manage-tenant"]}}
{"action": "subject.amend", "outcome": "allowed", "actor_name": "uma", "resource_id": "01a0ee8c-67c6-7752-904b-584bbc614619", "detail": {"enabled": {"after": false, "before": true}}}
```

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
caller could delete — [`DELETE /subjects/:id/recovery-codes`](#delete-subjectsidrecovery-codes)
revokes the set whole. `password-history` never appears: it is not a
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

## `DELETE /subjects/:id/recovery-codes`

Requires `manage-users`. Revokes every recovery code the subject holds,
spent ones with them, so none signs in again — the answer to a printed list
somebody else may have read. A code carries no `id` of its own
([`GET /subjects/:id/credentials`](#get-subjectsidcredentials) says why), so
the set is the only thing there is to remove. It answers `204` whether or
not any were held, and its `subject.recovery_codes_revoke` audit row says
how many went in `detail.revoked`. It owes nothing: requiring
`generate-recovery-codes` through
[`PUT /subjects/:id/required-actions`](#get-subjectsidrequired-actions-and-put-subjectsidrequired-actions)
is what asks the subject for a fresh set. An unknown subject, one in
another tenant, or one with no `users` row answers `404`, and a subject
holding an admin capability the caller does not is refused with `403`
([the target ceiling](#the-target-ceiling)).

Captured against the seventh stack, described at the top of this page, on `ines` in
`lockout-demo` — the subject [`GET /subjects/:id/lockout`](#get-subjectsidlockout)
below also uses. Its required actions first, for the `ETag` the `PUT`
sends:

```bash
INES=http://localhost:3080/admin/tenants/lockout-demo/subjects/01a0ec85-0c4c-7ab4-821c-a4fad1d15482
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" "$INES/required-actions" | grep -iE '^etag|^\{'
```

```
etag: "7d357b0ef1f85ba71c5ccebb6671b0c34f4b3950f5b21d2af7b4a3d4e9dcd570"
{"actions":[]}
```

The `PUT` owes a set, the sign-in that follows ends on the page that
issues it (its title printed, by `signin` from that section, and none of
the codes), and the credentials list then counts ten:

```bash
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -H 'if-match: "7d357b0ef1f85ba71c5ccebb6671b0c34f4b3950f5b21d2af7b4a3d4e9dcd570"' \
  -d '{"actions":["generate-recovery-codes"]}' "$INES/required-actions"
signin 'correct horse battery staple'
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$INES/credentials"
```

```
{"actions":["generate-recovery-codes"]}
HTTP/1.1 200 OK
<title>Save your recovery codes</title>
{"items":[{"id":"01a0ec85-0c6d-75c9-a720-81d3b70c0811","type":"password","created_at":"2026-09-29T09:35:37.542Z","expired":false},{"type":"recovery-code","created_at":"2026-09-29T09:36:10.866Z","recovery_code_count":10}]}
```

Revoking them, then the list again, then the audit row, scoped to `ines`
and this action:

Recaptured against the tenth stack, once each row answered `actor_name` and
`actor_origin`: in a tenant of the same name, `ines` seeded there, owed
`generate-recovery-codes` and signed in once so the page minted her a set,
then the same three requests, so the ids are that run's, not those above:

```bash
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$INES/recovery-codes"
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$INES/credentials"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/lockout-demo/audit?resource_type=subject&resource_id=01a0ee8f-bef6-7e61-b451-6bb2bb05a643&action=subject.recovery_codes_revoke"; echo
```

```
HTTP/1.1 204 No Content
x-request-id: 01a0ee8f-c14b-7de0-b504-c314a6070e23
cache-control: no-store
Date: Tue, 29 Sep 2026 19:06:33 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a0ee8f-bf17-764e-b49c-59229a548da4","type":"password","created_at":"2026-09-29T19:06:33.071Z","expired":false}]}
{"items":[{"id":"01a0ee8f-c159-7839-a043-7aeabfb94d1e","occurred_at":"2026-09-29T19:06:33.686Z","event_type":"admin_mutation","action":"subject.recovery_codes_revoke","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0ee8a-bfb8-763c-ac22-0c8d97b0fada","actor_client_id":"01a0ee8a-bf72-77c9-a423-f61084924d9f","actor_name":null,"actor_origin":"system","resource_type":"subject","resource_id":"01a0ee8f-bef6-7e61-b451-6bb2bb05a643","request_id":"01a0ee8f-c14b-7de0-b504-c314a6070e23","ip":"172.22.0.1","detail":{"revoked":10}}]}
```

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

## `GET /subjects/:id/lockout`

Requires `view-users`. The subject's run of failed sign-ins as the
lockout reads it: `failure_count`, `last_failure_at`, `locked_until`, and
`locked` — whether an attempt made now would be refused, judged by the
server's clock so a caller never compares `locked_until` against its own.
A lock that has run out answers `locked: false` with its count kept, since
the run is only forgotten after `brute_force_failure_reset_seconds` of
quiet ([README.md](../README.md)'s brute-force section has the arithmetic).
A subject that has never failed answers a zero count and nulls. An unknown
subject, one in another tenant, or one with no `users` row answers `404`.

Captured against the seventh stack, described at the top of this page, in a tenant
`lockout-demo` made by `odudu seed --tenant lockout-demo --client
lockout-demo-app --redirect-uri https://app.example/callback --user hana`,
on `ines`, a second subject seeded there with `odudu seed user` and
signed in by nothing before this. `signin` is the helper the section below
defines, pointed at this tenant, this client, `ines` and port 3080 — as run:

```bash
AUTHORIZE='http://localhost:3080/tenants/lockout-demo/protocol/openid-connect/auth?response_type=code&client_id=lockout-demo-app&redirect_uri=https%3A%2F%2Fapp.example%2Fcallback&scope=openid&state=xyz&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256'
signin() {
  sid=$(curl -sS "$AUTHORIZE" | sed -n 's/.*name="auth_session_id" value="\([^"]*\)".*/\1/p' | head -1)
  curl -sS -D - -o body.html \
    --data-urlencode "auth_session_id=$sid" \
    --data-urlencode "username=ines" \
    --data-urlencode "password=$1" \
    http://localhost:3080/tenants/lockout-demo/login-actions/authenticate | grep -iE '^(HTTP|location)'
  grep -o '<title>[^<]*</title>' body.html || true
}
```

Read first, then five wrong passwords and the right one — all six refused,
the sixth for the lock — then read again:

```bash
INES=http://localhost:3080/admin/tenants/lockout-demo/subjects/01a0ec85-0c4c-7ab4-821c-a4fad1d15482
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$INES/lockout"
for attempt in 1 2 3 4 5; do signin 'not the password'; done
signin 'correct horse battery staple'
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$INES/lockout"
```

```
{"locked":false,"locked_until":null,"failure_count":0,"last_failure_at":null}
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
{"locked":true,"locked_until":"2026-09-29T09:37:48.522Z","failure_count":6,"last_failure_at":"2026-09-29T09:35:48.522Z"}
```

The sixth attempt counted too, so the lock is the doubled one, two minutes.
Clearing it, reading again, then an id no user subject in `lockout-demo`
holds — the tenant's own id:

```bash
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$INES/lockout"
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$INES/lockout"
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3080/admin/tenants/lockout-demo/subjects/01a0ec84-9897-7740-a17f-83b4de29cdda/lockout
```

```
HTTP/1.1 204 No Content
x-request-id: 01a0ec85-3777-7b4c-bbd6-5aed404a90af
cache-control: no-store
Date: Tue, 29 Sep 2026 09:35:48 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"locked":false,"locked_until":null,"failure_count":0,"last_failure_at":null}
{"type":"about:blank","title":"Not Found","status":404,"detail":"no user subject 01a0ec84-9897-7740-a17f-83b4de29cdda","instance":"01a0ec85-37a5-7747-b4ff-2114cc1f7d80"}
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

## `DELETE /lockouts`

Requires `manage-users`. Clears every subject's run of failed sign-ins, locked
or still counting, as `DELETE /subjects/:id/lockout` clears one, and answers
how many it cleared. A subject holding an admin capability the caller does not
keeps its count and is counted under `beyond_ceiling` instead — the target
ceiling that door applies, run over the tenant as a set (ADR 0040's
amendment of 2026-09-30). One `subject.lockouts_clear` row, filed on the
tenant, carries both counts and, under `subject_ids`, the ids whose counts
it cleared, sorted, at most 100 of them, so the per-subject trail the single
door leaves is not lost; a subject left beyond the ceiling writes no refused
row of its own (ADR 0037).

Against the tenth stack, after five wrong passwords for `linus`, which lock
him, and two for `grace`, which do not:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/subjects?locked=true"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/subjects/01a0ee8a-c58a-716c-96a6-edcab4ca1a70/lockout"; echo
curl -sS -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$P/lockouts"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/subjects?locked=true"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/subjects/01a0ee8a-c58a-716c-96a6-edcab4ca1a70/lockout"; echo
```

```
{"items":[{"id":"01a0ee8a-c748-743d-b60e-9b0ed48221a3","type":"user","username":"linus","email":null,"enabled":true,"created_at":"2026-09-29T19:01:07.522Z"}]}
{"locked":false,"locked_until":null,"failure_count":2,"last_failure_at":"2026-09-29T19:02:52.059Z"}
{"cleared":2,"beyond_ceiling":0}
{"items":[]}
{"locked":false,"locked_until":null,"failure_count":0,"last_failure_at":null}
```

## `POST /subjects/:id/password-reset` and `POST /subjects/:id/verification`

Requires `manage-users`. Each queues a link to the subject's own address,
minted and mailed by the same write the self-service door makes
(`enqueueResetLink` and `enqueueVerificationLink`, `@odudu/account`), and
answers `202` with no body: the link is never in the response, nor in the
audit row, `subject.password_reset_send` or `subject.verification_send`,
whose `detail` is empty. Each is held to the target ceiling like every other
write under `/subjects/:id`, and each is throttled per origin with the
sign-in, registration and reset-request submissions (ADR 0023; not shown
here, since this stack raised the budget — `apps/server/tests/throttle.int.test.ts`
holds it). A subject with no `users` row answers `404`. Each refusal a link
would otherwise meet later, silently, is a `409` of its own type:

- `about:blank#no-email` — the subject has no address;
- `about:blank#reset-password-off`, a reset only — the tenant's
  `reset_password_allowed` is off, so its reset page would refuse the link;
- `about:blank#no-mail-relay` — `GET /smtp` would answer `effective` `none`:
  the tenant has no relay and the deployment no sender, so the mail would
  only be logged.

None of the three writes a row: each is a conflict with the data, not a guard
(ADR 0037's amendment of 2026-09-28). Against the tenth stack, for `grace`
and then `linus`, who has no address, taking each refusal in turn: the
setting, then a relay for `ops-demo` at the stack's own `postgres` container,
port 25, where nothing listens:

```bash
G=01a0ee8a-c58a-716c-96a6-edcab4ca1a70
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$P/subjects/$G/password-reset"; echo
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"reset_password_allowed":true}' "$P/settings" | grep -o '"reset_password_allowed":[a-z]*'
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/smtp"; echo
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$P/subjects/$G/password-reset"; echo
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"host":"postgres","port":25,"from_address":"noreply@ops.example"}' "$P/smtp"; echo
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$P/subjects/$G/password-reset"
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$P/subjects/$G/verification"
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/subjects/01a0ee8a-c748-743d-b60e-9b0ed48221a3/verification"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/audit?resource_type=subject&resource_id=$G&action=subject.password_reset_send"; echo
```

```
{"type":"about:blank#reset-password-off","title":"Conflict","status":409,"detail":"reset_password_allowed is off, so the tenant would refuse the link; turn it on with PATCH /settings first","instance":"01a0ee8c-61e6-766b-9b7d-dfa1705a654d"}
"reset_password_allowed":true
{"configured":false,"host":null,"port":null,"from_address":null,"username":null,"password_set":false,"starttls":null,"effective":"none"}
{"type":"about:blank#no-mail-relay","title":"Conflict","status":409,"detail":"the tenant has no relay and the deployment no sender, so the mail would only be logged","instance":"01a0ee8c-6254-71bb-99ff-38173b7334d0"}
{"configured":true,"host":"postgres","port":25,"from_address":"noreply@ops.example","username":null,"password_set":false,"starttls":false,"effective":"tenant"}
HTTP/1.1 202 Accepted
x-request-id: 01a0ee8c-6291-7ba8-91e6-d08ea702a515
cache-control: no-store
content-length: 0
Date: Tue, 29 Sep 2026 19:02:52 GMT
Connection: keep-alive
Keep-Alive: timeout=72

202
{"type":"about:blank#no-email","title":"Conflict","status":409,"detail":"the subject has no email address to send to","instance":"01a0ee8c-62de-71e8-afbb-2a704e8fa724"}
{"items":[{"id":"01a0ee8c-62ab-7858-b95a-960db8f34277","occurred_at":"2026-09-29T19:02:52.832Z","event_type":"admin_mutation","action":"subject.password_reset_send","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0ee8a-bfb8-763c-ac22-0c8d97b0fada","actor_client_id":"01a0ee8a-bf72-77c9-a423-f61084924d9f","actor_name":null,"actor_origin":"system","resource_type":"subject","resource_id":"01a0ee8a-c58a-716c-96a6-edcab4ca1a70","request_id":"01a0ee8c-6291-7ba8-91e6-d08ea702a515","ip":"172.22.0.1","detail":{}}]}
```

## `POST /subjects/:id/actions-email`

Requires `manage-users`. The body names the required actions the link takes
the subject through — `{"actions": […]}`, at least one of `update-password`,
`configure-totp`, `configure-passkey` and `generate-recovery-codes`, the
vocabulary `PUT /subjects/:id/required-actions` takes, anything else refused
with `400` — and optionally a `redirect_uri` with the `client_id` that
registered it. The link is minted and mailed to the subject's own address by
`enqueueActionsLink` (`@odudu/account`), and the answer is `202` with no
body. The two routes above are the same core with a fixed link: one
`sendAccountEmail` (`packages/protocol-admin/src/usecase/account-email.ts`)
does the lookups, the target ceiling, the three `409`s, the mail and the
audit row for all three, so they cannot drift.

**What the link does.** Opening it shows the actions, and consumes nothing,
so a mail scanner's `GET` does not spend it. Submitting it sets a new
password where `update-password` is named, under the reset link's rules — the
tenant's policy, the previous password refused, every outstanding
password-setting link retired — and owes every other action, so the subject's next sign-in parks on
each, as it does for one an administrator set. **The link alone never enrols
a factor**: possession of a mailbox stands in for a forgotten password, as a
reset link's does, but enrolling a TOTP secret or a passkey still takes a
sign-in with the password and whatever factor the subject already holds. The
link lives as long as a reset link (`reset_password_ttl_seconds`), since it
signs its subject in by their mailbox the same way, and it is spent once.

**A `redirect_uri` is only ever one the client registered.** The link's last
page offers it as "Back to the application", so it must equal, exactly, one
of the `redirect_uris` of the client `client_id` names, or the request is
refused with `400` naming the field; a `redirect_uri` without a `client_id`,
or a `client_id` without a `redirect_uri`, is refused the same way. Any other
target would make this server's page an open redirect under its own name.

The `409`s are the reset's: `about:blank#no-email`, `about:blank#no-mail-relay`,
and `about:blank#reset-password-off` when `update-password` is named while
the tenant's `reset_password_allowed` is off — its reset page would refuse
the link, and an outstanding link stops working the moment the setting is
turned off. It is held to the target ceiling and throttled per origin with
the sign-in, registration and reset submissions, as the two routes above
are. The link is never in the response, and the audit row,
`subject.actions_email_send`, names the actions, the client and the
redirect and nothing else.

Against the twelfth stack, in a tenant `required-actions-demo` made for it,
with a relay at the stack's own `postgres` container, port 25, where nothing
listens, a public client `actions-app` registered
`https://app.example/callback`, and `grace` made through `POST /subjects`
with an address and no password; `P=http://localhost:3082/admin/tenants/required-actions-demo`.
A link asking for a password while the tenant's reset is off, the setting
turned on, a redirect the client never registered, an action the server
does not take, then the send that is accepted, and its audit row:

```bash
G=01a109bf-b119-7510-a588-18f191c6bef5
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"actions":["configure-totp","update-password"]}' "$P/subjects/$G/actions-email"; echo
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"reset_password_allowed":true}' "$P/settings" | grep -o '"reset_password_allowed":[a-z]*'
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"actions":["configure-totp","update-password"],"client_id":"actions-app","redirect_uri":"https://evil.example/cb"}' \
  "$P/subjects/$G/actions-email"; echo
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"actions":["verify-email"]}' "$P/subjects/$G/actions-email"; echo
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"actions":["configure-totp","update-password"],"client_id":"actions-app","redirect_uri":"https://app.example/callback"}' \
  "$P/subjects/$G/actions-email"
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/audit?resource_type=subject&resource_id=$G&action=subject.actions_email_send" \
  | jq -c '.items[] | {action, outcome, detail}'
```

```
{"type":"about:blank#reset-password-off","title":"Conflict","status":409,"detail":"reset_password_allowed is off, so the tenant would refuse the link; turn it on with PATCH /settings first","instance":"01a109bf-b12a-7908-bdf5-badc3b34a200"}
"reset_password_allowed":true
{"type":"about:blank","title":"Bad Request","status":400,"detail":"redirect_uri: is not one of actions-app's registered redirect URIs","errors":[{"path":"redirect_uri","message":"is not one of actions-app's registered redirect URIs"}],"instance":"01a109bf-b168-7b17-96a5-bdf7f124150c"}
{"type":"about:blank","title":"Error","status":400,"detail":"body/actions/0 must be equal to one of the allowed values","errors":[{"path":"actions[0]","message":"must be equal to one of the allowed values"}],"instance":"01a109bf-b17f-7921-908a-2b52a175a4a4"}
HTTP/1.1 202 Accepted
x-request-id: 01a109bf-b189-768c-b5c1-9b6f91462cab
cache-control: no-store
content-length: 0
Date: Mon, 05 Oct 2026 01:48:40 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"action":"subject.actions_email_send","outcome":"allowed","detail":{"actions":["update-password","configure-totp"],"client_id":"actions-app","redirect_uri":"https://app.example/callback"}}
```

The one mail the tenant's outbox holds, read there, since the relay delivers nothing —
the actions in the order the link will ask for them, which is the one the
audit row lists too:

```bash
docker compose exec -T postgres psql -U odudu -d odudu -At -c \
  "select subject, body_text from email_outbox where tenant_id = (select id from tenants where name = 'required-actions-demo');"
```

```
Update your required-actions-demo account|Your administrator asks you to update your required-actions-demo account:

- Choose a new password
- Set up an authenticator app

Do so by visiting this link:

http://localhost:3082/tenants/required-actions-demo/login-actions/action-token?key=RK2yZYeq330vzTfYQQbYoNAmekDPir3Vsvm0A_AdfCA

If you were not expecting this, you can ignore this message.
```

What following it does is under [Following a required-actions link](request-paths.md#following-a-required-actions-link).

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
outstanding link that can set the password is retired** — reset links, and
required-actions links naming `update-password` — as a redeemed reset
retires its siblings, so a link mailed before the account was recovered cannot
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

The demotion that would come first, refused the same way, then `lin`'s
roles, unchanged, and the two `refused` rows it and a lockout clear wrote.
Captured against the sixth stack, in a tenant also named `recovery-demo`
created there for it, with its own `mo` (`manage-users`) and `lin`
(`tenant-admin`) set up the same way:

Recaptured against the tenth stack, once each row answered `actor_name` and
`actor_origin`, in a tenant of the same name with `mo` and `lin` set up the
same way, so the ids are that run's, not those above:

```bash
LIN=http://localhost:3082/admin/tenants/recovery-demo/subjects/01a0ee90-8113-7860-8d43-2175e6975b6d
ETAG=$(curl -sS -D - -o /dev/null -H "Authorization: Bearer $MO_TOKEN" "$LIN/roles" | tr -d '\r' | sed -n 's/^etag: //p')
curl -sS -X PUT -H "Authorization: Bearer $MO_TOKEN" -H 'content-type: application/json' \
  -H "If-Match: $ETAG" -d '{"role_ids":[]}' "$LIN/roles"
echo
curl -sS -X DELETE -H "Authorization: Bearer $MO_TOKEN" "$LIN/lockout"
echo
curl -sS -H "Authorization: Bearer $MO_TOKEN" "$LIN/roles"
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3082/admin/tenants/recovery-demo/audit?event_type=admin_mutation&outcome=refused&limit=2'
echo
```

```
{"type":"about:blank","title":"Forbidden","status":403,"detail":"the subject holds what the caller does not: manage-clients, manage-tenant, manage-keys, manage-sessions, view-audit","instance":"01a0ee90-b399-7446-a234-746e913625a6"}
{"type":"about:blank","title":"Forbidden","status":403,"detail":"the subject holds what the caller does not: manage-clients, manage-tenant, manage-keys, manage-sessions, view-audit","instance":"01a0ee90-b5dc-7596-8f44-6dcdf3d976e4"}
{"items":[{"id":"01a0ee90-580e-7688-b635-280e0a9e75bb","name":"tenant-admin","client_id":"01a0ee90-57cb-7a51-9164-4d2888295163","client_key":"odudu-admin"}]}
{"items":[{"id":"01a0ee90-b5ec-7d42-9fea-4c6a2ca2d7b8","occurred_at":"2026-09-29T19:07:36.298Z","event_type":"admin_mutation","action":"subject.lockout_clear","outcome":"refused","actor_tenant_id":"01a0ee90-5627-7af7-8dce-d98eb1aa9c7a","actor_subject_id":"01a0ee90-6fbc-71d1-9286-e933bcf69384","actor_client_id":"01a0ee90-57cb-7a51-9164-4d2888295163","actor_name":"mo","actor_origin":"tenant","resource_type":"subject","resource_id":"01a0ee90-8113-7860-8d43-2175e6975b6d","request_id":"01a0ee90-b5dc-7596-8f44-6dcdf3d976e4","ip":"172.22.0.1","detail":{"denied":["manage-clients","manage-tenant","manage-keys","manage-sessions","view-audit"]}},{"id":"01a0ee90-b530-7f48-a043-1cc199dfefda","occurred_at":"2026-09-29T19:07:36.051Z","event_type":"admin_mutation","action":"subject.roles_set","outcome":"refused","actor_tenant_id":"01a0ee90-5627-7af7-8dce-d98eb1aa9c7a","actor_subject_id":"01a0ee90-6fbc-71d1-9286-e933bcf69384","actor_client_id":"01a0ee90-57cb-7a51-9164-4d2888295163","actor_name":"mo","actor_origin":"tenant","resource_type":"subject","resource_id":"01a0ee90-8113-7860-8d43-2175e6975b6d","request_id":"01a0ee90-b399-7446-a234-746e913625a6","ip":"172.22.0.1","detail":{"denied":["manage-clients","manage-tenant","manage-keys","manage-sessions","view-audit"]}}],"next":"eyJhZnRlciI6IjIwMjYtMDktMjlUMTk6MDc6MzYuMDUxWnwwMWEwZWU5MC1iNTMwLTdmNDgtYTA0My0xY2MxOTlkZmVmZGEiLCJjb2xsZWN0aW9uIjoiYXVkaXQiLCJ0ZW5hbnRJZCI6IjAxYTBlZTkwLTU2MjctN2FmNy04ZGNlLWQ5OGViMWFhOWM3YSIsImZpbHRlcnMiOiJVZDFzeWdzd19Oblp0UzJDZ2dXQk91dVc3UE5YT29TVFlRakVMdDlBN1JZIn0.e-kpCAejGJ48wy3fmFUnWnFy6XVSh8Ou4S_8Dz24j6E"}
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

Recaptured against the tenth stack, once each row answered `actor_name` and
`actor_origin`, after the same recovery was made there in the tenant of the
same name above, before its ceiling demonstration, and bounded the same way;
the ids and the issued password are that run's, not those above:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3082/admin/tenants/recovery-demo/audit?event_type=admin_mutation&to=2026-09-29T19:07:32.000Z&limit=7'
echo

docker compose logs odudu | grep -c 'xZdG91476aUnqv7I9Ow7w6ZysjNDO2d-'
```

```
{"items":[{"id":"01a0ee90-a22a-7937-bf93-6b780e3e09f6","occurred_at":"2026-09-29T19:07:31.118Z","event_type":"admin_mutation","action":"subject.delete","outcome":"refused","actor_tenant_id":"01a0ee90-5627-7af7-8dce-d98eb1aa9c7a","actor_subject_id":"01a0ee90-6fbc-71d1-9286-e933bcf69384","actor_client_id":"01a0ee90-57cb-7a51-9164-4d2888295163","actor_name":"mo","actor_origin":"tenant","resource_type":"subject","resource_id":"01a0ee90-8113-7860-8d43-2175e6975b6d","request_id":"01a0ee90-a102-7f9d-a668-d511d7c1c776","ip":"172.22.0.1","detail":{"denied":["manage-clients","manage-tenant","manage-keys","manage-sessions","view-audit"]}},{"id":"01a0ee90-a0b0-7d64-9222-215fce17a0c3","occurred_at":"2026-09-29T19:07:30.851Z","event_type":"admin_mutation","action":"subject.amend","outcome":"refused","actor_tenant_id":"01a0ee90-5627-7af7-8dce-d98eb1aa9c7a","actor_subject_id":"01a0ee90-6fbc-71d1-9286-e933bcf69384","actor_client_id":"01a0ee90-57cb-7a51-9164-4d2888295163","actor_name":"mo","actor_origin":"tenant","resource_type":"subject","resource_id":"01a0ee90-8113-7860-8d43-2175e6975b6d","request_id":"01a0ee90-a007-7588-ae28-e4c84e936197","ip":"172.22.0.1","detail":{"denied":["manage-clients","manage-tenant","manage-keys","manage-sessions","view-audit"]}},{"id":"01a0ee90-9fea-7807-abbe-61cfe794ca56","occurred_at":"2026-09-29T19:07:30.649Z","event_type":"admin_mutation","action":"subject.password_issue","outcome":"refused","actor_tenant_id":"01a0ee90-5627-7af7-8dce-d98eb1aa9c7a","actor_subject_id":"01a0ee90-6fbc-71d1-9286-e933bcf69384","actor_client_id":"01a0ee90-57cb-7a51-9164-4d2888295163","actor_name":"mo","actor_origin":"tenant","resource_type":"subject","resource_id":"01a0ee90-8113-7860-8d43-2175e6975b6d","request_id":"01a0ee90-9ef8-7d2d-87a9-637c23262314","ip":"172.22.0.1","detail":{"denied":["manage-clients","manage-tenant","manage-keys","manage-sessions","view-audit"]}},{"id":"01a0ee90-9af6-7d69-b4cb-ef4ab6c02f0e","occurred_at":"2026-09-29T19:07:29.240Z","event_type":"admin_mutation","action":"subject.password_issue","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0ee8a-bfb8-763c-ac22-0c8d97b0fada","actor_client_id":"01a0ee8a-bf72-77c9-a423-f61084924d9f","actor_name":null,"actor_origin":"system","resource_type":"subject","resource_id":"01a0ee90-63eb-7f15-b728-2778d1eeb1b2","request_id":"01a0ee90-9996-747f-b057-d2736997b322","ip":"172.22.0.1","detail":{}},{"id":"01a0ee90-996d-7b41-8af2-ef7c4dcb79c8","occurred_at":"2026-09-29T19:07:28.919Z","event_type":"admin_mutation","action":"session.end_all","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0ee8a-bfb8-763c-ac22-0c8d97b0fada","actor_client_id":"01a0ee8a-bf72-77c9-a423-f61084924d9f","actor_name":null,"actor_origin":"system","resource_type":"subject","resource_id":"01a0ee90-63eb-7f15-b728-2778d1eeb1b2","request_id":"01a0ee90-98b2-73e2-8dcc-603f420cdea1","ip":"172.22.0.1","detail":{"ended":2}},{"id":"01a0ee90-9882-771e-b457-690b797a5d7e","occurred_at":"2026-09-29T19:07:28.767Z","event_type":"admin_mutation","action":"subject.lockout_clear","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0ee8a-bfb8-763c-ac22-0c8d97b0fada","actor_client_id":"01a0ee8a-bf72-77c9-a423-f61084924d9f","actor_name":null,"actor_origin":"system","resource_type":"subject","resource_id":"01a0ee90-63eb-7f15-b728-2778d1eeb1b2","request_id":"01a0ee90-9801-7539-b002-2152699cc740","ip":"172.22.0.1","detail":{"cleared":true}},{"id":"01a0ee90-834e-74cd-b6c1-836195dea170","occurred_at":"2026-09-29T19:07:23.325Z","event_type":"admin_mutation","action":"subject.roles_set","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0ee8a-bfb8-763c-ac22-0c8d97b0fada","actor_client_id":"01a0ee8a-bf72-77c9-a423-f61084924d9f","actor_name":null,"actor_origin":"system","resource_type":"subject","resource_id":"01a0ee90-8113-7860-8d43-2175e6975b6d","request_id":"01a0ee90-82fa-7893-90bc-e2d7754452d3","ip":"172.22.0.1","detail":{}}],"next":"eyJhZnRlciI6IjIwMjYtMDktMjlUMTk6MDc6MjMuMzI1WnwwMWEwZWU5MC04MzRlLTc0Y2QtYjZjMS04MzYxOTVkZWExNzAiLCJjb2xsZWN0aW9uIjoiYXVkaXQiLCJ0ZW5hbnRJZCI6IjAxYTBlZTkwLTU2MjctN2FmNy04ZGNlLWQ5OGViMWFhOWM3YSIsImZpbHRlcnMiOiJ6MEhPVzdmamNrYy1ISnhGTHZHOUlmaENwb1FRYUF2b3pBeURyck5nODhNIn0.zjFNAkHr5Uuj4lvGunjfSDELiAKAA-7YkKkhFTkGLDQ"}
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

Captured against the sixth stack, on a subject `grace` and a role
`billing-viewer` created in its `demo` for it. The read, then the write
carrying what the read answered:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3080/admin/tenants/demo/subjects/01a0ea58-0e2d-7c60-a4a2-7a7edc70a01f/roles

curl -sS -D - -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"' \
  -d '{"role_ids": ["01a0ea58-0e45-76eb-be5f-bd76e03e4b6e"]}' \
  http://localhost:3080/admin/tenants/demo/subjects/01a0ea58-0e2d-7c60-a4a2-7a7edc70a01f/roles
```

```
HTTP/1.1 200 OK
x-request-id: 01a0ea58-0e51-7257-bf3c-64071dd43178
cache-control: no-store
etag: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"
content-type: application/json; charset=utf-8
content-length: 12
Date: Mon, 28 Sep 2026 23:27:14 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[]}

HTTP/1.1 200 OK
x-request-id: 01a0ea58-0e65-7ba5-836e-5afec260184a
cache-control: no-store
etag: "da18ee68fe8192f473f7a652ecf0a6643b7a07b68bd4bc028673d434328f8572"
content-type: application/json; charset=utf-8
content-length: 116
Date: Mon, 28 Sep 2026 23:27:14 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a0ea58-0e45-76eb-be5f-bd76e03e4b6e","name":"billing-viewer","client_id":null,"client_key":null}]}
```

**The tag is over the list, not over the resource.** An empty assignment
hashes to `"eef46741…"` whichever subject, group or scope it belongs to —
the three sections that follow show the same value — so a tag is not an
identifier and carries no authority to write anywhere. It still does its
one job: a write only lands when the list is what its holder last read.

### The last administrator

A tenant always keeps one enabled subject holding `tenant-admin` — in the
system tenant, `manage-tenants`, whose holders reach every other tenant —
once it has one. A write that would leave none is refused with `409`,
type `about:blank#last-administrator`, nothing of it applied, and a
`refused` row under the action attempted (ADR 0037, ADR 0040's
amendment). Holders are counted however they hold it, and a disabled
subject is not one. The same refusal stands on every door that can take
an administrator away: this route and `PUT /subjects/:id/groups`,
disabling or deleting a subject, `PUT /groups/:id/roles`, reparenting or
deleting a group, deleting a role or removing a composite that nests it,
and deleting a client whose roles do. A tenant with no holder to begin
with is refused nothing.

Captured against the fifth stack in `admins-demo`, as `ada-t2`, on
`grace`, the tenant's only holder — her roles emptied under the `ETag` her
last write answered, then disabling her, then deleting her, then her
refused rows, newest first:

Recaptured against the tenth stack, once each row answered `actor_name` and
`actor_origin`, as `ada-t8b2`, on a `grace` seeded as the only holder of
`tenant-admin` in a tenant of the same name, her roles emptied under the
`ETag` a read of them answered, so the ids are that run's, not those above:

```bash
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -H 'If-Match: "ed3ace191e50ac13f9c21c9ec7f012d4155f16ce7ca3ea35698f18c9f25c3cd8"' \
  -d '{"role_ids":[]}' \
  http://localhost:3082/admin/tenants/admins-demo/subjects/01a0ee91-5901-7963-a2e4-c73142de6325/roles; echo
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"enabled":false}' \
  http://localhost:3082/admin/tenants/admins-demo/subjects/01a0ee91-5901-7963-a2e4-c73142de6325; echo
curl -sS -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3082/admin/tenants/admins-demo/subjects/01a0ee91-5901-7963-a2e4-c73142de6325; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3082/admin/tenants/admins-demo/audit?resource_type=subject&resource_id=01a0ee91-5901-7963-a2e4-c73142de6325&outcome=refused'; echo
```

```
{"type":"about:blank#last-administrator","title":"Conflict","status":409,"detail":"this would leave no enabled subject holding tenant-admin","instance":"01a0ee91-5c87-7b01-bee7-d60919b3f51a"}
{"type":"about:blank#last-administrator","title":"Conflict","status":409,"detail":"this would leave no enabled subject holding tenant-admin","instance":"01a0ee91-5ccd-7e16-b183-e33e0b17cee3"}
{"type":"about:blank#last-administrator","title":"Conflict","status":409,"detail":"this would leave no enabled subject holding tenant-admin","instance":"01a0ee91-5d11-7b93-acf2-8a3f1ac1ced3"}
{"items":[{"id":"01a0ee91-5d41-742d-8e36-8d689e236e62","occurred_at":"2026-09-29T19:08:19.116Z","event_type":"admin_mutation","action":"subject.delete","outcome":"refused","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0ee8a-bfb8-763c-ac22-0c8d97b0fada","actor_client_id":"01a0ee8a-bf72-77c9-a423-f61084924d9f","actor_name":null,"actor_origin":"system","resource_type":"subject","resource_id":"01a0ee91-5901-7963-a2e4-c73142de6325","request_id":"01a0ee91-5d11-7b93-acf2-8a3f1ac1ced3","ip":"172.22.0.1","detail":{"reason":"this would leave no enabled subject holding tenant-admin"}},{"id":"01a0ee91-5cf2-7d9e-b589-044ea71896ad","occurred_at":"2026-09-29T19:08:19.040Z","event_type":"admin_mutation","action":"subject.amend","outcome":"refused","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0ee8a-bfb8-763c-ac22-0c8d97b0fada","actor_client_id":"01a0ee8a-bf72-77c9-a423-f61084924d9f","actor_name":null,"actor_origin":"system","resource_type":"subject","resource_id":"01a0ee91-5901-7963-a2e4-c73142de6325","request_id":"01a0ee91-5ccd-7e16-b183-e33e0b17cee3","ip":"172.22.0.1","detail":{"reason":"this would leave no enabled subject holding tenant-admin"}},{"id":"01a0ee91-5cb4-72e7-aa73-3ead5e69f32c","occurred_at":"2026-09-29T19:08:18.980Z","event_type":"admin_mutation","action":"subject.roles_set","outcome":"refused","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0ee8a-bfb8-763c-ac22-0c8d97b0fada","actor_client_id":"01a0ee8a-bf72-77c9-a423-f61084924d9f","actor_name":null,"actor_origin":"system","resource_type":"subject","resource_id":"01a0ee91-5901-7963-a2e4-c73142de6325","request_id":"01a0ee91-5c87-7b01-bee7-d60919b3f51a","ip":"172.22.0.1","detail":{"reason":"this would leave no enabled subject holding tenant-admin"}}]}
```

The group, role and client doors, the system tenant's `manage-tenants`,
and two removals racing each other are what
`packages/protocol-admin/tests/administrators.int.test.ts` shows; none of
those was captured here.

## `GET /subjects/:id/effective-roles`

Requires `view-users`. Every role the subject holds — the set token issuance
and authorization read (`effectiveRoles`, `@odudu/domain-authz`), not only
what `GET /subjects/:id/roles` assigns — each with `via`, every path it is held
by: `direct`; `group`, naming the group the role is mapped to, which is the
subject's own or one of its ancestors; or `composite`, naming the held role
it is nested under. Unpaged, and with no `ETag`: `GET /subjects/:id/roles` is
the list `PUT /subjects/:id/roles` replaces, and this is what follows from it.
An unknown subject answers `404`.

Against the tenth stack, after two tenant roles `billing-reader` and
`billing-auditor`, a group `/finance` with `/finance/payables` beneath it, and,
through the endpoints above, `billing-auditor` nesting `billing-reader`,
`/finance` mapped to `billing-reader`, `grace` assigned `billing-auditor` and
made a member of `/finance/payables`. Her assignments, then what she holds:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/subjects/01a0ee8a-c58a-716c-96a6-edcab4ca1a70/roles"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/subjects/01a0ee8a-c58a-716c-96a6-edcab4ca1a70/effective-roles"; echo
```

```
{"items":[{"id":"01a0ee8b-2f3b-769a-9d35-2cd69f7b8c23","name":"billing-auditor","client_id":null,"client_key":null}]}
{"items":[{"id":"01a0ee8b-2f1f-7484-9703-dfbd7e559f17","name":"billing-reader","client_id":null,"client_key":null,"via":[{"kind":"group","group_id":"01a0ee8b-2f54-7a5a-9da6-7ba6baacbe13","group_path":"/finance"},{"kind":"composite","parent_role_id":"01a0ee8b-2f3b-769a-9d35-2cd69f7b8c23","parent_name":"billing-auditor"}]},{"id":"01a0ee8b-2f3b-769a-9d35-2cd69f7b8c23","name":"billing-auditor","client_id":null,"client_key":null,"via":[{"kind":"direct"}]}]}
```

`billing-reader` is held twice over — through `/finance`, an ancestor of the
group she is in, and nested under `billing-auditor` — and her assignments
name neither.

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

Captured against the twelfth stack, in a tenant `groups-demo` created
through `POST /admin/tenants` for it. There, `platform-admins` is mapped to
`tenant-admin` through `PUT /groups/:id/roles`, `oncall` is its child with
no role of its own, `support` has none either, and `mei2` is a subject
created through `POST /subjects`. `$HELPDESK_TOKEN` belongs to `helpdesk`,
a user of that tenant created through `POST /subjects`, granted
`manage-users` alone through `PUT /subjects/:id/roles`, and signed in with
the one-time password `POST /subjects/:id/password` issued it;
`$ADMIN_TOKEN` is `ada`'s. The refusal
below turns on two facts, shown first — what `helpdesk` holds, and that
`oncall` carries nothing itself while its parent carries `tenant-admin`:

```bash
curl -sS -H "Authorization: Bearer $HELPDESK_TOKEN" \
  http://localhost:3082/admin/tenants/groups-demo/whoami

curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3082/admin/tenants/groups-demo/groups/01a109b9-c2d9-7265-9cfe-1cc931aa4a87/roles

curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3082/admin/tenants/groups-demo/groups/01a109b9-c2c0-7af8-baf6-399f4128272f/roles
```

```
{"subjectId":"01a109b9-c365-7216-9064-207c3931f9e0","issuerTenantId":"01a109b9-c288-7ef5-a623-21ab2f266513","capabilities":["manage-users","view-users"],"crossTenant":false}
{"items":[]}
{"items":[{"id":"01a109b9-c296-7612-84cf-fd8e6a727672","name":"tenant-admin","client_id":"01a109b9-c28f-78c9-bac7-b8be0801cfd6","client_key":"odudu-admin"}]}
```

The read, then a write with no `If-Match`, then `helpdesk` putting `mei2`
in `oncall`:

```bash
curl -sS -D - -H "Authorization: Bearer $HELPDESK_TOKEN" \
  http://localhost:3082/admin/tenants/groups-demo/subjects/01a109b9-c34e-7692-b5a4-67af33cf85e0/groups

curl -sS -D - -X PUT \
  -H "Authorization: Bearer $HELPDESK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"group_ids": ["01a109b9-c2f2-795b-9df3-36c34e89980e"]}' \
  http://localhost:3082/admin/tenants/groups-demo/subjects/01a109b9-c34e-7692-b5a4-67af33cf85e0/groups

curl -sS -D - -X PUT \
  -H "Authorization: Bearer $HELPDESK_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"' \
  -d '{"group_ids": ["01a109b9-c2d9-7265-9cfe-1cc931aa4a87"]}' \
  http://localhost:3082/admin/tenants/groups-demo/subjects/01a109b9-c34e-7692-b5a4-67af33cf85e0/groups
```

```
HTTP/1.1 200 OK
x-request-id: 01a109b9-f21c-7f4a-b3f7-d25034ae0c60
cache-control: no-store
etag: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"
content-type: application/json; charset=utf-8
content-length: 12
Date: Mon, 05 Oct 2026 01:42:23 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[]}

HTTP/1.1 428 Precondition Required
x-request-id: 01a109b9-f22d-71b1-b8e2-f82b7f95e7e8
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 181
Date: Mon, 05 Oct 2026 01:42:23 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to replace a subject’s groups","instance":"01a109b9-f22d-71b1-b8e2-f82b7f95e7e8"}

HTTP/1.1 403 Forbidden
x-request-id: 01a109b9-f243-73fa-8f46-668be780b58a
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 228
Date: Mon, 05 Oct 2026 01:42:23 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Forbidden","status":403,"detail":"the caller does not hold: tenant-admin, manage-clients, manage-tenant, manage-keys, manage-sessions, view-audit","instance":"01a109b9-f243-73fa-8f46-668be780b58a"}
```

`oncall` names no role, and is refused for everything `tenant-admin`
composites that `helpdesk` does not hold — reached through its parent.
The membership is still empty, under the same tag, so the same `If-Match`
then puts `mei2` in `support`, and replaying it once that has landed is
stale:

```bash
curl -sS -D - -H "Authorization: Bearer $HELPDESK_TOKEN" \
  http://localhost:3082/admin/tenants/groups-demo/subjects/01a109b9-c34e-7692-b5a4-67af33cf85e0/groups

curl -sS -D - -X PUT \
  -H "Authorization: Bearer $HELPDESK_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"' \
  -d '{"group_ids": ["01a109b9-c2f2-795b-9df3-36c34e89980e"]}' \
  http://localhost:3082/admin/tenants/groups-demo/subjects/01a109b9-c34e-7692-b5a4-67af33cf85e0/groups

curl -sS -D - -X PUT \
  -H "Authorization: Bearer $HELPDESK_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"' \
  -d '{"group_ids": []}' \
  http://localhost:3082/admin/tenants/groups-demo/subjects/01a109b9-c34e-7692-b5a4-67af33cf85e0/groups
```

```
HTTP/1.1 200 OK
x-request-id: 01a109b9-f25d-7357-a2c8-4c86697f32da
cache-control: no-store
etag: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"
content-type: application/json; charset=utf-8
content-length: 12
Date: Mon, 05 Oct 2026 01:42:23 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[]}

HTTP/1.1 200 OK
x-request-id: 01a109b9-f26f-7e40-9063-700663679c1b
cache-control: no-store
etag: "66a62a8dcf68d9df0b7e058b8cd86c42a83d9452d2fabf3f17091b29552fecf4"
content-type: application/json; charset=utf-8
content-length: 201
Date: Mon, 05 Oct 2026 01:42:23 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a109b9-c2f2-795b-9df3-36c34e89980e","name":"support","description":null,"parent_id":null,"default_for_new_subjects":false,"path":"/support","created_at":"2026-10-05T01:42:11.441Z"}]}

HTTP/1.1 412 Precondition Failed
x-request-id: 01a109b9-f288-78e9-ade7-7dfb8ef68ccd
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 153
Date: Mon, 05 Oct 2026 01:42:23 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a109b9-f288-78e9-ade7-7dfb8ef68ccd"}
```

Both writes that reached the ceiling are in the trail, scoped here to
`mei2` — the refusal naming what was denied, the replacement the ids
before and after:

On the same stack and tenant:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3082/admin/tenants/groups-demo/audit?action=subject.groups_set&resource_type=subject&resource_id=01a109b9-c34e-7692-b5a4-67af33cf85e0'; echo
```

```
{"items":[{"id":"01a109b9-f27e-7d11-a166-1263b8d4466f","occurred_at":"2026-10-05T01:42:23.608Z","event_type":"admin_mutation","action":"subject.groups_set","outcome":"allowed","actor_tenant_id":"01a109b9-c288-7ef5-a623-21ab2f266513","actor_subject_id":"01a109b9-c365-7216-9064-207c3931f9e0","actor_client_id":"01a109b9-c28f-78c9-bac7-b8be0801cfd6","actor_name":"helpdesk","actor_origin":"tenant","resource_type":"subject","resource_id":"01a109b9-c34e-7692-b5a4-67af33cf85e0","request_id":"01a109b9-f26f-7e40-9063-700663679c1b","ip":"172.22.0.1","detail":{"group_ids":{"after":["01a109b9-c2f2-795b-9df3-36c34e89980e"],"before":[]}}},{"id":"01a109b9-f252-7573-967d-079323ae2a71","occurred_at":"2026-10-05T01:42:23.565Z","event_type":"admin_mutation","action":"subject.groups_set","outcome":"refused","actor_tenant_id":"01a109b9-c288-7ef5-a623-21ab2f266513","actor_subject_id":"01a109b9-c365-7216-9064-207c3931f9e0","actor_client_id":"01a109b9-c28f-78c9-bac7-b8be0801cfd6","actor_name":"helpdesk","actor_origin":"tenant","resource_type":"subject","resource_id":"01a109b9-c34e-7692-b5a4-67af33cf85e0","request_id":"01a109b9-f243-73fa-8f46-668be780b58a","ip":"172.22.0.1","detail":{"denied":["tenant-admin","manage-clients","manage-tenant","manage-keys","manage-sessions","view-audit"]}}]}
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
revoke, and is left alone; `DELETE /subjects/:id/grants/:clientId` is what
reaches it, and `DELETE /subjects/:id/consents/:clientId` too where a consent
was recorded.

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

## `GET /subjects/:id/grants` and `DELETE /subjects/:id/grants/:clientId`

Requires `manage-sessions`: a grant is what a token is presented under, so it
is a session's concern, and ending one is the same capability's. `GET` lists
every grant the subject holds that nothing has revoked, cursored by id, each
with the client it was issued through, its scope, the session bounding it and
`offline` — true for an `offline_access` grant, which no session bounds and
ending sessions leaves alone — and `refresh_expires_at`, when its newest
unspent refresh token lapses. Never a token. `DELETE` revokes every grant the
subject holds through the client (`:clientId` is the client's row id), offline
ones included, with the write revoking a consent makes
(`revokeForSubjectClient`), but without withdrawing the consent, and answers
how many; it ends no session. It is held to the target ceiling, and writes
`grant.revoke`. An unknown subject answers `404`.

Against the tenth stack, `grace`'s two grants through `ops-app`, the offline
one's refresh token (`$GRACE_OFFLINE_REFRESH_TOKEN`) presented after the
revocation, and what is left:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/subjects/01a0ee8a-c58a-716c-96a6-edcab4ca1a70/grants"; echo
curl -sS -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/subjects/01a0ee8a-c58a-716c-96a6-edcab4ca1a70/grants/01a0ee8a-d1a7-7c3c-a05b-903a2d8fa123"; echo
curl -sS -u "ops-app:$OPS_APP_SECRET" --data-urlencode grant_type=refresh_token \
  --data-urlencode "refresh_token=$GRACE_OFFLINE_REFRESH_TOKEN" \
  http://localhost:3082/tenants/ops-demo/protocol/openid-connect/token; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/subjects/01a0ee8a-c58a-716c-96a6-edcab4ca1a70/grants"; echo
```

```
{"items":[{"id":"01a0ee8b-2736-7d56-a78d-5d0c22330e0b","client_id":"01a0ee8a-d1a7-7c3c-a05b-903a2d8fa123","client_key":"ops-app","scope":"openid profile email offline_access","created_at":"2026-09-29T19:01:32.013Z","session_id":null,"offline":true,"refresh_expires_at":"2026-10-13T19:01:32.073Z"},{"id":"01a0ee8b-2871-7378-912a-5d2f335a483d","client_id":"01a0ee8a-d1a7-7c3c-a05b-903a2d8fa123","client_key":"ops-app","scope":"openid profile email","created_at":"2026-09-29T19:01:32.338Z","session_id":"01a0ee8b-27fa-7271-bb21-8bf1dec2d0fa","offline":false,"refresh_expires_at":"2026-10-13T19:01:32.391Z"}]}
{"revoked":2}
{"error":"invalid_grant"}
{"items":[]}
```

## `GET /sessions`, `GET /sessions/count` and `GET /clients/:id/sessions`

Requires `manage-sessions`. Every live session in the tenant, whoever holds
it, in id order and cursored, each naming its subject and that subject's
username. Liveness is the same arithmetic every other session read uses,
written as a predicate so a page is one query (`liveSessionCondition`,
`@odudu/authn-flows`). `?client=` narrows the listing, and the count, to the
sessions holding a grant through that client, by its row id;
`GET /clients/:id/sessions` is the same narrowing, answering `404` for a client
that does not exist. The count is capped like every other.

Against the tenth stack, with the three sessions its sign-ins left:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/sessions/count"; echo
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" "$P/sessions?limit=2"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/clients/01a0ee8a-d1a7-7c3c-a05b-903a2d8fa123/sessions"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/sessions/count?client=01a0ee8a-d1a7-7c3c-a05b-903a2d8fa123"; echo
```

```
{"count":3,"capped":false}
HTTP/1.1 200 OK
x-request-id: 01a0ee8b-343a-7279-ad8e-e45c5b139fc1
cache-control: no-store
link: </admin/tenants/ops-demo/sessions?limit=2&cursor=eyJhZnRlciI6IjAxYTBlZThiLTI3ZmEtNzI3MS1iYjIxLThiZjFkZWMyZDBmYSIsImNvbGxlY3Rpb24iOiJ0ZW5hbnQtc2Vzc2lvbnMiLCJ0ZW5hbnRJZCI6IjAxYTBlZThhLWMzOTQtN2I0OS05NDJiLTNkZWE3MGE5NjJlNyIsImZpbHRlcnMiOiJUMVBOb1l3cnFnd0RWTHRmbWo3TDVlMFNxMDJPRWJxSFBDOFJGaElDdVVVIn0.TWjgj_zCkTnLF8x2j2neR72PFkSthAD4leDxqPxE6Wk>; rel="next"
content-type: application/json; charset=utf-8
content-length: 793
Date: Tue, 29 Sep 2026 19:01:35 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a0ee8b-26ae-74b4-8598-c6ca2545c92f","subject_id":"01a0ee8a-c58a-716c-96a6-edcab4ca1a70","username":"grace","created_at":"2026-09-29T19:01:31.945Z","last_active_at":"2026-09-29T19:01:31.945Z","remembered":false,"client_ids":[]},{"id":"01a0ee8b-27fa-7271-bb21-8bf1dec2d0fa","subject_id":"01a0ee8a-c58a-716c-96a6-edcab4ca1a70","username":"grace","created_at":"2026-09-29T19:01:32.281Z","last_active_at":"2026-09-29T19:01:32.281Z","remembered":false,"client_ids":["ops-app"]}],"next":"eyJhZnRlciI6IjAxYTBlZThiLTI3ZmEtNzI3MS1iYjIxLThiZjFkZWMyZDBmYSIsImNvbGxlY3Rpb24iOiJ0ZW5hbnQtc2Vzc2lvbnMiLCJ0ZW5hbnRJZCI6IjAxYTBlZThhLWMzOTQtN2I0OS05NDJiLTNkZWE3MGE5NjJlNyIsImZpbHRlcnMiOiJUMVBOb1l3cnFnd0RWTHRmbWo3TDVlMFNxMDJPRWJxSFBDOFJGaElDdVVVIn0.TWjgj_zCkTnLF8x2j2neR72PFkSthAD4leDxqPxE6Wk"}
{"items":[{"id":"01a0ee8b-27fa-7271-bb21-8bf1dec2d0fa","subject_id":"01a0ee8a-c58a-716c-96a6-edcab4ca1a70","username":"grace","created_at":"2026-09-29T19:01:32.281Z","last_active_at":"2026-09-29T19:01:32.281Z","remembered":false,"client_ids":["ops-app"]},{"id":"01a0ee8b-28f4-79df-bbe5-95698666977b","subject_id":"01a0ee8a-c748-743d-b60e-9b0ed48221a3","username":"linus","created_at":"2026-09-29T19:01:32.530Z","last_active_at":"2026-09-29T19:01:32.530Z","remembered":false,"client_ids":["ops-app"]}]}
{"count":2,"capped":false}
```

The first of `grace`'s sessions names no client: that sign-in asked for
`offline_access`, and its grant is bound to no session, so neither `client_ids`
nor `?client=` finds it there.

## `DELETE /sessions`

Requires `manage-sessions`. Ends every live session in the tenant, each through
the same `endSession` that `DELETE /subjects/:id/sessions/:sid` calls — its
grants revoked, a Back-Channel Logout Token queued for each client that used it,
and its own `session.ended` row. A session whose subject holds an admin
capability the caller does not is left alone and counted under
`beyond_ceiling`: the target ceiling, run over the tenant as a set (ADR 0040,
whose consequence is that `manage-sessions` alone ends no administrator's
session; ADR 0040's amendment of 2026-09-30). One call ends at most 500
sessions, in id order, and answers how many are still live beyond those
under `remaining`, so a tenant with more is ended by calling again until
`remaining` is `0` — each call a transaction short enough not to hold the
tenant's sessions locked for the length of a large one. One
`session.end_all` row, filed on the tenant, carries all three counts. The
caller's own session ends with the rest when it is one of them.

Against the tenth stack, after `sam`, granted `odudu-admin:manage-sessions`
alone, signed in to the tenant's own admin client (`$SAM_TOKEN`), and `mona`
signed in through `ops-app`:

```bash
curl -sS -H "Authorization: Bearer $SAM_TOKEN" "$P/whoami"; echo
curl -sS -H "Authorization: Bearer $SAM_TOKEN" "$P/sessions"; echo
curl -sS -X DELETE -H "Authorization: Bearer $SAM_TOKEN" "$P/sessions"; echo
curl -sS -H "Authorization: Bearer $SAM_TOKEN" "$P/sessions"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/sessions"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/audit?action=session.end_all&limit=1"; echo
```

```
{"subjectId":"01a0ee8a-ca97-7a85-b36d-e23f6a8ae2d3","issuerTenantId":"01a0ee8a-c394-7b49-942b-3dea70a962e7","capabilities":["manage-sessions"],"crossTenant":false}
{"items":[{"id":"01a0ee8b-26ae-74b4-8598-c6ca2545c92f","subject_id":"01a0ee8a-c58a-716c-96a6-edcab4ca1a70","username":"grace","created_at":"2026-09-29T19:01:31.945Z","last_active_at":"2026-09-29T19:01:31.945Z","remembered":false,"client_ids":[]},{"id":"01a0ee8b-27fa-7271-bb21-8bf1dec2d0fa","subject_id":"01a0ee8a-c58a-716c-96a6-edcab4ca1a70","username":"grace","created_at":"2026-09-29T19:01:32.281Z","last_active_at":"2026-09-29T19:01:32.281Z","remembered":false,"client_ids":["ops-app"]},{"id":"01a0ee8b-28f4-79df-bbe5-95698666977b","subject_id":"01a0ee8a-c748-743d-b60e-9b0ed48221a3","username":"linus","created_at":"2026-09-29T19:01:32.530Z","last_active_at":"2026-09-29T19:01:32.530Z","remembered":false,"client_ids":["ops-app"]},{"id":"01a0ee8c-520e-7010-b273-0d3799401aea","subject_id":"01a0ee8a-c8f6-7450-b486-861a66a87684","username":"mona","created_at":"2026-09-29T19:02:48.588Z","last_active_at":"2026-09-29T19:02:48.588Z","remembered":false,"client_ids":["ops-app"]},{"id":"01a0ee8c-5369-74cc-9b41-6304c2990dbb","subject_id":"01a0ee8a-ca97-7a85-b36d-e23f6a8ae2d3","username":"sam","created_at":"2026-09-29T19:02:48.935Z","last_active_at":"2026-09-29T19:02:48.935Z","remembered":false,"client_ids":["odudu-admin"]}]}
{"ended":4,"remaining":0,"beyond_ceiling":1}
{"type":"about:blank","title":"Unauthorized","status":401,"instance":"01a0ee8c-5559-7b23-ac77-3108e2291fa2"}
{"items":[{"id":"01a0ee8c-520e-7010-b273-0d3799401aea","subject_id":"01a0ee8a-c8f6-7450-b486-861a66a87684","username":"mona","created_at":"2026-09-29T19:02:48.588Z","last_active_at":"2026-09-29T19:02:48.588Z","remembered":false,"client_ids":["ops-app"]}]}
{"items":[{"id":"01a0ee8c-5548-7fd9-8179-8d3d1320b981","occurred_at":"2026-09-29T19:02:49.371Z","event_type":"admin_mutation","action":"session.end_all","outcome":"allowed","actor_tenant_id":"01a0ee8a-c394-7b49-942b-3dea70a962e7","actor_subject_id":"01a0ee8a-ca97-7a85-b36d-e23f6a8ae2d3","actor_client_id":"01a0ee8a-c3a0-7429-ab4a-4ecef6baf694","actor_name":"sam","actor_origin":"tenant","resource_type":"tenant","resource_id":"01a0ee8a-c394-7b49-942b-3dea70a962e7","request_id":"01a0ee8c-550b-776a-8847-5fcfd763a5d1","ip":"172.22.0.1","detail":{"ended":4,"remaining":0,"beyond_ceiling":1}}]}
```

`sam`'s own session was one of the four, so his token is refused at once;
`mona`'s, beyond what `sam` holds, is the one left.

## `GET /roles`, `POST /roles`, `GET /roles/:id`, `PATCH /roles/:id` and `DELETE /roles/:id`

All five require `manage-tenant`; the list, `GET /roles`, is also
readable with `view-users` (below). A role is either a tenant role
(`client_id` is `null`) or scoped to one client, in which case a token's
`roles` claim carries it qualified by that client's own name rather than
plain — `packages/domain-authz/src/service/role-name.ts` has the format.
`PATCH` amends only `description` — at most 1000 characters, a CHECK
holds it there, and `null` clears it; every other field, `name`,
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

A create, captured against the sixth stack in its `showcase` tenant:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "billing-viewer", "description": "read-only access to invoices"}' \
  http://localhost:3080/admin/tenants/showcase/roles
```

```
{"id":"01a0ea58-d3a7-7fdf-a80d-4ff81ec35f77","name":"billing-viewer","description":"read-only access to invoices","client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-09-28T23:28:05.031Z"}
```

**Search and filters** follow `GET /subjects`: `?name=` is a prefix,
matched case-insensitively as a range over the stored `name_search` column
(`0075_list_indexes_roles_groups_scopes.sql`), and a searched listing is
ordered by that folded name, then by `id`. **`?client=`** is the one exact
filter, `AND`ed with it: `tenant` for the tenant roles alone, or a client's
id for the roles scoped to that client. A cursor is bound to every filter
it was minted under, and any other parameter is refused with `400` naming
it. Captured against the sixth stack, in a tenant `roles-demo` created
there for it, which held no roles of its own until these four were
created, the last scoped to a public client `demo-spa`
(`01a0ea58-d406-7a01-ae44-d5c21cc4c322`) created there too:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "billing-viewer"}' \
  http://localhost:3080/admin/tenants/roles-demo/roles
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Billing-Admin"}' \
  http://localhost:3080/admin/tenants/roles-demo/roles
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "support"}' \
  http://localhost:3080/admin/tenants/roles-demo/roles
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "billing-spa", "client_id": "01a0ea58-d406-7a01-ae44-d5c21cc4c322"}' \
  http://localhost:3080/admin/tenants/roles-demo/roles
```

```
{"id":"01a0ea58-d421-7321-afe5-9d7a30ba1782","name":"billing-viewer","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-09-28T23:28:05.153Z"}
{"id":"01a0ea58-d435-741e-bf5c-86256147d3ed","name":"Billing-Admin","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-09-28T23:28:05.173Z"}
{"id":"01a0ea58-d448-7a6e-b7e7-585fcc1904f3","name":"support","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-09-28T23:28:05.192Z"}
{"id":"01a0ea58-d45b-7c55-b5f0-e17efcae3798","name":"billing-spa","description":null,"client_id":"01a0ea58-d406-7a01-ae44-d5c21cc4c322","client_key":"demo-spa","default_for_new_subjects":false,"created_at":"2026-09-28T23:28:05.210Z"}
```

`BILLING` finds all three `billing` roles in folded order, tenant and
client alike; `?client=tenant` keeps the two tenant roles, and the client's
id keeps its one:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/roles-demo/roles?name=BILLING"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/roles-demo/roles?name=billing&client=tenant"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/roles-demo/roles?client=01a0ea58-d406-7a01-ae44-d5c21cc4c322"
```

```
{"items":[{"id":"01a0ea58-d435-741e-bf5c-86256147d3ed","name":"Billing-Admin","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-09-28T23:28:05.173Z"},{"id":"01a0ea58-d45b-7c55-b5f0-e17efcae3798","name":"billing-spa","description":null,"client_id":"01a0ea58-d406-7a01-ae44-d5c21cc4c322","client_key":"demo-spa","default_for_new_subjects":false,"created_at":"2026-09-28T23:28:05.210Z"},{"id":"01a0ea58-d421-7321-afe5-9d7a30ba1782","name":"billing-viewer","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-09-28T23:28:05.153Z"}]}
{"items":[{"id":"01a0ea58-d435-741e-bf5c-86256147d3ed","name":"Billing-Admin","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-09-28T23:28:05.173Z"},{"id":"01a0ea58-d421-7321-afe5-9d7a30ba1782","name":"billing-viewer","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-09-28T23:28:05.153Z"}]}
{"items":[{"id":"01a0ea58-d45b-7c55-b5f0-e17efcae3798","name":"billing-spa","description":null,"client_id":"01a0ea58-d406-7a01-ae44-d5c21cc4c322","client_key":"demo-spa","default_for_new_subjects":false,"created_at":"2026-09-28T23:28:05.210Z"}]}
```

One at a time, the `Link` header carries the search forward:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/roles-demo/roles?name=billing&limit=1"
```

```
HTTP/1.1 200 OK
x-request-id: 01a0ea58-d4a4-705d-ac59-ccdbeecbba7d
cache-control: no-store
link: </admin/tenants/roles-demo/roles?limit=1&name=billing&cursor=eyJhZnRlciI6IjAxYTBlYTU4LWQ0MzUtNzQxZS1iZjVjLTg2MjU2MTQ3ZDNlZCIsInNvcnQiOiJiaWxsaW5nLWFkbWluIiwiY29sbGVjdGlvbiI6InJvbGVzIiwidGVuYW50SWQiOiIwMWEwZWE1OC1kM2JiLTcxMjYtYTUxNC1kYTljZDZmN2QxMzMiLCJmaWx0ZXJzIjoiM0w4aEJkRGMyWVZnelVseHhtSlVYZGluWHJDMG10NHZMTXF1TlNTdEdOdyJ9.vqL1q3wdEfgZM9ieC07LiickD_1XP4pHvMiYd9_e-Zs>; rel="next"
content-type: application/json; charset=utf-8
content-length: 525
Date: Mon, 28 Sep 2026 23:28:05 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a0ea58-d435-741e-bf5c-86256147d3ed","name":"Billing-Admin","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-09-28T23:28:05.173Z"}],"next":"eyJhZnRlciI6IjAxYTBlYTU4LWQ0MzUtNzQxZS1iZjVjLTg2MjU2MTQ3ZDNlZCIsInNvcnQiOiJiaWxsaW5nLWFkbWluIiwiY29sbGVjdGlvbiI6InJvbGVzIiwidGVuYW50SWQiOiIwMWEwZWE1OC1kM2JiLTcxMjYtYTUxNC1kYTljZDZmN2QxMzMiLCJmaWx0ZXJzIjoiM0w4aEJkRGMyWVZnelVseHhtSlVYZGluWHJDMG10NHZMTXF1TlNTdEdOdyJ9.vqL1q3wdEfgZM9ieC07LiickD_1XP4pHvMiYd9_e-Zs"}
```

Following that link, then replaying its cursor with `?client=tenant` added:

```bash
CURSOR='eyJhZnRlciI6IjAxYTBlYTU4LWQ0MzUtNzQxZS1iZjVjLTg2MjU2MTQ3ZDNlZCIsInNvcnQiOiJiaWxsaW5nLWFkbWluIiwiY29sbGVjdGlvbiI6InJvbGVzIiwidGVuYW50SWQiOiIwMWEwZWE1OC1kM2JiLTcxMjYtYTUxNC1kYTljZDZmN2QxMzMiLCJmaWx0ZXJzIjoiM0w4aEJkRGMyWVZnelVseHhtSlVYZGluWHJDMG10NHZMTXF1TlNTdEdOdyJ9.vqL1q3wdEfgZM9ieC07LiickD_1XP4pHvMiYd9_e-Zs'
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/roles-demo/roles?limit=1&name=billing&cursor=$CURSOR"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/roles-demo/roles?limit=1&name=billing&client=tenant&cursor=$CURSOR"
```

```
{"items":[{"id":"01a0ea58-d45b-7c55-b5f0-e17efcae3798","name":"billing-spa","description":null,"client_id":"01a0ea58-d406-7a01-ae44-d5c21cc4c322","client_key":"demo-spa","default_for_new_subjects":false,"created_at":"2026-09-28T23:28:05.210Z"}],"next":"eyJhZnRlciI6IjAxYTBlYTU4LWQ0NWItN2M1NS1iNWYwLWUxN2VmY2FlMzc5OCIsInNvcnQiOiJiaWxsaW5nLXNwYSIsImNvbGxlY3Rpb24iOiJyb2xlcyIsInRlbmFudElkIjoiMDFhMGVhNTgtZDNiYi03MTI2LWE1MTQtZGE5Y2Q2ZjdkMTMzIiwiZmlsdGVycyI6IjNMOGhCZERjMllWZ3pVbHh4bUpVWGRpblhyQzBtdDR2TE1xdU5TU3RHTncifQ.nhc5AAVGM1CqXWTdxSwvW_4I6BXqLcJpr148nf35_AE"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"cursor is invalid or expired","errors":[{"path":"cursor","message":"is invalid or expired"}],"instance":"01a0ea58-d4ce-7b81-a7eb-d179705723d2"}
```

A `client` that is neither `tenant` nor an id, an unknown parameter, and
the stored `name_search` column named in a create body and in an amendment
— the first three refused by the generated schema, the last by the
amendment allowlist, which knows only the fields a role's wire shape
carries:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/roles-demo/roles?client=spa"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/roles-demo/roles?search=billing"
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "auditor", "name_search": "x"}' \
  http://localhost:3080/admin/tenants/roles-demo/roles
curl -sS -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name_search": "x"}' \
  http://localhost:3080/admin/tenants/roles-demo/roles/01a0ea58-d448-7a6e-b7e7-585fcc1904f3
```

```
{"type":"about:blank","title":"Error","status":400,"detail":"querystring/client must be equal to constant, querystring/client must match pattern \"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$\", querystring/client must match a schema in anyOf","errors":[{"path":"client","message":"must be equal to constant"},{"path":"client","message":"must match pattern \"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$\""},{"path":"client","message":"must match a schema in anyOf"}],"instance":"01a0ea58-d4e5-7f4b-8797-0c8695b5c60f"}
{"type":"about:blank","title":"Error","status":400,"detail":"querystring must NOT have additional properties: search","errors":[{"path":"search","message":"must NOT have additional properties"}],"instance":"01a0ea58-d4ee-77ce-9808-436afc8c914d"}
{"type":"about:blank","title":"Error","status":400,"detail":"body must NOT have additional properties: name_search","errors":[{"path":"name_search","message":"must NOT have additional properties"}],"instance":"01a0ea58-d4f8-7751-9c25-58f9d56e0333"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"name_search: name_search is not a role field","errors":[{"path":"name_search","message":"name_search is not a role field"}],"instance":"01a0ea58-d502-7dbb-9d1c-16d18b208caa"}
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

### The owning client, by name

A role names its owning client twice: `client_id`, the client's row id,
and `client_key`, that client's own `client_id` — the name a person tells
it apart by, since a tenant role and a client's may share a name. Both are
`null` for a tenant role. The same pair rides on every role list: a role's
composites, and the `items` a subject's, a group's and a scope's roles
answer beside `id` and `name`. `client_key` is refused
by `PATCH` like `client_id`. Captured against the fifth stack in
`etags-demo`: a role `reader` created on the public client `etags-app`, the
tenant's roles filtered to that client, and a subject `ines` given `reader`
and the tenant role `billing-viewer` under the `ETag` of her empty list:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"name":"reader","client_id":"01a0e9ec-d64a-7d5d-a0ac-a01efd56b6f3"}' \
  http://localhost:3080/admin/tenants/etags-demo/roles
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3080/admin/tenants/etags-demo/roles?client=01a0e9ec-d64a-7d5d-a0ac-a01efd56b6f3'
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -H 'If-Match: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"' \
  -d '{"role_ids":["01a0ea27-1cdb-7d21-8f0c-d7baaca12b15","01a0e9ec-6384-76f7-b433-4876e51cbff1"]}' \
  http://localhost:3080/admin/tenants/etags-demo/subjects/01a0ea27-1d13-7293-a266-8d37c0064e7d/roles
```

```
{"id":"01a0ea27-1cdb-7d21-8f0c-d7baaca12b15","name":"reader","description":null,"client_id":"01a0e9ec-d64a-7d5d-a0ac-a01efd56b6f3","client_key":"etags-app","default_for_new_subjects":false,"created_at":"2026-09-28T22:33:46.970Z"}
{"items":[{"id":"01a0ea27-1cdb-7d21-8f0c-d7baaca12b15","name":"reader","description":null,"client_id":"01a0e9ec-d64a-7d5d-a0ac-a01efd56b6f3","client_key":"etags-app","default_for_new_subjects":false,"created_at":"2026-09-28T22:33:46.970Z"}]}
{"items":[{"id":"01a0e9ec-6384-76f7-b433-4876e51cbff1","name":"billing-viewer","client_id":null,"client_key":null},{"id":"01a0ea27-1cdb-7d21-8f0c-d7baaca12b15","name":"reader","client_id":"01a0e9ec-d64a-7d5d-a0ac-a01efd56b6f3","client_key":"etags-app"}]}
```

### The list a user manager picks from

`GET /roles` alone is also readable with `view-users`, and so with
`manage-users`, which composes it: a user manager assigns roles to a
subject and needs the list to pick from. `GET /groups` is widened the same
way. Nothing else under either path is — a role's own read, its
composites and both counts still require `manage-tenant` — and what a user
manager may assign is still held to its own capabilities by the ceiling
(ADR 0040). A caller refused one of these lists gets the usual `403`, and
its `capability.refused` row names `view-users` under `detail.also_admits`
beside the `manage-tenant` it names as `capability`, since either would
have admitted it. Captured against the sixth stack in a tenant `admins-demo` created there
for it, as `hana`, a subject created there holding `view-users` alone and
signed in through the tenant's own admin client, first `whoami`, then two
lists and a count:

```bash
curl -sS -H "Authorization: Bearer $HANA_TOKEN" http://localhost:3080/admin/tenants/admins-demo/whoami
curl -sS -H "Authorization: Bearer $HANA_TOKEN" 'http://localhost:3080/admin/tenants/admins-demo/roles?name=manage&limit=2'
curl -sS -H "Authorization: Bearer $HANA_TOKEN" http://localhost:3080/admin/tenants/admins-demo/groups
curl -sS -H "Authorization: Bearer $HANA_TOKEN" http://localhost:3080/admin/tenants/admins-demo/roles/count
```

```
{"subjectId":"01a0ea59-5d33-7a1b-bce7-24b2c98cd01a","issuerTenantId":"01a0ea59-5cd2-7d04-a47c-25e735e7b213","capabilities":["view-users"],"crossTenant":false}
{"items":[{"id":"01a0ea59-5ce4-7529-83fa-4fa19f286315","name":"manage-clients","description":null,"client_id":"01a0ea59-5cdb-7604-a205-088e108e7bc7","client_key":"odudu-admin","default_for_new_subjects":false,"created_at":"2026-09-28T23:28:40.146Z"},{"id":"01a0ea59-5ce7-7289-a7bf-c6a5dc5d08ea","name":"manage-keys","description":null,"client_id":"01a0ea59-5cdb-7604-a205-088e108e7bc7","client_key":"odudu-admin","default_for_new_subjects":false,"created_at":"2026-09-28T23:28:40.146Z"}],"next":"eyJhZnRlciI6IjAxYTBlYTU5LTVjZTctNzI4OS1hN2JmLWM2YTVkYzVkMDhlYSIsInNvcnQiOiJtYW5hZ2Uta2V5cyIsImNvbGxlY3Rpb24iOiJyb2xlcyIsInRlbmFudElkIjoiMDFhMGVhNTktNWNkMi03ZDA0LWE0N2MtMjVlNzM1ZTdiMjEzIiwiZmlsdGVycyI6IlJmN1o1Njk1VkFrc05UeHBDNUhuYnZuN1dYME5hV0d0MGdmVk9OblNpTmcifQ.Xwvy2zgnUWKd8-sdfe15i06YKp5_6Jqwszwzt__kdiM"}
{"items":[]}
{"type":"about:blank","title":"Forbidden","status":403,"instance":"01a0ea59-ad56-772d-9206-e80a8ad75f02"}
```

Then `kai`, created there the same way holding `manage-clients` alone,
refused the list, and the row that refusal wrote:

Recaptured against the tenth stack, once each row answered `actor_name` and
`actor_origin`, with a `kai` seeded in a tenant of the same name holding
`manage-clients` alone, so the ids are that run's, not those above:

```bash
curl -sS -H "Authorization: Bearer $KAI_TOKEN" http://localhost:3082/admin/tenants/admins-demo/roles; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3082/admin/tenants/admins-demo/audit?action=capability.refused&limit=1'; echo
```

```
{"type":"about:blank","title":"Forbidden","status":403,"instance":"01a0ee91-6bf2-708d-839a-f58481e120e8"}
{"items":[{"id":"01a0ee91-6c24-7df3-aff4-f3b3cb39e5c3","occurred_at":"2026-09-29T19:08:22.941Z","event_type":"admin_access","action":"capability.refused","outcome":"refused","actor_tenant_id":"01a0ee91-5500-7587-bec8-ccd5ea0cfb56","actor_subject_id":"01a0ee91-621f-7416-9ebf-80d7244ddda7","actor_client_id":"01a0ee91-551f-76e0-b7f0-ff2a01e786b4","actor_name":"kai","actor_origin":"tenant","resource_type":null,"resource_id":null,"request_id":"01a0ee91-6bf2-708d-839a-f58481e120e8","ip":"172.22.0.1","detail":{"reason":"missing_capability","capability":"manage-tenant","also_admits":["view-users"]}}]}
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
curl -sS -D - -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"child_role_id": "01a0ea58-0e45-76eb-be5f-bd76e03e4b6e"}' \
  http://localhost:3080/admin/tenants/demo/roles/01a0ea62-7fb3-79e7-b158-93f29fa138ec/composites
```

`billing-viewer` nested under a second role, `billing-admin`, then the
reverse nesting attempted on the pair that now exists. Captured against
the sixth stack's `demo`; the `etag` is the one `GET …/composites` answers
for `billing-admin` afterwards:

```
HTTP/1.1 204 No Content
x-request-id: 01a0ea62-7fc0-7231-a08d-857d656c231a
cache-control: no-store
etag: "1ba3f58b74c652dfe778fc6ad685931d85d42696312ad3fa17e1b8d5c3e1b393"
Date: Mon, 28 Sep 2026 23:38:38 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"would create a role composite cycle","instance":"01a0ea62-7fdd-7315-8c7b-657bb3fb2b79"}
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
and read from the same `builtin_admin` column. `POST /roles/:id/composites`
refuses to add one there in the first place, so a capability role holds
exactly the edges provisioning gave it.
An edge between ordinary roles is removed whatever it nests, unless what
the child reaches includes an admin capability the caller does not hold
([a removal is judged by what it removes](#a-removal-is-judged-by-what-it-removes)).

Captured against the sixth stack in `composites-demo`, created through
`POST /admin/tenants` for it. `billing-admin` nests `billing-viewer` and
`invoice-editor`, each nested there through `POST /roles/:id/composites`:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3080/admin/tenants/composites-demo/roles/01a0ea5a-6e28-777a-b4f5-82d7512a7293/composites
```

```
{"items":[{"id":"01a0ea5a-6e3f-7002-a46e-54c9d5196212","name":"billing-viewer","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-09-28T23:29:50.143Z"},{"id":"01a0ea5a-6e54-7a44-a792-1e835b730a0e","name":"invoice-editor","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-09-28T23:29:50.164Z"}]}
```

`invoice-editor` removed, the same removal repeated, then the read again:

```bash
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3080/admin/tenants/composites-demo/roles/01a0ea5a-6e28-777a-b4f5-82d7512a7293/composites/01a0ea5a-6e54-7a44-a792-1e835b730a0e
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3080/admin/tenants/composites-demo/roles/01a0ea5a-6e28-777a-b4f5-82d7512a7293/composites/01a0ea5a-6e54-7a44-a792-1e835b730a0e
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3080/admin/tenants/composites-demo/roles/01a0ea5a-6e28-777a-b4f5-82d7512a7293/composites
```

```
HTTP/1.1 204 No Content
x-request-id: 01a0ea5a-6ed8-7b76-bfdb-b055727a4621
cache-control: no-store
etag: "129cc9286852a3ca1c341782b23088a247ee02ee791b267c9c2516abe6f1c956"
Date: Mon, 28 Sep 2026 23:29:50 GMT
Connection: keep-alive
Keep-Alive: timeout=72

HTTP/1.1 404 Not Found
x-request-id: 01a0ea5a-6ef1-70c5-8875-10bc6b304fdc
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 214
Date: Mon, 28 Sep 2026 23:29:50 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Not Found","status":404,"detail":"no composite 01a0ea5a-6e54-7a44-a792-1e835b730a0e under role 01a0ea5a-6e28-777a-b4f5-82d7512a7293","instance":"01a0ea5a-6ef1-70c5-8875-10bc6b304fdc"}
{"items":[{"id":"01a0ea5a-6e3f-7002-a46e-54c9d5196212","name":"billing-viewer","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-09-28T23:29:50.143Z"}]}
```

The guard. `tenant-admin` does nest `manage-users` — so a refusal is not a
`404` for a missing edge — and every child's `client_id` is the tenant's
built-in admin client, `odudu-admin` by its `client_key`; removing that
edge, as `ada`, who holds `tenant-admin` itself:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3080/admin/tenants/composites-demo/roles/01a0ea5a-6dfb-7573-9ff4-b065d090b94e/composites
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3080/admin/tenants/composites-demo/roles/01a0ea5a-6dfb-7573-9ff4-b065d090b94e/composites/01a0ea5a-6dfe-7770-8d9f-c403dd3516c9
```

```
{"items":[{"id":"01a0ea5a-6dff-7fc2-96a2-e7b54304342e","name":"manage-clients","description":null,"client_id":"01a0ea5a-6df3-7bfa-836b-27a177c6a1eb","client_key":"odudu-admin","default_for_new_subjects":false,"created_at":"2026-09-28T23:29:50.058Z"},{"id":"01a0ea5a-6e01-7af0-8021-52b76e39eb39","name":"manage-keys","description":null,"client_id":"01a0ea5a-6df3-7bfa-836b-27a177c6a1eb","client_key":"odudu-admin","default_for_new_subjects":false,"created_at":"2026-09-28T23:29:50.058Z"},{"id":"01a0ea5a-6e02-710f-ae5d-e14769b93a92","name":"manage-sessions","description":null,"client_id":"01a0ea5a-6df3-7bfa-836b-27a177c6a1eb","client_key":"odudu-admin","default_for_new_subjects":false,"created_at":"2026-09-28T23:29:50.058Z"},{"id":"01a0ea5a-6e00-71f9-b002-511a57dc59f3","name":"manage-tenant","description":null,"client_id":"01a0ea5a-6df3-7bfa-836b-27a177c6a1eb","client_key":"odudu-admin","default_for_new_subjects":false,"created_at":"2026-09-28T23:29:50.058Z"},{"id":"01a0ea5a-6dfe-7770-8d9f-c403dd3516c9","name":"manage-users","description":null,"client_id":"01a0ea5a-6df3-7bfa-836b-27a177c6a1eb","client_key":"odudu-admin","default_for_new_subjects":false,"created_at":"2026-09-28T23:29:50.058Z"},{"id":"01a0ea5a-6e04-7458-8cfe-07b8efa16913","name":"view-audit","description":null,"client_id":"01a0ea5a-6df3-7bfa-836b-27a177c6a1eb","client_key":"odudu-admin","default_for_new_subjects":false,"created_at":"2026-09-28T23:29:50.058Z"},{"id":"01a0ea5a-6dfd-76d2-a044-761e38240bf1","name":"view-users","description":null,"client_id":"01a0ea5a-6df3-7bfa-836b-27a177c6a1eb","client_key":"odudu-admin","default_for_new_subjects":false,"created_at":"2026-09-28T23:29:50.058Z"}]}
HTTP/1.1 409 Conflict
x-request-id: 01a0ea5a-6f37-773b-b988-dadf32b2cf0d
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 283
Date: Mon, 28 Sep 2026 23:29:50 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"tenant-admin is a capability of odudu-admin, this tenant's built-in admin client, and removing a composite from it would strip that from every administrator holding it","instance":"01a0ea5a-6f37-773b-b988-dadf32b2cf0d"}
```

The trail holds the removal that landed; the guarded one wrote its
`refused` row on `tenant-admin`, the role it was attempted on. Scoped to
the parent role's `resource_id`, since the action alone would also match
every other role's removals in this tenant:

Recaptured against the tenth stack, once each row answered `actor_name` and
`actor_origin`, after the same three roles were nested in a tenant of the
same name and the same edge removed twice, so the ids are that run's, not
those above. The guarded removal there came after this capture, and is
outside its scope either way:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3082/admin/tenants/composites-demo/audit?action=role.composite_remove&resource_type=role&resource_id=01a0ee92-a1c5-70f4-b754-e2b9d40c22c7'; echo
```

```
{"items":[{"id":"01a0ee92-a3d6-72f5-8f9e-9b31dd3f3923","occurred_at":"2026-09-29T19:09:42.712Z","event_type":"admin_mutation","action":"role.composite_remove","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0ee8a-bfb8-763c-ac22-0c8d97b0fada","actor_client_id":"01a0ee8a-bf72-77c9-a423-f61084924d9f","actor_name":null,"actor_origin":"system","resource_type":"role","resource_id":"01a0ee92-a1c5-70f4-b754-e2b9d40c22c7","request_id":"01a0ee92-a38e-7adc-ab75-39fad347ea6c","ip":"172.22.0.1","detail":{"child_role_id":"01a0ee92-a205-756a-8ca0-a2fbca9167e0"}}]}
```

### Composites answer an `ETag`

`GET …/composites` answers an `ETag` over the list it returns, and both
composite writes answer the list's new one — `POST` beside its `204`, and
`DELETE` beside its. `If-Match` is optional on both, as it has always been:
honoured when sent, and a stale one is refused with `412` before anything
changes. Captured against the sixth stack in `etags-demo`, on its
`billing-viewer` and a second role `billing-reader`
(`01a0ea5b-0e98-7055-aa80-e2e010791e41`), starting from no composites:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3080/admin/tenants/etags-demo/roles/01a0ea4c-4996-7260-b924-f88ed7f2d974/composites
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -H 'If-Match: "0000"' -d '{"child_role_id":"01a0ea5b-0e98-7055-aa80-e2e010791e41"}' \
  http://localhost:3080/admin/tenants/etags-demo/roles/01a0ea4c-4996-7260-b924-f88ed7f2d974/composites
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -H 'If-Match: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"' \
  -d '{"child_role_id":"01a0ea5b-0e98-7055-aa80-e2e010791e41"}' \
  http://localhost:3080/admin/tenants/etags-demo/roles/01a0ea4c-4996-7260-b924-f88ed7f2d974/composites
curl -sS -D - -o /dev/null -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3080/admin/tenants/etags-demo/roles/01a0ea4c-4996-7260-b924-f88ed7f2d974/composites
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'If-Match: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"' \
  http://localhost:3080/admin/tenants/etags-demo/roles/01a0ea4c-4996-7260-b924-f88ed7f2d974/composites/01a0ea5b-0e98-7055-aa80-e2e010791e41
```

Each one's status line, `etag` header and body, in that order. The last is
the empty list's `ETag` again, which no longer matches once the edge
exists:

```
HTTP/1.1 200 OK
etag: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"
{"items":[]}
HTTP/1.1 412 Precondition Failed
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a0ea5b-0eb9-72db-9e3a-6b9166459b3c"}
HTTP/1.1 204 No Content
etag: "36230dc1673b58470bf74054983efe2a77511ad0698be114ad8c288ef1506f28"
HTTP/1.1 200 OK
etag: "36230dc1673b58470bf74054983efe2a77511ad0698be114ad8c288ef1506f28"
HTTP/1.1 412 Precondition Failed
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a0ea5b-0f09-7ab4-8fa7-fc613ca84389"}
```

## `PUT /roles/:id/default`

Requires `manage-tenant`. The body is `{"default": true}` or
`{"default": false}`, and the answer is the role with its `ETag`.
`If-Match` is optional: sent, it is compared with the role as it stands
under the write's own lock, and a stale one is refused with `412`. A role
marked default is granted to **every subject created afterwards** —
through `POST /subjects`, self-registration and `odudu seed` alike, which
all call `grantNewSubjectDefaults`
(`packages/domain-authz/src/repository/new-subject-defaults.ts`) — and to
none that already exist, nor to a subject an import moves in with the roles
its document lists; unmarking it takes it from nobody who
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

Captured against the sixth stack in `composites-demo`, with roles
`member` and `helpdesk-lead` created there for it. `member` marked default,
then a subject `rosa2` created and its roles read:

```bash
curl -sS -D - -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"default": true}' \
  http://localhost:3080/admin/tenants/composites-demo/roles/01a0ea5b-b15f-7803-aef7-fc6af8f80938/default
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username": "rosa2"}' \
  http://localhost:3080/admin/tenants/composites-demo/subjects
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3080/admin/tenants/composites-demo/subjects/01a0ea5b-b1e1-71b6-b486-66fbc3402de4/roles
```

```
HTTP/1.1 200 OK
x-request-id: 01a0ea5b-b1b7-70f4-8ceb-8e199454e7e1
cache-control: no-store
etag: "da747fbe36ef2917de0bff1862d18797c1534292d5c38eace8552cda52a65846"
content-type: application/json; charset=utf-8
content-length: 187
Date: Mon, 28 Sep 2026 23:31:12 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a0ea5b-b15f-7803-aef7-fc6af8f80938","name":"member","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":true,"created_at":"2026-09-28T23:31:12.863Z"}
{"id":"01a0ea5b-b1e1-71b6-b486-66fbc3402de4","type":"user","username":"rosa2","email":null,"enabled":true,"created_at":"2026-09-28T23:31:12.992Z"}
{"items":[{"id":"01a0ea5b-b15f-7803-aef7-fc6af8f80938","name":"member","client_id":null,"client_key":null}]}
```

Unmarked, then a second subject `sven2`, who does not get it:

```bash
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"default": false}' \
  http://localhost:3080/admin/tenants/composites-demo/roles/01a0ea5b-b15f-7803-aef7-fc6af8f80938/default
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username": "sven2"}' \
  http://localhost:3080/admin/tenants/composites-demo/subjects
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3080/admin/tenants/composites-demo/subjects/01a0ea5b-b22b-738e-a166-efc08fda74cf/roles
```

```
{"id":"01a0ea5b-b15f-7803-aef7-fc6af8f80938","name":"member","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-09-28T23:31:12.863Z"}
{"id":"01a0ea5b-b22b-738e-a166-efc08fda74cf","type":"user","username":"sven2","email":null,"enabled":true,"created_at":"2026-09-28T23:31:13.066Z"}
{"items":[]}
```

The refusal. `helpdesk-lead` is a tenant role that nests `manage-users`,
which in turn composites `view-users`; marking it default as `ada`, who
holds both and more, then reading it back:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3080/admin/tenants/composites-demo/roles/01a0ea5b-b175-7800-a7c4-d9b8a1155f7d/composites
curl -sS -D - -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"default": true}' \
  http://localhost:3080/admin/tenants/composites-demo/roles/01a0ea5b-b175-7800-a7c4-d9b8a1155f7d/default
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3080/admin/tenants/composites-demo/roles/01a0ea5b-b175-7800-a7c4-d9b8a1155f7d
```

```
{"items":[{"id":"01a0ea5a-6dfe-7770-8d9f-c403dd3516c9","name":"manage-users","description":null,"client_id":"01a0ea5a-6df3-7bfa-836b-27a177c6a1eb","client_key":"odudu-admin","default_for_new_subjects":false,"created_at":"2026-09-28T23:29:50.058Z"}]}
HTTP/1.1 403 Forbidden
x-request-id: 01a0ea5b-b26b-7882-b22f-6ea4f53ef4bb
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 233
Date: Mon, 28 Sep 2026 23:31:13 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Forbidden","status":403,"detail":"a role handed to every new subject may reach no admin capability, and this one would reach: manage-users, view-users","instance":"01a0ea5b-b26b-7882-b22f-6ea4f53ef4bb"}
{"id":"01a0ea5b-b175-7800-a7c4-d9b8a1155f7d","name":"helpdesk-lead","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-09-28T23:31:12.885Z"}
```

`PATCH` still refuses the field, and says where it is set:

```bash
curl -sS -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"default_for_new_subjects": true}' \
  http://localhost:3080/admin/tenants/composites-demo/roles/01a0ea5b-b15f-7803-aef7-fc6af8f80938
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"default_for_new_subjects: default_for_new_subjects changes who a role is silently handed to at signup; set it with PUT /admin/tenants/{tenant}/roles/{id}/default, not a general amendment","errors":[{"path":"default_for_new_subjects","message":"default_for_new_subjects changes who a role is silently handed to at signup; set it with PUT /admin/tenants/{tenant}/roles/{id}/default, not a general amendment"}],"instance":"01a0ea5b-b294-7c39-9629-fedeac7a8fee"}
```

The trail, newest first — the refusal naming what `helpdesk-lead` would
have handed out, and `member`'s two changes. Two roles are named here, so
`resource_id` alone cannot select both; bounded instead with `to=` at a
point before the composite-door demonstration below repeats
`role.default_set` against the same `member` role:

Recaptured against the tenth stack, once each row answered `actor_name` and
`actor_origin`, after `member` and `helpdesk-lead`, nesting `manage-users`,
were made in the same tenant and the same three writes sent, bounded the
same way, so the ids are that run's, not those above:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3082/admin/tenants/composites-demo/audit?action=role.default_set&to=2026-09-29T19:09:44.000Z&limit=3'; echo
```

```
{"items":[{"id":"01a0ee92-a71f-7771-9b1a-03a150ed714d","occurred_at":"2026-09-29T19:09:43.575Z","event_type":"admin_mutation","action":"role.default_set","outcome":"refused","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0ee8a-bfb8-763c-ac22-0c8d97b0fada","actor_client_id":"01a0ee8a-bf72-77c9-a423-f61084924d9f","actor_name":null,"actor_origin":"system","resource_type":"role","resource_id":"01a0ee92-a288-7ed8-9c42-53a785bcb715","request_id":"01a0ee92-a6de-79b1-953a-0c1ea870ddf4","ip":"172.22.0.1","detail":{"denied":["manage-users","view-users"]}},{"id":"01a0ee92-a6d6-75f3-a442-ac6daeb27c94","occurred_at":"2026-09-29T19:09:43.505Z","event_type":"admin_mutation","action":"role.default_set","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0ee8a-bfb8-763c-ac22-0c8d97b0fada","actor_client_id":"01a0ee8a-bf72-77c9-a423-f61084924d9f","actor_name":null,"actor_origin":"system","resource_type":"role","resource_id":"01a0ee92-a253-705a-8b4e-3ea3cb68bbf7","request_id":"01a0ee92-a6b9-7135-9a56-79d0f994e9e5","ip":"172.22.0.1","detail":{"default_for_new_subjects":{"after":false,"before":true}}},{"id":"01a0ee92-a69c-73a6-b9c0-2a21029de42c","occurred_at":"2026-09-29T19:09:43.440Z","event_type":"admin_mutation","action":"role.default_set","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0ee8a-bfb8-763c-ac22-0c8d97b0fada","actor_client_id":"01a0ee8a-bf72-77c9-a423-f61084924d9f","actor_name":null,"actor_origin":"system","resource_type":"role","resource_id":"01a0ee92-a253-705a-8b4e-3ea3cb68bbf7","request_id":"01a0ee92-a67c-7ec0-8d69-42d693e4b738","ip":"172.22.0.1","detail":{"default_for_new_subjects":{"after":true,"before":false}}}]}
```

After that trail was read, the composite door: `member` marked default
again, `view-users` nested under it refused, and `member` unmarked:

```bash
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"default": true}' \
  http://localhost:3080/admin/tenants/composites-demo/roles/01a0ea5b-b15f-7803-aef7-fc6af8f80938/default
curl -sS -D - -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"child_role_id": "01a0ea5a-6dfd-76d2-a044-761e38240bf1"}' \
  http://localhost:3080/admin/tenants/composites-demo/roles/01a0ea5b-b15f-7803-aef7-fc6af8f80938/composites
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"default": false}' \
  http://localhost:3080/admin/tenants/composites-demo/roles/01a0ea5b-b15f-7803-aef7-fc6af8f80938/default
```

```
{"id":"01a0ea5b-b15f-7803-aef7-fc6af8f80938","name":"member","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":true,"created_at":"2026-09-28T23:31:12.863Z"}
HTTP/1.1 403 Forbidden
x-request-id: 01a0ea5b-baea-7e53-b950-9905874ea2e8
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 219
Date: Mon, 28 Sep 2026 23:31:15 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Forbidden","status":403,"detail":"a role handed to every new subject may reach no admin capability, and this one would reach: view-users","instance":"01a0ea5b-baea-7e53-b950-9905874ea2e8"}
{"id":"01a0ea5b-b15f-7803-aef7-fc6af8f80938","name":"member","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-09-28T23:31:12.863Z"}
```

## `GET /groups`, `POST /groups`, `GET /groups/:id`, `PATCH /groups/:id` and `DELETE /groups/:id`

All five require `manage-tenant`; the list, `GET /groups`, is also
readable with `view-users` (below). `path` is derived, never accepted: a root
group's is `/name`, a child's is its parent's with `/name` appended, and
`groupRepository` (`packages/domain-authz/src/repository/groups.ts`) is the
only writer of it. A group carries a `description`, as a role does: at
most 1000 characters on `POST` and `PATCH`, `null` to clear, exported and
imported with the group. `PATCH` amends `description` and `parent_id` —
reparenting, which recomputes `path` for the group and every descendant —
and every other field is refused with a reason. A `parent_id` naming no group answers `400`, the
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
  -d '{"parent_id": "01a109ba-89ef-7d81-8daf-7759f4b5bf57"}' \
  http://localhost:3082/admin/tenants/reparent-demo/groups/01a109ba-8a04-7ec4-bcc0-0b50ecc0b1be
```

Against the twelfth stack, in a tenant `reparent-demo` made for it: two
roots, `engineering`, created with a `description`, and `platform`, then
`platform` reparented under `engineering` — `path` is recomputed by the
write, never sent — then the reverse, refused:

```
{"id":"01a109ba-89ef-7d81-8daf-7759f4b5bf57","name":"engineering","description":"Everyone who builds the product","parent_id":null,"default_for_new_subjects":false,"path":"/engineering","created_at":"2026-10-05T01:43:02.382Z"}
{"id":"01a109ba-8a04-7ec4-bcc0-0b50ecc0b1be","name":"platform","description":null,"parent_id":null,"default_for_new_subjects":false,"path":"/platform","created_at":"2026-10-05T01:43:02.404Z"}
{"id":"01a109ba-8a04-7ec4-bcc0-0b50ecc0b1be","name":"platform","description":null,"parent_id":"01a109ba-89ef-7d81-8daf-7759f4b5bf57","default_for_new_subjects":false,"path":"/engineering/platform","created_at":"2026-10-05T01:43:02.404Z"}
{"type":"about:blank","title":"Conflict","status":409,"detail":"would create a group reparent cycle","instance":"01a109ba-8a44-7d24-82fd-f8c1c9d049e7"}
```

**Search** is `?name=`, the same prefix match `GET /roles` above describes,
over `groups.name_search`; it matches a group's own name, not its `path`.
Captured against the twelfth stack, whose `demo` held no groups until
`engineering`, `Engineering-Ops` and `finance` were created there as roots:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "engineering"}' \
  http://localhost:3082/admin/tenants/demo/groups
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Engineering-Ops"}' \
  http://localhost:3082/admin/tenants/demo/groups
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "finance"}' \
  http://localhost:3082/admin/tenants/demo/groups
```

```
{"id":"01a109ba-8a68-719f-810b-8ff86cf1e25e","name":"engineering","description":null,"parent_id":null,"default_for_new_subjects":false,"path":"/engineering","created_at":"2026-10-05T01:43:02.503Z"}
{"id":"01a109ba-8a7d-77c6-8977-e69091826379","name":"Engineering-Ops","description":null,"parent_id":null,"default_for_new_subjects":false,"path":"/Engineering-Ops","created_at":"2026-10-05T01:43:02.524Z"}
{"id":"01a109ba-8a90-7ece-9415-2dff8a669cf6","name":"finance","description":null,"parent_id":null,"default_for_new_subjects":false,"path":"/finance","created_at":"2026-10-05T01:43:02.544Z"}
```

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/demo/groups?name=ENG"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/demo/groups?name=eng&limit=1"
```

```
{"items":[{"id":"01a109ba-8a68-719f-810b-8ff86cf1e25e","name":"engineering","description":null,"parent_id":null,"default_for_new_subjects":false,"path":"/engineering","created_at":"2026-10-05T01:43:02.503Z"},{"id":"01a109ba-8a7d-77c6-8977-e69091826379","name":"Engineering-Ops","description":null,"parent_id":null,"default_for_new_subjects":false,"path":"/Engineering-Ops","created_at":"2026-10-05T01:43:02.524Z"}]}
{"items":[{"id":"01a109ba-8a68-719f-810b-8ff86cf1e25e","name":"engineering","description":null,"parent_id":null,"default_for_new_subjects":false,"path":"/engineering","created_at":"2026-10-05T01:43:02.503Z"}],"next":"eyJhZnRlciI6IjAxYTEwOWJhLThhNjgtNzE5Zi04MTBiLThmZjg2Y2YxZTI1ZSIsInNvcnQiOiJlbmdpbmVlcmluZyIsImNvbGxlY3Rpb24iOiJncm91cHMiLCJ0ZW5hbnRJZCI6IjAxYTEwOWI2LTFkOGQtNzhkYS05ZGYwLTBkMjhiNzJjZTJlOCIsImZpbHRlcnMiOiJzTVFsYy1tTnM3SUxXZHhsYk9YOUJKRlA0dzlSb05MMXlpSVJ0bmxrQnZNIn0.yP0xF9owpV-QdZI27JYEb_EH6gI-3WAqfQTmdDMOjZs"}
```

Following that cursor, then replaying it with `?name=` dropped:

```bash
CURSOR='eyJhZnRlciI6IjAxYTEwOWJhLThhNjgtNzE5Zi04MTBiLThmZjg2Y2YxZTI1ZSIsInNvcnQiOiJlbmdpbmVlcmluZyIsImNvbGxlY3Rpb24iOiJncm91cHMiLCJ0ZW5hbnRJZCI6IjAxYTEwOWI2LTFkOGQtNzhkYS05ZGYwLTBkMjhiNzJjZTJlOCIsImZpbHRlcnMiOiJzTVFsYy1tTnM3SUxXZHhsYk9YOUJKRlA0dzlSb05MMXlpSVJ0bmxrQnZNIn0.yP0xF9owpV-QdZI27JYEb_EH6gI-3WAqfQTmdDMOjZs'
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/demo/groups?limit=1&name=eng&cursor=$CURSOR"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/demo/groups?limit=1&cursor=$CURSOR"
```

```
{"items":[{"id":"01a109ba-8a7d-77c6-8977-e69091826379","name":"Engineering-Ops","description":null,"parent_id":null,"default_for_new_subjects":false,"path":"/Engineering-Ops","created_at":"2026-10-05T01:43:02.524Z"}]}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"cursor is invalid or expired","errors":[{"path":"cursor","message":"is invalid or expired"}],"instance":"01a109ba-8af2-7925-8ed3-9e1269aedc70"}
```

### The list a user manager picks from

`GET /groups` alone is also readable with `view-users`, and so with
`manage-users`, for the reason and within the limits the same subsection
under `GET /roles` gives, where it was captured.

### One level of the tree

`?parent=<id>` lists a group's children and `?parent=root` the groups with
no parent, so a tree is drawn a level at a time rather than from every page
of groups; `GET /groups/count` takes it too, and it `AND`s with `?name=`. A
value that is neither a UUID nor `root` is refused with `400`. Against the
twelfth stack, in an `ops-demo` of its own holding `/finance` and
`/finance/payables` alone, `$P` its `http://localhost:3082/admin/tenants/ops-demo`:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/groups?parent=root"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/groups?parent=01a109ba-8b46-73aa-98e5-54a2d4abddc6"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/groups/count?parent=01a109ba-8b46-73aa-98e5-54a2d4abddc6"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/groups?parent=top"; echo
```

```
{"items":[{"id":"01a109ba-8b46-73aa-98e5-54a2d4abddc6","name":"finance","description":null,"parent_id":null,"default_for_new_subjects":false,"path":"/finance","created_at":"2026-10-05T01:43:02.726Z"}]}
{"items":[{"id":"01a109ba-8b5c-7d8c-9337-c6abb3a36eee","name":"payables","description":null,"parent_id":"01a109ba-8b46-73aa-98e5-54a2d4abddc6","default_for_new_subjects":false,"path":"/finance/payables","created_at":"2026-10-05T01:43:02.746Z"}]}
{"count":1,"capped":false}
{"type":"about:blank","title":"Error","status":400,"detail":"querystring/parent must match pattern \"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$\", querystring/parent must be equal to constant, querystring/parent must match a schema in anyOf","errors":[{"path":"parent","message":"must match pattern \"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$\""},{"path":"parent","message":"must be equal to constant"},{"path":"parent","message":"must match a schema in anyOf"}],"instance":"01a109ba-8bab-7f79-8a9c-ececd8c32911"}
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

Captured against the sixth stack, on `demo`'s `engineering` group and
`billing-viewer` role:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3080/admin/tenants/demo/groups/01a0ea5c-86b5-7ca9-858a-559fbdf1f804/roles

curl -sS -D - -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"' \
  -d '{"role_ids": ["01a0ea58-0e45-76eb-be5f-bd76e03e4b6e"]}' \
  http://localhost:3080/admin/tenants/demo/groups/01a0ea5c-86b5-7ca9-858a-559fbdf1f804/roles
```

```
HTTP/1.1 200 OK
x-request-id: 01a0ea5c-fb6a-7248-8c7c-d360d9f0796b
cache-control: no-store
etag: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"
content-type: application/json; charset=utf-8
content-length: 12
Date: Mon, 28 Sep 2026 23:32:37 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[]}

HTTP/1.1 200 OK
x-request-id: 01a0ea5c-fb7f-7262-8379-cbd7bc176905
cache-control: no-store
etag: "da18ee68fe8192f473f7a652ecf0a6643b7a07b68bd4bc028673d434328f8572"
content-type: application/json; charset=utf-8
content-length: 116
Date: Mon, 28 Sep 2026 23:32:37 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a0ea58-0e45-76eb-be5f-bd76e03e4b6e","name":"billing-viewer","client_id":null,"client_key":null}]}
```

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
`bundle-app` is a client with a role `operator` scoped to it, nesting
`tenant-admin`. `bundle-app` was created through `POST /clients`, `ops`
through `POST /scopes`, `operator` through `POST /roles` scoped to
`bundle-app`, and `tenant-admin` nested under `operator` through
`POST /roles/:id/composites`, all against `ceiling-removal`.
`$TENANT_TOKEN` and `$CLIENTS_TOKEN` are the
`client_credentials` tokens of two clients whose service accounts were
given `manage-tenant` alone and `manage-clients` alone. Emptying `admins`,
deleting it, moving `on-call`
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

## `PUT /groups/:id/default`

Requires `manage-tenant`. The body is `{"default": true}` or
`{"default": false}`, and the answer is the group with its `ETag`; the
group's `default_for_new_subjects` shows the flag on every read, and
`PATCH /groups/:id` refuses it with a reason naming this route. `If-Match`
is optional, and a stale one is refused with `412`. A default group is
joined by **every subject created afterwards** — through `POST /subjects`,
self-registration and `odudu seed` (`seed user`, the bootstrap user and
`seed admin`), all through `grantNewSubjectDefaults`
(`packages/domain-authz/src/repository/new-subject-defaults.ts`), which
hands out the default roles in the same pass — and by none that already
exist. A subject an import brings is one being moved rather than created:
it arrives with exactly the groups and roles its document lists, a default
group's membership included where it held one, so the import never hands
back a membership an administrator removed, and a tenant re-exports what it
imported. Each change is audited as `group.default_set`, with the
flag's before and after in `detail`.

**A default group may reach no admin capability**, on the rule
`PUT /roles/:id/default` holds a role to: membership hands out the roles
mapped to the group and to every ancestor (ADR 0040's ceiling reaches as
far), so `true` is refused with `403`, whoever the caller is, when any of
them reaches a role of the built-in admin client. While a group is a
default, each write that could widen what it hands out is refused the same
way, with a `refused` row: `PUT /groups/:id/roles` on it or on an ancestor
mapping a role that reaches a capability, `POST /roles/:id/composites`
nesting one under a role it reaches, and `PATCH /groups/:id` moving it or
an ancestor under a chain that reaches one. Every one of these takes the
lock the role defaults take (`lockDefaultReach`,
`packages/protocol-admin/src/usecase/default-reach.ts`) after its own row
lock, so two writers cannot each pass the check alone. An import is held to
the same rule: a document marking a group default whose chain reaches a
capability is refused at that group's `default_for_new_subjects`.

Against the twelfth stack, in a tenant `defaults-demo` made for it: a root
group `staff`, made with a `description`, and its child `everyone`, neither
mapping a role. `everyone` made a default, then a subject created
afterwards, its memberships narrowed with `jq`:

```bash
curl -sS -D - -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"default": true}' \
  http://localhost:3082/admin/tenants/defaults-demo/groups/01a109bc-662b-766f-8f14-e5b4a1a51a3f/default
NEW=$(curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"username":"newcomer"}' \
  http://localhost:3082/admin/tenants/defaults-demo/subjects | jq -r .id)
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/defaults-demo/subjects/$NEW/groups" | jq -c '[.items[].path]'
```

```
HTTP/1.1 200 OK
x-request-id: 01a109bc-664b-744f-8927-24e62e623096
cache-control: no-store
etag: "792933a119637c51969100574f6271796b49a02533c7762d1d2419b1e9d6887a"
content-type: application/json; charset=utf-8
content-length: 230
Date: Mon, 05 Oct 2026 01:45:04 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a109bc-662b-766f-8f14-e5b4a1a51a3f","name":"everyone","description":null,"parent_id":"01a109bc-6614-7754-98ea-34b518dd251d","default_for_new_subjects":true,"path":"/staff/everyone","created_at":"2026-10-05T01:45:04.298Z"}
["/staff/everyone"]
```

Then the guard, from the other side: mapping `odudu-admin:view-users` to
`staff`, the default's parent — refused even for `ada-t8c2`, who holds every
capability — then `PATCH` naming the flag, then the trail of each group:

```bash
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -H "If-Match: $STAFF_ROLES_ETAG" \
  -d '{"role_ids": ["01a109bc-65ea-7553-a99e-0ca5a23eec96"]}' \
  http://localhost:3082/admin/tenants/defaults-demo/groups/01a109bc-6614-7754-98ea-34b518dd251d/roles; echo
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"default_for_new_subjects": false}' \
  http://localhost:3082/admin/tenants/defaults-demo/groups/01a109bc-662b-766f-8f14-e5b4a1a51a3f; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/defaults-demo/audit?resource_type=group&resource_id=01a109bc-662b-766f-8f14-e5b4a1a51a3f" \
  | jq -c '.items[] | {action, outcome, detail}'
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/defaults-demo/audit?resource_type=group&resource_id=01a109bc-6614-7754-98ea-34b518dd251d&action=group.roles_set" \
  | jq -c '.items[] | {action, outcome, detail}'
```

`$STAFF_ROLES_ETAG` is the `ETag` `GET …/groups/01a109bc-6614-7754-98ea-34b518dd251d/roles`
answered just before:

```
{"type":"about:blank","title":"Forbidden","status":403,"detail":"a group every new subject joins may reach no admin capability, and this one would reach: view-users","instance":"01a109bc-66ad-7234-9ce3-034e92b1af82"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"default_for_new_subjects: default_for_new_subjects changes who joins a group silently at signup; set it with PUT /admin/tenants/{tenant}/groups/{id}/default, not a general amendment","errors":[{"path":"default_for_new_subjects","message":"default_for_new_subjects changes who joins a group silently at signup; set it with PUT /admin/tenants/{tenant}/groups/{id}/default, not a general amendment"}],"instance":"01a109bc-66c8-7883-bb51-f2a9172721f3"}
{"action":"group.default_set","outcome":"allowed","detail":{"default_for_new_subjects":{"after":true,"before":false}}}
{"action":"group.create","outcome":"allowed","detail":{}}
{"action":"group.roles_set","outcome":"refused","detail":{"denied":["view-users"]}}
```

## `GET /scopes`, `POST /scopes`, `GET /scopes/:id`, `PATCH /scopes/:id` and `DELETE /scopes/:id`

All five require `manage-tenant`. `include_in_id_token` and
`include_in_access_token` (both default `true`) decide which token a
scope's claims land in; `PATCH` amends either, plus `description` and
`default_client_assignment` — `name` is refused, since it is the scope token
a client requests and a token carries. A duplicate name answers `409`.

**`default_client_assignment` is the tenant's default client scopes.** A
scope marked `default` or `optional` is assigned, that way, to every client
created afterwards — by `POST /clients`, by dynamic registration, by
`odudu seed` and by `seed client`, which all call `provisionClientDefaults`
(`packages/domain-tenant/src/usecase/provision-defaults.ts`) — and `null`
leaves it to be assigned deliberately. A new tenant marks the vocabulary it
provisions as that code always assigned it: `openid`, `profile`, `email`,
`address`, `phone`, `roles` and `groups` `default`, `offline_access`
`optional`, and `0089_scope_client_default.sql` marked an upgraded tenant's
scopes of those names the same way. A mark changes no client that already
exists. It is a scope's own column rather than a tenant setting listing
names, because the assignment kind belongs to each scope, and a deleted
scope takes its mark with it instead of leaving a name that matches
nothing.

**`consent_text` and `display_order` are what the consent screen shows.**
The screen lists a client's requested scopes by `display_order` (an integer,
`0` by default, never negative), then by name, the pre-approved ones first
and the optional ones after, and shows each by its `consent_text` where it
has one — at most 500 characters, or `null` for the bare scope name — every
value through the page's own `escapeHtml`, with the page's policy unchanged:
it still carries no script. The text is one string for now; a text per
locale is P4b's, with the rest of the translated pages. Both travel in the
tenant document and are amended by `PATCH`.

On the twelfth stack's `demo`, with `billing` marked as above: a public
client `consent-portal`, named `Consent <Portal>`, made with
`consent_required` and given the vocabulary — `billing` among it — by
`POST /clients`; `profile` given a text and an order; `grace` seeded with
`odudu seed user`; then a sign-in asking for the four scopes in another
order. The pre-approved pair is listed `openid` then `profile`, by their
`display_order` of `0` and `5`, the optional pair `offline_access` then
`billing`, by `0` and `10`, each with its text where it has one, escaped:

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"client_id":"consent-portal","name":"Consent <Portal>","redirect_uris":["https://portal.demo.example/callback"],"token_endpoint_auth_method":"none","consent_required":true}' \
  http://localhost:3082/admin/tenants/demo/clients > /dev/null
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"consent_text":"Your name & <picture>","display_order":5}' \
  http://localhost:3082/admin/tenants/demo/scopes/01a109b6-1d90-79dd-bd97-5ff11a7bdada > /dev/null
docker compose exec -T odudu node dist/main.js seed user --tenant demo \
  --username grace --password 'correct-horse-battery-8c2' > /dev/null
curl -sS -c jar -b jar -o /dev/null \
  'http://localhost:3082/tenants/demo/protocol/openid-connect/auth?response_type=code&client_id=consent-portal&redirect_uri=https%3A%2F%2Fportal.demo.example%2Fcallback&scope=openid%20billing%20profile%20offline_access&state=xyz&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256'
curl -sS -D - -c jar -b jar \
  --data-urlencode "auth_session_id=01a109bb-ebe1-7939-9b64-c49b58303c2d" \
  --data-urlencode 'username=grace' --data-urlencode 'password=correct-horse-battery-8c2' \
  http://localhost:3082/tenants/demo/login-actions/authenticate
```

The `auth_session_id` is the one the login form that request rendered
carried; the page's policy is the one every page without a script carries:

````
HTTP/1.1 200 OK
x-request-id: 01a109bb-ebef-720a-b749-5783b7fe7027
content-type: text/html
content-security-policy: default-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
content-length: 796
Date: Mon, 05 Oct 2026 01:44:33 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Allow access?</title></head>
<body>
<h1>Consent &lt;Portal&gt; is asking for access</h1>
<form method="post" action="/tenants/demo/login-actions/consent">
  <input type="hidden" name="auth_session_id" value="01a109bb-ebe1-7939-9b64-c49b58303c2d">
  <ul>
  <li>openid</li>
  <li>Your name &amp; &lt;picture&gt;</li>
  </ul>
  <label><input type="checkbox" name="scope" value="offline_access"> offline_access — grants ongoing access, even while you are not present</label>
  <label><input type="checkbox" name="scope" value="billing"> See and pay your invoices</label>
  <button type="submit" name="decision" value="allow">Allow</button>
  <button type="submit" name="decision" value="deny">Deny</button>
</form>
</body>
</html>
``` `DELETE` cascades:
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
  http://localhost:3082/admin/tenants/demo/scopes
````

Captured against the twelfth stack's `demo`, as are the three requests after
it: `billing` given a consent text, a place on the consent screen and a
client default, then a default that is none of the three values refused by
name, then a client created afterwards — its `scopes`, narrowed with `jq`,
carry `billing` as `optional` beside the vocabulary a new tenant marks:

```
{"id":"01a109bb-41fa-7343-8d50-a86f9070aefc","name":"billing","description":null,"include_in_id_token":false,"include_in_access_token":true,"default_client_assignment":null,"consent_text":null,"display_order":0,"created_at":"2026-10-05T01:43:49.498Z"}
```

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"consent_text": "See and pay your invoices", "display_order": 10, "default_client_assignment": "optional"}' \
  http://localhost:3082/admin/tenants/demo/scopes/01a109bb-41fa-7343-8d50-a86f9070aefc; echo
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"default_client_assignment": "always"}' \
  http://localhost:3082/admin/tenants/demo/scopes/01a109bb-41fa-7343-8d50-a86f9070aefc; echo
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"client_id": "billing-portal", "redirect_uris": ["https://billing.demo.example/callback"]}' \
  http://localhost:3082/admin/tenants/demo/clients | jq -c '[.scopes[] | {name, assignment}]'
```

```
{"id":"01a109bb-41fa-7343-8d50-a86f9070aefc","name":"billing","description":null,"include_in_id_token":false,"include_in_access_token":true,"default_client_assignment":"optional","consent_text":"See and pay your invoices","display_order":10,"created_at":"2026-10-05T01:43:49.498Z"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"default_client_assignment: default_client_assignment must be default, optional or null","errors":[{"path":"default_client_assignment","message":"default_client_assignment must be default, optional or null"}],"instance":"01a109bb-4228-7553-8179-293e52c0675f"}
[{"name":"openid","assignment":"default"},{"name":"profile","assignment":"default"},{"name":"email","assignment":"default"},{"name":"address","assignment":"default"},{"name":"phone","assignment":"default"},{"name":"roles","assignment":"default"},{"name":"groups","assignment":"default"},{"name":"offline_access","assignment":"optional"},{"name":"billing","assignment":"optional"}]
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
`client_scopes.name_search`. Captured against the sixth stack, whose
`demo` held the eight scopes a tenant is provisioned with, each cut down
with `jq` to the fields that show the point; then a cursor minted under
`?name=p` replayed under `?name=o`:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/demo/scopes?name=O" \
  | jq -c '{items: [.items[] | {name}]}'
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/demo/scopes?name=p&limit=1" \
  | jq -c '{items: [.items[] | {name}], next}'
```

```
{"items":[{"name":"offline_access"},{"name":"openid"}]}
{"items":[{"name":"phone"}],"next":"eyJhZnRlciI6IjAxYTBlYTRjLTA4ODgtNzc1MC04MmIxLWQ2YmE1ZGYyMzY2ZCIsInNvcnQiOiJwaG9uZSIsImNvbGxlY3Rpb24iOiJzY29wZXMiLCJ0ZW5hbnRJZCI6IjAxYTBlYTRjLTA4ODQtNzRmYS04MjVjLTA1ZjZlZjU2OGRkMCIsImZpbHRlcnMiOiJBbkY0THhTZFRNWjMxMEJpUjZFN3pGYWFCQ1hDcnZIMGFDVjZ2ZzJRUmg4In0.M9-fRVaU-b71dsUwQwGjmYChfaDZHaQ9OzpoT7XVrFw"}
```

```bash
CURSOR='eyJhZnRlciI6IjAxYTBlYTRjLTA4ODgtNzc1MC04MmIxLWQ2YmE1ZGYyMzY2ZCIsInNvcnQiOiJwaG9uZSIsImNvbGxlY3Rpb24iOiJzY29wZXMiLCJ0ZW5hbnRJZCI6IjAxYTBlYTRjLTA4ODQtNzRmYS04MjVjLTA1ZjZlZjU2OGRkMCIsImZpbHRlcnMiOiJBbkY0THhTZFRNWjMxMEJpUjZFN3pGYWFCQ1hDcnZIMGFDVjZ2ZzJRUmg4In0.M9-fRVaU-b71dsUwQwGjmYChfaDZHaQ9OzpoT7XVrFw'
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/demo/scopes?limit=1&name=p&cursor=$CURSOR" \
  | jq -c '{items: [.items[] | {name}], next}'
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/demo/scopes?limit=1&name=o&cursor=$CURSOR"
```

```
{"items":[{"name":"profile"}],"next":null}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"cursor is invalid or expired","errors":[{"path":"cursor","message":"is invalid or expired"}],"instance":"01a0ea5d-4b5b-7152-932f-b01589f6914d"}
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

Captured against the sixth stack, on a `billing` scope created in its
`demo` and the same role — the empty list's tag is the one the two sections above answered,
for the reason `PUT /subjects/:id/roles` states:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3080/admin/tenants/demo/scopes/01a0ea5d-c42a-723c-8bb2-b45950186b42/roles

curl -sS -D - -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"' \
  -d '{"role_ids": ["01a0ea58-0e45-76eb-be5f-bd76e03e4b6e"]}' \
  http://localhost:3080/admin/tenants/demo/scopes/01a0ea5d-c42a-723c-8bb2-b45950186b42/roles
```

```
HTTP/1.1 200 OK
x-request-id: 01a0ea5d-c436-7bd3-810b-49123e655d9b
cache-control: no-store
etag: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"
content-type: application/json; charset=utf-8
content-length: 12
Date: Mon, 28 Sep 2026 23:33:28 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[]}

HTTP/1.1 200 OK
x-request-id: 01a0ea5d-c44b-7d6c-b929-16982d3824dd
cache-control: no-store
etag: "da18ee68fe8192f473f7a652ecf0a6643b7a07b68bd4bc028673d434328f8572"
content-type: application/json; charset=utf-8
content-length: 116
Date: Mon, 28 Sep 2026 23:33:28 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a0ea58-0e45-76eb-be5f-bd76e03e4b6e","name":"billing-viewer","client_id":null,"client_key":null}]}
```

## `GET /scopes/:id/clients`

Requires `manage-tenant`, the capability that arranges scopes — not the
`manage-clients` a client's own representation needs. It answers the
clients the scope is assigned to, each by its row id, its `client_id`, its
name and its `assignment`, and nothing else of the client, for the same
reason `PUT /scopes/:id/clients/:clientId` answers only the assignments.
The list is in row-id order and pages the way every list here does; a
cursor is bound to its scope, so one minted for another scope is refused
with `400`. An unknown scope, or another tenant's, answers `404`.

Captured against the fifth stack in `etags-demo`, on the scope `billing`
(`01a0e9ec-d68e-7463-8023-bd155594d026`), after a second public client
`etags-reports` was created there and assigned it as `default` — so two
clients carry it, `etags-app` as `optional` from the capture under
"The client's new `ETag`" below, which ran first. As `ada-t2`, who holds every capability; that `manage-tenant` alone
suffices is what `packages/protocol-admin/tests/scopes.int.test.ts` shows,
and was not captured:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3080/admin/tenants/etags-demo/scopes/01a0e9ec-d68e-7463-8023-bd155594d026/clients?limit=1'
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/etags-demo/scopes/01a0e9ec-d68e-7463-8023-bd155594d026/clients?limit=1&cursor=$NEXT"
```

The first page's status line, `link` header and body, then the second page
under the `next` it answered:

```
HTTP/1.1 200 OK
link: </admin/tenants/etags-demo/scopes/01a0e9ec-d68e-7463-8023-bd155594d026/clients?limit=1&cursor=eyJhZnRlciI6IjAxYTBlOWVjLWQ2NGEtN2Q1ZC1hMGFjLWEwMWVmZDU2YjZmMyIsImNvbGxlY3Rpb24iOiJzY29wZV9jbGllbnRzIiwidGVuYW50SWQiOiIwMWEwZTllYy02MzM2LTdmNWQtYjY2NS0xZjBmMjM4NjkxZTAiLCJmaWx0ZXJzIjoienBYT015WjR3UTUxdlVWRlNlUUFSczUzM195TFYxRHo4VjhtSkJqaVV1VSJ9.kqsvXe4098QtAd3VtUADUklyypfRG7HebjhmN4KhHiw>; rel="next"
{"items":[{"id":"01a0e9ec-d64a-7d5d-a0ac-a01efd56b6f3","client_id":"etags-app","name":"etags-app","assignment":"optional"}],"next":"eyJhZnRlciI6IjAxYTBlOWVjLWQ2NGEtN2Q1ZC1hMGFjLWEwMWVmZDU2YjZmMyIsImNvbGxlY3Rpb24iOiJzY29wZV9jbGllbnRzIiwidGVuYW50SWQiOiIwMWEwZTllYy02MzM2LTdmNWQtYjY2NS0xZjBmMjM4NjkxZTAiLCJmaWx0ZXJzIjoienBYT015WjR3UTUxdlVWRlNlUUFSczUzM195TFYxRHo4VjhtSkJqaVV1VSJ9.kqsvXe4098QtAd3VtUADUklyypfRG7HebjhmN4KhHiw"}
{"items":[{"id":"01a0e9fc-fdef-7181-9a3d-25e1f12431e7","client_id":"etags-reports","name":"etags-reports","assignment":"default"}]}
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

The OpenAPI document declares that same shape as the `200`'s body —
`assignScopeToClientResponseSchema`, not the client's own. Captured
against the fifth stack, the published document's entry for this route,
extracted with the filter shown:

```bash
curl -sS http://localhost:3080/admin/openapi.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s);console.log(JSON.stringify(d.paths["/admin/tenants/{tenant}/scopes/{id}/clients/{clientId}"].put.responses["200"]))})'
```

```
{"description":"OK","content":{"application/json":{"schema":{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"client_id":{"type":"string"},"scopes":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string"},"name":{"type":"string"},"assignment":{"type":"string","enum":["default","optional"]}},"required":["id","name","assignment"],"additionalProperties":false}}},"required":["client_id","scopes"],"additionalProperties":false}}}}
```

### The client's new `ETag`

The client's own representation carries its `scopes`, so an assignment
changes the `ETag` `GET /clients/:id` answers. The `PUT` answers that new
`ETag`, and so does `DELETE /scopes/:id/clients/:clientId` beside its
`204`, so a caller editing the client can save its next change without
reading it again — the `ETag` is a digest, and hands the `manage-tenant`
holder none of what it covers. Captured against the fifth stack in
`etags-demo`, on a public client `etags-app`
(`01a0e9ec-d64a-7d5d-a0ac-a01efd56b6f3`) and a scope `billing`
(`01a0e9ec-d68e-7463-8023-bd155594d026`), both created there for it:

```bash
curl -sS -D - -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"assignment":"optional"}' \
  http://localhost:3080/admin/tenants/etags-demo/scopes/01a0e9ec-d68e-7463-8023-bd155594d026/clients/01a0e9ec-d64a-7d5d-a0ac-a01efd56b6f3
curl -sS -D - -o /dev/null -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3080/admin/tenants/etags-demo/clients/01a0e9ec-d64a-7d5d-a0ac-a01efd56b6f3
```

```
HTTP/1.1 200 OK
etag: "4239c83cdd1615fda6c595070f888200acba67bd27421287344614b7827f4165"
{"client_id":"01a0e9ec-d64a-7d5d-a0ac-a01efd56b6f3","scopes":[{"id":"01a0e9ec-6338-7743-a6cf-bf196533da83","name":"openid","assignment":"default"},{"id":"01a0e9ec-6338-7743-a6cf-bf1a6fe8811d","name":"profile","assignment":"default"},{"id":"01a0e9ec-6339-782e-9a8d-42f903942e10","name":"email","assignment":"default"},{"id":"01a0e9ec-633a-7996-82df-731802038298","name":"address","assignment":"default"},{"id":"01a0e9ec-633a-7996-82df-7319409725e4","name":"phone","assignment":"default"},{"id":"01a0e9ec-633b-7f20-8264-586c5a087d01","name":"roles","assignment":"default"},{"id":"01a0e9ec-633b-7f20-8264-586da97b298d","name":"groups","assignment":"default"},{"id":"01a0e9ec-633c-752d-a317-52e94971abf9","name":"offline_access","assignment":"optional"},{"id":"01a0e9ec-d68e-7463-8023-bd155594d026","name":"billing","assignment":"optional"}]}
HTTP/1.1 200 OK
etag: "4239c83cdd1615fda6c595070f888200acba67bd27421287344614b7827f4165"
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

Recaptured against the twelfth stack, in a tenant `scope-unassign-demo` made
for this section, on a public client `scope-unassign-app` registered for
`authorization_code`.
`POST /clients` assigned it the tenant's default vocabulary, `openid`
included, so `/authorize` first renders the login form:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  'http://localhost:3082/tenants/scope-unassign-demo/protocol/openid-connect/auth?response_type=code&client_id=scope-unassign-app&redirect_uri=https%3A%2F%2Fapp.example%2Fcallback&scope=openid&state=xyz&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256'
```

```
200
```

Unassigning `openid`, then reading the client back — the scope is gone from
`scopes`, `profile` now first — then the same removal repeated. The `204`
carries the client's new `ETag`, the one that read answers;
`scope-unassign-app` is public, so `service_subject_id` reads `null`:

```bash
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3082/admin/tenants/scope-unassign-demo/scopes/01a109b7-d4cb-7d70-8819-84944ef99955/clients/01a109b7-d4ff-72db-90a3-044efab12332

curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3082/admin/tenants/scope-unassign-demo/clients/01a109b7-d4ff-72db-90a3-044efab12332

curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3082/admin/tenants/scope-unassign-demo/scopes/01a109b7-d4cb-7d70-8819-84944ef99955/clients/01a109b7-d4ff-72db-90a3-044efab12332
```

```
HTTP/1.1 204 No Content
x-request-id: 01a109b7-d53a-7f8b-b6c6-8d2bc91ea83e
cache-control: no-store
etag: "d577711acc23b187327a97d02ab5f7abee1ff3a14aac707bd4d8a96d73b7766c"
Date: Mon, 05 Oct 2026 01:40:05 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a109b7-d4ff-72db-90a3-044efab12332","client_id":"scope-unassign-app","name":"scope-unassign-app","description":null,"type":"public","enabled":true,"full_scope_allowed":false,"registration_origin":"operator","created_at":"2026-10-05T01:40:04.990Z","redirect_uris":["https://app.example/callback"],"grant_types":["authorization_code"],"token_endpoint_auth_method":"none","audiences":[],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":null,"scopes":[{"id":"01a109b7-d4cc-7147-b8f0-70228a1a5a5c","name":"profile","assignment":"default"},{"id":"01a109b7-d4cd-7809-8aee-499efe11e1e1","name":"email","assignment":"default"},{"id":"01a109b7-d4cd-7809-8aee-499f5483c7bd","name":"address","assignment":"default"},{"id":"01a109b7-d4ce-7558-9abe-03d84d660f1a","name":"phone","assignment":"default"},{"id":"01a109b7-d4ce-7558-9abe-03d94c59122b","name":"roles","assignment":"default"},{"id":"01a109b7-d4cf-7cbe-ae62-cc913545931b","name":"groups","assignment":"default"},{"id":"01a109b7-d4cf-7cbe-ae62-cc92fb5695ab","name":"offline_access","assignment":"optional"}]}

HTTP/1.1 404 Not Found
x-request-id: 01a109b7-d565-7932-821a-445eb045285c
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 222
Date: Mon, 05 Oct 2026 01:40:05 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Not Found","status":404,"detail":"scope 01a109b7-d4cb-7d70-8819-84944ef99955 is not assigned to client 01a109b7-d4ff-72db-90a3-044efab12332","instance":"01a109b7-d565-7932-821a-445eb045285c"}
```

`/authorize`, asked for `openid` again, now refuses it the same way an
unregistered scope would — `state` and `iss` still carried back, the same
as any other redirect-side refusal:

```bash
curl -sS -D - -o /dev/null \
  'http://localhost:3082/tenants/scope-unassign-demo/protocol/openid-connect/auth?response_type=code&client_id=scope-unassign-app&redirect_uri=https%3A%2F%2Fapp.example%2Fcallback&scope=openid&state=xyz&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256'
```

```
HTTP/1.1 302 Found
x-request-id: 01a109b7-d579-793d-91fe-ea746b588ac8
location: https://app.example/callback?error=invalid_scope&state=xyz&iss=http%3A%2F%2Flocalhost%3A3082%2Ftenants%2Fscope-unassign-demo
content-length: 0
Date: Mon, 05 Oct 2026 01:40:05 GMT
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

A name the registry does not carry, refused with the names it does —
captured against the sixth stack, on the `billing` scope in its `demo`,
under the `ETag` its `GET …/mappers` answered:

```bash
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "59c1141bb2da82132d257ffa8b417c0a7c4e9985057f06388c4d62534ecb2183"' \
  -d '{"mapper_names": ["nonesuch"]}' \
  http://localhost:3080/admin/tenants/demo/scopes/01a0ea5d-c42a-723c-8bb2-b45950186b42/mappers
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"unknown mapper name(s): nonesuch; known: sub, profile, email, roles, groups, address, phone","errors":[{"path":"mapper_names","message":"names no registered mapper nonesuch"}],"instance":"01a0ea5e-0ac9-7763-81a3-db353b147f0c"}
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
registered with a `userinfo_signed_response_alg` or an
`id_token_signed_response_alg` no remaining non-retired key would produce,
naming the offending client id(s) in the response `detail`.

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
the sixth stack, whose `demo` held one key, `active` and `ES256`, so the
first filter matches nothing and the second finds it:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/demo/keys?status=active&alg=RS256"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/demo/keys?alg=ES256"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/demo/keys?status=pending"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/demo/keys?kid=x"
```

```
{"items":[]}
{"items":[{"id":"01a0ea4c-08b4-77b6-9ba5-89aa2348c2a1","status":"active","kid":"01a0ea4c-08b3-709e-8f42-9ae93cf18faa","alg":"ES256","created_at":"2026-09-28T23:14:06.596Z","not_after":null}]}
{"type":"about:blank","title":"Error","status":400,"detail":"querystring/status must be equal to one of the allowed values","errors":[{"path":"status","message":"must be equal to one of the allowed values"}],"instance":"01a0ea5e-5eb6-7059-ba9d-94bd832f36cc"}
{"type":"about:blank","title":"Error","status":400,"detail":"querystring must NOT have additional properties: kid","errors":[{"path":"kid","message":"must NOT have additional properties"}],"instance":"01a0ea5e-5ec1-775d-8b09-75ee325d8104"}
```

### A key's `ETag`

`POST /keys`, promote and retire each answer an `ETag` over the key they
answer. Promote and retire honour it as `If-Match` when it is sent, taken
over the key as it stands under the write's own lock, and refuse a stale
one with `412`; neither requires it. Captured against the fifth stack in
`etags-demo`:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"alg":"RS256"}' http://localhost:3080/admin/tenants/etags-demo/keys
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'If-Match: "0000"' \
  http://localhost:3080/admin/tenants/etags-demo/keys/01a0e9ec-b000-7842-96c3-6475d4f6e651/promote
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'If-Match: "3ec2140faff0825bec2afd86b419e16bd83744ce67f7fc3020a050e9f9e859a2"' \
  http://localhost:3080/admin/tenants/etags-demo/keys/01a0e9ec-b000-7842-96c3-6475d4f6e651/promote
```

```
HTTP/1.1 201 Created
etag: "3ec2140faff0825bec2afd86b419e16bd83744ce67f7fc3020a050e9f9e859a2"
{"id":"01a0e9ec-b000-7842-96c3-6475d4f6e651","status":"rotating","kid":"01a0e9ec-afff-7ce4-8c78-95aff244235b","alg":"RS256","created_at":"2026-09-28T21:29:57.991Z","not_after":null}
HTTP/1.1 412 Precondition Failed
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a0e9ec-b03e-7c15-b96f-ebcb3e5d528b"}
HTTP/1.1 200 OK
etag: "590baab1ba6f8492799c2636f440bfbe33c9354dff4143bb4021ed47a015305e"
{"id":"01a0e9ec-b000-7842-96c3-6475d4f6e651","status":"active","kid":"01a0e9ec-afff-7ce4-8c78-95aff244235b","alg":"RS256","created_at":"2026-09-28T21:29:57.991Z","not_after":null}
```

## `DELETE /keys/:id`

Requires `manage-keys`. Deletes a retired key, which is published nowhere and
signs nothing, so nothing a relying party holds can still need it. An active
or rotating key is refused with `409`: `POST /keys/:id/retire` is the door
that checks what still depends on one. `If-Match` is optional; a stale one is
refused with `412`. Writes `key.delete`, naming the `kid`. An unknown key
answers `404`.

Against the tenth stack, a key staged with `POST /keys`
(`01a0ee8c-6b4e-7479-a229-78e90920c309`), deleted before and after it was
retired, then the keys left and the key's own trail:

```bash
K=01a0ee8c-6b4e-7479-a229-78e90920c309
curl -sS -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$P/keys/$K"; echo
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$P/keys/$K/retire"; echo
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$P/keys/$K"
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/keys"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/audit?resource_type=signing_key&resource_id=$K" \
  | python3 -c 'import json,sys;[print(json.dumps({k:i[k] for k in ("action","outcome","resource_id","detail")})) for i in json.load(sys.stdin)["items"]]'
```

```
{"type":"about:blank","title":"Conflict","status":409,"detail":"the key is rotating: only a retired key can be deleted; retire it first","instance":"01a0ee8c-6c2d-7cdf-a62c-6bec497d8f65"}
{"id":"01a0ee8c-6b4e-7479-a229-78e90920c309","status":"retired","kid":"01a0ee8c-6b4e-7479-a229-78e820c93668","alg":"RS256","created_at":"2026-09-29T19:02:55.023Z","not_after":null}
HTTP/1.1 204 No Content
x-request-id: 01a0ee8c-6c76-7042-bd64-41005d2f2b33
cache-control: no-store
Date: Tue, 29 Sep 2026 19:02:55 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a0ee8a-c3c8-750a-8d55-6ba394c1e76e","status":"active","kid":"01a0ee8a-c3c7-7eea-9175-adeee2ccc815","alg":"ES256","created_at":"2026-09-29T19:01:06.581Z","not_after":null}]}
{"action": "key.delete", "outcome": "allowed", "resource_id": "01a0ee8c-6b4e-7479-a229-78e90920c309", "detail": {"kid": "01a0ee8c-6b4e-7479-a229-78e820c93668"}}
{"action": "key.retire", "outcome": "allowed", "resource_id": "01a0ee8c-6b4e-7479-a229-78e90920c309", "detail": {}}
{"action": "key.create", "outcome": "allowed", "resource_id": "01a0ee8c-6b4e-7479-a229-78e90920c309", "detail": {}}
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

Captured against the sixth stack. `demo`'s flow as `provisionTenant`
created it — the four steps every tenant starts with — and its `ETag`:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3080/admin/tenants/demo/flow/executions
```

```
etag: "2e028692eeb04a65ef6a06be482c11d71247d243b5929007716ee0f4eb2324db"
{"items":[{"index":0,"authenticator":"passkey","requirement":"alternative"},{"index":1,"authenticator":"password","requirement":"alternative"},{"index":2,"authenticator":"otp","requirement":"conditional"},{"index":3,"authenticator":"recovery-code","requirement":"conditional"}],"available":["password","passkey","otp","recovery-code"]}
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
  http://localhost:3080/admin/tenants/demo/flow/executions
```

```
HTTP/1.1 200 OK
x-request-id: 01a0ea5e-e668-7e6c-88d0-538349671167
cache-control: no-store
etag: "c46d3990450c6fdda560192fb31bb5c43d939d3ec27ba6861173ef4c2992e589"
content-type: application/json; charset=utf-8
content-length: 257
Date: Mon, 28 Sep 2026 23:34:43 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"index":0,"authenticator":"password","requirement":"required"},{"index":1,"authenticator":"otp","requirement":"conditional"},{"index":2,"authenticator":"passkey","requirement":"disabled"}],"available":["password","passkey","otp","recovery-code"]}
```

A second `PUT` carrying that same, now stale, header changes nothing:

```
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a0ea5e-e681-711e-bad1-50fc52dc2974"}
```

`index` is the array's own order renumbered from zero, and the request
carried none. The empty list is refused ahead of the precondition, so it
answers `400` rather than `428` even with no `If-Match` sent — the shape of
the request is wrong whatever generation it is against:

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"a flow needs at least one step; a tenant with no flow cannot be logged into","instance":"01a0ea5f-7df7-7ed3-9b4f-aa651cc2bd29"}
```

The write reaches the executor immediately, not only the table: the very
next login dispatches against the order this `PUT` wrote, since
`initialChallenge`/`advance` read a tenant's executions fresh on every
attempt rather than caching them.

### The authenticators a step may name

Both answers carry `available` beside `items`: every authenticator name the
registry a login dispatches through resolves, in its own order, so a caller
offering to add a step needs no list of its own. The `ETag` covers `items`
alone — `available` is the registry's, and no write here changes it — so
the `ETag` below is the one "A refusal names its field" sent as `If-Match`
before `available` existed, on the same untouched flow. Captured against
the fifth stack in `fields-demo`:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3080/admin/tenants/fields-demo/flow/executions
```

```
HTTP/1.1 200 OK
etag: "2e028692eeb04a65ef6a06be482c11d71247d243b5929007716ee0f4eb2324db"
{"items":[{"index":0,"authenticator":"passkey","requirement":"alternative"},{"index":1,"authenticator":"password","requirement":"alternative"},{"index":2,"authenticator":"otp","requirement":"conditional"},{"index":3,"authenticator":"recovery-code","requirement":"conditional"}],"available":["password","passkey","otp","recovery-code"]}
```

## `GET /smtp`, `PUT /smtp`, `DELETE /smtp` and `POST /smtp/test`

All four require `manage-tenant`. `DELETE` removes the tenant's own row,
so its mail falls back to the deployment's `ODUDU_SMTP_*` sender and then
the log-only adapter — the one way back from a configuration `PUT` can
only replace. `204` on success, `404` when there was nothing to remove. `GET` reports `configured: false` and
`password_set: false` for a tenant with no row, rather than 404 — the
endpoint always exists, it is the configuration that may not. `PUT`
replaces the whole configuration except the password, which `GET` never
hands back for a caller to resend: omitting `password` keeps the stored
one, and `"password": null` clears it. A kept password stays with the relay
and account it was entered for — omitting it while `host`, `port` or
`username` changes is refused with `400` naming `password`, since the next
test send would otherwise authenticate to whoever runs the new host. `GET` and `PUT` also report
`effective` — whose relay the tenant's mail actually goes through: `tenant`
for its own row, `deployment` for the deployment's `ODUDU_SMTP_*` sender,
`none` when there is neither and mail is only logged. The stored
password wraps through the same envelope a signing key's private half does
(`wrapSecret`/`unwrapSecret`, `@odudu/crypto`) — the column never carries
plaintext.

Two refusals bound what may be stored and what may be dialled.

**A configuration that authenticates requires TLS.** A `username` or a
`password` — sent, or kept from the stored row — with `starttls` anything
but `true` is `400`: `secure: false`
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

`GET` and `PUT` answer an `ETag` over the configuration as they answer it.
`PUT` honours `If-Match` when it is sent, taken under a lock on the row it
replaces, and refuses a stale one with `412`; it does not require one,
since a tenant with no row has nothing another writer could have changed
under it. Captured against the sixth stack in `etags-demo`, which had no
SMTP row — the `GET`, a `PUT` with an `If-Match` that matches nothing,
and the same `PUT` under the `GET`'s own:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3080/admin/tenants/etags-demo/smtp
curl -sS -D - -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -H 'If-Match: "0000"' \
  -d '{"host":"smtp.example.test","port":587,"from_address":"noreply@etags.example"}' \
  http://localhost:3080/admin/tenants/etags-demo/smtp
curl -sS -D - -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -H 'If-Match: "eb513a27e14a9d51bb5c40764b9054c6c4b4ff6de3ce14b3eb4cf4745589d891"' \
  -d '{"host":"smtp.example.test","port":587,"from_address":"noreply@etags.example"}' \
  http://localhost:3080/admin/tenants/etags-demo/smtp
```

```
HTTP/1.1 200 OK
etag: "eb513a27e14a9d51bb5c40764b9054c6c4b4ff6de3ce14b3eb4cf4745589d891"
{"configured":false,"host":null,"port":null,"from_address":null,"username":null,"password_set":false,"starttls":null,"effective":"none"}
HTTP/1.1 412 Precondition Failed
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a0ea60-0a48-75a8-a2e6-34274b488d20"}
HTTP/1.1 200 OK
etag: "f9ba93780f589e0cc3b6f2606f67d0d7b01c5a2ed5d04880f94052f64d4e1d80"
{"configured":true,"host":"smtp.example.test","port":587,"from_address":"noreply@etags.example","username":null,"password_set":false,"starttls":false,"effective":"tenant"}
```

Resolution order when this tenant's mail is actually sent
(`apps/server/src/email.ts`'s `resolveSender`): this row first, then the
deployment's own `ODUDU_SMTP_*` sender, then the log-only adapter. ADR
0015 is unaffected — it governs where a deployment's own credentials live,
and this is a credential the deployment itself never holds.

The transcripts below were captured against the sixth stack, whose `demo`
had no SMTP row until this section's `PUT`s.

```bash
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"host": "smtp.example.test", "port": 587, "from_address": "noreply@demo.example", "password": "hunter2"}' \
  http://localhost:3080/admin/tenants/demo/smtp
```

`GET` before that `PUT`, then the `PUT`'s own answer. The unconfigured read
is `200` with every field `null`, not `404`; the `PUT` is refused, because
it carries a password and does not ask for TLS:

```
{"configured":false,"host":null,"port":null,"from_address":null,"username":null,"password_set":false,"starttls":null,"effective":"none"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"starttls must be true when a username or password is configured","errors":[{"path":"starttls","message":"must be true when a username or password is configured"}],"instance":"01a0ea60-0a9a-74fe-9c48-4efba484a5eb"}
```

The same body with `"starttls": true`, then `GET` again:

```
{"configured":true,"host":"smtp.example.test","port":587,"from_address":"noreply@demo.example","username":null,"password_set":true,"starttls":true,"effective":"tenant"}
{"configured":true,"host":"smtp.example.test","port":587,"from_address":"noreply@demo.example","username":null,"password_set":true,"starttls":true,"effective":"tenant"}
```

`password_set` is how the password is reported; the value itself is never
in any of these.

### A kept password

Captured against the sixth stack, in a tenant `smtp-keep-demo` created
for it with no row: the `GET`; a `PUT` with a password; a `PUT` changing
only `from_address` and leaving `password` out, which keeps it; the same
with `starttls` off, refused for the password it would keep; a `PUT`
moving the host and leaving `password` out, refused naming `password`; and
a `PUT` sending `"password": null` without a `username`, which clears it.
None of these shows `deployment`: this stack sets no `ODUDU_SMTP_HOST`, so
a tenant with no row is on `none`.

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3080/admin/tenants/smtp-keep-demo/smtp
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"host":"smtp.example.test","port":587,"from_address":"noreply@keep.example","username":"mailer","password":"hunter2","starttls":true}' \
  http://localhost:3080/admin/tenants/smtp-keep-demo/smtp
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"host":"smtp.example.test","port":587,"from_address":"alerts@keep.example","username":"mailer","starttls":true}' \
  http://localhost:3080/admin/tenants/smtp-keep-demo/smtp
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"host":"smtp.example.test","port":587,"from_address":"alerts@keep.example","username":"mailer","starttls":false}' \
  http://localhost:3080/admin/tenants/smtp-keep-demo/smtp
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"host":"relay.elsewhere.example","port":587,"from_address":"alerts@keep.example","username":"mailer","starttls":true}' \
  http://localhost:3080/admin/tenants/smtp-keep-demo/smtp
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"host":"smtp.example.test","port":587,"from_address":"alerts@keep.example","password":null}' \
  http://localhost:3080/admin/tenants/smtp-keep-demo/smtp
```

```
{"configured":false,"host":null,"port":null,"from_address":null,"username":null,"password_set":false,"starttls":null,"effective":"none"}
{"configured":true,"host":"smtp.example.test","port":587,"from_address":"noreply@keep.example","username":"mailer","password_set":true,"starttls":true,"effective":"tenant"}
{"configured":true,"host":"smtp.example.test","port":587,"from_address":"alerts@keep.example","username":"mailer","password_set":true,"starttls":true,"effective":"tenant"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"starttls must be true when a username or password is configured","errors":[{"path":"starttls","message":"must be true when a username or password is configured"}],"instance":"01a0ea60-3e66-7f14-9ce6-838c942d3084"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"password must be sent again when host, port or username changes","errors":[{"path":"password","message":"must be sent again when host, port or username changes"}],"instance":"01a0ea60-3e7a-7ef9-a02e-531e6b7e4326"}
{"configured":true,"host":"smtp.example.test","port":587,"from_address":"alerts@keep.example","username":null,"password_set":false,"starttls":false,"effective":"tenant"}
```

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
  http://localhost:3080/admin/tenants/demo/smtp/test
```

Against `demo` before it had a row, then against the `smtp.example.test`
row the `PUT` above stored, then after its `host` was re-`PUT` as
`127.0.0.1`, with the password sent again as a changed host requires — the
probe this endpoint would otherwise be:

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"this tenant has no SMTP configuration","instance":"01a0ea60-0a74-7100-90b4-6e49dcb91251"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"this server will not connect to smtp.example.test: it resolves to no address","instance":"01a0ea60-0ad1-7952-b75a-bc336444b582"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"this server will not connect to 127.0.0.1: address 127.0.0.1 is a loopback address","instance":"01a0ea60-0b2b-7f39-b3aa-85c093b26882"}
```

No `502` is shown: this stack has no mail server and no host it is willing
to dial, so nothing here reaches a transport for one to be reported from.

`DELETE`, captured against the sixth stack in a tenant `smtp-delete-demo`
created for it with no row, then after a `PUT` had stored one. `404` first,
`204` second, and a `GET` afterwards showing the tenant back on the
deployment's own sender — `none` here, since this stack has none:

```bash
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3080/admin/tenants/smtp-delete-demo/smtp

curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"host": "smtp.example.test", "port": 587, "from_address": "noreply@demo.example"}' \
  http://localhost:3080/admin/tenants/smtp-delete-demo/smtp

curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3080/admin/tenants/smtp-delete-demo/smtp

curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3080/admin/tenants/smtp-delete-demo/smtp
```

```
HTTP/1.1 404 Not Found
x-request-id: 01a0ea60-3ea1-7d44-8d33-cb1d7be0cf91
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 154
Date: Mon, 28 Sep 2026 23:36:11 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Not Found","status":404,"detail":"this tenant has no SMTP configuration","instance":"01a0ea60-3ea1-7d44-8d33-cb1d7be0cf91"}
{"configured":true,"host":"smtp.example.test","port":587,"from_address":"noreply@demo.example","username":null,"password_set":false,"starttls":false,"effective":"tenant"}

HTTP/1.1 204 No Content
x-request-id: 01a0ea60-3ecb-7f6f-9a7d-400d877a394e
cache-control: no-store
Date: Mon, 28 Sep 2026 23:36:11 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"configured":false,"host":null,"port":null,"from_address":null,"username":null,"password_set":false,"starttls":null,"effective":"none"}
```

## `GET /mail`

Requires `manage-tenant`, the capability SMTP is configured with. The tenant's
outgoing mail, most recent first and cursored: `queued`, not yet tried;
`retrying`, failed and to be offered again; `sent`; or `failed`, every attempt
the sender makes spent (`ODUDU_OUTBOX_MAX_ATTEMPTS`) — with its subject line,
attempts, the relay's last error and when it is next due. Never the body: it
carries the link a recipient signs in with. `?status=` narrows it.

The recipient is a subject's address, which reading takes `view-users`
everywhere else, so a caller without `view-users` sees it masked — its first
character and its domain — wherever it appears, with `to_masked` true. A
relay's error quoting it back is masked too, matched without regard to case
and as a whole address, so `<Grace@Navy.Example>` is masked as surely as the
address as stored, and so is its local part followed by `@` on its own. `manage-tenant` alone says that mail went
and whether it failed, not to whom.

Against the tenth stack, after the two links above were queued: one pass of the
sender, run by hand, which the relay at `postgres:25` refuses; the outbox as
`$ADMIN_TOKEN` reads it; then as `mona`, signed in to the tenant's own admin
client (`$MONA_TOKEN`):

```bash
docker compose exec -T odudu node dist/main.js send-mail 2>/dev/null
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/mail"; echo
curl -sS -H "Authorization: Bearer $MONA_TOKEN" "$P/whoami"; echo
curl -sS -H "Authorization: Bearer $MONA_TOKEN" "$P/mail?status=retrying"; echo
```

```
{"level":30,"time":1790708573691,"pid":404,"hostname":"1dd2b3990a77","msg":"ODUDU_SMTP_HOST is unset; capturing outgoing mail instead of sending it"}
{"level":40,"time":1790708573757,"pid":404,"hostname":"1dd2b3990a77","err":{"type":"Error","message":"connect ECONNREFUSED 172.22.0.2:25","stack":"Error: connect ECONNREFUSED 172.22.0.2:25\n    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:2021:16)","errno":-111,"code":"ESOCKET","syscall":"connect","address":"172.22.0.2","port":25,"command":"CONN"},"messageId":"01a0ee8c-62a9-7880-8d8c-61381391ed4a","attempts":1,"msg":"outbox message failed and will be retried"}
{"level":40,"time":1790708573761,"pid":404,"hostname":"1dd2b3990a77","err":{"type":"Error","message":"connect ECONNREFUSED 172.22.0.2:25","stack":"Error: connect ECONNREFUSED 172.22.0.2:25\n    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:2021:16)","errno":-111,"code":"ESOCKET","syscall":"connect","address":"172.22.0.2","port":25,"command":"CONN"},"messageId":"01a0ee8c-62cf-7422-b5a9-7220bfeef117","attempts":1,"msg":"outbox message failed and will be retried"}
{"ran":true,"sent":0,"failed":2}
{"items":[{"id":"01a0ee8c-62cf-7422-b5a9-7220bfeef117","to":"grace@navy.example","to_masked":false,"subject":"Verify your ops-demo account","status":"retrying","attempts":1,"last_error":"connect ECONNREFUSED 172.22.0.2:25","created_at":"2026-09-29T19:02:52.872Z","next_attempt_at":"2026-09-29T19:03:53.692Z","sent_at":null},{"id":"01a0ee8c-62a9-7880-8d8c-61381391ed4a","to":"grace@navy.example","to_masked":false,"subject":"Reset your ops-demo password","status":"retrying","attempts":1,"last_error":"connect ECONNREFUSED 172.22.0.2:25","created_at":"2026-09-29T19:02:52.832Z","next_attempt_at":"2026-09-29T19:03:53.692Z","sent_at":null}]}
{"subjectId":"01a0ee8a-c8f6-7450-b486-861a66a87684","issuerTenantId":"01a0ee8a-c394-7b49-942b-3dea70a962e7","capabilities":["manage-tenant"],"crossTenant":false}
{"items":[{"id":"01a0ee8c-62cf-7422-b5a9-7220bfeef117","to":"g***@navy.example","to_masked":true,"subject":"Verify your ops-demo account","status":"retrying","attempts":1,"last_error":"connect ECONNREFUSED 172.22.0.2:25","created_at":"2026-09-29T19:02:52.872Z","next_attempt_at":"2026-09-29T19:03:53.692Z","sent_at":null},{"id":"01a0ee8c-62a9-7880-8d8c-61381391ed4a","to":"g***@navy.example","to_masked":true,"subject":"Reset your ops-demo password","status":"retrying","attempts":1,"last_error":"connect ECONNREFUSED 172.22.0.2:25","created_at":"2026-09-29T19:02:52.832Z","next_attempt_at":"2026-09-29T19:03:53.692Z","sent_at":null}]}
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

**Which event types are stored is the tenant's `audit_event_types`
setting**, a list drawn from the six types `?event_type=` filters on, every
one by default. `PATCH /settings` takes it as an array (and
`odudu seed tenant --set audit_event_types=…` comma-separated), and it is
answered in the order the types are listed here: `admin_mutation`,
`admin_access`, `authentication`, `session`, `token`, `credential`. The
audit writer (`auditRepository`, `packages/domain-audit/src/repository/audit.ts`)
reads it in the transaction that writes each row, so **a change applies from
the moment it is saved**, to the next event on, and **it never deletes a row
already stored** — those stay until `audit_retention_days` takes them.
`admin_mutation` and `admin_access` are always stored: a value leaving
either out is refused with `400`, the error naming `audit_event_types`, and
a CHECK on the column refuses it again underneath. A security trail an
attacker holding an administrator's token could switch off is no trail.

Against the twelfth stack, in a tenant `audit-types-demo` made for it with
`ivy` seeded there by `odudu seed user`, so its trail holds nothing else:
`ivy` signs in once through the tenant's `odudu-admin` client (the
sign-in "Getting the token" shows), the counts of three types are read,
`authentication` and `session` are left out — named in another order, and
answered in the listed one — a value leaving out `admin_mutation` is
refused, `ivy` signs in again, and the counts are read again. The new
sign-in wrote its `token` row and nothing of the two types left out, and
the rows already stored are still there:

```bash
for t in authentication session token; do
  echo "$t $(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/audit/count?event_type=$t")"
done
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"audit_event_types":["token","admin_access","admin_mutation","credential"]}' \
  "$P/settings" | jq -c '{audit_event_types}'
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"audit_event_types":["admin_access","token"]}' "$P/settings"; echo
```

`$P` is `http://localhost:3082/admin/tenants/audit-types-demo`, and the
`for` loop ran once before the two `PATCH`es and once after the second
sign-in:

```
authentication {"count":1,"capped":false}
session {"count":1,"capped":false}
token {"count":1,"capped":false}
{"audit_event_types":["admin_mutation","admin_access","token","credential"]}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"1 tenant setting(s) outside the permitted range, listed under errors","errors":[{"path":"audit_event_types","message":"must include admin_mutation and admin_access, which can never be turned off; admin_mutation is missing"}],"instance":"01a109c0-9b94-7272-b44f-a67c82329648"}
authentication {"count":1,"capped":false}
session {"count":1,"capped":false}
token {"count":2,"capped":false}
```

**Each row names its actor when it is read**, beside the ids it stores:
`actor_name` is a user's username, or the `client_id` whose service account
the actor is, resolved within the row's own tenant at read time and never
written with the row — so the trail stays append-only, and a deleted
subject's name leaves with it, `null` from then on. `actor_origin` says where
the actor came from: `tenant`, this tenant; `system`, a system administrator
acting across tenants; `other-tenant`, the subject of a foreign token
refused at the door. A name is never resolved outside the row's tenant: an
auditor of a tenant reads no other tenant's subjects anywhere else, so a
system administrator appears as `system` with the id alone, and a system
auditor reads that name in `system`'s own trail. A name is a username,
which reading takes `view-users` everywhere else, so a caller holding
`view-audit` without it reads `actor_name` as `null` on every row, with
`actor_origin` still set — the same rule that masks a recipient under
`GET /mail`. `GET /clients/:id/evaluate` and `DELETE /sessions` above show a
`system` and a `tenant` actor, and `GET /audit/export` below a deleted one.
The older transcripts of this listing in this document and in
[docs/request-paths.md](request-paths.md) were recaptured against the tenth
stack once the two fields were added, each saying so where it appears; those
in [docs/console-paths.md](console-paths.md) say at the block that they
predate them.

Against the tenth stack, `ivy`, seeded in `ops-demo` with `odudu seed user`
and granted `odudu-admin:view-audit` alone (`$IVY_TOKEN`), reads the row
`DELETE /sessions` above left, then `$ADMIN_TOKEN` reads the same row:

```bash
curl -sS -H "Authorization: Bearer $IVY_TOKEN" "$P/whoami"; echo
curl -sS -H "Authorization: Bearer $IVY_TOKEN" "$P/audit?action=session.end_all&limit=1"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/audit?action=session.end_all&limit=1"; echo
```

```
{"subjectId":"01a0eea2-0572-77d8-b198-1cd4eae2caff","issuerTenantId":"01a0ee8a-c394-7b49-942b-3dea70a962e7","capabilities":["view-audit"],"crossTenant":false}
{"items":[{"id":"01a0ee8c-5548-7fd9-8179-8d3d1320b981","occurred_at":"2026-09-29T19:02:49.371Z","event_type":"admin_mutation","action":"session.end_all","outcome":"allowed","actor_tenant_id":"01a0ee8a-c394-7b49-942b-3dea70a962e7","actor_subject_id":"01a0ee8a-ca97-7a85-b36d-e23f6a8ae2d3","actor_client_id":"01a0ee8a-c3a0-7429-ab4a-4ecef6baf694","actor_name":null,"actor_origin":"tenant","resource_type":"tenant","resource_id":"01a0ee8a-c394-7b49-942b-3dea70a962e7","request_id":"01a0ee8c-550b-776a-8847-5fcfd763a5d1","ip":"172.22.0.1","detail":{"ended":4,"remaining":0,"beyond_ceiling":1}}]}
{"items":[{"id":"01a0ee8c-5548-7fd9-8179-8d3d1320b981","occurred_at":"2026-09-29T19:02:49.371Z","event_type":"admin_mutation","action":"session.end_all","outcome":"allowed","actor_tenant_id":"01a0ee8a-c394-7b49-942b-3dea70a962e7","actor_subject_id":"01a0ee8a-ca97-7a85-b36d-e23f6a8ae2d3","actor_client_id":"01a0ee8a-c3a0-7429-ab4a-4ecef6baf694","actor_name":"sam","actor_origin":"tenant","resource_type":"tenant","resource_id":"01a0ee8a-c394-7b49-942b-3dea70a962e7","request_id":"01a0ee8c-550b-776a-8847-5fcfd763a5d1","ip":"172.22.0.1","detail":{"ended":4,"remaining":0,"beyond_ceiling":1}}]}
```

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

Recaptured against the twelfth stack, once a client's diff carried the
fields `0084` to `0086` added, after the same writes were made in a tenant
`audit-demo` created there for them — `demo-backend` with a `jwks`,
`demo-app`, the reserved `client_id` refused, then a key staged, promoted
and the old one retired — so the ids below are that run's, not the third
stack's, and the actor is `ada-t8c2`. `actor_origin` is
`system` on every row, and `actor_name` `null`, a system administrator
being named only in `system`'s own trail:

```bash
curl -sS -G \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  --data-urlencode "resource_type=client" \
  --data-urlencode "action=client.create" \
  --data-urlencode "limit=20" \
  http://localhost:3082/admin/tenants/audit-demo/audit; echo
```

All three `client.create` rows on this stack, newest first: the
reserved-`client_id` refusal, attempted last, then `demo-app` and
`demo-backend` below it — both created directly through `POST /clients`,
oldest last:

```
{"items":[{"id":"01a109b8-77c8-7c97-8aa7-deac1a7668cf","occurred_at":"2026-10-05T01:40:46.664Z","event_type":"admin_mutation","action":"client.create","outcome":"refused","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a109b4-0995-7d14-bb7f-6176df2e4d18","actor_client_id":"01a109b4-095b-7501-8dea-df1b55815aaf","actor_name":null,"actor_origin":"system","resource_type":"client","resource_id":"odudu-admin","request_id":"01a109b8-77be-7a55-a1e9-0d79829206cc","ip":"172.22.0.1","detail":{}},{"id":"01a109b8-77af-76a9-af36-20575e2d2b9c","occurred_at":"2026-10-05T01:40:46.628Z","event_type":"admin_mutation","action":"client.create","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a109b4-0995-7d14-bb7f-6176df2e4d18","actor_client_id":"01a109b4-095b-7501-8dea-df1b55815aaf","actor_name":null,"actor_origin":"system","resource_type":"client","resource_id":"01a109b8-77a5-71da-a011-fbe99903f2b4","request_id":"01a109b8-7799-7eb6-920d-379e0a60f39b","ip":"172.22.0.1","detail":{"jwks":{"changed":true},"name":{"after":"demo-app"},"type":{"after":"public"},"enabled":{"after":true},"tos_uri":{"after":null},"jwks_uri":{"after":null},"audiences":{"after":[]},"client_uri":{"after":null},"policy_uri":{"after":null},"description":{"after":null},"grant_types":{"after":["authorization_code"]},"web_origins":{"after":[]},"redirect_uris":{"after":["https://app.example/callback"]},"default_max_age":{"after":null},"require_auth_time":{"after":false},"full_scope_allowed":{"after":false},"id_token_ttl_seconds":{"after":null},"backchannel_logout_uri":{"after":null},"frontchannel_logout_uri":{"after":null},"access_token_ttl_seconds":{"after":null},"client_credentials_scopes":{"after":[]},"post_logout_redirect_uris":{"after":[]},"refresh_token_ttl_seconds":{"after":null},"token_endpoint_auth_method":{"after":"none"},"id_token_signed_response_alg":{"after":null}}},{"id":"01a109b8-7782-77bc-9ca1-9d946717fefc","occurred_at":"2026-10-05T01:40:46.472Z","event_type":"admin_mutation","action":"client.create","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a109b4-0995-7d14-bb7f-6176df2e4d18","actor_client_id":"01a109b4-095b-7501-8dea-df1b55815aaf","actor_name":null,"actor_origin":"system","resource_type":"client","resource_id":"01a109b8-7778-7d05-a7d7-4bc8c614b862","request_id":"01a109b8-76fd-7d6d-a3a0-2473f5d37820","ip":"172.22.0.1","detail":{"jwks":{"changed":true},"name":{"after":"demo-backend"},"type":{"after":"confidential"},"enabled":{"after":true},"tos_uri":{"after":null},"jwks_uri":{"after":null},"audiences":{"after":[]},"client_uri":{"after":null},"policy_uri":{"after":null},"description":{"after":null},"grant_types":{"after":["client_credentials"]},"web_origins":{"after":[]},"redirect_uris":{"after":[]},"default_max_age":{"after":null},"require_auth_time":{"after":false},"full_scope_allowed":{"after":false},"id_token_ttl_seconds":{"after":null},"backchannel_logout_uri":{"after":null},"frontchannel_logout_uri":{"after":null},"access_token_ttl_seconds":{"after":null},"client_credentials_scopes":{"after":[]},"post_logout_redirect_uris":{"after":[]},"refresh_token_ttl_seconds":{"after":null},"token_endpoint_auth_method":{"after":"private_key_jwt"},"id_token_signed_response_alg":{"after":null}}}]}
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

```bash
curl -sS -G -H "Authorization: Bearer $ADMIN_TOKEN" \
  --data-urlencode "resource_type=signing_key" \
  http://localhost:3082/admin/tenants/audit-demo/audit; echo
```

```
{"items":[{"id":"01a109b8-785d-7bf7-bcdf-19fb0836e064","occurred_at":"2026-10-05T01:40:46.807Z","event_type":"admin_mutation","action":"key.retire","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a109b4-0995-7d14-bb7f-6176df2e4d18","actor_client_id":"01a109b4-095b-7501-8dea-df1b55815aaf","actor_name":null,"actor_origin":"system","resource_type":"signing_key","resource_id":"01a109b8-76ec-74e6-a029-ecff623b8d80","request_id":"01a109b8-784f-7cab-88a6-10b1d5eb21c1","ip":"172.22.0.1","detail":{}},{"id":"01a109b8-7845-7d5b-bf6f-c7d2895629e6","occurred_at":"2026-10-05T01:40:46.786Z","event_type":"admin_mutation","action":"key.promote","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a109b4-0995-7d14-bb7f-6176df2e4d18","actor_client_id":"01a109b4-095b-7501-8dea-df1b55815aaf","actor_name":null,"actor_origin":"system","resource_type":"signing_key","resource_id":"01a109b8-7825-7a6a-a1c9-43a7595d4817","request_id":"01a109b8-7839-7840-bd5d-b935524f7cea","ip":"172.22.0.1","detail":{}},{"id":"01a109b8-7827-7d57-9cfe-16ca0fb3b8c7","occurred_at":"2026-10-05T01:40:46.710Z","event_type":"admin_mutation","action":"key.create","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a109b4-0995-7d14-bb7f-6176df2e4d18","actor_client_id":"01a109b4-095b-7501-8dea-df1b55815aaf","actor_name":null,"actor_origin":"system","resource_type":"signing_key","resource_id":"01a109b8-7825-7a6a-a1c9-43a7595d4817","request_id":"01a109b8-77eb-7a5d-86bd-2648f8c75b2a","ip":"172.22.0.1","detail":{}}]}
```

And `?outcome=refused`, non-empty for `POST /clients`: the same
reserved-`client_id` row shown above, on its own —
`resource_id` is the `client_id` string, there being no row to name:

```bash
curl -sS -G -H "Authorization: Bearer $ADMIN_TOKEN" \
  --data-urlencode "resource_type=client" \
  --data-urlencode "outcome=refused" \
  http://localhost:3082/admin/tenants/audit-demo/audit; echo
```

```
{"items":[{"id":"01a109b8-77c8-7c97-8aa7-deac1a7668cf","occurred_at":"2026-10-05T01:40:46.664Z","event_type":"admin_mutation","action":"client.create","outcome":"refused","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a109b4-0995-7d14-bb7f-6176df2e4d18","actor_client_id":"01a109b4-095b-7501-8dea-df1b55815aaf","actor_name":null,"actor_origin":"system","resource_type":"client","resource_id":"odudu-admin","request_id":"01a109b8-77be-7a55-a1e9-0d79829206cc","ip":"172.22.0.1","detail":{}}]}
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
  http://localhost:3082/admin/tenants/audit-demo/audit; echo
```

```
{"items":[{"id":"01a109b8-77c8-7c97-8aa7-deac1a7668cf","occurred_at":"2026-10-05T01:40:46.664Z","event_type":"admin_mutation","action":"client.create","outcome":"refused","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a109b4-0995-7d14-bb7f-6176df2e4d18","actor_client_id":"01a109b4-095b-7501-8dea-df1b55815aaf","actor_name":null,"actor_origin":"system","resource_type":"client","resource_id":"odudu-admin","request_id":"01a109b8-77be-7a55-a1e9-0d79829206cc","ip":"172.22.0.1","detail":{}},{"id":"01a109b8-77af-76a9-af36-20575e2d2b9c","occurred_at":"2026-10-05T01:40:46.628Z","event_type":"admin_mutation","action":"client.create","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a109b4-0995-7d14-bb7f-6176df2e4d18","actor_client_id":"01a109b4-095b-7501-8dea-df1b55815aaf","actor_name":null,"actor_origin":"system","resource_type":"client","resource_id":"01a109b8-77a5-71da-a011-fbe99903f2b4","request_id":"01a109b8-7799-7eb6-920d-379e0a60f39b","ip":"172.22.0.1","detail":{"jwks":{"changed":true},"name":{"after":"demo-app"},"type":{"after":"public"},"enabled":{"after":true},"tos_uri":{"after":null},"jwks_uri":{"after":null},"audiences":{"after":[]},"client_uri":{"after":null},"policy_uri":{"after":null},"description":{"after":null},"grant_types":{"after":["authorization_code"]},"web_origins":{"after":[]},"redirect_uris":{"after":["https://app.example/callback"]},"default_max_age":{"after":null},"require_auth_time":{"after":false},"full_scope_allowed":{"after":false},"id_token_ttl_seconds":{"after":null},"backchannel_logout_uri":{"after":null},"frontchannel_logout_uri":{"after":null},"access_token_ttl_seconds":{"after":null},"client_credentials_scopes":{"after":[]},"post_logout_redirect_uris":{"after":[]},"refresh_token_ttl_seconds":{"after":null},"token_endpoint_auth_method":{"after":"none"},"id_token_signed_response_alg":{"after":null}}},{"id":"01a109b8-7782-77bc-9ca1-9d946717fefc","occurred_at":"2026-10-05T01:40:46.472Z","event_type":"admin_mutation","action":"client.create","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a109b4-0995-7d14-bb7f-6176df2e4d18","actor_client_id":"01a109b4-095b-7501-8dea-df1b55815aaf","actor_name":null,"actor_origin":"system","resource_type":"client","resource_id":"01a109b8-7778-7d05-a7d7-4bc8c614b862","request_id":"01a109b8-76fd-7d6d-a3a0-2473f5d37820","ip":"172.22.0.1","detail":{"jwks":{"changed":true},"name":{"after":"demo-backend"},"type":{"after":"confidential"},"enabled":{"after":true},"tos_uri":{"after":null},"jwks_uri":{"after":null},"audiences":{"after":[]},"client_uri":{"after":null},"policy_uri":{"after":null},"description":{"after":null},"grant_types":{"after":["client_credentials"]},"web_origins":{"after":[]},"redirect_uris":{"after":[]},"default_max_age":{"after":null},"require_auth_time":{"after":false},"full_scope_allowed":{"after":false},"id_token_ttl_seconds":{"after":null},"backchannel_logout_uri":{"after":null},"frontchannel_logout_uri":{"after":null},"access_token_ttl_seconds":{"after":null},"client_credentials_scopes":{"after":[]},"post_logout_redirect_uris":{"after":[]},"refresh_token_ttl_seconds":{"after":null},"token_endpoint_auth_method":{"after":"private_key_jwt"},"id_token_signed_response_alg":{"after":null}}}]}
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

Captured against the sixth stack's `demo`:

```bash
curl -sS -G -H "Authorization: Bearer $ADMIN_TOKEN" \
  --data-urlencode "event_type=bogus" \
  http://localhost:3080/admin/tenants/demo/audit
```

```
{"type":"about:blank","title":"Error","status":400,"detail":"querystring/event_type must be equal to one of the allowed values","errors":[{"path":"event_type","message":"must be equal to one of the allowed values"}],"instance":"01a0ea61-337e-7cec-8b3c-06ea3a078323"}
```

`resource_id` narrows further, and requires `resource_type` alongside it —
captured on the same third stack, rebuilt for this branch, with a fresh
system-tenant admin (`resource-doc`) and a tenant created only for this
subsection, `resource-audit-1790486559`, so its trail holds nothing but
what it did: two clients, `resource-doc-a` and `resource-doc-b`.

Recaptured against the twelfth stack in a tenant `resource-audit`, created
there with the same two clients by `ada-t8c2`, so the id is that run's:

```bash
curl -sS -G -H "Authorization: Bearer $ADMIN_TOKEN" \
  --data-urlencode "resource_type=client" \
  --data-urlencode "resource_id=01a109b8-7923-7e91-a66b-30136311418b" \
  http://localhost:3082/admin/tenants/resource-audit/audit; echo
```

Only `resource-doc-a`'s own row, not `resource-doc-b`'s:

```
{"items":[{"id":"01a109b8-792c-70bc-a0df-1cb04897ed0a","occurred_at":"2026-10-05T01:40:46.984Z","event_type":"admin_mutation","action":"client.create","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a109b4-0995-7d14-bb7f-6176df2e4d18","actor_client_id":"01a109b4-095b-7501-8dea-df1b55815aaf","actor_name":null,"actor_origin":"system","resource_type":"client","resource_id":"01a109b8-7923-7e91-a66b-30136311418b","request_id":"01a109b8-78ff-7c5c-89ef-851e27a0902e","ip":"172.22.0.1","detail":{"jwks":{"changed":true},"name":{"after":"resource-doc-a"},"type":{"after":"confidential"},"enabled":{"after":true},"tos_uri":{"after":null},"jwks_uri":{"after":null},"audiences":{"after":[]},"client_uri":{"after":null},"policy_uri":{"after":null},"description":{"after":null},"grant_types":{"after":["client_credentials"]},"web_origins":{"after":[]},"redirect_uris":{"after":[]},"default_max_age":{"after":null},"require_auth_time":{"after":false},"full_scope_allowed":{"after":false},"id_token_ttl_seconds":{"after":null},"backchannel_logout_uri":{"after":null},"frontchannel_logout_uri":{"after":null},"access_token_ttl_seconds":{"after":null},"client_credentials_scopes":{"after":[]},"post_logout_redirect_uris":{"after":[]},"refresh_token_ttl_seconds":{"after":null},"token_endpoint_auth_method":{"after":"client_secret_basic"},"id_token_signed_response_alg":{"after":null}}}]}
```

`resource_id` alone, with no `resource_type`, is refused — a client, a
role and a group could all happen to share this id, so which table it
names is not optional:

Captured against the sixth stack's `demo`, the id no row there names — the
refusal is of the query's shape, before any row is read:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/demo/audit?resource_id=01a0e150-b9ec-70a9-8e34-663280fa0514"
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"resource_id requires resource_type","errors":[{"path":"resource_id","message":"resource_id requires resource_type"}],"instance":"01a0ea61-338a-77a5-9e7b-5e0b1470f049"}
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
than minting fresh ones — and there is no way to clear an append-only
audit trail from the admin API. So the two blocks below were recaptured on
a stack where neither tenant's trail held anything yet, which is the one
way to reproduce the state the prose describes.)_

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

Recaptured against the tenth stack, once each row answered `actor_name` and
`actor_origin`, after the same requests were made there — `acme` created,
`demo-operator` created in its `demo` with the admin audience and no
capability, and its token presented at `acme` once — so the ids are that
run's, not the fourth stack's:

```bash
curl -sS -G -H "Authorization: Bearer $ADMIN_TOKEN" \
  --data-urlencode "event_type=admin_access" \
  http://localhost:3082/admin/tenants/acme/audit; echo
curl -sS -G -H "Authorization: Bearer $ADMIN_TOKEN" \
  --data-urlencode "event_type=admin_access" \
  http://localhost:3082/admin/tenants/demo/audit; echo
```

```
{"items":[{"id":"01a0ee96-113f-7bf0-a878-7fbd1bb8cb47","occurred_at":"2026-09-29T19:13:27.357Z","event_type":"admin_access","action":"token.foreign_issuer","outcome":"refused","actor_tenant_id":"01a0ee8f-032e-718b-b030-be2b154a9e99","actor_subject_id":"01a0ee96-104f-7c7f-b3da-d7049248b038","actor_client_id":"01a0ee96-1084-772b-b51a-848699f7a2e1","actor_name":null,"actor_origin":"other-tenant","resource_type":null,"resource_id":null,"request_id":"foreign-issuer-doc","ip":"172.22.0.1","detail":{"reason":"foreign_issuer"}}]}
{"items":[]}
```

The same token at `demo`, where it authenticates but holds no capability,
is a `403`, and `demo`'s trail now has the `capability.refused` row naming
what `GET /subjects` needed:

Recaptured against the tenth stack the same way, straight after the block
above:

```bash
curl -sS -D - -H "Authorization: Bearer $DEMO_TOKEN" \
  -H 'x-request-id: capability-refused-doc' \
  http://localhost:3082/admin/tenants/demo/subjects; echo
curl -sS -G -H "Authorization: Bearer $ADMIN_TOKEN" \
  --data-urlencode "event_type=admin_access" \
  http://localhost:3082/admin/tenants/demo/audit; echo
```

```
HTTP/1.1 403 Forbidden
x-request-id: capability-refused-doc
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 91
Date: Tue, 29 Sep 2026 19:13:28 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Forbidden","status":403,"instance":"capability-refused-doc"}
{"items":[{"id":"01a0ee96-1551-7830-a44f-fd26a2050e16","occurred_at":"2026-09-29T19:13:28.400Z","event_type":"admin_access","action":"capability.refused","outcome":"refused","actor_tenant_id":"01a0ee8f-032e-718b-b030-be2b154a9e99","actor_subject_id":"01a0ee96-104f-7c7f-b3da-d7049248b038","actor_client_id":"01a0ee96-1084-772b-b51a-848699f7a2e1","actor_name":"demo-operator","actor_origin":"tenant","resource_type":null,"resource_id":null,"request_id":"capability-refused-doc","ip":"172.22.0.1","detail":{"reason":"missing_capability","capability":"view-users"}}]}
```

## `GET /audit/count` and `GET /audit/export`

Requires `view-audit`. Both take `GET /audit`'s filters, and the same refusals
of them. `/count` answers how many rows the listing would page through, capped
like every other count. `/export` answers every row the listing would, newest
first, as NDJSON (`application/x-ndjson`), one `GET /audit` item per line —
or, past 10,000 rows, refuses the whole export with `413`
(`about:blank#export-too-large`) rather than cut it short, which would read as
the whole trail. Each export is itself audited as `audit.export`, since it
hands the trail over in bulk.

Against the tenth stack, the two rows `POST /subjects/bulk` left under
`uma`'s name; then `uma` deleted, and the same export again:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/audit/count?action=subject.amend"; echo
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" "$P/audit/export?action=subject.amend"
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/subjects/01a0ee8a-cc42-7dc9-a0bd-7fcd5dc9c35e"
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/audit/export?action=subject.amend"
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/audit/count?action=audit.export"; echo
```

```
{"count":2,"capped":false}
HTTP/1.1 200 OK
x-request-id: 01a0ee8c-6e3f-75fe-8e8e-20a87f45ac41
cache-control: no-store
content-type: application/x-ndjson; charset=utf-8
content-length: 1141
Date: Tue, 29 Sep 2026 19:02:55 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a0ee8c-69d4-7064-bae0-23af3f0d9bf6","occurred_at":"2026-09-29T19:02:54.671Z","event_type":"admin_mutation","action":"subject.amend","outcome":"refused","actor_tenant_id":"01a0ee8a-c394-7b49-942b-3dea70a962e7","actor_subject_id":"01a0ee8a-cc42-7dc9-a0bd-7fcd5dc9c35e","actor_client_id":"01a0ee8a-c3a0-7429-ab4a-4ecef6baf694","actor_name":"uma","actor_origin":"tenant","resource_type":"subject","resource_id":"01a0ee8a-c8f6-7450-b486-861a66a87684","request_id":"01a0ee8c-69b5-7e9b-a23c-621c22a3eb69","ip":"172.22.0.1","detail":{"denied":["manage-tenant"]}}
{"id":"01a0ee8c-69ce-7674-a090-e64e603e8a49","occurred_at":"2026-09-29T19:02:54.658Z","event_type":"admin_mutation","action":"subject.amend","outcome":"allowed","actor_tenant_id":"01a0ee8a-c394-7b49-942b-3dea70a962e7","actor_subject_id":"01a0ee8a-cc42-7dc9-a0bd-7fcd5dc9c35e","actor_client_id":"01a0ee8a-c3a0-7429-ab4a-4ecef6baf694","actor_name":"uma","actor_origin":"tenant","resource_type":"subject","resource_id":"01a0ee8c-67c6-7752-904b-584bbc614619","request_id":"01a0ee8c-69b5-7e9b-a23c-621c22a3eb69","ip":"172.22.0.1","detail":{"enabled":{"after":false,"before":true}}}
204
{"id":"01a0ee8c-69d4-7064-bae0-23af3f0d9bf6","occurred_at":"2026-09-29T19:02:54.671Z","event_type":"admin_mutation","action":"subject.amend","outcome":"refused","actor_tenant_id":"01a0ee8a-c394-7b49-942b-3dea70a962e7","actor_subject_id":"01a0ee8a-cc42-7dc9-a0bd-7fcd5dc9c35e","actor_client_id":"01a0ee8a-c3a0-7429-ab4a-4ecef6baf694","actor_name":null,"actor_origin":"tenant","resource_type":"subject","resource_id":"01a0ee8a-c8f6-7450-b486-861a66a87684","request_id":"01a0ee8c-69b5-7e9b-a23c-621c22a3eb69","ip":"172.22.0.1","detail":{"denied":["manage-tenant"]}}
{"id":"01a0ee8c-69ce-7674-a090-e64e603e8a49","occurred_at":"2026-09-29T19:02:54.658Z","event_type":"admin_mutation","action":"subject.amend","outcome":"allowed","actor_tenant_id":"01a0ee8a-c394-7b49-942b-3dea70a962e7","actor_subject_id":"01a0ee8a-cc42-7dc9-a0bd-7fcd5dc9c35e","actor_client_id":"01a0ee8a-c3a0-7429-ab4a-4ecef6baf694","actor_name":null,"actor_origin":"tenant","resource_type":"subject","resource_id":"01a0ee8c-67c6-7752-904b-584bbc614619","request_id":"01a0ee8c-69b5-7e9b-a23c-621c22a3eb69","ip":"172.22.0.1","detail":{"enabled":{"after":false,"before":true}}}
{"count":2,"capped":false}
```

The second export names no actor: `actor_name` is resolved when a row is read
(see `GET /audit`), and `uma` is gone.

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
schema's, hence their generic `title`; the third is the handler's.
Captured against the sixth stack's `demo`, since none of them reads a row:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/demo/subjects/count?limit=5"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/demo/subjects/count?cursor=x"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/demo/subjects/count?username=a&email=b"
```

```
{"type":"about:blank","title":"Error","status":400,"detail":"querystring must NOT have additional properties: limit","errors":[{"path":"limit","message":"must NOT have additional properties"}],"instance":"01a0ea61-845b-74ab-9020-373d1a6ada67"}
{"type":"about:blank","title":"Error","status":400,"detail":"querystring must NOT have additional properties: cursor","errors":[{"path":"cursor","message":"must NOT have additional properties"}],"instance":"01a0ea61-846d-7b1b-afe7-c61051d5153f"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"search one field at a time: username or email, not both","errors":[{"path":"email","message":"search one field at a time: username or email, not both"}],"instance":"01a0ea61-847a-7970-bb2c-77e99c2bf5e8"}
```

## `GET /admin/openapi.json`

The reference this document points at: an OpenAPI 3.1 description of every
route above, generated from the same route table the router registers from,
so the two cannot drift. It takes no `{tenant}` — it describes the API
rather than reaching into one — and is served without authentication, since
a client that cannot read it cannot generate against it. Captured against the
twelfth stack:

```bash
curl -sS -D - -o openapi.json http://localhost:3082/admin/openapi.json
jq '.paths | length' openapi.json
```

```
HTTP/1.1 200 OK
x-request-id: 01a109c0-e764-785f-b5bd-6cbedd84c522
access-control-allow-origin: *
content-type: application/json; charset=utf-8
content-length: 311878
Date: Mon, 05 Oct 2026 01:49:59 GMT
Connection: keep-alive
Keep-Alive: timeout=72

74
```

305 KB and 74 paths, which is the whole route table. It is the one admin
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
rather than repeating it. `/admin/openapi.json` is not among those 74
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
