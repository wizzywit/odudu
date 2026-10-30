---
title: An admin signs in and changes a user
description: Sign an administrator in to the console, check who you are, change a user with a safe update, and sign out, with the real requests.
sidebar_position: 3
---

# An admin signs in and changes a user

The admin console signs an administrator in through the same flow your users meet, then does the admin work for them. The browser holds one cookie and no token: the tokens stay on the server. This guide follows one administrator, `grace`, from sign-in to changing another user, `hopper`.

The excerpts come from several real runs on different stacks: steps 1 to 4 from one, steps 5 to 7 from another and step 8 from a third. Ports and ids therefore differ between steps, and each full transcript says which run it is. Every command keeps one cookie jar, `jar`.

## 1. Start the sign-in

Send the browser to `/console/auth/login` with the tenant and where to land afterwards. The console answers with a redirect to the tenant's own sign-in.

```bash
curl -sS -D - -c jar -b jar \
  'http://localhost:3000/console/auth/login?tenant=console-paths&return_to=/console/x'
```

```
set-cookie: odudu-console-login=01a17b02-1a9a-78f4-a746-1a223a533ca7.3CtlssHNJxU43xqp5aDXjUjTYI3DUcyyvPx-gvAS0dI; HttpOnly; SameSite=Lax; Path=/; Max-Age=1800
location: http://localhost:3000/tenants/console-paths/protocol/openid-connect/auth?response_type=code&client_id=odudu-admin&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fconsole%2Fauth%2Fcallback&scope=openid&resource=urn%3Aodudu%3Aparams%3Aadmin-api&state=01a17b02-1a9a-78f4-a746-1a223a533ca7.3CtlssHNJxU43xqp5aDXjUjTYI3DUcyyvPx-gvAS0dI&nonce=HcUdPjfBTMLeGeP6XZ_3eawPUTiu8R4t-AfRbz2-sws&code_challenge=GJ-7-iCZ_2Fy5TJS3iKKu5QbvHcZx4ZWGoPZiWsf14Y&code_challenge_method=S256
```

The short-lived `odudu-console-login` cookie remembers this attempt. The redirect is an ordinary authorization request with PKCE.

Full transcript: [GET /console/auth/login](../reference/transcripts/console-paths/get-consoleauthlogin.md).

## 2. Sign in at the tenant

The administrator signs in on the tenant's page, exactly as a user would.

```
<form method="post" action="/tenants/console-paths/login-actions/authenticate">
  <input type="hidden" name="auth_session_id" value="01a17b02-8ad6-7f28-a5de-160ccba3fde5">
  <label>Username <input type="text" name="username" autocomplete="username"></label>
  <label>Password <input type="password" name="password" autocomplete="current-password"></label>
  <button type="submit">Sign in</button>
</form>
```

```
set-cookie: console-paths-session=01a17b02-c90d-7d65-a61c-8380a55dceed:JcZY8IODtyTttYAwKcuAlTa9PDDtc1ho--5ZtooaGT4; HttpOnly; SameSite=Lax; Path=/
set-cookie: console-paths-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/console-paths/; Max-Age=0
location: http://localhost:3000/console/auth/callback?code=85eAmeU6LFGcTdS2rwRq1DbseXWPhqCrhtszaj9-Q34&state=01a17b02-1a9a-78f4-a746-1a223a533ca7.3CtlssHNJxU43xqp5aDXjUjTYI3DUcyyvPx-gvAS0dI&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fconsole-paths
```

