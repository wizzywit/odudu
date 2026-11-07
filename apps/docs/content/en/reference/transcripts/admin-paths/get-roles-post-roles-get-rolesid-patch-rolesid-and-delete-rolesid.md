---
title: 'Roles: list, create, read, update, delete'
description: 'All five require manage-tenant; the list, GET /roles, is also readable with view-users (below).'
---

# Roles: list, create, read, update, delete

This page covers `GET /roles`, `POST /roles`, `GET /roles/:id`, `PATCH /roles/:id` and `DELETE /roles/:id`.

All five require `manage-tenant`; the list, `GET /roles`, is also readable with
`view-users` (below). A role is either a tenant role (`client_id` is `null`) or
scoped to one client, in which case a token's `roles` claim carries it qualified
by that client's own name rather than plain. `PATCH` amends only `description` —
at most 1000 characters, a CHECK holds it there, and `null` clears it; every
other field, `name`, `client_id` and `default_for_new_subjects` included, is
refused with a reason — the last naming `PUT /roles/:id/default`, which is where
it is set — the same shape `PATCH /subjects/:id` refuses `id`, `type` and
`username`. A duplicate name — per tenant for a tenant role, per client for a
client-scoped one — answers `409`, and a `client_id` naming no client answers
`400`. `DELETE` cascades: every `role_composites` edge, `subject_roles`
assignment and `client_scope_roles` mapping naming the role goes with it.

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
not hold ([a removal is judged by what it removes](./get-groupsidroles-and-put-groupsidroles.md#a-removal-is-judged-by-what-it-removes)).

A create, in its `showcase` tenant:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "billing-viewer", "description": "read-only access to invoices"}' \
  http://localhost:3082/admin/tenants/showcase/roles
```

```
{"id":"01a10bd4-d376-748b-a43b-f40458d88100","name":"billing-viewer","description":"read-only access to invoices","client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-10-05T11:30:59.574Z","admin_reach":[]}
```

**Search and filters** follow `GET /subjects`: `?name=` is a prefix, matched
case-insensitively as a range over the stored `name_search` column
(`0075_list_indexes_roles_groups_scopes.sql`), and a searched listing is ordered
by that folded name, then by `id`. **`?client=`** is the one exact filter,
`AND`ed with it: `tenant` for the tenant roles alone, or a client's id for the
roles scoped to that client. A cursor is bound to every filter it was minted
under, and any other parameter is refused with `400` naming it. In a tenant
`roles-demo` created there for it, which held no roles of its own but the
built-in admin client's until these four were created, the last scoped to a
public client `demo-spa` (`01a10bd4-d668-7670-afe0-844b224421c5`) made there
with `seed client` first:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "billing-viewer"}' \
  http://localhost:3082/admin/tenants/roles-demo/roles
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Billing-Admin"}' \
  http://localhost:3082/admin/tenants/roles-demo/roles
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "support"}' \
  http://localhost:3082/admin/tenants/roles-demo/roles
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "billing-spa", "client_id": "01a10bd4-d668-7670-afe0-844b224421c5"}' \
  http://localhost:3082/admin/tenants/roles-demo/roles
```

```
{"id":"01a10bd4-d6d8-73f1-b60b-11d57d6bb686","name":"billing-viewer","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-10-05T11:31:00.438Z","admin_reach":[]}
{"id":"01a10bd4-d6f3-7ca9-ab57-830ede1e570b","name":"Billing-Admin","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-10-05T11:31:00.467Z","admin_reach":[]}
{"id":"01a10bd4-d70c-70c1-9fc7-09b29cce97db","name":"support","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-10-05T11:31:00.492Z","admin_reach":[]}
{"id":"01a10bd4-d727-7bbc-b05f-a238bd2d00d2","name":"billing-spa","description":null,"client_id":"01a10bd4-d668-7670-afe0-844b224421c5","client_key":"demo-spa","default_for_new_subjects":false,"created_at":"2026-10-05T11:31:00.518Z","admin_reach":[]}
```

`BILLING` finds all three `billing` roles in folded order, tenant and
client alike; `?client=tenant` keeps the two tenant roles, and the client's
id keeps its one:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/roles-demo/roles?name=BILLING"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/roles-demo/roles?name=billing&client=tenant"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/roles-demo/roles?client=01a10bd4-d668-7670-afe0-844b224421c5"
```

```
{"items":[{"id":"01a10bd4-d6f3-7ca9-ab57-830ede1e570b","name":"Billing-Admin","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-10-05T11:31:00.467Z","admin_reach":[]},{"id":"01a10bd4-d727-7bbc-b05f-a238bd2d00d2","name":"billing-spa","description":null,"client_id":"01a10bd4-d668-7670-afe0-844b224421c5","client_key":"demo-spa","default_for_new_subjects":false,"created_at":"2026-10-05T11:31:00.518Z","admin_reach":[]},{"id":"01a10bd4-d6d8-73f1-b60b-11d57d6bb686","name":"billing-viewer","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-10-05T11:31:00.438Z","admin_reach":[]}]}
{"items":[{"id":"01a10bd4-d6f3-7ca9-ab57-830ede1e570b","name":"Billing-Admin","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-10-05T11:31:00.467Z","admin_reach":[]},{"id":"01a10bd4-d6d8-73f1-b60b-11d57d6bb686","name":"billing-viewer","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-10-05T11:31:00.438Z","admin_reach":[]}]}
{"items":[{"id":"01a10bd4-d727-7bbc-b05f-a238bd2d00d2","name":"billing-spa","description":null,"client_id":"01a10bd4-d668-7670-afe0-844b224421c5","client_key":"demo-spa","default_for_new_subjects":false,"created_at":"2026-10-05T11:31:00.518Z","admin_reach":[]}]}
```

One at a time, the `Link` header carries the search forward:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/roles-demo/roles?name=billing&limit=1"
```

```
HTTP/1.1 200 OK
x-request-id: 01a10bd4-d783-7e2e-8d08-0e26bdc54a64
cache-control: no-store
link: </admin/tenants/roles-demo/roles?limit=1&name=billing&cursor=eyJhZnRlciI6IjAxYTEwYmQ0LWQ2ZjMtN2NhOS1hYjU3LTgzMGVkZTFlNTcwYiIsInNvcnQiOiJiaWxsaW5nLWFkbWluIiwiY29sbGVjdGlvbiI6InJvbGVzIiwidGVuYW50SWQiOiIwMWExMGJkNC1kNDg1LTc2NDItYmQxYS04YzY1MzBmYTk5NTgiLCJmaWx0ZXJzIjoiM0w4aEJkRGMyWVZnelVseHhtSlVYZGluWHJDMG10NHZMTXF1TlNTdEdOdyJ9.v_fTLZ_BVcFLmG1cpmnr-lJijG8KwzLcjOTkCAkdsM8>; rel="next"
content-type: application/json; charset=utf-8
content-length: 542
Date: Mon, 05 Oct 2026 11:31:00 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a10bd4-d6f3-7ca9-ab57-830ede1e570b","name":"Billing-Admin","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-10-05T11:31:00.467Z","admin_reach":[]}],"next":"eyJhZnRlciI6IjAxYTEwYmQ0LWQ2ZjMtN2NhOS1hYjU3LTgzMGVkZTFlNTcwYiIsInNvcnQiOiJiaWxsaW5nLWFkbWluIiwiY29sbGVjdGlvbiI6InJvbGVzIiwidGVuYW50SWQiOiIwMWExMGJkNC1kNDg1LTc2NDItYmQxYS04YzY1MzBmYTk5NTgiLCJmaWx0ZXJzIjoiM0w4aEJkRGMyWVZnelVseHhtSlVYZGluWHJDMG10NHZMTXF1TlNTdEdOdyJ9.v_fTLZ_BVcFLmG1cpmnr-lJijG8KwzLcjOTkCAkdsM8"}
```

Following that link, then replaying its cursor with `?client=tenant` added:

```bash
CURSOR='eyJhZnRlciI6IjAxYTEwYmQ0LWQ2ZjMtN2NhOS1hYjU3LTgzMGVkZTFlNTcwYiIsInNvcnQiOiJiaWxsaW5nLWFkbWluIiwiY29sbGVjdGlvbiI6InJvbGVzIiwidGVuYW50SWQiOiIwMWExMGJkNC1kNDg1LTc2NDItYmQxYS04YzY1MzBmYTk5NTgiLCJmaWx0ZXJzIjoiM0w4aEJkRGMyWVZnelVseHhtSlVYZGluWHJDMG10NHZMTXF1TlNTdEdOdyJ9.v_fTLZ_BVcFLmG1cpmnr-lJijG8KwzLcjOTkCAkdsM8'
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/roles-demo/roles?limit=1&name=billing&cursor=$CURSOR"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/roles-demo/roles?limit=1&name=billing&client=tenant&cursor=$CURSOR"
```

```
{"items":[{"id":"01a10bd4-d727-7bbc-b05f-a238bd2d00d2","name":"billing-spa","description":null,"client_id":"01a10bd4-d668-7670-afe0-844b224421c5","client_key":"demo-spa","default_for_new_subjects":false,"created_at":"2026-10-05T11:31:00.518Z","admin_reach":[]}],"next":"eyJhZnRlciI6IjAxYTEwYmQ0LWQ3MjctN2JiYy1iMDVmLWEyMzhiZDJkMDBkMiIsInNvcnQiOiJiaWxsaW5nLXNwYSIsImNvbGxlY3Rpb24iOiJyb2xlcyIsInRlbmFudElkIjoiMDFhMTBiZDQtZDQ4NS03NjQyLWJkMWEtOGM2NTMwZmE5OTU4IiwiZmlsdGVycyI6IjNMOGhCZERjMllWZ3pVbHh4bUpVWGRpblhyQzBtdDR2TE1xdU5TU3RHTncifQ.ijOveSgDATnglqazyZg9Bg3YQ16FbkWdHCndAD36v6E"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"cursor is invalid or expired","errors":[{"path":"cursor","message":"is invalid or expired"}],"instance":"01a10bd4-d7b2-7276-af2a-0852ca741785"}
```

A `client` that is neither `tenant` nor an id, an unknown parameter, and
the stored `name_search` column named in a create body and in an amendment
— the first three refused by the generated schema, the last by the
amendment allowlist, which knows only the fields a role's wire shape
carries:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/roles-demo/roles?client=spa"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/roles-demo/roles?search=billing"
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "auditor", "name_search": "x"}' \
  http://localhost:3082/admin/tenants/roles-demo/roles
