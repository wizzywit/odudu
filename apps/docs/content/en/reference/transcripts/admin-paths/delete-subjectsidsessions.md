---
title: 'DELETE /subjects/:id/sessions'
description: 'Requires manage-sessions, like the rest of this family.'
---

# `DELETE /subjects/:id/sessions`

> **Not replayed after the device field.** A session in a block on this page now also carries `device`, which the blocks below do not show, because this page was captured before the field existed and has not been run again. [A session's device](../request-paths/the-me-api.md#a-sessions-device) is a live capture of it.

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
    -u "recovery-demo-app:oNxj0NLDbXAVWohwuHXVUI_sHgnrfIJMuAk28Kl8WCU" \
    'http://localhost:3000/tenants/recovery-demo/protocol/openid-connect/token' | grep -o '"refresh_token":"[^"]*"'
}
redeem h09v7JRpqx_2QP43pO0iFb-Mi_-y5-uvQ_dLO9R1yEM
redeem dIaPGsUTiYp47Ypkl8FuoxachQAgewGPjxhS7Uy0nT4
```

```
"refresh_token":"thiT9DnRT_NtwhsWgwbFHSxBBRXv19484ncl7K1_3Vc"
"refresh_token":"CukLcH9hRCYKI6uWDiTIWP1h6o5MoZdAhwmwgNKAh14"
```

Two live sessions, each holding a grant. Listing them, ending them,
listing again, and both refresh tokens refused:

```bash
refresh() {
  curl -sS \
    --data-urlencode "grant_type=refresh_token" \
    --data-urlencode "refresh_token=$1" \
    -u "recovery-demo-app:oNxj0NLDbXAVWohwuHXVUI_sHgnrfIJMuAk28Kl8WCU" \
    'http://localhost:3000/tenants/recovery-demo/protocol/openid-connect/token'
  echo
}
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/recovery-demo/subjects/01a0e303-9db3-712d-9272-98d2c2a04320/sessions
echo

curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/recovery-demo/subjects/01a0e303-9db3-712d-9272-98d2c2a04320/sessions
echo

curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/recovery-demo/subjects/01a0e303-9db3-712d-9272-98d2c2a04320/sessions
echo

refresh thiT9DnRT_NtwhsWgwbFHSxBBRXv19484ncl7K1_3Vc
refresh CukLcH9hRCYKI6uWDiTIWP1h6o5MoZdAhwmwgNKAh14
```

```
{"items":[{"id":"01a0e304-7933-7d2c-8e6b-ebbe5e34982a","created_at":"2026-09-27T13:18:36.338Z","last_active_at":"2026-09-27T13:18:36.338Z","remembered":false,"client_ids":["recovery-demo-app"]},{"id":"01a0e304-797c-7fe2-b013-c38192ef313b","created_at":"2026-09-27T13:18:36.411Z","last_active_at":"2026-09-27T13:18:36.411Z","remembered":false,"client_ids":["recovery-demo-app"]}]}
HTTP/1.1 200 OK
x-request-id: 01a0e304-c992-7ce0-a32d-345ffe41df00
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 11
Date: Sun, 27 Sep 2026 13:18:56 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"ended":2}
{"items":[]}
{"error":"invalid_grant","error_description":"The code or token is not valid."}
{"error":"invalid_grant","error_description":"The code or token is not valid."}
```
