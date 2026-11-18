---
title: An admin signs in and changes a user
description: Sign an administrator in to the console, check who you are, change a user with a safe update, and sign out, with the real requests.
sidebar_position: 3
---

# An admin signs in and changes a user

The admin console signs an administrator in through the same flow your users meet, then does the admin work for them. The browser holds one cookie and no token: the tokens stay on the server. This guide follows one administrator, `grace`, from sign-in to changing another user, `hopper`.

The excerpts come from several real runs on different stacks: steps 1 to 4 from one run of this checkout, steps 5 to 7 from another and step 8 from a third. Ports and ids therefore differ between steps, and each full transcript says which run it is. Every command keeps one cookie jar, `jar`.

## 1. Start the sign-in

Send the browser to `/console/auth/login` with the tenant and where to land afterwards. The console answers with a redirect to the tenant's own sign-in.

```bash
curl -sS -D - -c jar -b jar \
  'http://localhost:3000/console/auth/login?tenant=console-paths&return_to=/console/x'
```

```
set-cookie: odudu-console-login=01a1e40a-95ad-78bf-80da-9bd2262c5363.BjO0JkIDSX4IKGzjT5SPzjFbf88k8pjLgVqbPXBFe48; HttpOnly; SameSite=Lax; Path=/; Max-Age=1800
location: http://localhost:3000/tenants/console-paths/protocol/openid-connect/auth?response_type=code&client_id=odudu-admin&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fconsole%2Fauth%2Fcallback&scope=openid&resource=urn%3Aodudu%3Aparams%3Aadmin-api&state=01a1e40a-95ad-78bf-80da-9bd2262c5363.BjO0JkIDSX4IKGzjT5SPzjFbf88k8pjLgVqbPXBFe48&nonce=n4P22nIWRyugG5cR5rX9nVVt-OleKFm0DfOCtcrlIko&code_challenge=rQSla7vgAf2zoYQqNOLL7awyoONHK79Quzfr05_N9Z8&code_challenge_method=S256
```

The short-lived `odudu-console-login` cookie remembers this attempt. The redirect is an ordinary authorization request with PKCE.

Full transcript: [GET /console/auth/login](../reference/transcripts/console-paths/get-consoleauthlogin.md).

## 2. Sign in at the tenant

The administrator signs in on the tenant's page, exactly as a user would.

```
<form method="post" action="/tenants/console-paths/login-actions/authenticate">
  <input type="hidden" name="auth_session_id" value="01a1e40a-9c6e-7dc2-bb67-9ee780e76199">
  <label>Username <input type="text" name="username" autocomplete="username"></label>
  <label>Password <input type="password" name="password" autocomplete="current-password"></label>
  <button type="submit">Sign in</button>
</form>
```

```
set-cookie: console-paths-session=01a1e40a-9ccb-7fb9-b81d-fe193820f4bc:Th1Jy-A2vQC6inJrp8zu-A0MrvPB9Li8XHh8bb29kC4; HttpOnly; SameSite=Lax; Path=/
set-cookie: console-paths-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: console-paths-device=7uZOFjMCF2TN0YpZD2r-Bw; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/console-paths/; Max-Age=0
location: http://localhost:3000/console/auth/callback?code=TPYJy1W24fZC4lIciERQie-HnpWIvh9sK8jClNPoHh4&state=01a1e40a-95ad-78bf-80da-9bd2262c5363.BjO0JkIDSX4IKGzjT5SPzjFbf88k8pjLgVqbPXBFe48&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fconsole-paths
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
set-cookie: odudu-console=01a1e40a-95ad-78bf-80da-9bd2262c5363.GTbtIVRV1OixEar9QJTKhv-QgqU6xlrzBGWlszR2Ybc; HttpOnly; SameSite=Strict; Path=/
location: /console/x
```

Full transcript: [GET /console/auth/callback](../reference/transcripts/console-paths/get-consoleauthcallback.md).

## 4. Check who you are

Ask the console for the session. It answers with the tenant and the administrator, never a token.

```bash
curl -sS -D - -c jar -b jar http://localhost:3000/console/api/session
```

```
{"tenant":"console-paths","subject_id":"01a1e40a-97ed-7c3e-844f-e4e718d05850","username":"grace"}
```