curl -sS -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name_search": "x"}' \
  http://localhost:3082/admin/tenants/roles-demo/roles/01a10bd4-d70c-70c1-9fc7-09b29cce97db
```

```
{"type":"about:blank","title":"Error","status":400,"detail":"querystring/client must be equal to constant, querystring/client must match pattern \"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$\", querystring/client must match a schema in anyOf","errors":[{"path":"client","message":"must be equal to constant"},{"path":"client","message":"must match pattern \"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$\""},{"path":"client","message":"must match a schema in anyOf"}],"instance":"01a10bd4-d7c8-74da-80b9-cf4ba4610516"}
{"type":"about:blank","title":"Error","status":400,"detail":"querystring must NOT have additional properties: search","errors":[{"path":"search","message":"must NOT have additional properties"}],"instance":"01a10bd4-d7d3-7526-973e-335c0fc0a1d3"}
{"type":"about:blank","title":"Error","status":400,"detail":"body must NOT have additional properties: name_search","errors":[{"path":"name_search","message":"must NOT have additional properties"}],"instance":"01a10bd4-d7e0-7c73-9077-69671a60f01e"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"name_search: name_search is not a role field","errors":[{"path":"name_search","message":"name_search is not a role field"}],"instance":"01a10bd4-d7ec-77d2-8e3f-858092080816"}
```

Every `409` that guards the built-in admin client's roles writes a `refused` row
with the refusal's text under `detail.reason`, the way a `403` does (ADR 0037's
amendment of 2026-09-28): deleting one of those roles here, and adding or
removing a composite of one below. On `ceiling-removal`, from [a removal is
judged by what it
removes](./get-groupsidroles-and-put-groupsidroles.md#a-removal-is-judged-by-what-it-removes),
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

## The owning client, by name

A role names its owning client twice: `client_id`, the client's row id, and
`client_key`, that client's own `client_id` — the name a person tells it apart
by, since a tenant role and a client's may share a name. Both are `null` for a
tenant role. The same pair rides on every role list: a role's composites, and
the `items` a subject's, a group's and a scope's roles answer beside `id` and
`name`. `client_key` is refused by `PATCH` like `client_id`. In `etags-demo`,
whose public client `etags-app` was made with `seed client` and whose subject
`ines` with `POST /subjects`: a role `reader` created on the client, the
tenant's roles filtered to it, and `ines` given `reader` and the tenant role
`billing-viewer` from above under the `ETag` of her empty list:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"name":"reader","client_id":"01a10bd4-903e-716d-b038-29c8d3ee53ec"}' \
  http://localhost:3082/admin/tenants/etags-demo/roles
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3082/admin/tenants/etags-demo/roles?client=01a10bd4-903e-716d-b038-29c8d3ee53ec'
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -H 'If-Match: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"' \
  -d '{"role_ids":["01a10bd4-9120-7c99-a4b7-9b35a2219dc8","01a10bd4-90e5-79e8-92bd-8f9024ae8829"]}' \
  http://localhost:3082/admin/tenants/etags-demo/subjects/01a10bd4-90a5-7793-971d-100cba5bc688/roles
```

