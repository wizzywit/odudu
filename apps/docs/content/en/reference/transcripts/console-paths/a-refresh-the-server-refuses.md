---
title: 'A refresh the server refuses'
description: 'When the server refuses a refresh, the grant is revoked, the next call answers a session-ended 401 and clears its cookie, and the row is gone.'
---

# A refresh the server refuses

> **Not replayed after the device field.** A session in a block on this page now also carries `device`, which the blocks below do not show, because this page was captured before the field existed and has not been run again. [A session's device](../request-paths/the-me-api.md#a-sessions-device) is a live capture of it.

On the same session, straight after the lock section. Its grant is revoked
through the console itself, by ending the SSO session the grant is bound to; a
write names the session's subject in `X-Odudu-Console-Subject`, as every write
must, or it is refused as another principal's. `ada` holds two live sessions at
this point, the first sign-in's loopback one and this run's own,
`01a17b05-62b9-…`, the one in its `system-session` cookie:

```bash
curl -sS -D - -b jar http://localhost:3082/console/api/admin/tenants/system/subjects/01a17b04-bdeb-7b73-a5a4-a5674032af15/sessions
curl -sS -D - -c jar -b jar -X DELETE \
  -H 'Origin: http://localhost:3082' -H 'X-Odudu-Console: 1' \
  -H 'X-Odudu-Console-Subject: 01a17b04-bdeb-7b73-a5a4-a5674032af15' \
  http://localhost:3082/console/api/admin/tenants/system/subjects/01a17b04-bdeb-7b73-a5a4-a5674032af15/sessions/01a17b05-62b9-7a06-8827-1b50aeec0e5d
```

```
HTTP/1.1 200 OK
x-request-id: 01a17b16-2bfe-72f8-b9e7-ac02309d60a3
content-type: application/json; charset=utf-8
cache-control: no-store
content-length: 367
Date: Tue, 27 Oct 2026 02:00:13 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a17b05-41f4-7e19-aa04-8d1bb5fb9a7a","created_at":"2026-10-27T01:41:44.563Z","last_active_at":"2026-10-27T01:42:12.701Z","remembered":false,"client_ids":["odudu-admin"]},{"id":"01a17b05-62b9-7a06-8827-1b50aeec0e5d","created_at":"2026-10-27T01:41:52.952Z","last_active_at":"2026-10-27T01:59:32.777Z","remembered":false,"client_ids":["odudu-admin"]}]}
```

```
HTTP/1.1 204 No Content
x-request-id: 01a17b16-2c20-77c0-b61e-ec889d88a83b
cache-control: no-store
Date: Tue, 27 Oct 2026 02:00:13 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

This file, `q-state.sql`, run through the same `psql` as the refresh
sections, reads the console session's stored access-token expiry and
whether the grant is revoked. psql's trailing header spaces are trimmed
below:

```sql
select id, access_expires_at, access_expires_at - now() as remaining from console_sessions where tenant_id = '0199aa00-0000-7000-8000-000000000001' and subject_id = '01a17b04-bdeb-7b73-a5a4-a5674032af15' and id = '01a17b05-62e9-703b-8cae-7a216ade12de';
select g.revoked_at is not null as revoked from token_grants g where g.session_id = '01a17b05-62b9-7a06-8827-1b50aeec0e5d';
```

Right after the `DELETE`, the grant is revoked and the console session is
still there, its access token good for four more minutes:

```
                  id                  |     access_expires_at      |    remaining
--------------------------------------+----------------------------+-----------------
 01a17b05-62e9-703b-8cae-7a216ade12de | 2026-10-27 02:04:32.765+00 | 00:04:19.569486
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
docker compose -p odudu-docs-12b exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < q-state.sql
cp jar jar-before-call
curl -sS -D - -c jar -b jar \
  http://localhost:3082/console/api/admin/tenants/system/subjects/01a17b04-bdeb-7b73-a5a4-a5674032af15
docker compose -p odudu-docs-12b exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < q-state.sql
curl -sS -D - -b jar-before-call http://localhost:3082/console/api/session
```

```
                  id                  |     access_expires_at      |    remaining
--------------------------------------+----------------------------+-----------------
 01a17b05-62e9-703b-8cae-7a216ade12de | 2026-10-27 02:04:32.765+00 | 00:00:25.426517
(1 row)

 revoked
---------
 t
(1 row)
```

The `GET` is the session-ended `401`, and its cookie is cleared:

```
HTTP/1.1 401 Unauthorized
x-request-id: 01a17b19-bf44-7da3-9cc6-018fc3960c08
set-cookie: odudu-console=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0
content-type: application/problem+json; charset=utf-8
cache-control: no-store
content-length: 130
Date: Tue, 27 Oct 2026 02:04:07 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"status":401,"type":"about:blank#console-session-ended","title":"Unauthorized","instance":"01a17b19-bf44-7da3-9cc6-018fc3960c08"}
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
x-request-id: 01a17b19-bfbe-7140-92a0-4d4cc6235828
set-cookie: odudu-console=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0
content-type: application/problem+json; charset=utf-8
cache-control: no-store
content-length: 130
Date: Tue, 27 Oct 2026 02:04:07 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"status":401,"type":"about:blank#console-session-ended","title":"Unauthorized","instance":"01a17b19-bfbe-7140-92a0-4d4cc6235828"}
```

The server's request log for that second shows which check ended it. The
`GET` never reached `/admin/`. The gateway refreshed first, under the
`GET`'s own request id, and the token endpoint answered `400`:

```bash
docker compose -p odudu-docs-12b logs --since $(cat p3-from.txt) odudu 2>&1 \
  | sed 's/^[^{]*//' \
  | jq -c 'select(.msg == "incoming request" or .msg == "request completed") | [.reqId, .req.method // .res.statusCode, .req.url // null]'
```

```
["01a17b19-bf44-7da3-9cc6-018fc3960c08","GET","/console/api/admin/tenants/system/subjects/01a17b04-bdeb-7b73-a5a4-a5674032af15"]
["01a17b19-bf44-7da3-9cc6-018fc3960c08","POST","/tenants/system/protocol/openid-connect/token"]
["01a17b19-bf44-7da3-9cc6-018fc3960c08",400,null]
["01a17b19-bf44-7da3-9cc6-018fc3960c08",401,null]
["01a17b19-bfbe-7140-92a0-4d4cc6235828","GET","/console/api/session"]
["01a17b19-bfbe-7140-92a0-4d4cc6235828",401,null]
```
