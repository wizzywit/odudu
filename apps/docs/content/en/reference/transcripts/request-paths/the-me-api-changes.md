---
title: 'The me API: changes'
description: "A person's own changes with their own token: the profile, a new address, sessions, consents, authenticators and the recent sign-in they need."
---

# The me API: changes

[The me API](./the-me-api.md) reads. With the scope `me:write` the same API changes, and this page runs each change. A token
that holds `me:write` may:

- amend the profile claims, `PATCH /me/profile`, and, in a request of its own, ask for a new email address;
- end one of the person's sessions, `DELETE /me/sessions/{id}`, or all the others, `DELETE /me/sessions`;
- withdraw a consent, `DELETE /me/consents/{client_id}`;
- rename an authenticator, `PATCH /me/credentials/{id}`, or remove it, `DELETE /me/credentials/{id}`.

A change that could lock the person out or hand their account to somebody else (a new address, a new username, ending all the
other sessions, withdrawing a consent, removing an authenticator) also needs a sign-in no older than the tenant's
`session_freshness_seconds`, 300 unless the tenant set it, 30 to 3600. A token whose sign-in is older is refused with `401` and
the challenge of RFC 9470, and the application sends the person through `/authorize` again. The claims, a rename and ending one
session need no recent sign-in. A token issued to an agent, one that carries `act`, may read and never writes: the last section gets one by
[token exchange](./path-d-token-exchange.md) and shows the refusal, `agent_not_permitted`.

Every command was run, in this order, on a compose stack built for these pages (port `3000`, the throttles at `10000`, the
schedules off), in the tenant `me-edit`, which the first block makes: the stack had served the tenants of other pages first, and
none of them takes part. The mail catcher was empty when the page began. The stack is the compose stack with one file added,
which gives the server a mail relay that keeps what it is given, so a mailed link can be read. The file is saved as
`compose.mail.yaml`:

```yaml
services:
  odudu:
    environment:
      ODUDU_ALLOW_PRIVATE_SMTP_HOSTS: 'true'
      ODUDU_SMTP_HOST: mailpit
      ODUDU_SMTP_PORT: '1025'
      ODUDU_SMTP_FROM: odudu@docs.local
      ODUDU_SMTP_STARTTLS: 'false'
      ODUDU_OUTBOX_ENABLED: 'false'
  mailpit:
    image: axllent/mailpit:v1.33.0@sha256:9b3a463be15354c0f0eba91697d80e3e0d8a5623ef0e627cacc836bc17fd5231
    ports:
      - '127.0.0.1:8092:8025'
```

With the server's own sender off, `odudu send-mail` is what sends the queued mail and says how many it sent. Without a relay, in
the stack the other pages run on, an address change is refused with `503` `mail_unavailable`: the server cannot prove an address
it cannot mail. `$ADMIN` is a system administrator's token, got as in [Getting the token](../admin-paths/getting-the-token.md);
a token lives five minutes, and every block below ran within the minutes of its own.

## A client, two people and a window

The two helpers below do the sign-in every client does, with the me URL as the `resource` so the token is for that API: the
authorization request, then the password. A first sign-in shows the consent page, which the helper answers by ticking every scope
asked for.

```bash
odudu() { docker compose -p odudu-p4f-i25 -f infra/docker/compose.yaml -f compose.mail.yaml exec -T odudu node dist/main.js "$@"; }
BASE=http://localhost:3000
ME=$BASE/tenants/me-edit/me
REDIR=http://127.0.0.1:8080/callback
pkce() {
  VERIFIER=$(openssl rand -hex 32)
  CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 | openssl base64 | tr '+/' '-_' | tr -d '=')
}
authorize() { # client_id scope resource
  curl -sS -c jar -b jar -o authorize.html --get --data-urlencode response_type=code --data-urlencode "client_id=$1" \
    --data-urlencode redirect_uri=$REDIR --data-urlencode "scope=$2" --data-urlencode "resource=$3" --data-urlencode state=s \
    --data-urlencode "code_challenge=$CHALLENGE" --data-urlencode code_challenge_method=S256 \
    $BASE/tenants/me-edit/protocol/openid-connect/auth
  AS=$(grep -o 'name="auth_session_id" value="[^"]*"' authorize.html | head -1 | sed 's/.*value="//;s/"//')
}
password_step() { # username scope
  curl -sS -c jar -b jar -D login.headers -o login.html --data-urlencode "auth_session_id=$AS" \
    --data-urlencode username=$1 --data-urlencode password=correct-horse-battery \
    $BASE/tenants/me-edit/login-actions/authenticate
  if grep -q 'login-actions/consent' login.html; then
    AS=$(grep -o 'name="auth_session_id" value="[^"]*"' login.html | head -1 | sed 's/.*value="//;s/"//')
    local scopes=()
    for s in $2; do [ "$s" != openid ] && scopes+=(--data-urlencode "scope=$s"); done
    curl -sS -c jar -b jar -D login.headers -o /dev/null --data-urlencode "auth_session_id=$AS" "${scopes[@]}" \
      --data-urlencode decision=allow $BASE/tenants/me-edit/login-actions/consent
  fi
  CODE=$(grep -i '^location:' login.headers | sed 's/.*code=//;s/&.*//' | tr -d '\r')
}
signin() { # username scope: a new browser, so a new session
  rm -f jar; pkce; authorize me-app "$2" "$ME"; password_step "$1" "$2"
}
token() {
  curl -sS --data-urlencode grant_type=authorization_code --data-urlencode "code=$CODE" --data-urlencode redirect_uri=$REDIR \
    --data-urlencode client_id=me-app --data-urlencode "code_verifier=$VERIFIER" --data-urlencode "resource=$ME" \
    $BASE/tenants/me-edit/protocol/openid-connect/token | jq -r .access_token
}
```

