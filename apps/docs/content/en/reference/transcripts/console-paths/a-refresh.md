---
title: 'A refresh'
description: 'Within 30 seconds of expiry the gateway refreshes the access token as odudu-admin before it forwards a call; the browser sees no difference.'
---

# A refresh

On the session `01a1edf0-d095…` of `ada`'s first sign-in. Every request before
it ran on an access token with more than 30 s left. The gateway refreshes before
forwarding when less is left, and the token lives 300 s, so this section waited
until the stored expiry was under 30 s away (6 s, in this run). The refresh is a call to the tenant's
token endpoint as `odudu-admin`, carrying the assertion it signs; the server's
own `token` audit row names the grant and the client, and the proxied `GET`
shows no difference to the browser. These ran one after another, `$FROM` being
the timestamp printed first:

```bash
python3 -c "import datetime;print(datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.')+'%03dZ'%(datetime.datetime.now().microsecond//1000))"
curl -sS -D - -b jar \
  http://localhost:3000/console/api/admin/tenants/system/subjects/01a1ede6-ec0c-7392-9e7b-44c008443b65
curl -sS -D - -b jar \
  "http://localhost:3000/console/api/admin/tenants/system/audit?event_type=token&from=$FROM"
curl -sS -D - -b jar \
  "http://localhost:3000/console/api/admin/tenants/system/audit?action=grant.revoked_on_reuse&from=$FROM"
```

with this query, on the standard input of `psql` in the `postgres` container,
run before the `GET` and again after it:

```sql
select access_expires_at, access_expires_at - now() as remaining from console_sessions where id = '01a1edf0-d095-7b2a-b3ee-6039e9388c11';
```

Before:

```
     access_expires_at      |    remaining
----------------------------+-----------------
 2026-11-18 09:20:44.582+00 | 00:00:06.241557
(1 row)
```

`$FROM`, then the `GET`:

```
2026-11-18T09:20:38.399Z
```

```
HTTP/1.1 200 OK
x-request-id: 01a1edf5-4c14-7130-bb8b-04e8767edb66
content-type: application/json; charset=utf-8
etag: "b3222d9b79c137fe89adb86054eed78832e51e6e9cfea01f5dfbdce27a5938b0"
cache-control: no-store
content-length: 165
Date: Wed, 18 Nov 2026 09:20:38 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1ede6-ec0c-7392-9e7b-44c008443b65","type":"user","username":"ada","email":null,"enabled":true,"created_at":"2026-11-18T09:04:56.151Z","pending_email":null}
```

After, the expiry is 300 s from the refresh:

```
     access_expires_at      |    remaining
----------------------------+-----------------
 2026-11-18 09:25:38.425+00 | 00:04:58.468727
(1 row)
```

The tenant's `token` audit rows since `$FROM` are one `token.refresh`, on
the grant the sign-in created, by the client `odudu-admin`:

```
HTTP/1.1 200 OK
x-request-id: 01a1edf5-50f9-757b-98be-89e26020873d
content-type: application/json; charset=utf-8
cache-control: no-store
content-length: 554
Date: Wed, 18 Nov 2026 09:20:39 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a1edf5-4caa-7de4-b301-24fa6166d0fb","occurred_at":"2026-11-18T09:20:38.547Z","event_type":"token","action":"token.refresh","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a1ede6-ec0c-7392-9e7b-44c008443b65","actor_client_id":"01a1ede6-ebb3-7706-9a28-51f4cce0dcca","actor_name":"ada","actor_origin":"tenant","resource_type":"grant","resource_id":"01a1edf0-d086-7967-abc5-ec595e6fbd0c","request_id":"01a1edf5-4c14-7130-bb8b-04e8767edb66","ip":"172.20.0.1","detail":{"scope":"openid"}}]}
```

and the refresh token was presented once, since reuse detection revoked
nothing:

```
HTTP/1.1 200 OK
x-request-id: 01a1edf5-513e-70d2-be5b-0abf9b705519
content-type: application/json; charset=utf-8
cache-control: no-store
content-length: 12
Date: Wed, 18 Nov 2026 09:20:39 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[]}
```
