---
title: 'Role composites: list and remove'
description: "Both require manage-tenant. The read answers the role's direct children only, each in the same shape GET /roles/:id answers, ordered by name — not…"
---

# Role composites: list and remove

This page covers `GET /roles/:id/composites` and `DELETE /roles/:id/composites/:childId`.

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
([a removal is judged by what it removes](./get-groupsidroles-and-put-groupsidroles.md#a-removal-is-judged-by-what-it-removes)).

In `composites-demo`, created through `POST /admin/tenants` for it.
`billing-admin` nests `billing-viewer` and `invoice-editor`, each nested there
through `POST /roles/:id/composites`:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3082/admin/tenants/composites-demo/roles/01a10bd5-586f-7d37-8635-d3d478ec27b0/composites
```

```
{"items":[{"id":"01a10bd5-5894-7574-967a-b9d73aca3cc2","name":"billing-viewer","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-10-05T11:31:33.651Z","admin_reach":[]},{"id":"01a10bd5-58b1-7f83-933d-edbb5b0d9d23","name":"invoice-editor","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-10-05T11:31:33.680Z","admin_reach":[]}]}
```

`invoice-editor` removed, the same removal repeated, then the read again:

```bash
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3082/admin/tenants/composites-demo/roles/01a10bd5-586f-7d37-8635-d3d478ec27b0/composites/01a10bd5-58b1-7f83-933d-edbb5b0d9d23
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3082/admin/tenants/composites-demo/roles/01a10bd5-586f-7d37-8635-d3d478ec27b0/composites/01a10bd5-58b1-7f83-933d-edbb5b0d9d23
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3082/admin/tenants/composites-demo/roles/01a10bd5-586f-7d37-8635-d3d478ec27b0/composites
```

```
HTTP/1.1 204 No Content
x-request-id: 01a10bd5-5a21-7f9e-9358-a6ddba04a460
cache-control: no-store
etag: "a90d843a406386c7b64d76101ec4d961177ac1f3e87c073b79619a8193246bb5"
Date: Mon, 05 Oct 2026 11:31:34 GMT
Connection: keep-alive
Keep-Alive: timeout=72

HTTP/1.1 404 Not Found
x-request-id: 01a10bd5-5a48-7b0f-bec0-64eb7de7a546
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 214
Date: Mon, 05 Oct 2026 11:31:34 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Not Found","status":404,"detail":"no composite 01a10bd5-58b1-7f83-933d-edbb5b0d9d23 under role 01a10bd5-586f-7d37-8635-d3d478ec27b0","instance":"01a10bd5-5a48-7b0f-bec0-64eb7de7a546"}
{"items":[{"id":"01a10bd5-5894-7574-967a-b9d73aca3cc2","name":"billing-viewer","description":null,"client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-10-05T11:31:33.651Z","admin_reach":[]}]}
```

The guard. `tenant-admin` does nest `manage-users` — so a refusal is not a
`404` for a missing edge — and every child's `client_id` is the tenant's
built-in admin client, `odudu-admin` by its `client_key`; removing that
edge, as `ada`, who holds `tenant-admin` itself:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/composites-demo/roles/01a1a8b1-849b-7d7b-8b9b-4c125123e0dd/composites
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/composites-demo/roles/01a1a8b1-849b-7d7b-8b9b-4c125123e0dd/composites/01a1a8b1-849e-7cc5-bf55-b09e03e03203
```

```
{"items":[{"id":"01a1a8b1-849f-7b65-8009-0a80dfbf3c03","name":"manage-clients","description":null,"client_id":"01a1a8b1-848b-71f5-90ea-6fbb151dfb17","client_key":"odudu-admin","default_for_new_subjects":false,"created_at":"2026-11-04T22:32:48.521Z","admin_reach":["manage-clients"]},{"id":"01a1a8b1-84a5-7f33-8301-d08c7b3e6564","name":"manage-domains","description":null,"client_id":"01a1a8b1-848b-71f5-90ea-6fbb151dfb17","client_key":"odudu-admin","default_for_new_subjects":false,"created_at":"2026-11-04T22:32:48.521Z","admin_reach":["view-domains","manage-domains"]},{"id":"01a1a8b1-84a1-705f-a869-a8e1375b77ec","name":"manage-keys","description":null,"client_id":"01a1a8b1-848b-71f5-90ea-6fbb151dfb17","client_key":"odudu-admin","default_for_new_subjects":false,"created_at":"2026-11-04T22:32:48.521Z","admin_reach":["manage-keys"]},{"id":"01a1a8b1-84a2-7901-a64e-bc4c0b40b3da","name":"manage-sessions","description":null,"client_id":"01a1a8b1-848b-71f5-90ea-6fbb151dfb17","client_key":"odudu-admin","default_for_new_subjects":false,"created_at":"2026-11-04T22:32:48.521Z","admin_reach":["manage-sessions"]},{"id":"01a1a8b1-84a0-75f1-a09e-7b7173dc7844","name":"manage-tenant","description":null,"client_id":"01a1a8b1-848b-71f5-90ea-6fbb151dfb17","client_key":"odudu-admin","default_for_new_subjects":false,"created_at":"2026-11-04T22:32:48.521Z","admin_reach":["manage-tenant"]},{"id":"01a1a8b1-849e-7cc5-bf55-b09e03e03203","name":"manage-users","description":null,"client_id":"01a1a8b1-848b-71f5-90ea-6fbb151dfb17","client_key":"odudu-admin","default_for_new_subjects":false,"created_at":"2026-11-04T22:32:48.521Z","admin_reach":["view-users","manage-users"]},{"id":"01a1a8b1-84a3-7e48-8a7c-f9ca22794e5f","name":"view-audit","description":null,"client_id":"01a1a8b1-848b-71f5-90ea-6fbb151dfb17","client_key":"odudu-admin","default_for_new_subjects":false,"created_at":"2026-11-04T22:32:48.521Z","admin_reach":["view-audit"]},{"id":"01a1a8b1-84a4-7d84-8742-1443da3ed46a","name":"view-domains","description":null,"client_id":"01a1a8b1-848b-71f5-90ea-6fbb151dfb17","client_key":"odudu-admin","default_for_new_subjects":false,"created_at":"2026-11-04T22:32:48.521Z","admin_reach":["view-domains"]},{"id":"01a1a8b1-849d-74c5-b537-7de865befcbb","name":"view-users","description":null,"client_id":"01a1a8b1-848b-71f5-90ea-6fbb151dfb17","client_key":"odudu-admin","default_for_new_subjects":false,"created_at":"2026-11-04T22:32:48.521Z","admin_reach":["view-users"]}]}

HTTP/1.1 409 Conflict
x-request-id: 01a1a8b2-a7b4-739f-8665-31264fe6bcbd
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 283
Date: Wed, 04 Nov 2026 22:34:03 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"tenant-admin is a capability of odudu-admin, this tenant's built-in admin client, and removing a composite from it would strip that from every administrator holding it","instance":"01a1a8b2-a7b4-739f-8665-31264fe6bcbd"}
```

This block ran again after `view-domains` and `manage-domains` joined the built-in roles, so its ids and times are not those of the blocks around it. `tenant-admin` nests nine roles now, `view-domains` and `manage-domains` among them.

The trail holds the removal that landed; the guarded one wrote its
`refused` row on `tenant-admin`, the role it was attempted on. Scoped to
the parent role's `resource_id`, since the action alone would also match
every other role's removals in this tenant:

With `actor_name` and `actor_origin` on each row, after the same three roles are
nested in a tenant of the same name and the same edge removed twice, the ids are
a fresh run's, not those above. The guarded removal there came later, and is
outside its scope either way:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3082/admin/tenants/composites-demo/audit?action=role.composite_remove&resource_type=role&resource_id=01a0ee92-a1c5-70f4-b754-e2b9d40c22c7'; echo
```

```
{"items":[{"id":"01a0ee92-a3d6-72f5-8f9e-9b31dd3f3923","occurred_at":"2026-09-29T19:09:42.712Z","event_type":"admin_mutation","action":"role.composite_remove","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0ee8a-bfb8-763c-ac22-0c8d97b0fada","actor_client_id":"01a0ee8a-bf72-77c9-a423-f61084924d9f","actor_name":null,"actor_origin":"system","resource_type":"role","resource_id":"01a0ee92-a1c5-70f4-b754-e2b9d40c22c7","request_id":"01a0ee92-a38e-7adc-ab75-39fad347ea6c","ip":"172.22.0.1","detail":{"child_role_id":"01a0ee92-a205-756a-8ca0-a2fbca9167e0"}}]}
```

## Composites answer an `ETag`

`GET …/composites` answers an `ETag` over the list it returns, and both
composite writes answer the list's new one — `POST` beside its `204`, and
`DELETE` beside its. `If-Match` is optional on both, as it has always been:
honoured when sent, and a stale one is refused with `412` before anything
changes. In `etags-demo`, on its `billing-viewer` and a second role
`billing-reader` (`01a10bd4-90c5-717d-b188-344280ce610d`), starting from no
composites:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3082/admin/tenants/etags-demo/roles/01a10bd4-90e5-79e8-92bd-8f9024ae8829/composites \
  | grep -E '^(HTTP/|etag:|\{)'
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -H 'If-Match: "0000"' -d '{"child_role_id":"01a10bd4-90c5-717d-b188-344280ce610d"}' \
  http://localhost:3082/admin/tenants/etags-demo/roles/01a10bd4-90e5-79e8-92bd-8f9024ae8829/composites \
  | grep -E '^(HTTP/|etag:|\{)'
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -H 'If-Match: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"' \
  -d '{"child_role_id":"01a10bd4-90c5-717d-b188-344280ce610d"}' \
  http://localhost:3082/admin/tenants/etags-demo/roles/01a10bd4-90e5-79e8-92bd-8f9024ae8829/composites \
  | grep -E '^(HTTP/|etag:|\{)'
curl -sS -D - -o /dev/null -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3082/admin/tenants/etags-demo/roles/01a10bd4-90e5-79e8-92bd-8f9024ae8829/composites \
  | grep -E '^(HTTP/|etag:)'
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'If-Match: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"' \
  http://localhost:3082/admin/tenants/etags-demo/roles/01a10bd4-90e5-79e8-92bd-8f9024ae8829/composites/01a10bd4-90c5-717d-b188-344280ce610d \
  | grep -E '^(HTTP/|etag:|\{)'
```

Each one's status line, `etag` header and body, in that order. The last is
the empty list's `ETag` again, which no longer matches once the edge
exists:

```
HTTP/1.1 200 OK
etag: "eef46741adfc3a9f76294d3b78f37a45f113092ac9d44ee77c7a038a88ff09a1"
{"items":[]}
HTTP/1.1 412 Precondition Failed
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a10bd4-9189-73aa-8144-d537d3d723dc"}
HTTP/1.1 204 No Content
etag: "d3a2f8e19b84fd992be23207e179afe9b80112fabeb7a204f9d2eec6ae178147"
HTTP/1.1 200 OK
etag: "d3a2f8e19b84fd992be23207e179afe9b80112fabeb7a204f9d2eec6ae178147"
HTTP/1.1 412 Precondition Failed
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a10bd4-91db-7ba1-a35e-922a461fed09"}
```