The client is registered for the me URL as an audience, marked as needing consent, and assigned `me:read` and `me:write` as
optional scopes, so a request names the ones it wants and the person approves them. The tenant gets two people, and a recent
sign-in window of 30 seconds, the shortest there is, so the page does not wait five minutes to age a sign-in:

```bash
odudu seed --tenant me-edit --client demo-spa --redirect-uri http://localhost:8080/callback \
  --user grace --password correct-horse-battery --email grace@example.com
odudu seed user --tenant me-edit --username lin --password correct-horse-battery --email lin@example.com
curl -sS -X POST -H "Authorization: Bearer $ADMIN" -H 'content-type: application/json' \
  -d '{"client_id":"me-app","name":"Account page","redirect_uris":["'$REDIR'"],"token_endpoint_auth_method":"none","grant_types":["authorization_code"],"audiences":["'$ME'"],"consent_required":true}' \
  $BASE/admin/tenants/me-edit/clients | jq -c '{client_id,name,type,audiences,consent_required}'
for s in me:read me:write; do odudu seed assign-scope --tenant me-edit --client-id me-app --scope $s --assignment optional; done
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN" -H 'content-type: application/json' \
  -d '{"session_freshness_seconds":30}' $BASE/admin/tenants/me-edit/settings | jq -c '{session_freshness_seconds}'
RUN_START=$(date -u +%FT%T.000Z)
```

```
{"created":true,"tenant":"me-edit","tenantId":"01a1cf7d-e070-7864-9f33-977e69d93297","clientId":"demo-spa","userSubjectId":"01a1cf7d-e1d7-7736-be76-b55deeca97fe"}
{"command":"user","tenant":"me-edit","tenantId":"01a1cf7d-e070-7864-9f33-977e69d93297","username":"lin","userSubjectId":"01a1cf7d-e377-71f9-9b34-b767394e3d4a"}
{"client_id":"me-app","name":"Account page","type":"public","audiences":["http://localhost:3000/tenants/me-edit/me"],"consent_required":true}
{"command":"assign-scope","tenant":"me-edit","tenantId":"01a1cf7d-e070-7864-9f33-977e69d93297","clientId":"me-app","scope":"me:read","assignment":"optional"}
{"command":"assign-scope","tenant":"me-edit","tenantId":"01a1cf7d-e070-7864-9f33-977e69d93297","clientId":"me-app","scope":"me:write","assignment":"optional"}
{"session_freshness_seconds":30}
```

## The profile

`grace` signs in and asks for both scopes. The token carries them, and the profile claims she sends are written; the answer is the
profile as `GET /me/profile` shows it, so it is the check that the write took:

```bash
signin grace "openid me:read me:write"
TOKEN=$(token)
echo "$TOKEN" | cut -d. -f2 | python3 -c "import sys,base64;s=sys.stdin.read().strip();print(base64.urlsafe_b64decode(s+'='*(-len(s)%4)).decode())" | jq -c '{scope,client_id}'
curl -sS -D - -X PATCH -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Grace Hopper","locale":"en"}' $ME/profile
```

```
{"scope":"openid me:read me:write","client_id":"me-app"}
HTTP/1.1 200 OK
x-request-id: 01a1cf7d-e800-786e-93d8-748217b348fa
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 583
Date: Thu, 12 Nov 2026 11:21:37 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"sub":"01a1cf7d-e1d7-7736-be76-b55deeca97fe","username":"grace","email":"grace@example.com","email_verified":false,"name":"Grace Hopper","given_name":null,"family_name":null,"middle_name":null,"nickname":null,"preferred_username":null,"profile":null,"picture":null,"website":null,"gender":null,"birthdate":null,"zoneinfo":null,"locale":"en","phone_number":null,"phone_number_verified":false,"address_formatted":null,"address_street":null,"address_locality":null,"address_region":null,"address_postal_code":null,"address_country":null,"profile_updated_at":"2026-11-12T11:21:37.548Z"}
```

A member that is not a claim a person may write is refused, not ignored: the verification flags are proved by a mail or a code,
never stated, and `username` is a claim only where the tenant has turned on `username_editable`. An `email` goes in a request of
its own, because it does not take effect when it is sent:

```bash
for body in '{"email_verified":true}' '{"username":"grace2"}' '{"email":"grace.hopper@example.com","name":"G"}' '{}'; do
  curl -sS -X PATCH -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "$body" $ME/profile
  echo
done
```

