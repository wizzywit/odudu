---
title: 'A refresh the server refuses'
description: 'When the server refuses a refresh, the grant is revoked, the next call answers a session-ended 401 and clears its cookie, and the row is gone.'
---

# A refresh the server refuses

On the same session, straight after the lock section. Its grant is revoked
through the console itself, by ending the SSO session the grant is bound to; a
write names the session's subject in `X-Odudu-Console-Subject`, as every write
must, or it is refused as another principal's. `ada` holds two live sessions at
this point, the first sign-in's loopback one and this run's own,
`01a1e3fd-1c39-…`, the one in its `system-session` cookie:

```bash
curl -sS -D - -b jar http://localhost:3000/console/api/admin/tenants/system/subjects/01a1e3fd-18d7-7d86-b3fb-2af7f7fda495/sessions
curl -sS -D - -c jar -b jar -X DELETE \
  -H 'Origin: http://localhost:3000' -H 'X-Odudu-Console: 1' \
  -H 'X-Odudu-Console-Subject: 01a1e3fd-18d7-7d86-b3fb-2af7f7fda495' \
  http://localhost:3000/console/api/admin/tenants/system/subjects/01a1e3fd-18d7-7d86-b3fb-2af7f7fda495/sessions/01a1e3fd-1c39-7eed-a725-bba505e48d03
```

```
HTTP/1.1 200 OK
x-request-id: 01a1e3fd-1d79-742a-884f-14941398bdfa
content-type: application/json; charset=utf-8
cache-control: no-store
content-length: 519
Date: Mon, 16 Nov 2026 10:52:58 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a1e3fd-1a03-7cb6-8c97-79857a1f1f06","created_at":"2026-11-16T10:52:57.726Z","last_active_at":"2026-11-16T10:52:57.726Z","remembered":false,"client_ids":["odudu-admin"],"device":"af000c9c19427ecaa9549fb6aae857b719038f405993224f720ca83316ea1d37"},{"id":"01a1e3fd-1c39-7eed-a725-bba505e48d03","created_at":"2026-11-16T10:52:58.292Z","last_active_at":"2026-11-16T10:52:58.292Z","remembered":false,"client_ids":["odudu-admin"],"device":"f41681ef4701a4a4c5e0dc8240588f6de3ec822d776a2c359d84aa99865d86eb"}]}
```

```
HTTP/1.1 204 No Content
x-request-id: 01a1e3fd-1da7-71f5-812e-94d0471253d3
cache-control: no-store
Date: Mon, 16 Nov 2026 10:52:58 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

This file, `q-state.sql`, run through the same `psql` as the refresh
sections, reads the console session's stored access-token expiry and
whether the grant is revoked. psql's trailing header spaces are trimmed
below:

```sql
select id, access_expires_at, access_expires_at - now() as remaining from console_sessions where tenant_id = '0199aa00-0000-7000-8000-000000000001' and subject_id = '01a1e3fd-18d7-7d86-b3fb-2af7f7fda495' and id = '01a1e3fd-1cb6-7ba6-87c7-41db6e56d067';
select g.revoked_at is not null as revoked from token_grants g where g.session_id = '01a1e3fd-1c39-7eed-a725-bba505e48d03';
```

Right after the `DELETE`, the grant is revoked and the console session is
still there, its access token good for almost five more minutes:

```
                  id                  |     access_expires_at     |   remaining
--------------------------------------+---------------------------+----------------
 01a1e3fd-1cb6-7ba6-87c7-41db6e56d067 | 2026-11-16 10:57:58.35+00 | 00:04:59.48459
(1 row)

 revoked
---------
 t
(1 row)
```

Nothing was sent until the token was inside its 30 s refresh window. Then,
one after another: the query, a proxied `GET`, the query again, and the
session read with a copy of the jar taken before the `GET`:

```bash
docker compose -p odudu-p4f-i14 exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < q-state.sql
cp jar jar-before-call
curl -sS -D - -c jar -b jar \
  http://localhost:3000/console/api/admin/tenants/system/subjects/01a1e3fd-18d7-7d86-b3fb-2af7f7fda495
docker compose -p odudu-p4f-i14 exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < q-state.sql
curl -sS -D - -b jar-before-call http://localhost:3000/console/api/session
```

```
                  id                  |     access_expires_at     |    remaining
--------------------------------------+---------------------------+-----------------
 01a1e3fd-1cb6-7ba6-87c7-41db6e56d067 | 2026-11-16 10:57:58.35+00 | 00:00:24.792277
(1 row)

 revoked
---------
 t
(1 row)
```

The `GET` is the session-ended `401`, and its cookie is cleared:

```
HTTP/1.1 401 Unauthorized
x-request-id: 01a1e401-4f91-72ea-901d-2620152e83a9
set-cookie: odudu-console=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0
content-type: application/problem+json; charset=utf-8
cache-control: no-store
content-length: 130
Date: Mon, 16 Nov 2026 10:57:33 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"status":401,"type":"about:blank#console-session-ended","title":"Unauthorized","instance":"01a1e401-4f91-72ea-901d-2620152e83a9"}
```

The row is gone:

```
 id | access_expires_at | remaining
----+-------------------+-----------
(0 rows)

 revoked
---------
 t
(1 row)
```

The cookie from before the `GET` names nothing now:

```
HTTP/1.1 401 Unauthorized
x-request-id: 01a1e401-5028-7dfd-a8ed-9d1eeb9ba117
set-cookie: odudu-console=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0
content-type: application/problem+json; charset=utf-8
cache-control: no-store
content-length: 130
Date: Mon, 16 Nov 2026 10:57:33 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"status":401,"type":"about:blank#console-session-ended","title":"Unauthorized","instance":"01a1e401-5028-7dfd-a8ed-9d1eeb9ba117"}
```

The server's request log for that second shows which check ended it. The
`GET` never reached `/admin/`. The gateway refreshed first, under the
`GET`'s own request id, and the token endpoint answered `400`:

```bash
docker compose -p odudu-p4f-i14 logs --since $(cat p3-from.txt) odudu 2>&1 \
  | sed 's/^[^{]*//' \
  | jq -c 'select(.msg == "incoming request" or .msg == "request completed") | [.reqId, .req.method // .res.statusCode, .req.url // null]'
```

```
["01a1e401-4f91-72ea-901d-2620152e83a9","GET","/console/api/admin/tenants/system/subjects/01a1e3fd-18d7-7d86-b3fb-2af7f7fda495"]
["01a1e401-4f91-72ea-901d-2620152e83a9","POST","/tenants/system/protocol/openid-connect/token"]
["01a1e401-4f91-72ea-901d-2620152e83a9",400,null]
["01a1e401-4f91-72ea-901d-2620152e83a9",401,null]
["01a1e401-5028-7dfd-a8ed-9d1eeb9ba117","GET","/console/api/session"]
["01a1e401-5028-7dfd-a8ed-9d1eeb9ba117",401,null]
```
