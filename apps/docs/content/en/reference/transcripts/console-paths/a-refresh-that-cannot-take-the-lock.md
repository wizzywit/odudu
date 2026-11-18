---
title: 'A refresh that cannot take the lock'
description: "A refresh waits at most five seconds for the session's row lock, so two refreshes of one session never present its refresh token twice."
---

# A refresh that cannot take the lock

On the same session, 4.5 minutes after its last refresh. A refresh holds
the session's row lock, waiting at most 5 s for it, so that two refreshes of one
session never present its refresh token twice. Here `psql` holds that lock for
12 s while a request that needs a refresh arrives. The lock is taken by this
file, `q-lock.sql`, through the same `psql`:

```sql
BEGIN;
SELECT id, clock_timestamp() AS locked_at FROM console_sessions WHERE id = '01a1edf0-d095-7b2a-b3ee-6039e9388c11' FOR UPDATE;
SELECT pg_sleep(12);
SELECT clock_timestamp() AS releasing_at;
COMMIT;
```

The steps, in order: the expiry query from the section above; `$FROM`;
the lock file started in the background; one second later the `GET`, with
curl printing its total time; then, once `psql` had committed, the same
`GET`, the expiry query, and the `token` audit rows since `$FROM`.

```bash
python3 -c "import datetime;print(datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.')+'%03dZ'%(datetime.datetime.now().microsecond//1000))"
docker compose -p odudu-docs-12b exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < q-lock.sql &
sleep 1
curl -sS -D - -w 'time_total: %{time_total}\n' -b jar \
  http://localhost:3000/console/api/admin/tenants/system/subjects/01a1ede6-ec0c-7392-9e7b-44c008443b65
wait
curl -sS -D - -b jar \
  http://localhost:3000/console/api/admin/tenants/system/subjects/01a1ede6-ec0c-7392-9e7b-44c008443b65
curl -sS -D - -b jar \
  "http://localhost:3000/console/api/admin/tenants/system/audit?event_type=token&from=$FROM"
```

Before, the token was inside the refresh window:

```
     access_expires_at      |    remaining
----------------------------+-----------------
 2026-11-18 09:25:38.425+00 | 00:00:24.981452
(1 row)
```

```
2026-11-18T09:25:13.522Z
```

The lock, held from 09:25:13.62 to 09:25:25.64. The `pg_sleep` value line
is a single space, trimmed below like the header spaces:

```
BEGIN
                  id                  |           locked_at
--------------------------------------+-------------------------------
 01a1edf0-d095-7b2a-b3ee-6039e9388c11 | 2026-11-18 09:25:13.623146+00
(1 row)

 pg_sleep
----------

(1 row)

         releasing_at
-------------------------------
 2026-11-18 09:25:25.643883+00
(1 row)

COMMIT
```

The `GET` sent while it was held waited 5 s for the lock and was answered
`502`, at 09:25:19, inside the lock's twelve seconds. curl's `time_total`
follows the body on the same line, since the body ends without a newline:

```
HTTP/1.1 502 Bad Gateway
x-request-id: 01a1edf9-82bb-7446-8d1b-3075bee7ddd4
content-type: application/problem+json; charset=utf-8
cache-control: no-store
content-length: 107
Date: Wed, 18 Nov 2026 09:25:19 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"status":502,"type":"about:blank","title":"Bad Gateway","instance":"01a1edf9-82bb-7446-8d1b-3075bee7ddd4"}time_total: 5.051171
```

The session was kept. The `GET` after the commit refreshed and was
forwarded:

```
HTTP/1.1 200 OK
x-request-id: 01a1edf9-ae27-78c7-9b6f-526450111280
content-type: application/json; charset=utf-8
etag: "b3222d9b79c137fe89adb86054eed78832e51e6e9cfea01f5dfbdce27a5938b0"
cache-control: no-store
content-length: 165
Date: Wed, 18 Nov 2026 09:25:25 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1ede6-ec0c-7392-9e7b-44c008443b65","type":"user","username":"ada","email":null,"enabled":true,"created_at":"2026-11-18T09:04:56.151Z","pending_email":null}
```

```
     access_expires_at      |    remaining
----------------------------+-----------------
 2026-11-18 09:30:25.672+00 | 00:04:59.802709
(1 row)
```

Since `$FROM` there is one `token.refresh`, the one after the commit. The
request that timed out on the lock never reached the token endpoint:

```
HTTP/1.1 200 OK
x-request-id: 01a1edf9-af03-73ab-9892-9002fb8d2443
content-type: application/json; charset=utf-8
cache-control: no-store
content-length: 554
Date: Wed, 18 Nov 2026 09:25:25 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a1edf9-ae6c-719b-8444-fa33dcb01b59","occurred_at":"2026-11-18T09:25:25.731Z","event_type":"token","action":"token.refresh","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a1ede6-ec0c-7392-9e7b-44c008443b65","actor_client_id":"01a1ede6-ebb3-7706-9a28-51f4cce0dcca","actor_name":"ada","actor_origin":"tenant","resource_type":"grant","resource_id":"01a1edf0-d086-7967-abc5-ec595e6fbd0c","request_id":"01a1edf9-ae27-78c7-9b6f-526450111280","ip":"172.20.0.1","detail":{"scope":"openid"}}]}
```

The run's session was not logged out until the next section ended it, so its
`console_sessions` row was there throughout.