```
{"error":"invalid_request","error_description":"The request body is not valid: Unrecognized key: \"email_verified\""}
{"error":"invalid_request","error_description":"username: this tenant has not enabled username editing (username_editable)"}
{"error":"invalid_request","error_description":"email: change the address in a request of its own"}
{"error":"invalid_request","error_description":"The request body is not valid: must name at least one member"}
```

A token that holds `me:read` alone cannot write. The person approved both scopes, so a request that names only `me:read` gets a
token that has it:

```bash
signin grace "openid me:read"
READ=$(token)
curl -sS -D - -X PATCH -H "Authorization: Bearer $READ" -H 'content-type: application/json' \
  -d '{"name":"Someone Else"}' $ME/profile
```

```
HTTP/1.1 403 Forbidden
x-request-id: 01a1cf7d-e8d8-7ffa-8162-b08c797fe8d4
www-authenticate: Bearer error="insufficient_scope", scope="me:write"
cache-control: no-store
content-length: 0
Date: Thu, 12 Nov 2026 11:21:37 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

What changed is in the audit trail, with the fields named and never their values (an address or a birthdate identifies a person
more than a trail should hold). The actor is `grace`, acting through `me-app`, and `via` says the change came through this API:

```bash
curl -sS -H "Authorization: Bearer $ADMIN" "$BASE/admin/tenants/me-edit/audit?action=subject.profile_amend&from=$RUN_START" \
  | jq -c '.items[] | {action, outcome, detail}'
```

```
{"action":"subject.profile_amend","outcome":"allowed","detail":{"via":"me","fields":["name","locale"]}}
```

## A new address

The address does not change when it is asked for. The request is answered `202`, and the profile still holds the old address
until the person follows the link that is mailed to the new one. This needs a recent sign-in, and `grace` has just made one:

```bash
signin grace "openid me:read me:write"
TOKEN=$(token)
curl -sS -D - -X PATCH -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"email":"grace.hopper@example.com"}' $ME/profile
echo
curl -sS -H "Authorization: Bearer $TOKEN" $ME/profile | jq -c '{email, email_verified}'
```

```
HTTP/1.1 202 Accepted
x-request-id: 01a1cf7d-e97e-742a-8b79-3ca9973d2bd5
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 32
Date: Thu, 12 Nov 2026 11:21:37 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"email_verification_sent":true}
{"email":"grace@example.com","email_verified":false}
```

The mail is queued and goes out when the sender runs. It goes to the new address. Nothing is mailed to the old one, because `grace` never verified it; a verified address is told, as the section after this one shows:

```bash
odudu send-mail
curl -sS localhost:8092/api/v1/messages | jq -c '.messages[] | {to: [.To[].Address], subject: .Subject}'
```

```
{"ran":true,"sent":1,"failed":0}
{"to":["grace.hopper@example.com"],"subject":"Verify your me-edit account"}
```

The link is in the text of the mail. Opening it shows a page with one button, and pressing the button makes the address the
person's, verified:

```bash
ID=$(curl -sS localhost:8092/api/v1/messages | jq -r '.messages[0].ID')
LINK=$(curl -sS localhost:8092/api/v1/message/$ID | jq -r .Text | grep -o 'http://[^ ]*action-token?key=[^ ]*' | tr -d '\r')
KEY=${LINK#*key=}
curl -sS "$LINK" | sed -n '/<h1>/,/<\/form>/p'
curl -sS -D - -o /dev/null -X POST --data-urlencode "key=$KEY" $BASE/tenants/me-edit/login-actions/action-token | head -1
curl -sS -H "Authorization: Bearer $TOKEN" $ME/profile | jq -c '{email, email_verified}'
```

```
<h1>Confirm your email address</h1>
<p>Email address: <bdi>grace.hopper@example.com</bdi></p>
<p>Account at <bdi>me-edit</bdi></p>
<p>Press the button to confirm this address.</p>
<form method="post" action="/tenants/me-edit/login-actions/action-token">
  <input type="hidden" name="key" value="d6oNgV9puBSzh3rSSy-OGQ6N5cjMvILmCelwNdxrGDI">
  <button type="submit">Confirm my email</button>
</form>
HTTP/1.1 200 OK
{"email":"grace.hopper@example.com","email_verified":true}
```

The link works once. Pressing the button a second time is refused with `400`:

```bash
curl -sS -D - -o /dev/null -X POST --data-urlencode "key=$KEY" $BASE/tenants/me-edit/login-actions/action-token | head -1
```

```
HTTP/1.1 400 Bad Request
```

Asking for an address another person holds is answered exactly as asking for a free one, `202`, so the response tells nothing
about who holds what. The difference is that no mail is sent: `lin` holds `lin@example.com`, and the mail catcher has still only
the one message:

```bash
curl -sS -D - -o /dev/null -X PATCH -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"email":"lin@example.com"}' $ME/profile | head -1
odudu send-mail
curl -sS localhost:8092/api/v1/messages | jq -c '[.messages[] | .To[].Address]'
curl -sS -H "Authorization: Bearer $ADMIN" "$BASE/admin/tenants/me-edit/audit?action=subject.profile_amend&from=$RUN_START" \
  | jq -c '.items[] | select(.detail.fields == ["email"]) | {action, outcome, detail}'
