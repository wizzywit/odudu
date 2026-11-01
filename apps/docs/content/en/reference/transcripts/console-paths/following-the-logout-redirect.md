---
title: 'Following the logout redirect'
description: 'After a console logout the browser follows the redirect, and the console client signs out at once, with no confirmation page.'
---

# Following the logout redirect

`$REDIRECT` is the `redirect` above. The jar still holds `system-session` from
the sign-in. The console's own client has `skip_logout_confirmation` on, and the
ID token in the URL is its own, for the session in that cookie, so the tenant's
logout endpoint ends the session on this one request and answers the redirect
at once: no confirmation page, and the cookies cleared. Any other client would
have been asked (the [RP-initiated logout section on skipping the
page](../request-paths/rp-initiated-logout.md#a-client-may-skip-the-page) shows
both). This page ran on a new stack with the tenant `system` and the user `grace`
seeded, and `grace` signed in to the console with the jar `jar`:

```bash
curl -sS -D - -c jar -b jar "$REDIRECT"
```

```
HTTP/1.1 302 Found
x-request-id: 01a17d35-fe0d-7401-8988-dc816f1754b9
set-cookie: system-session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: system-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
cache-control: no-store
location: http://localhost:3194/console/
content-length: 0
Date: Tue, 27 Oct 2026 11:54:12 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

What is left, read from the database as the superuser. The queries below ran after
that request. They show the SSO session id `01a17d35-146a-7572-9f37-427aadc59c3a`, the one in the
`system-session` cookie and the ID token's `sid`, ended. The first query counts the
tenant's `console_sessions` rows, and this stack has had no other console session
live. The third lists two grants because the same SSO session had signed `grace` in
to the console twice, and ending it revoked both. psql ends each header line
with a space, which the formatter trims below; nothing else differs from what it
printed:

```sql
select count(*) as console_sessions from console_sessions where tenant_id = '0199aa00-0000-7000-8000-000000000001';
select id, expires_at <= now() as expired from sessions where id = '01a17d35-146a-7572-9f37-427aadc59c3a';
select g.session_id, g.revoked_at is not null as revoked from token_grants g join clients c on c.id = g.client_id where g.tenant_id = '0199aa00-0000-7000-8000-000000000001' and c.client_id = 'odudu-admin' and g.session_id = '01a17d35-146a-7572-9f37-427aadc59c3a';
```

```
 console_sessions
------------------
                0
(1 row)

                  id                  | expired
--------------------------------------+---------
 01a17d35-146a-7572-9f37-427aadc59c3a | t
(1 row)

              session_id              | revoked
--------------------------------------+---------
 01a17d35-146a-7572-9f37-427aadc59c3a | t
 01a17d35-146a-7572-9f37-427aadc59c3a | t
(2 rows)
```

The console cookie from before the logout, sent again (from a copy of the
jar taken just before the logout), is an ended session:

```bash
curl -sS -D - -b jar-before-logout http://localhost:3194/console/api/session
```

```
HTTP/1.1 401 Unauthorized
x-request-id: 01a17d35-ff7c-7d8f-82cd-bb59f0c21111
set-cookie: odudu-console=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0
content-type: application/problem+json; charset=utf-8
cache-control: no-store
content-length: 130
Date: Tue, 27 Oct 2026 11:54:13 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"status":401,"type":"about:blank#console-session-ended","title":"Unauthorized","instance":"01a17d35-ff7c-7d8f-82cd-bb59f0c21111"}
```
