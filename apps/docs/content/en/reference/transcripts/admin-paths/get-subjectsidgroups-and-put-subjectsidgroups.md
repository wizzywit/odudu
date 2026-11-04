---
title: 'GET /subjects/:id/groups and PUT /subjects/:id/groups'
description: 'The read requires view-users; the write requires manage-users.'
---

# `GET /subjects/:id/groups` and `PUT /subjects/:id/groups`

The read requires `view-users`; the write requires `manage-users`. Both
answer the groups the subject **directly** belongs to — the same set the
`groups` claim of its next token carries
([ADR 0022](https://github.com/wizzywit/odudu/blob/main/docs/adr/0022-group-claims-carry-direct-memberships.md)) — and the
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
target ceiling ([`POST /subjects/:id/password`](./post-subjectsidpassword.md#the-target-ceiling))
comes first: a subject holding a capability the caller does not cannot
have any membership changed by that caller, removals included.

**`If-Match` is mandatory here, not optional**, for the reason it is on
`PUT /subjects/:id/roles`: absent, `428`; stale, `412`. The tag is over
the list exactly as the `GET` answers it, so reparenting a member group,
which rewrites its `path`, changes the tag even though the membership did
not; an empty membership answers the same `"eef46741…"` every empty list
here does.

In a tenant `groups-demo` created through `POST /admin/tenants` for it. There,
`platform-admins` is mapped to `tenant-admin` through `PUT /groups/:id/roles`,
`oncall` is its child with no role of its own, `support` has none either, and
`mei2` is a subject created through `POST /subjects`. `$HELPDESK_TOKEN` belongs
to `helpdesk`, a user of that tenant created through `POST /subjects`, granted
`manage-users` alone through `PUT /subjects/:id/roles`, and signed in with the
one-time password `POST /subjects/:id/password` issued it; `$ADMIN_TOKEN` is
`ada`'s. The refusal below turns on two facts, shown first — what `helpdesk`
holds, and that `oncall` carries nothing itself while its parent carries
`tenant-admin`:

```bash
curl -sS -H "Authorization: Bearer $HELPDESK_TOKEN" \
  http://localhost:3000/admin/tenants/groups-demo/whoami

curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/groups-demo/groups/01a1a8b2-3185-7f82-8c55-61f0b1dbe23c/roles

curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/groups-demo/groups/01a1a8b2-2ffa-7a43-9317-6edf9d9e2087/roles
```

```
{"subjectId":"01a1a8b2-37e7-78a1-bae2-ab65b553f569","issuerTenantId":"01a1a8b1-8127-7350-86b7-3cc9fb8bc5c0","capabilities":["manage-users","view-users"],"crossTenant":false}
{"items":[]}
{"items":[{"id":"01a1a8b1-8198-7416-b9df-c11af829837b","name":"tenant-admin","client_id":"01a1a8b1-817e-7849-8840-51c37e1a68d6","client_key":"odudu-admin","admin_reach":["view-users","manage-users","manage-clients","manage-tenant","manage-keys","mana
```

This block ran again after `view-domains` and `manage-domains` joined the built-in roles, so its ids and times are not those of the blocks around it. Every id on this page from here to its end is from that run.

The read, then a write with no `If-Match`, then `helpdesk` putting `mei2`
in `oncall`:

```bash
curl -sS -D - -H "Authorization: Bearer $HELPDESK_TOKEN" \
  http://localhost:3000/admin/tenants/groups-demo/subjects/01a1a8b2-3622-7c10-8a54-7281a4c3cfa3/groups

curl -sS -D - -X PUT \
  -H "Authorization: Bearer $HELPDESK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"group_ids": ["01a1a8b2-32fe-72d5-8b42-367ce4e09849"]}' \
  http://localhost:3000/admin/tenants/groups-demo/subjects/01a1a8b2-3622-7c10-8a54-7281a4c3cfa3/groups

curl -sS -D - -X PUT \
  -H "Authorization: Bearer $HELPDESK_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"' \
  -d '{"group_ids": ["01a1a8b2-3185-7f82-8c55-61f0b1dbe23c"]}' \
  http://localhost:3000/admin/tenants/groups-demo/subjects/01a1a8b2-3622-7c10-8a54-7281a4c3cfa3/groups
```

```
HTTP/1.1 200 OK
x-request-id: 01a1a8b2-3f69-7dd3-b2fe-8006c5ae9e60
etag: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"
content-type: application/json; charset=utf-8
content-length: 12
Date: Wed, 04 Nov 2026 22:33:36 GMT

{"items":[]}

HTTP/1.1 428 Precondition Required
x-request-id: 01a1a8b2-3f7e-7d0a-be27-e517a89c60ee
content-type: application/problem+json; charset=utf-8
content-length: 181
Date: Wed, 04 Nov 2026 22:33:36 GMT

{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to replace a subject’s groups","instance":"01a1a8b2-3f7e-7d0a-be27-e517a89c60ee"}

HTTP/1.1 403 Forbidden
x-request-id: 01a1a8b2-3f9b-7d8c-864b-d2e55038a9c3
content-type: application/problem+json; charset=utf-8
content-length: 258
Date: Wed, 04 Nov 2026 22:33:36 GMT

{"type":"about:blank","title":"Forbidden","status":403,"detail":"the caller does not hold: tenant-admin, manage-clients, manage-tenant, manage-keys, manage-sessions, view-audit, view-domains, manage-domains","instance":"01a1a8b2-3f9b-7d8c-864b-d2e550
```

`oncall` names no role, and is refused for everything `tenant-admin`
composites that `helpdesk` does not hold — reached through its parent.
The membership is still empty, under the same tag, so the same `If-Match`
then puts `mei2` in `support`, and replaying it once that has landed is
stale:

```bash
curl -sS -D - -H "Authorization: Bearer $HELPDESK_TOKEN" \
  http://localhost:3000/admin/tenants/groups-demo/subjects/01a1a8b2-3622-7c10-8a54-7281a4c3cfa3/groups

curl -sS -D - -X PUT \
  -H "Authorization: Bearer $HELPDESK_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"' \
  -d '{"group_ids": ["01a1a8b2-32fe-72d5-8b42-367ce4e09849"]}' \
  http://localhost:3000/admin/tenants/groups-demo/subjects/01a1a8b2-3622-7c10-8a54-7281a4c3cfa3/groups

curl -sS -D - -X PUT \
  -H "Authorization: Bearer $HELPDESK_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"' \
  -d '{"group_ids": []}' \
  http://localhost:3000/admin/tenants/groups-demo/subjects/01a1a8b2-3622-7c10-8a54-7281a4c3cfa3/groups
```

```
HTTP/1.1 200 OK
x-request-id: 01a1a8b2-3fbb-73cf-8b3e-9bcbee85d026
etag: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"
content-type: application/json; charset=utf-8
content-length: 12
Date: Wed, 04 Nov 2026 22:33:36 GMT

{"items":[]}

HTTP/1.1 200 OK
x-request-id: 01a1a8b2-3fd0-72cd-84f4-cfdc80bcfd48
etag: "7077f0aba25d33ec1994d8a980c0506d603b6e345e60454c624713a0e7669efb"
content-type: application/json; charset=utf-8
content-length: 201
Date: Wed, 04 Nov 2026 22:33:36 GMT

{"items":[{"id":"01a1a8b2-32fe-72d5-8b42-367ce4e09849","name":"support","description":null,"parent_id":null,"default_for_new_subjects":false,"path":"/support","created_at":"2026-11-04T22:33:33.180Z"}]}

HTTP/1.1 412 Precondition Failed
x-request-id: 01a1a8b2-3ff0-70d7-a231-9aea2d4e69be
content-type: application/problem+json; charset=utf-8
content-length: 153
Date: Wed, 04 Nov 2026 22:33:36 GMT

{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a1a8b2-3ff0-70d7-a231-9aea2d4e69be"}
```

Both writes that reached the ceiling are in the trail, scoped here to
`mei2` — the refusal naming what was denied, the replacement the ids
before and after:

In the same tenant:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3000/admin/tenants/groups-demo/audit?action=subject.groups_set&resource_type=subject&resource_id=01a1a8b2-3622-7c10-8a54-7281a4c3cfa3'; echo
```

```
{"items":[{"id":"01a1a8b2-3fe5-7328-976c-4cf15df36cab","occurred_at":"2026-11-04T22:33:36.477Z","event_type":"admin_mutation","action":"subject.groups_set","outcome":"allowed","actor_tenant_id":"01a1a8b1-8127-7350-86b7-3cc9fb8bc5c0","actor_subject_id
```
