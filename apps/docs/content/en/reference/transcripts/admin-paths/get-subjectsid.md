---
title: 'GET /subjects/:id'
description: 'Requires view-users, the same capability the listing does.'
---

# `GET /subjects/:id`

Requires `view-users`, the same capability the listing does. Carries an
`ETag` computed over the response body, the same convention every other
single-resource read in this API follows, except for `pending_email`: the
address an administrator asked to change to and the person has not confirmed
([`PATCH /subjects/:id`](./patch-subjectsid.md#changing-an-email-the-person-confirms)),
or `null`, which is in no list and no part of the `ETag`. An unknown id answers
`404`.

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/subjects/01a1ede9-94a6-7f42-8017-3db17df2ee91
```

```
HTTP/1.1 200 OK
x-request-id: 01a1edea-06c8-7d94-92c1-40f95a0c6a43
cache-control: no-store
etag: "7b2ee19449bac2c5f4ee270f1605a34cab90a04b4b3607962577478bcca34ff3"
content-type: application/json; charset=utf-8
content-length: 178
Date: Wed, 18 Nov 2026 09:08:19 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1ede9-94a6-7f42-8017-3db17df2ee91","type":"user","username":"ada","email":"ada@example.com","enabled":true,"created_at":"2026-11-18T09:07:50.563Z","pending_email":null}
```