Full transcript: [GET /console/api/session](../reference/transcripts/console-paths/get-consoleapisession.md).

## 5. Read the user

This step is from a later run, so the administrator's id here is not the one step 4 showed.

Fetch `hopper`. Every admin call names the administrator it acts for in `X-Odudu-Console-Subject`. The answer carries an `ETag`, which stands for this version of the user, and `pending_email`, which is `null` unless an email change is waiting for the person to confirm it.

```bash
curl -sS -D - -c jar -b jar -H 'X-Odudu-Console-Subject: 01a1edf1-4be2-7d84-b717-8bbb96a53677' \
  http://localhost:3000/console/api/admin/tenants/console-paths/subjects/01a1edf1-4c5e-7369-8846-d7678379b7f1
```

```
HTTP/1.1 200 OK
x-request-id: 01a1edf1-b161-75fc-89b2-50f85a72b7c0
content-type: application/json; charset=utf-8
etag: "2b18cf8cd3e4689c50e9ba079b816e5185705a12554c3f3c9018dbebfa28d745"
```

```
{"id":"01a1edf1-4c5e-7369-8846-d7678379b7f1","type":"user","username":"hopper","email":"hopper@example.com","enabled":true,"created_at":"2026-11-18T09:16:16.347Z","pending_email":null}
```

Full transcript: [PATCH …/subjects/{id}](../reference/transcripts/console-paths/patch-consoleapiadmintenantstenantsubjectsid.md).

## 6. Change the user

Send the change with that `ETag` in `If-Match`, so the update only applies if nobody else changed the user first. A write also carries `Origin` and `X-Odudu-Console: 1`. This one disables `hopper`. Changing the email address is a different kind of change: it is mailed to the new address and takes effect only when the person confirms it, so it leaves the `ETag` as it was ([`PATCH /subjects/:id`](../reference/transcripts/admin-paths/patch-subjectsid.md#changing-an-email-the-person-confirms) shows it).

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
{"id":"01a1edf1-4c5e-7369-8846-d7678379b7f1","type":"user","username":"hopper","email":"hopper@example.com","enabled":false,"created_at":"2026-11-18T09:16:16.347Z","pending_email":null}
```

The answer carries a new `ETag`. Using the old one again is refused, which [Read a refusal](./read-a-refusal.md) shows.

Full transcript: [PATCH …/subjects/{id}](../reference/transcripts/console-paths/patch-consoleapiadmintenantstenantsubjectsid.md).

## 7. See the change in the audit trail

Every change is recorded with who made it. Read the audit trail for the second the change ran.

```bash
curl -sS -D - -b jar -H 'X-Odudu-Console-Subject: 01a1edf1-4be2-7d84-b717-8bbb96a53677' \
  'http://localhost:3000/console/api/admin/tenants/console-paths/audit?from=2026-11-18T09:16:42Z&to=2026-11-18T09:16:43Z'
```

```
{"items":[{"id":"01a1edf1-b1b8-77e7-aa03-66f121548d56","occurred_at":"2026-11-18T09:16:42.286Z","event_type":"admin_mutation","action":"subject.amend","outcome":"allowed","actor_tenant_id":"01a1edf1-48f8-7169-a65d-edcba624324f","actor_subject_id":"01a1edf1-4be2-7d84-b717-8bbb96a53677","actor_client_id":"01a1edf1-4914-76e6-ad4d-003eed92415f","actor_name":"grace","actor_origin":"tenant","resource_type":"subject","resource_id":"01a1edf1-4c5e-7369-8846-d7678379b7f1","request_id":"01a1edf1-b193-752e-8398-68d2f9f4eda3","ip":"172.20.0.1","detail":{"enabled":{"after":false,"before":true}}}]}
```

The row says `subject.amend`, names `grace` as the actor and holds the value of `enabled` before and after.

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

The earlier commands of this guide ran on a stack on port `3000`; this one was run again on a throwaway stack on port
`3194`, which is why its command names that port. On your own stack all of them use the port you started it on.

Full transcript: [POST /console/auth/logout](../reference/transcripts/console-paths/post-consoleauthlogout.md).

## Where to go next

- [Read a refusal](./read-a-refusal.md) shows what the console refuses and why.
- The admin API behind these calls is in the [reference](../reference/index.md).
