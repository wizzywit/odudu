---
title: An address, a profile and the terms at sign-in
description: A tenant asks a person to verify an address, fill in a profile and accept terms before a sign-in ends; an application may start two of these.
---

# An address, a profile and the terms at sign-in

Three required actions ask more of a person than a credential does. `verify-email` asks them to prove the address on file, with
a link mailed to it. `update-profile` asks them to fill in the profile fields the tenant requires. `accept-terms` asks them to
accept the tenant's terms at the version in force. An administrator owes them to a person with `PUT /admin/tenants/<name>/subjects/<id>/required-actions`,
and a sign-in asks for them after the password, in this order among the rest: `verify-email`, `update-password`, `configure-totp`,
`configure-passkey`, `generate-recovery-codes`, `update-profile` and `accept-terms`. The page of each has no way out while the
tenant asks, and an application that starts `verify-email` or `update-profile` through `/authorize?action=` gives the person a cancel
control, as it does for the other actions ([Sending a person to change a credential](./sending-a-person-to-change-a-credential.md)).
`accept-terms` is the tenant's alone: a client's `allowed_actions` refuses it and `/authorize` refuses `action=accept-terms`.

Every command was run, in this order, on a compose stack built for this page (port `3000`, the throttles at `10000`, the
schedules off), in the tenant `more-demo`, which the first block makes, on a database that began empty: `odudu seed admin`, then the
page's blocks as one script in one shell, each block's output written to the page as it came back (carriage returns and trailing
spaces removed). The stack is the compose stack with the one file added that [The me API's changes](./the-me-api-changes.md)
shows, which gives the server a mail relay that keeps what it is given, `compose.mail.yaml`, so a mailed link can be read; with the
server's own sender off, `odudu send-mail` is what sends. Without a relay the page's button says that the server cannot send mail.
`$ADMIN_TOKEN` is a system administrator's token, got as in [Getting the token](../admin-paths/getting-the-token.md); a token lives
five minutes, and every block that names one ran within the minutes of its own.

## A tenant, two people and a client

`grace` has an address that nobody has verified; `lin` has none. `profile-app` is a public client that may start the two actions an
application can start. The helpers do the sign-in every client does and report what each page is: its status, its heading and
whether it offers a way to leave:

```bash
odudu() { docker compose -p odudu-p4f-i12 -f infra/docker/compose.yaml -f compose.mail.yaml exec -T odudu node dist/main.js "$@"; }
psql() { docker compose -p odudu-p4f-i12 -f infra/docker/compose.yaml -f compose.mail.yaml exec -T postgres psql -U odudu -d odudu "$@"; }
BASE=http://localhost:3000
T=$BASE/tenants/more-demo
ME=$T/me
REDIR=http://127.0.0.1:8080/callback
VERIFIER=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
CHALLENGE=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
authorize() { # client_id, then the members to add to the request
  curl -sS -c jar -b jar -D auth.headers -o auth.html --get --data-urlencode response_type=code --data-urlencode "client_id=$1" \
    --data-urlencode redirect_uri=$REDIR --data-urlencode "scope=openid me:read" --data-urlencode "resource=$ME" --data-urlencode state=s \
    --data-urlencode "code_challenge=$CHALLENGE" --data-urlencode code_challenge_method=S256 "$T/protocol/openid-connect/auth?$2"
  AS=$(grep -o 'name="auth_session_id" value="[^"]*"' auth.html | head -1 | sed 's/.*value="//;s/"//')
}
step() { # a POST to the sign-in flow; the headers of the answer are step.headers, its page step.html
  local target=$1; shift
  curl -sS -c jar -b jar -D step.headers -o step.html --data-urlencode "auth_session_id=$AS" "$@" "$T/login-actions/$target"
  local next; next=$(grep -o 'name="auth_session_id" value="[^"]*"' step.html | head -1 | sed 's/.*value="//;s/"//')
  [ -n "$next" ] && AS=$next
  return 0
}
shown() { # the heading of the page that came back, whether it offers a way to leave, and the status line
  local page=${1:-step.html}
  echo "status: $(head -1 step.headers | tr -d '\r' | cut -d' ' -f2)"
  echo "page: $(grep -o '<h1>[^<]*' $page | sed 's/<h1>//')"
  if grep -q 'name="cancel"' $page; then echo "cancel control: yes"; else echo "cancel control: no"; fi
}
back() { grep -i '^location:' step.headers | tr -d '\r'; }
odudu seed --tenant more-demo --client demo-spa --redirect-uri $REDIR \
  --user grace --password correct-horse-battery --email grace@example.com
odudu seed user --tenant more-demo --username lin --password correct-horse-battery
odudu seed client --tenant more-demo --client-id profile-app --public --redirect-uri $REDIR \
  --audience $ME --allow-action verify-email --allow-action update-profile
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/admin/tenants/more-demo/clients?client_id_exact=profile-app" \
  | jq -c '.items[0] | {client_id, allowed_actions}'
```

```
{"created":true,"tenant":"more-demo","tenantId":"01a1d202-aa3c-7470-b30e-0494d8902d94","clientId":"demo-spa","userSubjectId":"01a1d202-aadf-79f5-a8b2-bb9c647a6a1c"}
{"command":"user","tenant":"more-demo","tenantId":"01a1d202-aa3c-7470-b30e-0494d8902d94","username":"lin","userSubjectId":"01a1d202-acb5-7ef7-9ef0-183016b546bc"}
{"command":"client","created":true,"tenant":"more-demo","tenantId":"01a1d202-aa3c-7470-b30e-0494d8902d94","clientId":"profile-app","clientDbId":"01a1d202-aeb7-7d10-bb98-d453006afd5c"}
{"client_id":"profile-app","allowed_actions":["verify-email","update-profile"]}
```

## What an administrator cannot owe

An action that cannot be done is refused when it is added to a person's list, with a `409` whose `type` says why, rather than left to
fail at the next sign-in. `lin` has no address to verify, and the tenant has no terms yet, so `accept-terms` is refused for `grace`:

```bash
GRACE=$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/admin/tenants/more-demo/subjects?username=grace" | jq -r '.items[0].id')
LIN=$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/admin/tenants/more-demo/subjects?username=lin" | jq -r '.items[0].id')
put() { # subject id, then the actions as a JSON list
  local etag; etag=$(curl -sS -D - -o /dev/null -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/admin/tenants/more-demo/subjects/$1/required-actions" | grep -i '^etag:' | cut -d' ' -f2 | tr -d '\r')
  curl -sS -D - -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: $etag" -H 'content-type: application/json' \
    -d "{\"actions\":$2}" "$BASE/admin/tenants/more-demo/subjects/$1/required-actions"
  echo
}
put $LIN '["verify-email"]'
put $GRACE '["accept-terms"]'
```

```
HTTP/1.1 409 Conflict
x-request-id: 01a1d202-bb60-7e5b-b91f-de3ff63a910a
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 189
Date: Thu, 12 Nov 2026 23:05:56 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank#no-email","title":"Conflict","status":409,"detail":"the subject has no email address, so verify-email cannot be owed","instance":"01a1d202-bb60-7e5b-b91f-de3ff63a910a"}
HTTP/1.1 409 Conflict
x-request-id: 01a1d202-bba2-78e2-b8c7-869ab7783e8a
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 231
Date: Thu, 12 Nov 2026 23:05:56 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank#terms-not-configured","title":"Conflict","status":409,"detail":"the tenant has no terms_uri, so accept-terms cannot be owed; set it with PATCH /settings first","instance":"01a1d202-bba2-78e2-b8c7-869ab7783e8a"}
```

The terms are two tenant settings, `terms_uri` and `terms_version`; setting them asks nobody. The address has to be https (or http
to this machine), of a bounded length, with no fragment and no credentials in it. The profile asks for the claims in a third
setting, `required_profile_fields`, which is `given_name` and `family_name` until it is changed; here `birthdate` is added. With the
terms set, all three actions are owed to `grace`, and the list is read back sorted by name:

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"terms_uri":"https://example.com/terms","terms_version":"2026-01"}' "$BASE/admin/tenants/more-demo/settings" \
  | jq -c '{terms_uri, terms_version, required_profile_fields}'
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"terms_uri":"http://example.com/terms"}' "$BASE/admin/tenants/more-demo/settings" | jq -c .
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"required_profile_fields":["given_name","family_name","birthdate"]}' "$BASE/admin/tenants/more-demo/settings" \
  | jq -c '{required_profile_fields}'
