---
title: 'GET /subjects'
description: 'Requires view-users, and manage-users reaches it too: every manage-* role is composited to its view-* counterpart through role_composites.'
---

# `GET /subjects`

Requires `view-users`. `manage-users` also reaches it: `provisionAdminClient`
composites every `manage-*` role to its `view-*` counterpart through
`role_composites`, so a caller holding only `manage-users` already holds
`view-users` by the time `authorizeAdmin` resolves its effective roles — nothing
in the route special-cases it. Pages by an opaque cursor, `?limit=` and
`?cursor=`, ordered by `id`, the same convention every other listing in this API
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

Eight subjects by the time this ran, and the first five are the point of the
paragraph above: the service accounts of confidential clients, each created
with its client and carrying no `users` row, so `username` and `email` are
`null` and no search would ever return them. `ada`, `Adaline` and `adam` are
`POST /subjects` below:

```
{"items":[{"id":"01a109b6-1e08-73b5-b63f-7e89c1af0ad1","type":"service","username":null,"email":null,"enabled":true,"created_at":"2026-10-27T01:05:16.783Z"},{"id":"01a17ae4-195d-7ecf-bfaf-30bee34797e1","type":"service","username":null,"email":null,"enabled":true,"created_at":"2026-10-27T01:05:31.483Z"},{"id":"01a17ae4-19b4-7fde-aca3-15bba4e88ff5","type":"service","username":null,"email":null,"enabled":true,"created_at":"2026-10-27T01:05:31.570Z"},{"id":"01a109b6-1f0b-7a0b-89d2-3a6006154ef9","type":"service","username":null,"email":null,"enabled":true,"created_at":"2026-10-27T01:06:12.713Z"},{"id":"01a17aed-008d-762d-9c16-3a49394b8edb","type":"service","username":null,"email":null,"enabled":true,"created_at":"2026-10-27T01:15:14.953Z"},{"id":"01a0ea54-2519-7513-8bf7-c105e0cfd9dd","type":"user","username":"ada","email":"ada@example.com","enabled":true,"created_at":"2026-10-27T01:15:46.485Z"},{"id":"01a0ea54-2556-7831-8443-acf0d9ac9f1d","type":"user","username":"Adaline","email":null,"enabled":true,"created_at":"2026-10-27T01:16:21.119Z"},{"id":"01a0ea54-256c-7e66-a2f7-ab933f2e09c8","type":"user","username":"adam","email":null,"enabled":true,"created_at":"2026-10-27T01:16:21.168Z"}]}
```

In the searches below `demo` holds `ada` (`ada@example.com`, created by `POST
/subjects` below) and the service subjects of its confidential clients;
`Adaline` and `adam` were created through `POST /subjects` just before, with no
email. `ADA` finds all three, in folded order:

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

## Filtering by capability