```
{"id":"01a10bd4-9120-7c99-a4b7-9b35a2219dc8","name":"reader","description":null,"client_id":"01a10bd4-903e-716d-b038-29c8d3ee53ec","client_key":"etags-app","default_for_new_subjects":false,"created_at":"2026-10-05T11:30:42.591Z","admin_reach":[]}
{"items":[{"id":"01a10bd4-9120-7c99-a4b7-9b35a2219dc8","name":"reader","description":null,"client_id":"01a10bd4-903e-716d-b038-29c8d3ee53ec","client_key":"etags-app","default_for_new_subjects":false,"created_at":"2026-10-05T11:30:42.591Z","admin_reach":[]}]}
{"items":[{"id":"01a10bd4-90e5-79e8-92bd-8f9024ae8829","name":"billing-viewer","client_id":null,"client_key":null},{"id":"01a10bd4-9120-7c99-a4b7-9b35a2219dc8","name":"reader","client_id":"01a10bd4-903e-716d-b038-29c8d3ee53ec","client_key":"etags-app"}]}
```

## What a role reaches: `admin_reach`

Every role answer — the list, a role's own read and every write that answers it,
and a role's composites — carries `admin_reach`: the admin capabilities the role
hands out, expanded through `role_composites` however deep it nests them, by
`capabilitiesReachableFrom`, the same computation every capability ceiling here
judges a write by, and read for a whole page in one query. It names capabilities
in the order `whoami` does, never `tenant-admin` itself, whose holding is the
capabilities it nests. It is derived on each read and never stored: the `ETag`
is taken over the stored fields alone, so a composite added somewhere below a
role does not stale a write to its description, and `PATCH` refuses it with a
reason.