put $GRACE '["accept-terms","update-profile","verify-email"]'
```

```
{"terms_uri":"https://example.com/terms","terms_version":"2026-01","required_profile_fields":["given_name","family_name"]}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"1 tenant setting(s) outside the permitted range, listed under errors","errors":[{"path":"terms_uri","message":"must be an https address, or an http one to this machine, of up to 2048 characters, with no fragment and no credentials in it"}],"instance":"01a1d202-bc21-737e-b88d-d9d722b505a4"}
{"required_profile_fields":["given_name","family_name","birthdate"]}
HTTP/1.1 200 OK
x-request-id: 01a1d202-bc7d-7935-854c-121da8523a1d
cache-control: no-store
etag: "3c95abeefed1547300c92fafd42865cf075b9f54e2a070978ecb8418a80d0f6b"
content-type: application/json; charset=utf-8
content-length: 60
Date: Thu, 12 Nov 2026 23:05:57 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"actions":["accept-terms","update-profile","verify-email"]}
```

## The address

`grace` signs in. After her password comes the page for the first action in the order, the address page. It shows the address held,
a control to ask for a link and one to say it is verified, and posts to the same step as the other action pages:

```bash
rm -f jar
authorize profile-app ""
step authenticate --data-urlencode username=grace --data-urlencode password=correct-horse-battery
shown
grep -o 'Address:[^<]*<bdi>[^<]*</bdi>' step.html
grep -o 'name="send"' step.html
grep -o 'login-actions/required-action?action=[a-z-]*' step.html
```

```
status: 200
page: Verify your email address
cancel control: no
Address: <bdi>grace@example.com</bdi>
name="send"
login-actions/required-action?action=verify-email
```

The second control checks the address again, and the action ends only when it is verified. It is not yet, so the page comes back with
the reason in its alert, and all three actions are still owed:

```bash
step "required-action?action=verify-email"
shown
grep -o 'role="alert"' step.html
grep -o '<li id="form-error-0">[^<]*' step.html | sed 's/<li id="form-error-0">//'
psql -c "select action from user_required_actions where subject_id = '$GRACE' order by action"
```

```
status: 200
page: Verify your email address
cancel control: no
role="alert"
That address is not verified yet. Open the link we sent, then try again.
     action
