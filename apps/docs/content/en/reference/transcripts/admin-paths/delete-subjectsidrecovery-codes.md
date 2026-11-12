---
title: 'DELETE /subjects/:id/recovery-codes'
description: 'Requires manage-users. Revokes every recovery code the subject holds, spent ones with them, so none signs in again — the answer to a printed list…'
---

# `DELETE /subjects/:id/recovery-codes`

> **Not replayed after the device cookie.** A response on this page that ends a sign-in now also carries a `set-cookie` for `<tenant>-device`, which the blocks below do not show, because this page was captured before that cookie existed and has not been run again. [A session's device](../request-paths/the-me-api.md#a-sessions-device) is a live capture of the cookie.

Requires `manage-users`. Revokes every recovery code the subject holds,
spent ones with them, so none signs in again — the answer to a printed list
somebody else may have read. A code carries no `id` of its own
([`GET /subjects/:id/credentials`](./get-subjectsidcredentials.md) says why), so
the set is the only thing there is to remove. It answers `204` whether or
not any were held, and its `subject.recovery_codes_revoke` audit row says
how many went in `detail.revoked`.

**A revoked set is replaced unless the request says otherwise.** While the
subject still holds a TOTP enrolment, the
request adds the `generate-recovery-codes` required action in the same
transaction, so their next sign-in ends on the page that issues a fresh set;
`?require_new_set=false` leaves them with none until
[`PUT /subjects/:id/required-actions`](./get-subjectsidrequired-actions-and-put-subjectsidrequired-actions.md)
or the next sign-in asks (below). A subject with no TOTP is never
asked, since a set would serve nothing. The audit row's
`detail.new_set_required` says which it was. Any value of `require_new_set`
other than `true` or `false` is refused with `400` before anything changes.
The subject is mailed at the address on file when any code was revoked, saying
the old codes no longer work and, if one is asked, that a new set will be;
there is no mail for a revoke that found nothing, and none for a subject with
no address.

**A sign-in that completes with a TOTP and no unspent code also owes
a set**, once: it adds `generate-recovery-codes`, which saving a set clears, so
it does not repeat. That covers a subject whose set was revoked with
`require_new_set=false`, and one enrolled before codes existed. It is one
aggregate query on the sign-in's success path, and never runs for a subject
with no TOTP. Revoking the set because the last TOTP was removed is
[`DELETE /subjects/:id/credentials/:credentialId`](./delete-subjectsidcredentialscredentialid.md)'s
doing, not this endpoint's.

An unknown subject, one in
another tenant, or one with no `users` row answers `404`, and a subject
holding an admin capability the caller does not is refused with `403`
([the target ceiling](./post-subjectsidpassword.md#the-target-ceiling)).

Described at the top of this page, on `ines` in `lockout-demo` — the subject
[`GET /subjects/:id/lockout`](./get-subjectsidlockout.md) below also uses. Its
required actions first, for the `ETag` the `PUT` sends:

```bash
INES=http://localhost:3080/admin/tenants/lockout-demo/subjects/01a0ec85-0c4c-7ab4-821c-a4fad1d15482
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" "$INES/required-actions" | grep -iE '^etag|^\{'
```

```
etag: "7d357b0ef1f85ba71c5ccebb6671b0c34f4b3950f5b21d2af7b4a3d4e9dcd570"
{"actions":[]}
```

The `PUT` owes a set, but `ines` holds no TOTP enrolment, so a set would serve
nothing. The sign-in that follows (its status and `location` printed, by `signin`
from that section) completes with a code instead of stopping on the page that
issues one, the owed action is dropped, and the credentials list counts no
codes:

```bash
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -H 'if-match: "7d357b0ef1f85ba71c5ccebb6671b0c34f4b3950f5b21d2af7b4a3d4e9dcd570"' \
  -d '{"actions":["generate-recovery-codes"]}' "$INES/required-actions"
signin 'correct horse battery staple'
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$INES/required-actions"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$INES/credentials"
```

```
{"actions":["generate-recovery-codes"]}
HTTP/1.1 302 Found
location: https://app.example/callback?code=HESdIKBxIduiL9PbuAXpDM-sYKuZ8bOL1-1bgg4SnTo&state=xyz&iss=http%3A%2F%2Flocalhost%3A3080%2Ftenants%2Flockout-demo
{"actions":[]}
{"items":[{"id":"01a0ec85-0c6d-75c9-a720-81d3b70c0811","type":"password","created_at":"2026-10-27T01:20:59.351Z","expired":false}]}
```

The rest is on the tenant the credential section above names (`recovery-life`, a
public client `life-app` with `https://app.example/callback`), on `olga` and
`noor`, each seeded with `seed user` and then given as the database owner a TOTP
credential and ten recovery-code rows. The id variables are their subject ids,
`OLGA=01a1554b-be61-7ac8-b5d5-5cedc64a4492` and
`NOOR=01a1554b-fca4-73b7-ad55-6a4150567782`. `olga` is revoked with the default:
her `required-actions` first (empty, with the `ETag`), the revoke, what is owed
after, the credentials (the TOTP stays, no recovery-code entry), the audit row
for this action, and her mail:

```bash
S=http://localhost:3187/admin/tenants/recovery-life/subjects
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" "$S/$OLGA/required-actions" | grep -iE '^etag|^\{'
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$S/$OLGA/recovery-codes"
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$S/$OLGA/required-actions"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$S/$OLGA/credentials"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3187/admin/tenants/recovery-life/audit?resource_type=subject&resource_id=$OLGA&action=subject.recovery_codes_revoke" |
  python3 -c "
import json,sys
for r in json.load(sys.stdin)['items']: print(json.dumps({k:r[k] for k in ('action','outcome','detail')}))"
docker compose -p odudu-p4g-recovery exec -T postgres psql -U odudu -d odudu -tA -c \
  "select to_address, subject, body_text from email_outbox where tenant_id = (select id from tenants where name = 'recovery-life') and to_address = 'olga@example.test'"
```

```
etag: "7d357b0ef1f85ba71c5ccebb6671b0c34f4b3950f5b21d2af7b4a3d4e9dcd570"
{"actions":[]}
HTTP/1.1 204 No Content
x-request-id: 01a1554c-4c0a-7fe3-a0ff-cef22c539c0d
cache-control: no-store
Date: Mon, 19 Oct 2026 17:53:46 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"actions":["generate-recovery-codes"]}
{"items":[{"id":"01a1554b-be82-7e8a-ab63-1ecfd873f6b7","type":"password","created_at":"2026-10-19T17:53:09.725Z","expired":false},{"id":"f10d2fd7-1c2b-4095-b53c-5e94d7ad2f26","type":"totp","created_at":"2026-10-19T17:53:26.695Z"}]}
{"action": "subject.recovery_codes_revoke", "outcome": "allowed", "detail": {"revoked": 10, "new_set_required": true}}
olga@example.test|Your recovery-life recovery codes were revoked|An administrator revoked the recovery codes on your ⁨recovery-life⁩ account. The old codes no longer work.

You will be asked to save a new set the next time you sign in.

If you did not expect this, contact your administrator.

--
You received this because the recovery codes on your account at ⁨recovery-life⁩ were changed.
© 2026 Odudu · Powered by odudu
```

The mail above, for `olga`, is from the same setup, with `olga` seeded with
`seed user` and given a TOTP credential and ten recovery-code rows as `ines`
was.

`noor` is revoked with `require_new_set=false`, after a value that is neither
`true` nor `false` was refused and the ten codes counted to show it changed
nothing. Nothing is owed after, and the audit row says so. Then `noor` signs
in, the password and then the code from the authenticator app. `signin` is the
helper the lockout section below defines, pointed at this tenant and client and
taking, after the username, the name and value of a second field to post once
the password has been taken; `totp.py` is a five-line RFC 6238 generator over
the secret the TOTP row was seeded with. The sign-in ends on the page that
issues a set, and the set is now owed:

```bash
AUTHORIZE='http://localhost:3187/tenants/recovery-life/protocol/openid-connect/auth?response_type=code&client_id=life-app&redirect_uri=https%3A%2F%2Fapp.example%2Fcallback&scope=openid&state=xyz&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256'
signin() {
  sid=$(curl -sS "$AUTHORIZE" | sed -n 's/.*name="auth_session_id" value="\([^"]*\)".*/\1/p' | head -1)
  curl -sS -D - -o body.html --data-urlencode "auth_session_id=$sid" --data-urlencode "username=$1" \
    --data-urlencode "password=correct horse battery staple" \
    http://localhost:3187/tenants/recovery-life/login-actions/authenticate | grep -iE '^(HTTP)' | tr -d '\r'
  grep -o '<title>[^<]*</title>' body.html || true
  if [ -n "$2" ]; then
    curl -sS -D - -o body.html --data-urlencode "auth_session_id=$sid" --data-urlencode "$2=$3" \
      http://localhost:3187/tenants/recovery-life/login-actions/authenticate |
      grep -iE '^(HTTP|location)' | cut -c1-90 | tr -d '\r'
    grep -o '<title>[^<]*</title>' body.html || true
  fi
}
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$S/$NOOR/recovery-codes?require_new_set=maybe"; echo
docker compose -p odudu-p4g-recovery exec -T postgres psql -U odudu -d odudu -tA -c \
  "select count(*) from user_credentials where subject_id = '$NOOR' and type = 'recovery-code'"
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$S/$NOOR/recovery-codes?require_new_set=false"
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$S/$NOOR/required-actions"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3187/admin/tenants/recovery-life/audit?resource_type=subject&resource_id=$NOOR&action=subject.recovery_codes_revoke" |
  python3 -c "
import json,sys
for r in json.load(sys.stdin)['items']: print(json.dumps({k:r[k] for k in ('action','outcome','detail')}))"
signin noor code "$(python3 totp.py GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ)"
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$S/$NOOR/required-actions"; echo
```

The status lines and titles are what `signin` prints, status and title after
the password, then status, any `location` and title after the code. The wrong
value is refused by the router's own query check, whose message is its
validator's:

```
HTTP/1.1 400 Bad Request
x-request-id: 01a1554c-6f30-7642-b969-feb18871fdc9
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 276
Date: Tue, 27 Oct 2026 01:26:57 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Error","status":400,"detail":"querystring/require_new_set must be equal to one of the allowed values","errors":[{"path":"require_new_set","message":"must be equal to one of the allowed values"}],"instance":"01a1554c-6f30-7642-b969-feb18871fdc9"}
10
HTTP/1.1 204 No Content
x-request-id: 01a17af7-b84b-7c47-8ad1-189f92c86676
cache-control: no-store
Date: Tue, 27 Oct 2026 01:26:57 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"actions":[]}
{"action": "subject.recovery_codes_revoke", "outcome": "allowed", "detail": {"revoked": 10, "new_set_required": false}}
HTTP/1.1 200 OK
<title>Enter your authentication code</title>
HTTP/1.1 200 OK
<title>Save your recovery codes</title>
{"actions":["generate-recovery-codes"]}
```

A revoke that asks for a new set, followed by the removal of the last TOTP,
leaves nothing owed, and the next sign-in is not refused for a page that cannot
be shown. On a fresh volume (the same names as above, so the ids are that run's:
`olga` is `01a155ef-96aa-7aff-86c2-84b67d1c3a3d`, her TOTP row
`d3c306d7-002d-487c-8d4b-acdd5817707d`), seeded with a TOTP and ten code rows as
the database owner. `AUTHORIZE` is the helper's own URL for this tenant and
client:

```bash
S=http://localhost:3187/admin/tenants/recovery-life/subjects
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$S/$OLGA/recovery-codes"
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$S/$OLGA/required-actions"; echo
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$S/$OLGA/credentials/$TOTP"
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$S/$OLGA/required-actions"; echo
sid=$(curl -sS "$AUTHORIZE" | sed -n 's/.*name="auth_session_id" value="\([^"]*\)".*/\1/p' | head -1)
curl -sS -D - -o body.html --data-urlencode "auth_session_id=$sid" --data-urlencode username=olga \
  --data-urlencode "password=correct horse battery staple" \
  http://localhost:3187/tenants/recovery-life/login-actions/authenticate
```

```
HTTP/1.1 204 No Content
x-request-id: 01a17af7-ee89-704a-92ca-cd753a64220d
cache-control: no-store
Date: Tue, 27 Oct 2026 01:27:11 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"actions":["generate-recovery-codes"]}
HTTP/1.1 204 No Content
x-request-id: 01a17af7-eebc-7305-9b17-41a84a5c5169
cache-control: no-store
Date: Tue, 27 Oct 2026 01:27:11 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"actions":[]}
HTTP/1.1 302 Found
x-request-id: 01a17af7-ef03-7a65-bd2d-1e5e9cbe4d0e
set-cookie: recovery-life-session=01a17af7-ef36-7ca0-ac65-f9eeea0cf11e:XzGU66lkGUYr7IK4UZn6a3ZF8_AnXyAWrWJWojxPWFE; HttpOnly; SameSite=Lax; Path=/
set-cookie: recovery-life-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/recovery-life/; Max-Age=0
location: https://app.example/callback?code=6ZCnFFbW27Ex8es1NprEVmt2ImDtLH_E5QuvGPzCfD0&state=xyz&iss=http%3A%2F%2Flocalhost%3A3080%2Ftenants%2Frecovery-life
content-length: 0
Date: Tue, 27 Oct 2026 01:27:11 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```