In a tenant `admins-demo` created for it, as `ada-t2` — a system administrator,
so no holder of anything in `admins-demo` itself. `grace`
(`01a0ea0f-36a4-7377-b18e-c6e48982a5cf`) was created there and given
`tenant-admin` alone, which nests `view-users`, so she is listed under both:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3000/admin/tenants/admins-demo/subjects?capability=tenant-admin'
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3000/admin/tenants/admins-demo/subjects?capability=view-users'
```

```
{"items":[{"id":"01a1a8b1-9be5-70de-8c85-93229675801c","type":"user","username":"grace","email":null,"enabled":true,"created_at":"2026-11-04T22:32:54.496Z","admin_capabilities":[{"name":"tenant-admin","direct":true},{"name":"view-users","direct":false},{"name":"manage-users","direct":false},{"name":"manage-clients","direct":false},{"name":"manage-tenant","direct":false},{"name":"manage-keys","direct":false},{"name":"manage-sessions","direct":false},{"name":"view-audit","direct":false},{"name":"view-domains","direct":false},{"name":"manage-domains","direct":false}]}]}
{"items":[{"id":"01a1a8b1-9be5-70de-8c85-93229675801c","type":"user","username":"grace","email":null,"enabled":true,"created_at":"2026-11-04T22:32:54.496Z","admin_capabilities":[{"name":"tenant-admin","direct":true},{"name":"view-users","direct":false},{"name":"manage-users","direct":false},{"name":"manage-clients","direct":false},{"name":"manage-tenant","direct":false},{"name":"manage-keys","direct":false},{"name":"manage-sessions","direct":false},{"name":"view-audit","direct":false},{"name":"view-domains","direct":false},{"name":"manage-domains","direct":false}]},{"id":"01a1a8b1-9f83-7e71-b85e-2c904346eca3","type":"user","username":"hana","email":null,"enabled":true,"created_at":"2026-11-04T22:32:55.421Z","admin_capabilities":[{"name":"view-users","direct":true}]}]}
```

This block ran again after `view-domains` and `manage-domains` joined the built-in roles, so its ids and times are not those of the blocks around it.

Holding through a group or a composite is shown by an integration test, not
here.

## Holders of any capability, and what each holds

`capability=any` lists every subject holding at least one admin capability,
however it holds it, and `/subjects/count?capability=any` counts them. Under any
`capability` filter each item also carries `admin_capabilities`: every name it
holds effectively, `tenant-admin` among them, each with `direct` — whether it is
assigned to the subject itself rather than only through a group or a role that
nests it. It is read for the whole page in one query (`adminCapabilitiesOf`), so
a list of holders never asks per row; which group or role carries a holding is
`GET /subjects/:id/effective-roles`' answer. A listing with no `capability`
filter carries no such field.

As `ada-t9`, a system administrator seeded with `seed user` and `seed grant-role
--role odudu-admin:tenant-admin`. In a tenant `holders-demo`, all through
`seed`: `grace` assigned `tenant-admin`; `linus` a member of `/auditors`, which
is mapped to `view-audit`; `mei` assigned `view-users` and `manage-sessions`;
and `bob`, who holds nothing. The listing, its count, a page of two with its
`link`, and `bob` found by name, carrying no `admin_capabilities` since that
listing is not filtered by capability:

```bash
P=http://localhost:3000/admin/tenants/holders-demo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/subjects?capability=any"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/subjects/count?capability=any"; echo
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" "$P/subjects?capability=any&limit=2"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/subjects?username=bob"; echo
```

```
{"items":[{"id":"01a1a8b1-88b4-7c2b-ae64-c7d60920fd47","type":"user","username":"grace","email":null,"enabled":true,"created_at":"2026-11-04T22:32:49.582Z","admin_capabilities":[{"name":"tenant-admin","direct":true},{"name":"view-users","direct":false},{"name":"manage-users","direct":false},{"name":"manage-clients","direct":false},{"name":"manage-tenant","direct":false},{"name":"manage-keys","direct":false},{"name":"manage-sessions","direct":false},{"name":"view-audit","direct":false},{"name":"view-domains","direct":false},{"name":"manage-domains","direct":false}]},{"id":"01a1a8b1-8acb-7210-98d9-e7ebaebacf75","type":"user","username":"linus","email":null,"enabled":true,"created_at":"2026-11-04T22:32:50.118Z","admin_capabilities":[{"name":"view-audit","direct":false}]},{"id":"01a1a8b1-8cba-721d-9d0a-7b5d7704f203","type":"user","username":"mei","email":null,"enabled":true,"created_at":"2026-11-04T22:32:50.612Z","admin_capabilities":[{"name":"view-users","direct":true},{"name":"manage-sessions","direct":true}]}]}
{"count":3,"capped":false}
HTTP/1.1 200 OK
x-request-id: 01a1a8b1-c9ba-7646-bc96-852d1f704c60
cache-control: no-store
link: </admin/tenants/holders-demo/subjects?limit=2&capability=any&cursor=eyJhZnRlciI6IjAxYTFhOGIxLThhY2ItNzIxMC05OGQ5LWU3ZWJhZWJhY2Y3NSIsImNvbGxlY3Rpb24iOiJzdWJqZWN0cyIsInRlbmFudElkIjoiMDFhMWE4YjEtNzZkMy03ODQ2LWFjZGItZjEwNGNlM2NmN2JjIiwiZmlsdGVycyI6InJXRnNaN2Y3d3JBRDFrck0wQXJORFY1dEgwXzJNZEdSQW5kV2NmUTBBelUifQ.dcy5prL553f6FljLAB9RcCXF99yMJrjksnrt7S86DbU>; rel="next"
content-type: application/json; charset=utf-8
content-length: 1072
Date: Wed, 04 Nov 2026 22:33:06 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a1a8b1-88b4-7c2b-ae64-c7d60920fd47","type":"user","username":"grace","email":null,"enabled":true,"created_at":"2026-11-04T22:32:49.582Z","admin_capabilities":[{"name":"tenant-admin","direct":true},{"name":"view-users","direct":false},{"name":"manage-users","direct":false},{"name":"manage-clients","direct":false},{"name":"manage-tenant","direct":false},{"name":"manage-keys","direct":false},{"name":"manage-sessions","direct":false},{"name":"view-audit","direct":false},{"name":"view-domains","direct":false},{"name":"manage-domains","direct":false}]},{"id":"01a1a8b1-8acb-7210-98d9-e7ebaebacf75","type":"user","username":"linus","email":null,"enabled":true,"created_at":"2026-11-04T22:32:50.118Z","admin_capabilities":[{"name":"view-audit","direct":false}]}],"next":"eyJhZnRlciI6IjAxYTFhOGIxLThhY2ItNzIxMC05OGQ5LWU3ZWJhZWJhY2Y3NSIsImNvbGxlY3Rpb24iOiJzdWJqZWN0cyIsInRlbmFudElkIjoiMDFhMWE4YjEtNzZkMy03ODQ2LWFjZGItZjEwNGNlM2NmN2JjIiwiZmlsdGVycyI6InJXRnNaN2Y3d3JBRDFrck0wQXJORFY1dEgwXzJNZEdSQW5kV2NmUTBBelUifQ.dcy5prL553f6FljLAB9RcCXF99yMJrjksnrt7S86DbU"}
{"items":[{"id":"01a1a8b1-8ea4-7320-a26f-3e371440cc46","type":"user","username":"bob","email":null,"enabled":true,"created_at":"2026-11-04T22:32:51.103Z"}]}
```

This block ran again after `view-domains` and `manage-domains` joined the built-in roles, so its ids and times are not those of the blocks around it. `tenant-admin` carries nine roles now, so `grace`'s `admin_capabilities` has two more names and the page of two is longer.

`grace`'s capabilities other than `tenant-admin` are held within it, so none
is direct; `linus` holds `view-audit` only through `/auditors`; `bob` is in
neither list nor count.

## Filtering by type, lockout and name

After `grace`'s profile was given `name`, `given_name` and `family_name` through
`PATCH /subjects/:id/profile` and five wrong passwords were submitted for
`linus` inside a minute: two name searches, the refusal of two at once,
`linus`'s lockout as the per-subject read answers it, the locked subjects and
their count, and the one subject of type `service`, `ops-app`'s service account,
beside the count of users:

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