----------------
 accept-terms
 update-profile
 verify-email
(3 rows)
```

The first control queues the verification mail, at most three an hour to one address, and says so on the page. The mail is the one
a verification link already is; its link is shown here as `KEY` in place of the key:

```bash
step "required-action?action=verify-email" --data-urlencode send=1
shown
grep -o 'role="status">[^<]*' step.html | sed 's/role="status">//'
odudu send-mail
curl -sS localhost:8092/api/v1/messages | jq -c '.messages[] | {to: [.To[].Address], subject: .Subject}'
ID=$(curl -sS localhost:8092/api/v1/messages | jq -r '.messages[0].ID')
LINK=$(curl -sS localhost:8092/api/v1/message/$ID | jq -r .Text | grep -o 'http://[^ ]*action-token?key=[^ ]*' | tr -d '\r')
echo "$LINK" | sed 's/key=.*/key=KEY/'
```

```
status: 200
page: Verify your email address
cancel control: no
We sent a link to this address. Open it, then come back and choose &quot;I have verified it&quot;.
{"ran":true,"sent":1,"failed":0}
{"to":["grace@example.com"],"subject":"Verify your more-demo account"}
http://localhost:3000/tenants/more-demo/login-actions/action-token?key=KEY
```

The link opens a page that changes nothing until its button is pressed, so a mail scanner that opens it spends nothing. Pressing it
verifies the address, and the action goes with it, wherever the link was opened:

```bash
curl -sS -c ljar -b ljar -o link.html "$LINK"
grep -o '<h1>[^<]*' link.html | sed 's/<h1>//'
grep -o '<button[^>]*>[^<]*' link.html
grep -o '<form[^>]*>' link.html
```

```
Confirm your email address
<button type="submit">Confirm my email
<form method="post" action="/tenants/more-demo/login-actions/action-token">
```

```bash
KEYFIELD=$(grep -o 'name="key" value="[^"]*"' link.html | sed 's/.*value="//;s/"//')
curl -sS -c ljar -b ljar -o linked.html --data-urlencode "key=$KEYFIELD" "$BASE/tenants/more-demo/login-actions/action-token"
grep -o '<h1>[^<]*' linked.html | sed 's/<h1>//'
psql -At -c "select email_verified from users where subject_id = '$GRACE'"
psql -c "select action from user_required_actions where subject_id = '$GRACE' order by action"
```

```
Your email address is confirmed
t
     action
