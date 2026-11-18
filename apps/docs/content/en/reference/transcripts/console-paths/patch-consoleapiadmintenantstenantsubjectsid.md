---
title: 'PATCH /console/api/admin/tenants/{tenant}/subjects/{id}'
description: "A write through the console proxy carries If-Match and names the session's subject in the X-Odudu-Console-Subject header."
---

# `PATCH /console/api/admin/tenants/{tenant}/subjects/{id}`

On `grace`'s session. `If-Match` is one of the four request headers the proxy
forwards, and every write names the session's subject in
`X-Odudu-Console-Subject`
([below](./post-consoleapiadmintenantstenantsubjects-refused-for-another-principal.md)).
The `ETag` comes from a read of `hopper`:

```bash
curl -sS -D - -c jar -b jar -H 'X-Odudu-Console-Subject: 01a1edf1-4be2-7d84-b717-8bbb96a53677' \
  http://localhost:3000/console/api/admin/tenants/console-paths/subjects/01a1edf1-4c5e-7369-8846-d7678379b7f1
```

```
HTTP/1.1 200 OK
x-request-id: 01a1edf1-b161-75fc-89b2-50f85a72b7c0
content-type: application/json; charset=utf-8
etag: "2b18cf8cd3e4689c50e9ba079b816e5185705a12554c3f3c9018dbebfa28d745"
cache-control: no-store
content-length: 184
Date: Wed, 18 Nov 2026 09:16:42 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1edf1-4c5e-7369-8846-d7678379b7f1","type":"user","username":"hopper","email":"hopper@example.com","enabled":true,"created_at":"2026-11-18T09:16:16.347Z","pending_email":null}
```

A write under `/console/api/` must carry the base's `Origin` and
`X-Odudu-Console: 1` (see the next section). This one disables `hopper`, on
that `ETag`. A change of `email` would not do here: it is mailed to the new
address and leaves the stored `email` and so the `ETag` as they were, which
[`PATCH /subjects/:id`](../admin-paths/patch-subjectsid.md#changing-an-email-the-person-confirms)
shows:

```bash
curl -sS -D - -c jar -b jar -X PATCH \
  -H 'Origin: http://localhost:3000' -H 'X-Odudu-Console: 1' \
  -H 'X-Odudu-Console-Subject: 01a1edf1-4be2-7d84-b717-8bbb96a53677' \
  -H 'Content-Type: application/json' \
  -H 'If-Match: "2b18cf8cd3e4689c50e9ba079b816e5185705a12554c3f3c9018dbebfa28d745"' \
  -d '{"enabled":false}' \
  http://localhost:3000/console/api/admin/tenants/console-paths/subjects/01a1edf1-4c5e-7369-8846-d7678379b7f1
```

```
HTTP/1.1 200 OK
x-request-id: 01a1edf1-b193-752e-8398-68d2f9f4eda3
content-type: application/json; charset=utf-8
etag: "4a18970a7b62ce0df2c88d78fa4d7cf390aaeaa7287c5bfd47a4735485af3742"
cache-control: no-store
content-length: 185
Date: Wed, 18 Nov 2026 09:16:42 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1edf1-4c5e-7369-8846-d7678379b7f1","type":"user","username":"hopper","email":"hopper@example.com","enabled":false,"created_at":"2026-11-18T09:16:16.347Z","pending_email":null}
```

The same `If-Match` again, which that write made stale. The `412` is the
admin API's own, passed back unchanged. Its `instance` is the `x-request-id`
the browser was answered with, because the gateway sends that id upstream:

```bash
curl -sS -D - -c jar -b jar -X PATCH \
  -H 'Origin: http://localhost:3000' -H 'X-Odudu-Console: 1' \
  -H 'X-Odudu-Console-Subject: 01a1edf1-4be2-7d84-b717-8bbb96a53677' \
  -H 'Content-Type: application/json' \
  -H 'If-Match: "2b18cf8cd3e4689c50e9ba079b816e5185705a12554c3f3c9018dbebfa28d745"' \
  -d '{"enabled":false}' \
  http://localhost:3000/console/api/admin/tenants/console-paths/subjects/01a1edf1-4c5e-7369-8846-d7678379b7f1
```

```
HTTP/1.1 412 Precondition Failed
x-request-id: 01a1edf1-b1c9-7f43-8f8a-3f18b0b0ba22
content-type: application/problem+json; charset=utf-8
cache-control: no-store
content-length: 153
Date: Wed, 18 Nov 2026 09:16:42 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a1edf1-b1c9-7f43-8f8a-3f18b0b0ba22"}
```

The write's audit row, read through the proxy for the second in which the
three requests ran (`2026-11-18T09:16:42Z`, printed by `date -u` before the
first), carries the `PATCH`'s own `x-request-id` as its `request_id`, and
answers `actor_name` and `actor_origin`:

```bash
curl -sS -D - -b jar -H 'X-Odudu-Console-Subject: 01a1edf1-4be2-7d84-b717-8bbb96a53677' \
  'http://localhost:3000/console/api/admin/tenants/console-paths/audit?from=2026-11-18T09:16:42Z&to=2026-11-18T09:16:43Z'
```

```
HTTP/1.1 200 OK
x-request-id: 01a1edf1-b643-788c-a3aa-08897022cb20
content-type: application/json; charset=utf-8
cache-control: no-store
content-length: 590
Date: Wed, 18 Nov 2026 09:16:43 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a1edf1-b1b8-77e7-aa03-66f121548d56","occurred_at":"2026-11-18T09:16:42.286Z","event_type":"admin_mutation","action":"subject.amend","outcome":"allowed","actor_tenant_id":"01a1edf1-48f8-7169-a65d-edcba624324f","actor_subject_id":"01a1edf1-4be2-7d84-b717-8bbb96a53677","actor_client_id":"01a1edf1-4914-76e6-ad4d-003eed92415f","actor_name":"grace","actor_origin":"tenant","resource_type":"subject","resource_id":"01a1edf1-4c5e-7369-8846-d7678379b7f1","request_id":"01a1edf1-b193-752e-8398-68d2f9f4eda3","ip":"172.20.0.1","detail":{"enabled":{"after":false,"before":true}}}]}
```