curl -sS -H "Authorization: Bearer $ADMIN" "$BASE/admin/tenants/me-edit/audit?action=email.changed&from=$RUN_START" \
  | jq -c '.items[] | {action, outcome, detail}'
```

```
HTTP/1.1 202 Accepted
{"ran":true,"sent":0,"failed":0}
["grace.hopper@example.com"]
{"action":"subject.profile_amend","outcome":"allowed","detail":{"via":"me","fields":["email"],"skipped":"address_in_use"}}
{"action":"subject.profile_amend","outcome":"allowed","detail":{"via":"me","fields":["email"],"notice":"skipped_unverified","pending":true}}
{"action":"email.changed","outcome":"allowed","detail":{}}
```

### The address being left

A person who has proved their address has a notice queued to it when a change is asked for and the request is not
skipped, at the address that would be left, so that somebody who has taken over a session is less likely to move the account unnoticed. It is a queued mail, not a
guarantee: delivery happens later and can fail, and the audit value `sent` records that the notice was queued, not that it
arrived. `grace` verified her address above, so the same kind of request now queues two mails: the link to the new address,
and a notice to the old one. The notice names the change and the time, and carries no link:

```bash
signin grace "openid me:read me:write"
NOTICED=$(token)
curl -sS -o /dev/null -w '%{http_code}\n' -X PATCH -H "Authorization: Bearer $NOTICED" -H 'content-type: application/json' \
  -d '{"email":"grace.second@example.com"}' $ME/profile
odudu send-mail
curl -sS localhost:8092/api/v1/messages | jq -c '[.messages[] | select(.Subject | test("requested")) | {to: [.To[].Address], subject: .Subject}][0]'
ID=$(curl -sS localhost:8092/api/v1/messages | jq -r '[.messages[] | select(.Subject | test("requested"))][0].ID')
curl -sS localhost:8092/api/v1/message/$ID | jq -r .Text | sed -n '1,8p'
curl -sS -H "Authorization: Bearer $ADMIN" "$BASE/admin/tenants/me-edit/audit?action=subject.profile_amend&from=$RUN_START" \
  | jq -c '.items[] | select(.detail.pending == true) | {action, detail}'
```

```
202
{"ran":true,"sent":2,"failed":0}
{"to":["grace.hopper@example.com"],"subject":"A new email address was requested for your me-edit account"}
Someone asked to change the email address on your ⁨me-edit⁩ account. This address stays on the account until the new one is confirmed.

This happened on 2026-11-12 11:21 UTC.

If this was not you, sign in and review your sign-in methods, change your password if you use one, or contact your administrator right away.

--
You received this because the email address on your account at ⁨me-edit⁩ was asked to change.
{"action":"subject.profile_amend","detail":{"via":"me","fields":["email"],"notice":"sent","pending":true}}
{"action":"subject.profile_amend","detail":{"via":"me","fields":["email"],"notice":"skipped_unverified","pending":true}}
```

The audit row says whether anybody was told: `notice` is `sent`, `skipped_unverified` when the address on file was never verified,
or `skipped_none` when the person has none. The change is allowed in every case; only the mail depends on it.

## A recent sign-in

The window is 30 seconds here. The token from the last section is now older than that, so the same kind of request is refused
with `401`. The challenge names the error, `insufficient_user_authentication`, and the age that would do, `max_age`:

```bash
sleep 35
curl -sS -D - -X PATCH -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"email":"grace@example.org"}' $ME/profile
```

```
HTTP/1.1 401 Unauthorized
x-request-id: 01a1cf7e-7a13-7111-bac8-d9c02fde05c4
www-authenticate: Bearer error="insufficient_user_authentication", error_description="A recent sign-in is required", max_age="30"
cache-control: no-store
content-length: 0
Date: Thu, 12 Nov 2026 11:22:14 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

An application that gets this does not retry: it sends the person through `/authorize` again with the `max_age` from the
challenge (and the `acr_values` if the challenge has them, see below). `grace` still has a session in the browser, but it is
older than `max_age`, so the authorization server shows the sign-in page again instead of answering with a code. This is the one
step of the page that is run as the browser of the same person, with the cookie jar of the sign-in before it:

```bash
pkce
curl -sS -c jar -b jar -o authorize.html -w '%{http_code}\n' --get --data-urlencode response_type=code --data-urlencode client_id=me-app \
  --data-urlencode redirect_uri=$REDIR --data-urlencode "scope=openid me:read me:write" --data-urlencode "resource=$ME" \
  --data-urlencode state=s --data-urlencode "code_challenge=$CHALLENGE" --data-urlencode code_challenge_method=S256 \
  --data-urlencode max_age=30 $BASE/tenants/me-edit/protocol/openid-connect/auth
grep -o '<title>[^<]*' authorize.html
AS=$(grep -o 'name="auth_session_id" value="[^"]*"' authorize.html | head -1 | sed 's/.*value="//;s/"//')
password_step grace "openid me:read me:write"
FRESH=$(token)
curl -sS -D - -X PATCH -H "Authorization: Bearer $FRESH" -H 'content-type: application/json' \
  -d '{"email":"grace@example.org"}' $ME/profile
```