A tenant role `audit-lead` nesting `odudu-admin:view-audit`, and `audit-bundle`
nesting `audit-lead`, each made there with `POST /roles` and `POST
/roles/:id/composites` for it, `$P` the tenant's
`http://localhost:3082/admin/tenants/reach-demo`. `audit-bundle` names no
capability itself and reaches one two levels down — what its default is then
refused for:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" $P/roles/01a10bd6-2cbc-706c-8d46-891aad99d5bb \
  | grep -E '^(HTTP/|etag:|\{)'
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" $P/roles/01a10bd6-2cbc-706c-8d46-891aad99d5bb/composites; echo
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"default":true}' $P/roles/01a10bd6-2cbc-706c-8d46-891aad99d5bb/default; echo
```

Each response's status line and `etag` where it has one, then its body:

```
HTTP/1.1 200 OK
etag: "7ecd0c326f94377e60c254866472c0d0b033d159f60df4629dc6ffd41ef7ecde"
{"id":"01a10bd6-2cbc-706c-8d46-891aad99d5bb","name":"audit-bundle","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-10-05T11:32:27.964Z","admin_reach":["view-audit"]}
{"items":[{"id":"01a10bd6-2ca5-763e-b394-ce919be96bc2","name":"audit-lead","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-10-05T11:32:27.940Z","admin_reach":["view-audit"]}]}
{"type":"about:blank","title":"Forbidden","status":403,"detail":"a role handed to every new subject may reach no admin capability, and this one would reach: view-audit","instance":"01a10bd6-2e73-7649-a48f-c17b297dca44"}
```

## The list a user manager picks from

`GET /roles` alone is also readable with `view-users`, and so with
`manage-users`, which composes it: a user manager assigns roles to a subject and
needs the list to pick from. `GET /groups` is widened the same way. Nothing else
under either path is — a role's own read, its composites and both counts still
require `manage-tenant` — and what a user manager may assign is still held to
its own capabilities by the ceiling (ADR 0040). A caller refused one of these
lists gets the usual `403`, and its `capability.refused` row names `view-users`
under `detail.also_admits` beside the `manage-tenant` it names as `capability`,
since either would have admitted it. In a tenant `admins-demo` created there for
it, as `hana`, a subject seeded there with `seed user`, granted
`odudu-admin:view-users` alone with `seed grant-role` and signed in through the
tenant's own admin client, first `whoami`, then two lists and a count:

```bash
curl -sS -H "Authorization: Bearer $HANA_TOKEN" http://localhost:3000/admin/tenants/admins-demo/whoami
curl -sS -H "Authorization: Bearer $HANA_TOKEN" 'http://localhost:3000/admin/tenants/admins-demo/roles?name=manage&limit=2'
curl -sS -H "Authorization: Bearer $HANA_TOKEN" http://localhost:3000/admin/tenants/admins-demo/groups
curl -sS -H "Authorization: Bearer $HANA_TOKEN" http://localhost:3000/admin/tenants/admins-demo/roles/count
```

```
{"subjectId":"01a1a8b1-9f83-7e71-b85e-2c904346eca3","issuerTenantId":"01a1a8b1-7b69-785b-9e31-aabf725e7291","capabilities":["view-users"],"crossTenant":false}
{"items":[{"id":"01a1a8b1-7c94-7503-b20d-a74c128b7ed8","name":"manage-clients","description":null,"client_id":"01a1a8b1-7c3e-7346-ada2-2b8823b3bd1b","client_key":"odudu-admin","default_for_new_subjects":false,"created_at":"2026-11-04T22:32:46.394Z","admin_reach":["manage-clients"]},{"id":"01a1a8b1-7cb9-7b64-a611-3bc2da2c3ad5","name":"manage-domains","description":null,"client_id":"01a1a8b1-7c3e-7346-ada2-2b8823b3bd1b","client_key":"odudu-admin","default_for_new_subjects":false,"created_at":"2026-11-04T22:32:46.394Z","admin_reach":["view-domains","manage-domains"]}],"next":"eyJhZnRlciI6IjAxYTFhOGIxLTdjYjktN2I2NC1hNjExLTNiYzJkYTJjM2FkNSIsInNvcnQiOiJtYW5hZ2UtZG9tYWlucyIsImNvbGxlY3Rpb24iOiJyb2xlcyIsInRlbmFudElkIjoiMDFhMWE4YjEtN2I2OS03ODViLTllMzEtYWFiZjcyNWU3MjkxIiwiZmlsdGVycyI6IlJmN1o1Njk1VkFrc05UeHBDNUhuYnZuN1dYME5hV0d0MGdmVk9OblNpTmcifQ._BOcDlYJ5BU6CG8AmjGIusNK8rfdnftMImK2csQdH5s"}
{"items":[]}
{"type":"about:blank","title":"Forbidden","status":403,"instance":"01a1a8b1-ca76-74e1-be07-5758f1559921"}
```

This block ran again after `view-domains` and `manage-domains` joined the built-in roles, so its ids and times are not those of the blocks around it. `manage-domains` now sorts second among the roles named `manage`.

Then `kai`, created there the same way holding `manage-clients` alone,
refused the list, and the row that refusal wrote:

The same again, now that each row answers `actor_name` and `actor_origin`; the
ids are a fresh run's, not those above:

```bash
curl -sS -H "Authorization: Bearer $KAI_TOKEN" http://localhost:3082/admin/tenants/admins-demo/roles; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3082/admin/tenants/admins-demo/audit?action=capability.refused&limit=1'; echo
```

```
{"type":"about:blank","title":"Forbidden","status":403,"instance":"01a0ee91-6bf2-708d-839a-f58481e120e8"}
{"items":[{"id":"01a17b00-fab5-79b4-ac4b-85cf3c61ac0d","occurred_at":"2026-10-27T01:37:04.180Z","event_type":"admin_access","action":"capability.refused","outcome":"refused","actor_tenant_id":"01a17aee-035a-7fbd-b91e-5d1bf526e06a","actor_subject_id":"01a17b00-f2ad-73d0-9614-632615bd007d","actor_client_id":"01a17aee-036f-79c1-9d61-075c9eb9f690","actor_name":"kai","actor_origin":"tenant","resource_type":null,"resource_id":null,"request_id":"01a0ee91-6bf2-708d-839a-f58481e120e8","ip":"172.20.0.1","detail":{"reason":"missing_capability","capability":"manage-tenant","also_admits":["view-users"]}}],"next":"eyJhZnRlciI6IjIwMjYtMTAtMjdUMDE6Mzc6MDQuMTgwWnwwMWExN2IwMC1mYWI1LTc5YjQtYWM0Yi04NWNmM2M2MWFjMGQiLCJjb2xsZWN0aW9uIjoiYXVkaXQiLCJ0ZW5hbnRJZCI6IjAxYTE3YWVlLTAzNWEtN2ZiZC1iOTFlLTVkMWJmNTI2ZTA2YSIsImZpbHRlcnMiOiJzV3pnMmJuM3FLa3djU0htSGVxS1gyYlZ5VlA3Tl8wRWdhSmI3Si1TeWRrIn0.p7U0bK0GfLYBChgI0CUD3PbRR6ClAVOiDVsLOoDqPTw"}
```

## Retrying a create with an Idempotency-Key

An agent or a script that never hears an answer cannot tell whether a create arrived, and sending it again may
create the role twice. The `POST` routes therefore take an `Idempotency-Key` header (all but the few below) (1 to 255 letters, digits and
`_ . : -`; a UUID is the usual choice). The first call with a key runs. A repeat of it within 24 hours is answered with
the same status, the same body and the same `ETag`, marked `Idempotent-Replayed: true`, without running again and
without a second audit row. The record is written in the transaction of the call it records, so one exists only for a
call that happened. A key belongs to its tenant, its route and the caller that first used it. These blocks ran on a
freshly built compose stack in a tenant `idem-demo` made for them (`POST /admin/tenants`), with a token got as in
[Getting the token](./getting-the-token.md); first the call:

```bash
curl -sS -D - -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 6f9c1c2e-6a0e-4b8a-9c1e-2d7b1e0a5f01" \
  -d '{"name": "billing-viewer", "description": "read-only access to invoices"}' \
  http://localhost:3000/admin/tenants/idem-demo/roles
