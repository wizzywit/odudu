---
title: 'POST /console/auth/logout'
description: 'A console logout ends the console session. It is sent with no body, under the same CSRF guard as every other write.'
---

# `POST /console/auth/logout`

On a console session of `grace`'s, signed in with its own `jar` and ended
here, so the sections around it keep the first. Sent with no body. The same CSRF
guard applies here. `$SINCE` is the second before it:

```bash
curl -sS -D - -c jar -b jar -X POST \
  -H 'Origin: http://localhost:3194' -H 'X-Odudu-Console: 1' \
  http://localhost:3194/console/auth/logout
docker compose -p odudu-skip2 logs --since $SINCE odudu 2>&1 \
  | sed 's/^[^{]*//' \
  | jq -c 'select(.reqId == "01a17d35-5aaf-72f8-9e0f-8b8afabdb050" and (.msg == "incoming request" or .msg == "request completed")) | [.reqId, .req.method // .res.statusCode, .req.url // null]'
```

```
HTTP/1.1 200 OK
x-request-id: 01a17d35-5aaf-72f8-9e0f-8b8afabdb050
cache-control: no-store
set-cookie: odudu-console=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0
content-type: application/json; charset=utf-8
content-length: 713
Date: Tue, 27 Oct 2026 11:53:31 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"redirect":"http://localhost:3194/tenants/system/protocol/openid-connect/logout?id_token_hint=eyJhbGciOiJFUzI1NiIsImtpZCI6IjAxYTE3ZDMwLTUzMjEtN2QzMS05NDM2LTk1NjhkNDc0YjY1MCJ9.eyJzdWIiOiIwMWExN2QzNC1mNjI0LTc3OTktYjI3NS1hZGRhNzM1YTNlNDkiLCJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMxOTQvdGVuYW50cy9zeXN0ZW0iLCJhdWQiOiJvZHVkdS1hZG1pbiIsImlhdCI6MTc5MzEwMTk5MywiZXhwIjoxNzkzMTAyMjkzLCJub25jZSI6IkVpampIM18waE9iLTRrMEtseGpDM2xkdmRpbkREVkdRYXh2blVzTUJ1NFEiLCJzaWQiOiIwMWExN2QzNS0xNDZhLTc1NzItOWYzNy00MjdhYWRjNTljM2EiLCJhbXIiOlsicHdkIl0sImFjciI6IjEifQ.IBQkIqaT1ThmA5-8p0E9kAwsJLPV8egISfaSnMVOenFBwsTjYltFX5__Pvo05M4nPk8NEbKB4FwV_EDLS3INXw&post_logout_redirect_uri=http%3A%2F%2Flocalhost%3A3194%2Fconsole%2F&client_id=odudu-admin"}
```

The log, with the stack's own health probes left out. The gateway revoked the
session's refresh token at the tenant's `/revoke`, signing the assertion it
authenticates with, and the endpoint answered `200`. An unsigned revocation would
have been refused and the token left alive; [the section above](./the-gateway-is-a-confidential-client.md)
shows that refusal:

```
["01a17d35-5aaf-72f8-9e0f-8b8afabdb050","POST","/console/auth/logout"]
["01a17d35-5aaf-72f8-9e0f-8b8afabdb050","POST","/tenants/system/protocol/openid-connect/revoke"]
["01a17d35-5aaf-72f8-9e0f-8b8afabdb050",200,null]
["01a17d35-5aaf-72f8-9e0f-8b8afabdb050","GET","/tenants/system/.well-known/openid-configuration"]
["01a17d35-5aaf-72f8-9e0f-8b8afabdb050",200,null]
["01a17d35-5aaf-72f8-9e0f-8b8afabdb050",200,null]
```

By the time this answered, the gateway had revoked the session's refresh
token, deleted its `console_sessions` row and cleared its cookie. The
tenant's SSO session is still live. Only the browser's own navigation to
`redirect` carries the SSO cookie, so the SPA follows it itself, and the tenant's
logout endpoint then ends that session at once, because the console's own client
has opted out of the confirmation
([next](./following-the-logout-redirect.md)).
