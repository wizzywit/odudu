---
title: 'DELETE /subjects/:id/sessions'
description: 'Requires manage-sessions, like the rest of this family.'
---

# `DELETE /subjects/:id/sessions`

Requires `manage-sessions`, like the rest of this family. Ends every live
session the subject holds, each through the same `endSession` the
single-session `DELETE` above calls — so each has every grant it holds
revoked, a Back-Channel Logout Token enqueued for each registered client
that used it and has a `backchannel_logout_uri`, and its own
`session.ended` row with `detail.via` `admin`, exactly as ending it alone
would. The sessions are locked first, so a concurrent single-session end
waits for this one rather than racing it. The answer is how many were
ended, `{"ended": n}`, and the one `session.end_all` row this writes
carries the same count in `detail.ended`, filed on the subject. A subject
with no live session answers `{"ended":0}`; an unknown subject, or one in
another tenant, answers `404`. As with ending one session, a grant bound to
no session — an `offline_access` refresh token — is not a session's to
revoke, and is left alone; `DELETE /subjects/:id/grants/:clientId` is what
reaches it, and `DELETE /subjects/:id/consents/:clientId` too where a consent
was recorded.

After `DELETE /subjects/:id/lockout`, against the same `hana` and
`recovery-demo-app`. The two codes the sign-ins there bought, redeemed, each
response cut to its refresh token:

```bash
redeem() {
  curl -sS \
    --data-urlencode "grant_type=authorization_code" \
    --data-urlencode "code=$1" \
    --data-urlencode "redirect_uri=https://app.example/callback" \
    --data-urlencode "code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk" \
    -u "recovery-demo-app:izuxIVWAgYa_OtjPUH5_fW4XHY52SCwAnSIHSdNs42o" \
    'http://localhost:3000/tenants/recovery-demo/protocol/openid-connect/token' | grep -o '"refresh_token":"[^"]*"'
}
redeem 8fngX60T_fqkL6Eo0CWc0hN-WO48k7vdfRNAwUjv8-A
redeem siqZJTb99r6PwzhNOG7w3iNMOU7VKgFXk4P-mrsSI0Y
```

```
"refresh_token":"K6bHBAE16TMHEWsir6y-w3NCfelO3mgsQJ3PXrABTbE"
"refresh_token":"7wsM1zCi_4AxxoIVQac4KpJAmzwkp6JhQ7tA1FCYLyY"
```

Two live sessions, each holding a grant. Listing them, ending them,
listing again, and both refresh tokens refused:

```bash
refresh() {
  curl -sS \
    --data-urlencode "grant_type=refresh_token" \
    --data-urlencode "refresh_token=$1" \
    -u "recovery-demo-app:izuxIVWAgYa_OtjPUH5_fW4XHY52SCwAnSIHSdNs42o" \
    'http://localhost:3000/tenants/recovery-demo/protocol/openid-connect/token'
  echo
}
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/recovery-demo/subjects/01a1d0a4-ab22-7dd2-93fc-b4792c16eb63/sessions
echo

curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/recovery-demo/subjects/01a1d0a4-ab22-7dd2-93fc-b4792c16eb63/sessions
echo

curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/recovery-demo/subjects/01a1d0a4-ab22-7dd2-93fc-b4792c16eb63/sessions
echo

refresh K6bHBAE16TMHEWsir6y-w3NCfelO3mgsQJ3PXrABTbE
refresh 7wsM1zCi_4AxxoIVQac4KpJAmzwkp6JhQ7tA1FCYLyY
```

```
{"items":[{"id":"01a1d0a4-abbb-71a4-973e-49a9b3eaba15","created_at":"2026-11-12T16:43:35.225Z","last_active_at":"2026-11-12T16:43:35.225Z","remembered":false,"client_ids":["recovery-demo-app"],"device":"f12f0ff5e0818833ec57461cfe5ae1617980bd6914dfbb9f2b0832a72547fe88"},{"id":"01a1d0a4-ac0f-7980-89ff-609526c5d2d8","created_at":"2026-11-12T16:43:35.309Z","last_active_at":"2026-11-12T16:43:35.309Z","remembered":false,"client_ids":["recovery-demo-app"],"device":"ae0979f26f5959c9d18c15f63546e28a91bb92e7d9906611c3e7f215b04b39e2"}]}
HTTP/1.1 200 OK
x-request-id: 01a1d0a4-accb-7f46-a1a4-280dc38b0932
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 11
Date: Thu, 12 Nov 2026 16:43:35 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"ended":2}
{"items":[]}
{"error":"invalid_grant","error_description":"The code or token is not valid."}
{"error":"invalid_grant","error_description":"The code or token is not valid."}
```