```
200
<title>Sign in
HTTP/1.1 202 Accepted
x-request-id: 01a1cf7e-7b09-788a-884e-711c35b29734
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 32
Date: Thu, 12 Nov 2026 11:22:15 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"email_verification_sent":true}
```

The new sign-in is a session of its own with a new token, and the old token is not made fresh by it: it still answers `401`.

```bash
curl -sS -D - -o /dev/null -X PATCH -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"email":"grace@example.org"}' $ME/profile | sed -n '1p;3p'
```

```
HTTP/1.1 401 Unauthorized
www-authenticate: Bearer error="insufficient_user_authentication", error_description="A recent sign-in is required", max_age="30"
```

## Sessions

Ending one session needs no recent sign-in, and ending all the others does. `grace` has the sessions the sections above made, each a sign-in in a new browser. The
token used here is the fresh one, whose session is marked `current`. Ending one other session answers `current_session_ended`,
which is `true` only when the session is the one the token was issued for:

```bash
curl -sS -H "Authorization: Bearer $FRESH" "$ME/sessions?limit=200" | jq -c '{count: (.items | length), current: [.items[] | select(.current) | .id]}'
OTHER=$(curl -sS -H "Authorization: Bearer $FRESH" "$ME/sessions?limit=200" | jq -r '[.items[] | select(.current | not)][0].id')
curl -sS -D - -X DELETE -H "Authorization: Bearer $FRESH" $ME/sessions/$OTHER
```

```
{"count":5,"current":["01a1cf7e-7ad1-7b4f-a1ec-738823097965"]}
HTTP/1.1 200 OK
x-request-id: 01a1cf7e-7b7f-7fc8-a192-5b8ca1e54b97
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 31
Date: Thu, 12 Nov 2026 11:22:15 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"current_session_ended":false}
```

`DELETE /me/sessions` ends every other session, and never the one the token was issued for. One request ends a hundred at most, so
`more` says whether any are left. To show it, `grace` signs in on a hundred more browsers, each its own session, whose codes are
never redeemed:

```bash
for i in $(seq 1 100); do signin grace "openid me:read" > /dev/null; done
curl -sS -H "Authorization: Bearer $FRESH" "$ME/sessions?limit=200" | jq -c '{count: (.items | length)}'
curl -sS -D - -X DELETE -H "Authorization: Bearer $FRESH" $ME/sessions
echo
curl -sS -D - -X DELETE -H "Authorization: Bearer $FRESH" $ME/sessions
echo
curl -sS -H "Authorization: Bearer $FRESH" "$ME/sessions" | jq -c '{count: (.items | length), current: [.items[] | .current]}'
```

```
{"count":104}
HTTP/1.1 200 OK
x-request-id: 01a1cf7e-a1c4-7126-a653-962381df1d4b
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 25
Date: Thu, 12 Nov 2026 11:22:25 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"ended":100,"more":true}
HTTP/1.1 200 OK
x-request-id: 01a1cf7e-a1e4-7543-b0c8-8735e8116f48
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 24
Date: Thu, 12 Nov 2026 11:22:25 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"ended":3,"more":false}
{"count":1,"current":[true]}
```

The token of the first sign-in of the address section stood behind one of the sessions just ended. A read with it still answers,
because a read checks the token and not the session. Every change is refused `401` `invalid_token`, the ones that need a recent
sign-in and the ones that do not: a change is made on behalf of a session, and signing in again is a new session, not a refresh
of this one, so there is no challenge to answer:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" $ME/profile
curl -sS -o /dev/null -w '%{http_code}\n' -X PATCH -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"locale":"en"}' $ME/profile
curl -sS -D - -o /dev/null -X PATCH -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"email":"grace@example.net"}' $ME/profile | sed -n '1p;3p'
```

```
200
401
HTTP/1.1 401 Unauthorized
www-authenticate: Bearer error="invalid_token"
```

Each of those is a session ended as a logout ends it, with its grants revoked and any back-channel logout sent. The trail has
one row for the single end and one for each request that ended the others, with the number it ended. Each session that ended is
also a `session.ended` event, as it is when a person logs out, whose detail says `via` `self`; the third request shows two:

```bash
curl -sS -H "Authorization: Bearer $ADMIN" "$BASE/admin/tenants/me-edit/audit?action=session.end_all&from=$RUN_START" \
  | jq -c '.items[] | {action, outcome, detail}'
curl -sS -H "Authorization: Bearer $ADMIN" "$BASE/admin/tenants/me-edit/audit?action=session.end&from=$RUN_START" \
  | jq -c '.items[] | {action, outcome, detail}'
curl -sS -H "Authorization: Bearer $ADMIN" "$BASE/admin/tenants/me-edit/audit?action=session.ended&from=$RUN_START&limit=2" \
  | jq -c '.items[] | {event_type, action, detail}'