Full transcript: [The tenant's own sign-in](../reference/transcripts/console-paths/the-tenants-own-sign-in.md).

## 3. Let the console finish the sign-in

The browser follows the redirect to the console's callback. The console checks the attempt, swaps the code for tokens, keeps them on the server and gives the browser a session cookie.

```bash
curl -sS -D - -c jar -b jar "$LOCATION"
```

```
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console-restart=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console=01a17b02-1a9a-78f4-a746-1a223a533ca7.GojT2OLYCr7eeXpTifOxiPPc41bqImwM5v9PNFsVueY; HttpOnly; SameSite=Strict; Path=/
location: /console/x
```

Full transcript: [GET /console/auth/callback](../reference/transcripts/console-paths/get-consoleauthcallback.md).

## 4. Check who you are

Ask the console for the session. It answers with the tenant and the administrator, never a token.

```bash
curl -sS -D - -c jar -b jar http://localhost:3000/console/api/session
```

```
{"tenant":"console-paths","subject_id":"01a17b02-1cb3-720a-ab9c-a0cc44e107a2","username":"grace"}
```

Full transcript: [GET /console/api/session](../reference/transcripts/console-paths/get-consoleapisession.md).

## 5. Read the user

This step is from a later run, so the administrator's id here is not the one step 4 showed.

Fetch `hopper`. Every admin call names the administrator it acts for in `X-Odudu-Console-Subject`. The answer carries an `ETag`, which stands for this version of the user.

```bash
curl -sS -D - -c jar -b jar -H 'X-Odudu-Console-Subject: 01a13ff2-eff9-746c-b8cb-e56af2072daa' \
  http://localhost:3185/console/api/admin/tenants/console-paths/subjects/01a13ff2-f33a-79ce-a952-0aeec04a80d4
```

```
HTTP/1.1 200 OK
x-request-id: 01a13ff3-38ca-7de2-b786-a50a8a02eaaa
content-type: application/json; charset=utf-8
etag: "476c7432885859a0124f9b8bd8ec8e643c33a66caccf17b6d0cf940c01a49e51"
```

```
{"id":"01a13ff2-f33a-79ce-a952-0aeec04a80d4","type":"user","username":"hopper","email":"hopper@example.com","enabled":true,"created_at":"2026-10-15T14:24:09.013Z"}
```

Full transcript: [PATCH …/subjects/{id}](../reference/transcripts/console-paths/patch-consoleapiadmintenantstenantsubjectsid.md).

## 6. Change the user

Send the change with that `ETag` in `If-Match`, so the update only applies if nobody else changed the user first. A write also carries `Origin` and `X-Odudu-Console: 1`.

```bash
curl -sS -D - -c jar -b jar -X PATCH \
  -H 'Origin: http://localhost:3185' -H 'X-Odudu-Console: 1' \
  -H 'X-Odudu-Console-Subject: 01a13ff2-eff9-746c-b8cb-e56af2072daa' \
  -H 'Content-Type: application/json' \
  -H 'If-Match: "476c7432885859a0124f9b8bd8ec8e643c33a66caccf17b6d0cf940c01a49e51"' \
  -d '{"email":"grace.hopper@example.com"}' \
  http://localhost:3185/console/api/admin/tenants/console-paths/subjects/01a13ff2-f33a-79ce-a952-0aeec04a80d4
```

```
{"id":"01a13ff2-f33a-79ce-a952-0aeec04a80d4","type":"user","username":"hopper","email":"grace.hopper@example.com","enabled":true,"created_at":"2026-10-15T14:24:09.013Z"}
```

The answer carries a new `ETag`. Using the old one again is refused, which [Read a refusal](./read-a-refusal.md) shows.

Full transcript: [PATCH …/subjects/{id}](../reference/transcripts/console-paths/patch-consoleapiadmintenantstenantsubjectsid.md).

## 7. See the change in the audit trail

Every change is recorded with who made it. Read the audit trail for the second the change ran.

```bash
curl -sS -D - -b jar -H 'X-Odudu-Console-Subject: 01a13ff2-eff9-746c-b8cb-e56af2072daa' \
  'http://localhost:3185/console/api/admin/tenants/console-paths/audit?from=2026-10-15T14:24:26Z&to=2026-10-15T14:24:27Z'
```

```
{"items":[{"id":"01a13ff3-396e-72bc-b234-0c7b9ae6a6c6","occurred_at":"2026-10-15T14:24:26.970Z","event_type":"admin_mutation","action":"subject.amend","outcome":"allowed","actor_tenant_id":"01a13ff2-eddb-7d89-8555-c32d1cd8acf9","actor_subject_id":"01a13ff2-eff9-746c-b8cb-e56af2072daa","actor_client_id":"01a13ff2-ee18-7fab-b610-0fb99df8e511","actor_name":"grace","actor_origin":"tenant","resource_type":"subject","resource_id":"01a13ff2-f33a-79ce-a952-0aeec04a80d4","request_id":"01a13ff3-38fc-7a89-9c47-3fc41614c27a","ip":"172.20.0.1","detail":{"email":{"after":"grace.hopper@example.com","before":"hopper@example.com"}}}]}
```

The row says `subject.amend`, names `grace` as the actor and holds the email before and after.

Full transcript: [PATCH …/subjects/{id}](../reference/transcripts/console-paths/patch-consoleapiadmintenantstenantsubjectsid.md).

## 8. Sign out

Signing out revokes the session's refresh token, deletes the console session and clears the cookie. The answer tells the browser where to go to end the tenant's own session too. The console's client has opted out of the confirmation, so that address signs the person out at once and sends the browser back to the console.

```bash
curl -sS -D - -c jar -b jar -X POST \
  -H 'Origin: http://localhost:3194' -H 'X-Odudu-Console: 1' \
  http://localhost:3194/console/auth/logout
```

```
HTTP/1.1 200 OK
x-request-id: 01a17d35-5aaf-72f8-9e0f-8b8afabdb050
cache-control: no-store
set-cookie: odudu-console=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0
```

The earlier commands of this guide ran on a stack on port `3185`; this one was run again on a throwaway stack on port
`3194`, which is why its command names that port. On your own stack all of them use the port you started it on.

Full transcript: [POST /console/auth/logout](../reference/transcripts/console-paths/post-consoleauthlogout.md).

## Where to go next

- [Read a refusal](./read-a-refusal.md) shows what the console refuses and why.
- The admin API behind these calls is in the [reference](../reference/index.md).
