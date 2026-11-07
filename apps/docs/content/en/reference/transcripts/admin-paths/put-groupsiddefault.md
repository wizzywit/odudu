---
title: 'PUT /groups/:id/default'
description: 'Requires manage-tenant. The body is {"default": true} or {"default": false}, and the answer is the group with its ETag; the group''s…'
---

# `PUT /groups/:id/default`

Requires `manage-tenant`. The body is `{"default": true}` or `{"default":
false}`, and the answer is the group with its `ETag`; the group's
`default_for_new_subjects` shows the flag on every read, and `PATCH /groups/:id`
refuses it with a reason naming this route. `If-Match` is optional, and a stale
one is refused with `412`. A default group is joined by **every subject created
afterwards** — through `POST /subjects`, self-registration and `odudu seed`
(`seed user`, the bootstrap user and `seed admin`), all through
`grantNewSubjectDefaults`, which hands out the default roles in the same pass —
and by none that already exist. A subject an import brings is one being moved
rather than created: it arrives with exactly the groups and roles its document
lists, a default group's membership included where it held one, so the import
never hands back a membership an administrator removed, and a tenant re-exports
what it imported. Each change is audited as `group.default_set`, with the flag's
before and after in `detail`.

**A default group may reach no admin capability**, on the rule `PUT
/roles/:id/default` holds a role to: membership hands out the roles mapped to
the group and to every ancestor (ADR 0040's ceiling reaches as far), so `true`
is refused with `403`, whoever the caller is, when any of them reaches a role of
the built-in admin client. While a group is a default, each write that could
widen what it hands out is refused the same way, with a `refused` row: `PUT
/groups/:id/roles` on it or on an ancestor mapping a role that reaches a
capability, `POST /roles/:id/composites` nesting one under a role it reaches,
and `PATCH /groups/:id` moving it or an ancestor under a chain that reaches one.
Every one of these takes the lock the role defaults take (`lockDefaultReach`),
so two writers cannot each pass the check alone, and takes it only once every
row it will write, or its foreign keys will check, is locked — the roles a group
is given, the subtree a reparent rewrites and its new parent — so no writer
holding it ever waits on a row another writer holds while waiting for it
(`default-reach-locks.int.test.ts`). An import is held to the same rule: a
document marking a group default whose chain reaches a capability is refused at
that group's `default_for_new_subjects`. A group's record says which groups that
reaches: `holds_default_group` is `true` for a default group and for every group
above it, since each of them hands its roles down to the default, so a client
can refuse the move or the role before sending it.

In a tenant `defaults-demo` made for it: a root group `staff`, made with a
`description`, and its child `everyone`, neither mapping a role. `everyone` made
a default, then a subject created afterwards, its memberships narrowed with
`jq`, then `staff` read, whose `holds_default_group` is now `true` for the
default beneath it:

```bash
curl -sS -D - -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"default": true}' \
  http://localhost:3082/admin/tenants/defaults-demo/groups/01a10bd5-e21f-7145-8078-e79e986ea65b/default
NEW=$(curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"username":"newcomer"}' \
  http://localhost:3082/admin/tenants/defaults-demo/subjects | jq -r .id)
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/defaults-demo/subjects/$NEW/groups" | jq -c '[.items[].path]'
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3082/admin/tenants/defaults-demo/groups/01a10bd5-e200-7d85-9686-6a25421a8bbf
```

```
HTTP/1.1 200 OK
x-request-id: 01a10bd5-e269-7dba-a8c0-ef9c9a2001b2
cache-control: no-store
etag: "fe7d1de863b9501ca09f07797c2e77fc63bd0087460ebbf86d00a8a60fecd4ba"
content-type: application/json; charset=utf-8
content-length: 299
Date: Mon, 05 Oct 2026 11:32:08 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a10bd5-e21f-7145-8078-e79e986ea65b","name":"everyone","description":null,"parent_id":"01a10bd5-e200-7d85-9686-6a25421a8bbf","default_for_new_subjects":true,"path":"/staff/everyone","created_at":"2026-10-05T11:32:08.861Z","admin_reach":[],"subtree_admin_reach":[],"holds_default_group":true}
["/staff/everyone"]
{"id":"01a10bd5-e200-7d85-9686-6a25421a8bbf","name":"staff","description":"Everyone on the payroll","parent_id":null,"default_for_new_subjects":false,"path":"/staff","created_at":"2026-10-05T11:32:08.831Z","admin_reach":[],"subtree_admin_reach":[],"holds_default_group":true}
```

Then the guard, from the other side: mapping `odudu-admin:view-users` to
`staff`, the default's parent — refused even for `ada-t8c2`, who holds every
capability — then `PATCH` naming the flag, then the trail of each group:

```bash
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -H "If-Match: $STAFF_ROLES_ETAG" \
  -d '{"role_ids": ["01a10bd5-e1d0-7b1d-be18-f1d71f3f175e"]}' \
  http://localhost:3082/admin/tenants/defaults-demo/groups/01a10bd5-e200-7d85-9686-6a25421a8bbf/roles; echo
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"default_for_new_subjects": false}' \
  http://localhost:3082/admin/tenants/defaults-demo/groups/01a10bd5-e21f-7145-8078-e79e986ea65b; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/defaults-demo/audit?resource_type=group&resource_id=01a10bd5-e21f-7145-8078-e79e986ea65b" \
  | jq -c '.items[] | {action, outcome, detail}'
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/defaults-demo/audit?resource_type=group&resource_id=01a10bd5-e200-7d85-9686-6a25421a8bbf&action=group.roles_set" \
  | jq -c '.items[] | {action, outcome, detail}'
```

`$STAFF_ROLES_ETAG` is the `ETag` `GET …/groups/01a109bc-6614-7754-98ea-34b518dd251d/roles`
answered just before:

```
{"type":"about:blank","title":"Forbidden","status":403,"detail":"a group every new subject joins may reach no admin capability, and this one would reach: view-users","instance":"01a10bd5-e2e8-73aa-b8ac-cdf90e56e3b0"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"default_for_new_subjects: default_for_new_subjects changes who joins a group silently at signup; set it with PUT /admin/tenants/{tenant}/groups/{id}/default, not a general amendment","errors":[{"path":"default_for_new_subjects","message":"default_for_new_subjects changes who joins a group silently at signup; set it with PUT /admin/tenants/{tenant}/groups/{id}/default, not a general amendment"}],"instance":"01a10bd5-e308-7ac6-bb78-c61ceede78c0"}
{"action":"group.default_set","outcome":"allowed","detail":{"default_for_new_subjects":{"after":true,"before":false}}}
{"action":"group.create","outcome":"allowed","detail":{"name":{"after":"everyone"},"parent_id":{"after":"01a1b3cf-d48c-7a32-af8b-177ff077d691"}}}
{"action":"group.roles_set","outcome":"refused","detail":{"denied":["view-users"]}}
```

The `group.create` row names what the create set: the `name` and, where there is one, the `parent_id`. Its `parent_id` is that of a `staff` group made with the same requests on another stack, so it is not the id above.