```

```
{"action":"session.end_all","outcome":"allowed","detail":{"via":"me","more":false,"ended":3}}
{"action":"session.end_all","outcome":"allowed","detail":{"via":"me","more":true,"ended":100}}
{"action":"session.end","outcome":"allowed","detail":{"via":"me","current":false}}
{"event_type":"session","action":"session.ended","detail":{"via":"self"}}
{"event_type":"session","action":"session.ended","detail":{"via":"self"}}
```

## A consent

`grace` approved `me-app` at her first sign-in, and it is listed. Withdrawing the consent removes it and revokes every grant she
holds under that client; withdrawing one she never gave is `404`:

```bash
curl -sS -H "Authorization: Bearer $FRESH" $ME/consents | jq -c .
curl -sS -D - -X DELETE -H "Authorization: Bearer $FRESH" $ME/consents/me-app
curl -sS -H "Authorization: Bearer $FRESH" $ME/consents | jq -c .
curl -sS -D - -X DELETE -H "Authorization: Bearer $FRESH" $ME/consents/me-app
```

```
{"items":[{"client_id":"me-app","scope_names":["openid","me:read","me:write"],"granted_at":"2026-11-12T11:21:37.424Z"}],"next_cursor":null}
HTTP/1.1 204 No Content
x-request-id: 01a1cf7e-a289-7861-87cb-6dd88923213f
cache-control: no-store
Date: Thu, 12 Nov 2026 11:22:25 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[],"next_cursor":null}
HTTP/1.1 404 Not Found
x-request-id: 01a1cf7e-a2a7-708b-a5de-3b1da1195143
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 59
Date: Thu, 12 Nov 2026 11:22:25 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"error":"not_found","error_description":"No such consent"}
```

## An authenticator

`lin` holds a password only, and her address is marked verified now, so that the mails these changes send can be seen. The tenant
is made to require a second factor, so her next sign-in asks her to set one up. The page does what an authenticator app does: it
reads the secret off the setup page and computes the code ([the TOTP page](./two-factor-authentication-with-totp.md) shows each
step):

```bash
odudu seed profile --tenant me-edit --username lin --email-verified | jq -c '{command}'
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN" -H 'content-type: application/json' \
  -d '{"otp_required":true}' $BASE/admin/tenants/me-edit/settings | jq -c '{otp_required}'
totp() { node --input-type=module -e "
import { totpCode, totpCounter } from './packages/crypto/src/service/totp.ts';
console.log(totpCode('$1', totpCounter(new Date())));
"; }
rm -f jar; pkce; authorize me-app "openid me:read me:write" "$ME"
curl -sS -c jar -b jar -o setup.html --data-urlencode "auth_session_id=$AS" --data-urlencode username=lin \
  --data-urlencode password=correct-horse-battery $BASE/tenants/me-edit/login-actions/authenticate
grep -o '<h1>[^<]*' setup.html
SECRET=$(grep -o 'secret=[A-Z2-7]*' setup.html | head -1 | sed 's/secret=//')
AS=$(grep -o 'name="auth_session_id" value="[^"]*"' setup.html | head -1 | sed 's/.*value="//;s/"//')
curl -sS -c jar -b jar -o recovery.html --data-urlencode "auth_session_id=$AS" --data-urlencode "secret=$SECRET" \
  --data-urlencode "code=$(totp $SECRET)" "$BASE/tenants/me-edit/login-actions/required-action?action=configure-totp"
grep -o '<h1>[^<]*' recovery.html
AS=$(grep -o 'name="auth_session_id" value="[^"]*"' recovery.html | head -1 | sed 's/.*value="//;s/"//')
curl -sS -c jar -b jar -D login.headers -o login.html --data-urlencode "auth_session_id=$AS" \
  "$BASE/tenants/me-edit/login-actions/required-action?action=generate-recovery-codes"
AS=$(grep -o 'name="auth_session_id" value="[^"]*"' login.html | head -1 | sed 's/.*value="//;s/"//')
curl -sS -c jar -b jar -D login.headers -o /dev/null --data-urlencode "auth_session_id=$AS" --data-urlencode scope=me:read \
  --data-urlencode scope=me:write --data-urlencode decision=allow $BASE/tenants/me-edit/login-actions/consent
CODE=$(grep -i '^location:' login.headers | sed 's/.*code=//;s/&.*//' | tr -d '\r')
LIN=$(token)
curl -sS -H "Authorization: Bearer $LIN" $ME/credentials | jq -c '.items[] | {type, label}'
```

```
{"command":"profile"}
{"otp_required":true}
<h1>Set up your authenticator
<h1>Save your recovery codes
{"type":"password","label":null}
{"type":"totp","label":null}
```

An authenticator can be renamed, which is the label the person sees in their list. The password is not an authenticator, and an id
that is not one of hers is `404`:

```bash
TOTP_ID=$(curl -sS -H "Authorization: Bearer $LIN" $ME/credentials | jq -r '.items[] | select(.type == "totp") | .id')
PASSWORD_ID=$(curl -sS -H "Authorization: Bearer $LIN" $ME/credentials | jq -r '.items[] | select(.type == "password") | .id')
curl -sS -D - -X PATCH -H "Authorization: Bearer $LIN" -H 'content-type: application/json' \
  -d '{"label":"Phone"}' $ME/credentials/$TOTP_ID
echo
curl -sS -D - -o /dev/null -X PATCH -H "Authorization: Bearer $LIN" -H 'content-type: application/json' \
  -d '{"label":"Laptop"}' $ME/credentials/$PASSWORD_ID | head -1
```

```
HTTP/1.1 200 OK
x-request-id: 01a1cf7e-a6f0-716e-aaa7-1dfc56dcd03f
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 135
Date: Thu, 12 Nov 2026 11:22:26 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1cf7e-a5e6-7a76-a3d6-91a42335a437","type":"totp","label":"Phone","created_at":"2026-11-12T11:22:26.149Z","last_used_at":null}
HTTP/1.1 404 Not Found
```

Removing the only authenticator of a tenant that requires one is refused with `409`, and nothing is deleted. The tenant needs
every person to hold a second factor, so the last one stays until another is added:

```bash
curl -sS -D - -X DELETE -H "Authorization: Bearer $LIN" $ME/credentials/$TOTP_ID
echo
curl -sS -H "Authorization: Bearer $LIN" $ME/credentials | jq -c '[.items[] | .type]'
```

```
HTTP/1.1 409 Conflict
x-request-id: 01a1cf7e-a712-77b0-aa9a-230e2e8e593a
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 146
Date: Thu, 12 Nov 2026 11:22:26 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"error":"last_second_factor","error_description":"This tenant requires a second factor and this is the last one; add another before removing it"}
["password","totp"]
```

A removal asks a person who holds a second factor for a sign-in that used it. After the window passes, the same request is a
`401` whose challenge also names `acr_values`, the authentication class a sign-in with a second factor earns, and the gate
answers before the tenant's rule does:

```bash
sleep 35
curl -sS -D - -X DELETE -H "Authorization: Bearer $LIN" $ME/credentials/$TOTP_ID
```

```
HTTP/1.1 401 Unauthorized
x-request-id: 01a1cf7f-3005-7f81-9bcd-5dd88c883682
www-authenticate: Bearer error="insufficient_user_authentication", error_description="A recent sign-in is required", max_age="30", acr_values="2"
cache-control: no-store
content-length: 0
Date: Thu, 12 Nov 2026 11:23:01 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The application sends her through `/authorize` with both, and this time the sign-in asks for the code as well as the password. The
code of the step the setup spent is not accepted again, and the window has moved on since:

```bash
pkce
curl -sS -c jar -b jar -o authorize.html -w '%{http_code}\n' --get --data-urlencode response_type=code --data-urlencode client_id=me-app \
  --data-urlencode redirect_uri=$REDIR --data-urlencode "scope=openid me:read me:write" --data-urlencode "resource=$ME" \
  --data-urlencode state=s --data-urlencode "code_challenge=$CHALLENGE" --data-urlencode code_challenge_method=S256 \
  --data-urlencode max_age=30 --data-urlencode acr_values=2 $BASE/tenants/me-edit/protocol/openid-connect/auth
AS=$(grep -o 'name="auth_session_id" value="[^"]*"' authorize.html | head -1 | sed 's/.*value="//;s/"//')
curl -sS -c jar -b jar -o code-form.html --data-urlencode "auth_session_id=$AS" --data-urlencode username=lin \
  --data-urlencode password=correct-horse-battery $BASE/tenants/me-edit/login-actions/authenticate
grep -o 'name="code"' code-form.html
AS=$(grep -o 'name="auth_session_id" value="[^"]*"' code-form.html | head -1 | sed 's/.*value="//;s/"//')
curl -sS -c jar -b jar -D login.headers -o /dev/null --data-urlencode "auth_session_id=$AS" --data-urlencode "code=$(totp $SECRET)" \
  $BASE/tenants/me-edit/login-actions/authenticate
CODE=$(grep -i '^location:' login.headers | sed 's/.*code=//;s/&.*//' | tr -d '\r')
LIN=$(token)
curl -sS -D - -X DELETE -H "Authorization: Bearer $LIN" $ME/credentials/$TOTP_ID
```

```
200
name="code"
HTTP/1.1 409 Conflict
x-request-id: 01a1cf7f-313f-71de-bf72-b1fcbea608dc
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 146
Date: Thu, 12 Nov 2026 11:23:01 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"error":"last_second_factor","error_description":"This tenant requires a second factor and this is the last one; add another before removing it"}
```

That sign-in satisfies the gate and the tenant's rule still refuses. Once the tenant stops requiring a second factor, the
authenticator may go, because the password still signs her in; the answer is `204` and the list holds the password alone:

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN" -H 'content-type: application/json' \
  -d '{"otp_required":false}' $BASE/admin/tenants/me-edit/settings | jq -c '{otp_required}'
curl -sS -D - -X DELETE -H "Authorization: Bearer $LIN" $ME/credentials/$TOTP_ID
curl -sS -H "Authorization: Bearer $LIN" $ME/credentials | jq -c '[.items[] | .type]'
curl -sS -H "Authorization: Bearer $ADMIN" "$BASE/admin/tenants/me-edit/audit?from=$RUN_START&limit=200" \
  | jq -c '.items[] | select(.action | test("credential|recovery")) | {action, detail}'