----------------
 accept-terms
 update-profile
(2 rows)
```

## The profile

Back at the page she was left on, `grace` says she has verified it. Nothing is owed of that action any more, and the sign-in
carries on to the next one: the profile. The form lists every profile field a person can edit through `PATCH /me/profile` (the
username is there only where the tenant lets one change), each with what the person holds, and marks the ones the tenant requires.
The block lists the marked ones and counts the fields that carry a value attribute, which is every field of the form:

```bash
step "required-action?action=verify-email"
shown
grep -o '<label>[^<]*(required) <input type="[a-z]*" name="[a-z_]*"' step.html | sed 's/<label>//;s/ <input type="[a-z]*" name="\([a-z_]*\)"/ [\1]/'
grep -c '<input type="[a-z]*" name="[a-z_]*" value' step.html
```

```
status: 200
page: Complete your profile
cancel control: no
Given name (required) [given_name]
Family name (required) [family_name]
Birthdate (required) [birthdate]
21
```

The form is done when each required field has a value. Left without the birthdate, it comes back with the problem, the field marked
invalid, and nothing written; the last line is the stored name and given name, both still empty:

```bash
FIELDS=(--data-urlencode "name=Grace Hopper" --data-urlencode given_name=Grace --data-urlencode family_name=Hopper --data-urlencode middle_name=Brewster --data-urlencode nickname=Amazing --data-urlencode preferred_username=grace --data-urlencode profile=https://example.com/grace --data-urlencode picture=https://example.com/grace.png --data-urlencode website=https://example.com --data-urlencode gender=female --data-urlencode zoneinfo=America/New_York --data-urlencode locale=en-US --data-urlencode phone_number=+12025550123 --data-urlencode "address_formatted=1 Navy Way" --data-urlencode "address_street=1 Navy Way" --data-urlencode address_locality=Arlington --data-urlencode address_region=Virginia --data-urlencode address_postal_code=22202 --data-urlencode address_country=US)
step "required-action?action=update-profile" --data-urlencode "name=Grace Hopper" --data-urlencode given_name=Grace --data-urlencode family_name=Hopper
shown
grep -o '<li id="form-error-[0-9]*">[^<]*' step.html | sed 's/<li id="form-error-[0-9]*">//'
grep -o '<input[^>]*name="birthdate"[^>]*>' step.html
psql -At -c "select name, given_name from users where subject_id = '$GRACE'"
```

```
status: 400
page: Complete your profile
cancel control: no
Fill in the required fields.
<input type="text" name="birthdate" value="" autocomplete="bday" aria-invalid="true" aria-describedby="form-error-0">
|
```

Every value is judged as the me API judges it, and every refusal is named at once, not one for each round trip. The three bad values
below are all named, and nothing is written:

```bash
step "required-action?action=update-profile" --data-urlencode given_name=Grace --data-urlencode family_name=Hopper \
  --data-urlencode birthdate=12/09/1906 --data-urlencode zoneinfo=+1 --data-urlencode website=ftp://example.com
shown
grep -o '<li id="form-error-[0-9]*">[^<]*' step.html | sed 's/<li id="form-error-[0-9]*">//'
psql -At -c "select name, given_name, birthdate from users where subject_id = '$GRACE'"
```

```
status: 400
page: Complete your profile
cancel control: no
Website must be an address starting with http:// or https://.
Birthdate must be a date as YYYY-MM-DD, or a year as YYYY.
Time zone must be a time zone name such as Europe/London.
||
```

With the required fields filled and every value good, the profile is written in one transaction. A field the form was not asked for
is ignored: the `email` and `unknown` fields below change nothing, and the address stays the one held. The next page is the terms:

```bash
step "required-action?action=update-profile" "${FIELDS[@]}" --data-urlencode birthdate=1906-12-09 --data-urlencode email=other@example.com --data-urlencode unknown=ignored
shown
psql -At -c "select name, birthdate, email, address_country from users where subject_id = '$GRACE'"
psql -c "select action from user_required_actions where subject_id = '$GRACE' order by action"
```

```
status: 200
page: Accept the terms
cancel control: no
Grace Hopper|1906-12-09|grace@example.com|US
    action
--------------
 accept-terms
(1 row)
```

## The terms

The terms page links the terms with `rel="noopener noreferrer"` and `target="_blank"`, names the version, carries the version it shows
in a hidden field and has one box. A box left unticked comes back with the reason:

```bash
grep -o '<a href="[^"]*"[^>]*>[^<]*</a>' step.html
grep -o '(Version <bdi>[^<]*</bdi>)' step.html
grep -o '<input type="hidden" name="version"[^>]*>' step.html
grep -c 'type="checkbox"' step.html
step "required-action?action=accept-terms" --data-urlencode version=2026-01
shown
grep -o '<li id="form-error-0">[^<]*' step.html | sed 's/<li id="form-error-0">//'
```

```
<a href="https://example.com/terms" rel="noopener noreferrer" target="_blank">Read the terms</a>
(Version <bdi>2026-01</bdi>)
<input type="hidden" name="version" value="2026-01">
1
status: 400
page: Accept the terms
cancel control: no
Tick the box to accept the terms and continue.
```

The page recorded nothing about the version it showed until the box is ticked, and it is ticked for the version the person saw. If an
administrator changes the version while the page is open, the form that comes back names the old one: the page is shown again at the
version now in force, says so, and records nothing:

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"terms_version":"2026-02"}' "$BASE/admin/tenants/more-demo/settings" | jq -c '{terms_version}'
step "required-action?action=accept-terms" --data-urlencode accept=true --data-urlencode version=2026-01
shown
grep -o '<li id="form-error-0">[^<]*' step.html | sed 's/<li id="form-error-0">//'
grep -o '(Version <bdi>[^<]*</bdi>)' step.html
psql -c "select count(*) as accepted from subject_terms_acceptances where subject_id = '$GRACE'"
```

```
{"terms_version":"2026-02"}
status: 400
page: Accept the terms
cancel control: no
The terms changed while this page was open. Read the new version, and accept it if you agree.
(Version <bdi>2026-02</bdi>)
 accepted
----------
        0
(1 row)
```

Ticking the box for the version shown records it, with the time, clears the action, and the sign-in completes. The audit trail has
the two writes: the profile fields that changed (their names, never their values) and the acceptance with its version:

```bash
step "required-action?action=accept-terms" --data-urlencode accept=true --data-urlencode version=2026-02
back | sed 's/code=[^&]*/code=CODE/'
psql -c "select version, accepted_at is not null as recorded from subject_terms_acceptances where subject_id = '$GRACE'"
psql -c "select action from user_required_actions where subject_id = '$GRACE'"
psql -At -c "select action, detail from audit_events where tenant_id = (select id from tenants where name = 'more-demo') and action in ('terms.accepted','subject.profile_amend') order by occurred_at" | sed 's/"fields": \[[^]]*\]/"fields": [...]/'
```

```
location: http://127.0.0.1:8080/callback?code=CODE&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fmore-demo
 version | recorded
---------+----------
 2026-02 | t
(1 row)

 action
--------
(0 rows)

subject.profile_amend|{"via": "required_action", "fields": [...]}
terms.accepted|{"version": "2026-02"}
```

The terms change again, and the action is owed again. A person who has accepted one version is asked for the next when an
administrator says so, and not before. The administrator reads what `grace` accepted, newest first, on
[the route that lists it](../admin-paths/get-subjectsidterms-acceptances.md):

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"terms_version":"2026-03"}' "$BASE/admin/tenants/more-demo/settings" | jq -c '{terms_version}'
put $GRACE '["accept-terms"]' | tail -1
rm -f jar
authorize profile-app ""
step authenticate --data-urlencode username=grace --data-urlencode password=correct-horse-battery
shown
step "required-action?action=accept-terms" --data-urlencode accept=true --data-urlencode version=2026-03
back | sed 's/code=[^&]*/code=CODE/'
```

```
{"terms_version":"2026-03"}
{"actions":["accept-terms"]}
status: 200
page: Accept the terms
cancel control: no
location: http://127.0.0.1:8080/callback?code=CODE&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fmore-demo
```

```bash
S=$BASE/admin/tenants/more-demo/subjects
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" $S/$GRACE/terms-acceptances
```

```
HTTP/1.1 200 OK
x-request-id: 01a1d202-d3f2-7d80-82c3-15f504080474
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 137
Date: Thu, 12 Nov 2026 23:06:03 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"version":"2026-03","accepted_at":"2026-11-12T23:06:02.355Z"},{"version":"2026-02","accepted_at":"2026-11-12T23:06:01.045Z"}]}
```

## An application starting an action

`grace` is signed in, and her address is verified. `profile-app` sends her to `verify-email`: the page says the address is already
verified and offers only the way on, and a cancel control as the page of an action an application asked for has. She leaves it, and
the redirect ends in `action_status=cancelled`:

```bash
authorize profile-app "action=verify-email"
echo "status: $(head -1 auth.headers | tr -d '\r' | cut -d' ' -f2)"
echo "page: $(grep -o '<h1>[^<]*' auth.html | sed 's/<h1>//')"
grep -c 'name="cancel"' auth.html
grep -o 'This address is already verified.' auth.html
grep -o 'name="send"' auth.html
curl -sS -c jar -b jar -D step.headers -o step.html --data-urlencode "auth_session_id=$AS" --data-urlencode cancel=1 "$T/login-actions/required-action?action=verify-email"
back | sed 's/code=[^&]*/code=CODE/;s/iss=[^&]*/iss=ISS/'
```

```
status: 200
page: Verify your email address
1
This address is already verified.
location: http://127.0.0.1:8080/callback?code=CODE&state=s&iss=ISS&action_status=cancelled
```

`accept-terms` is refused at the client's redirect address with `invalid_request`, and no page is shown:

```bash
authorize profile-app "action=accept-terms"
grep -i '^location' auth.headers | tr -d '\r' | sed 's/iss=[^&]*/iss=ISS/'
```

```
location: http://127.0.0.1:8080/callback?error=invalid_request&error_description=action+is+not+valid&state=s&iss=ISS
```

`update-profile` shows the form with what she holds and a cancel control. Submitting it completes, and the redirect ends in
`success`; the me API's `GET /me/profile` is where the application reads the result:

```bash
authorize profile-app "action=update-profile"
echo "page: $(grep -o '<h1>[^<]*' auth.html | sed 's/<h1>//')"
grep -c 'name="cancel"' auth.html
grep -o 'An application asked you to review your profile.' auth.html
grep -o '<input type="text" name="name"[^>]*>' auth.html
curl -sS -c jar -b jar -D step.headers -o step.html --data-urlencode "auth_session_id=$AS" "${FIELDS[@]}" --data-urlencode birthdate=1906-12-09 "$T/login-actions/required-action?action=update-profile"
back | sed 's/code=[^&]*/code=CODE/;s/iss=[^&]*/iss=ISS/'
```

```
page: Complete your profile
1
An application asked you to review your profile.
<input type="text" name="name" value="Grace Hopper" autocomplete="name">
location: http://127.0.0.1:8080/callback?code=CODE&state=s&iss=ISS&action_status=success
```

`lin` has no address, so an application cannot ask her to verify one. The page says it cannot be done and offers the way back, with
`action_status=error`:

```bash
rm -f jar
authorize profile-app "action=verify-email"
step authenticate --data-urlencode username=lin --data-urlencode password=correct-horse-battery
shown
grep -o 'href="[^"]*action_status=error[^"]*"' step.html | sed 's/iss=[^&"]*/iss=ISS/;s/\&amp;/\&/g'
```

```
status: 400
page: Can&#39;t continue
cancel control: no
href="http://127.0.0.1:8080/callback?error=access_denied&error_description=The+user+did+not+allow+the+request.&state=s&iss=ISS&action_status=error"
```