```

```
HTTP/1.1 201 Created
x-request-id: 01a1adf9-2c62-7d1d-904f-9e5d86372bcf
cache-control: no-store
etag: "3d09ecc5d47b8ac57c8f0558a6970fdb6134e98a752311a818d0b3eb5c5c9780"
content-type: application/json; charset=utf-8
content-length: 239
Date: Thu, 05 Nov 2026 23:09:10 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1adf9-2c73-7ce6-b8aa-37bf1c28cadd","name":"billing-viewer","description":"read-only access to invoices","client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-11-05T23:09:10.639Z","admin_reach":[]}
```

And the same command again, as a client that lost the answer would send it. The status, the `etag` and the body are
the first call's, `idempotent-replayed` is the only new header, and `created_at` is still the first call's instant:

```
HTTP/1.1 201 Created
x-request-id: 01a1adf9-2c85-72a2-b327-682418d54851
cache-control: no-store
etag: "3d09ecc5d47b8ac57c8f0558a6970fdb6134e98a752311a818d0b3eb5c5c9780"
content-type: application/json; charset=utf-8
idempotent-replayed: true
content-length: 239
Date: Thu, 05 Nov 2026 23:09:10 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1adf9-2c73-7ce6-b8aa-37bf1c28cadd","name":"billing-viewer","description":"read-only access to invoices","client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-11-05T23:09:10.639Z","admin_reach":[]}
```

One role exists and one `role.create` audit row was written:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/idem-demo/roles?name=billing"
docker compose exec -T postgres psql -U odudu -d odudu -c "select count(*) as role_create_rows from audit_events e join tenants t on t.id = e.tenant_id where t.name = 'idem-demo' and e.action = 'role.create';"
```