odudu send-mail
curl -sS localhost:8092/api/v1/messages | jq -c '[.messages[] | select(.To[].Address == "lin@example.com") | .Subject] | sort'
```

```
{"otp_required":false}
HTTP/1.1 204 No Content
x-request-id: 01a1cf7f-316c-7b09-b36f-5216ec951a72
cache-control: no-store
Date: Thu, 12 Nov 2026 11:23:01 GMT
Connection: keep-alive
Keep-Alive: timeout=72

["password"]
{"action":"subject.recovery_codes_revoke","detail":{"via":"me","reason":"last_factor_removed","revoked":10}}
{"action":"subject.credential_delete","detail":{"via":"me","type":"totp","notice":"sent","credential_id":"01a1cf7e-a5e6-7a76-a3d6-91a42335a437"}}
{"action":"subject.credential_rename","detail":{"via":"me","type":"totp","credential_id":"01a1cf7e-a5e6-7a76-a3d6-91a42335a437"}}
{"action":"recovery_codes.issued","detail":{"notice":"sent"}}
{"ran":true,"sent":5,"failed":0}
["An authenticator app was added to your me-edit account","An authenticator app was removed from your me-edit account","New recovery codes were saved on your me-edit account"]
```

`lin` verified her address, so each change was told to her: the authenticator she set up, the recovery codes she saved and the
authenticator she removed, and the audit rows of the removal and of the codes say `notice` `sent`. The third notice says the
recovery codes went with the authenticator, because it was the last.

The other refusal, `last_sign_in_method`, is for taking away a passkey that is the only way a person signs in. It cannot be
reached here: a passkey is registered by a browser, and a person who has one and a password may remove either. The integration
tests of the removal run it.

## An agent's token

A client that is allowed to exchange tokens ([token exchange](./path-d-token-exchange.md)) can get a token that names an actor: it is
`grace`'s token, and carries `act`, the claim that says somebody acts for her. The me API lets such a token read and refuses it every
write, whatever scopes it holds: the person makes the change themselves. The client below may exchange for the me URL and holds both
me scopes; `lin` is the actor:

```bash
psql() { docker compose -p odudu-p4f-i25 -f infra/docker/compose.yaml -f compose.mail.yaml exec -T postgres psql -U odudu -d odudu "$@"; }
odudu seed client --tenant me-edit --client-id me-exchange --client-secret me-exchange-secret \
  --redirect-uri http://localhost:8080/callback --grant-type authorization_code --grant-type refresh_token \
  --grant-type urn:ietf:params:oauth:grant-type:token-exchange --token-exchange-actor-from-other-client | jq -c '{client:.clientId}'
psql -c "UPDATE client_oidc_config SET audiences = ARRAY['$ME'], token_exchange_impersonation_allowed = true
  FROM clients WHERE clients.id = client_oidc_config.client_id AND clients.client_id = 'me-exchange'
  AND client_oidc_config.tenant_id = (SELECT id FROM tenants WHERE name = 'me-edit');"
for s in me:read me:write; do odudu seed assign-scope --tenant me-edit --client-id me-exchange --scope $s --assignment optional | jq -c '{scope}'; done
signin grace "openid me:read me:write"; SUBJECT=$(token)
signin lin "openid me:read me:write"; ACTOR=$(token)
AGENT=$(curl -sS -u me-exchange:me-exchange-secret \
  --data-urlencode grant_type=urn:ietf:params:oauth:grant-type:token-exchange \
  --data-urlencode "subject_token=$SUBJECT" --data-urlencode subject_token_type=urn:ietf:params:oauth:token-type:access_token \
  --data-urlencode "actor_token=$ACTOR" --data-urlencode actor_token_type=urn:ietf:params:oauth:token-type:access_token \
  --data-urlencode "resource=$ME" $BASE/tenants/me-edit/protocol/openid-connect/token | jq -r .access_token)
echo "$AGENT" | cut -d. -f2 | python3 -c "import sys,base64;s=sys.stdin.read().strip();print(base64.urlsafe_b64decode(s+'='*(-len(s)%4)).decode())" | jq -c '{scope,aud,act}'
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $AGENT" $ME/profile
curl -sS -D - -X PATCH -H "Authorization: Bearer $AGENT" -H 'content-type: application/json' -d '{"name":"Not Grace"}' $ME/profile
```

```
{"client":"me-exchange"}
UPDATE 1
{"scope":"me:read"}
{"scope":"me:write"}
{"scope":"openid me:read me:write","aud":["http://localhost:3000/tenants/me-edit/me","http://localhost:3000/tenants/me-edit"],"act":{"sub":"01a1cf7d-e377-71f9-9b34-b767394e3d4a"}}
200
HTTP/1.1 403 Forbidden
x-request-id: 01a1cf7f-3b17-7389-a724-95a0e3c28ffc
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 164
Date: Thu, 12 Nov 2026 11:23:04 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"error":"agent_not_permitted","error_description":"A token issued to an agent may read this account and may not change it; the person makes the change themselves"}
```

What this page does not show: the API at a tenant's own domain (the path is `/me/profile` there), and a rate limit and CORS on
these routes, which they do not have yet.