```
{"items":[{"id":"01a1adf9-2c73-7ce6-b8aa-37bf1c28cadd","name":"billing-viewer","description":"read-only access to invoices","client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-11-05T23:09:10.639Z","admin_reach":[]}]}
 role_create_rows
------------------
                1
(1 row)
```

The same key with a different body is refused with `422` and nothing is applied, so a client that reuses a key by
mistake finds out instead of being told its new request succeeded. A key presented by another caller is refused the
same way, never answered with the first caller's response:

```bash
curl -sS -D - -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 6f9c1c2e-6a0e-4b8a-9c1e-2d7b1e0a5f01" \
  -d '{"name": "billing-admin"}' \
  http://localhost:3000/admin/tenants/idem-demo/roles
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/idem-demo/roles?name=billing-admin"
```

```
HTTP/1.1 422 Unprocessable Entity
x-request-id: 01a1adf9-2d7e-79a0-8d07-26c7bb15196f
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 238
Date: Thu, 05 Nov 2026 23:09:10 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank#idempotency-key-reused","title":"Unprocessable Content","status":422,"detail":"this Idempotency-Key was used for a different request; use a new key for a new request","instance":"01a1adf9-2d7e-79a0-8d07-26c7bb15196f"}
{"items":[]}
```

A refusal or a failure is not kept, so a retry runs: a create of a name that already exists is refused with `409`
whatever the key, and only the first call's row is in the table below. A key that is empty, over 255 characters or
holds other characters is `400` (`about:blank#idempotency-key-invalid`) before anything runs:

```bash
curl -sS -D - -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 0b7d3a64-93f4-4d5c-8a2e-5e6d1f3c7a10" \
  -d '{"name": "billing-viewer"}' \
  http://localhost:3000/admin/tenants/idem-demo/roles
curl -sS -D - -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: not a key" \
  -d '{"name": "billing-admin"}' \
  http://localhost:3000/admin/tenants/idem-demo/roles
```

```
HTTP/1.1 409 Conflict
x-request-id: 01a1adf9-2da8-7d0b-95dd-a049a3e0f4d8
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 161
Date: Thu, 05 Nov 2026 23:09:10 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"the name \"billing-viewer\" is already in use","instance":"01a1adf9-2da8-7d0b-95dd-a049a3e0f4d8"}

HTTP/1.1 400 Bad Request
x-request-id: 01a1adf9-2dc0-74fc-86a1-fecd40608b76
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 231
Date: Thu, 05 Nov 2026 23:09:10 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank#idempotency-key-invalid","title":"Bad Request","status":400,"detail":"Idempotency-Key must be one value of 1 to 255 letters, digits and the characters _ . : -","instance":"01a1adf9-2dc0-74fc-86a1-fecd40608b76"}
```

A route whose response carries a secret shown once (creating a client, rotating its secret, minting a registration
token, issuing a password, importing a tenant) takes no key. The server never stores such a body, and running the
call again would mint a second secret, so a request naming one is refused with `400`
(`about:blank#idempotency-unsupported`) and nothing is applied; the same request without the header runs as it
always has:

```bash
curl -sS -D - -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 5d0c9a1e-2b7f-4f0a-b2a9-3c1d8e6f4a22" \
  -d '{"uses": 1, "ttl_seconds": 3600}' \
  http://localhost:3000/admin/tenants/idem-demo/registration-tokens
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a1adf9-2dd6-722b-995b-5adb55849d30
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 264
Date: Thu, 05 Nov 2026 23:09:11 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank#idempotency-unsupported","title":"Bad Request","status":400,"detail":"this route answers with a secret shown once, which is never stored, so it takes no Idempotency-Key; repeat it without one","instance":"01a1adf9-2dd6-722b-995b-5adb55849d30"}
```

What the server kept, read as the database owner and scoped to the tenant: one row, for the one call that
succeeded, kept for a day. It was read straight after the blocks above and before the refusals below,
which is the only state those blocks leave.

```bash
docker compose exec -T postgres psql -U odudu -d odudu -c "select k.key, k.route, k.response_status, k.expires_at - k.created_at as kept_for from idempotency_keys k join tenants t on t.id = k.tenant_id where t.name = 'idem-demo';"
```

```
                 key                  |               route               | response_status | kept_for
--------------------------------------+-----------------------------------+-----------------+----------
 6f9c1c2e-6a0e-4b8a-9c1e-2d7b1e0a5f01 | POST /admin/tenants/:tenant/roles |             201 | 1 day
(1 row)
```

Creating a tenant takes no key either, for a different reason: it writes outside the transaction a record of the call would
share, so a record could not prove the call happened. It is refused with `400` (`about:blank#idempotency-not-atomic`) and
creates nothing; a repeat of a create that already happened is answered `409`. This one ran on a second freshly built stack,
`odudu-p5a-i6b`, with a token got as above:

```bash
curl -sS -D - -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 3e2f8a10-5c4b-4d7e-9f61-0a8b7c6d5e41" \
  -d '{"name": "idem-demo"}' \
  http://localhost:3000/admin/tenants
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a1ae19-add4-7c3e-b9a0-4f4c17ef1133
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 296
Date: Thu, 05 Nov 2026 23:44:40 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank#idempotency-not-atomic","title":"Bad Request","status":400,"detail":"this route writes outside the transaction a record would share, so it takes no Idempotency-Key; a repeat of a create that already happened is answered 409","instance":"01a1ae19-add4-7c3e-b9a0-4f4c17ef1133"}
```

A route that waits on another server while it runs (testing a tenant's mail relay, verifying a domain's DNS record) takes no
key either: a slow host would hold the call, its database connection and one of the few places keyed calls run in, so it is
refused with `400` (`about:blank#idempotency-external-io`) and nothing is applied. This ran on a third freshly built stack,
`odudu-p5a-i6c`, in a tenant `idem-demo` made there:

```bash
curl -sS -D - -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 7b1d4c92-0e3a-4f58-8d6c-2a9e5f1b3c70" \
  -d '{"to": "ops@example.com"}' \
  http://localhost:3000/admin/tenants/idem-demo/smtp/test
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a1ae31-ea34-7bf9-9f3c-b83885198fcc
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 319
Date: Fri, 06 Nov 2026 00:11:09 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank#idempotency-external-io","title":"Bad Request","status":400,"detail":"this route waits on another server (mail or DNS) while it runs, which a record cannot cover without holding the call open, so it takes no Idempotency-Key; repeat it without one","instance":"01a1ae31-ea34-7bf9-9f3c-b83885198fcc"}
```

A `PUT`, a `PATCH` and a `DELETE` ignore the header, since repeating one lands where the first did. A repeat of
a call that carried `If-Match` is answered from the record before the `If-Match` is read again, which is the point:
the first call changed the version the header named, so without the record the retry would be refused with `412`.
A tenant holds at most 10,000 keys that have not expired, past which a new key is refused with `429`
(`about:blank#idempotency-capacity`), and a response over 64 KiB is refused with `422`
(`about:blank#idempotency-response-too-large`) and undone. Two calls with one key at the same instant are not
shown here, since which of them meets the other is a matter of timing: the one that arrives while the first runs is
answered `409` (`about:blank#idempotency-in-flight`), and the next is replayed. A stored response is a copy of the one sent, kept 24 hours; it can hold subject data and erasing the subject does not purge it; the integration tests hold a call
open to show it. [Retention](../request-paths/retention-what-odudu-reap-removes.md) shows the keys being deleted.
