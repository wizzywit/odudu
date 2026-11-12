---
title: Sending a person to change a credential
description: An application sends a signed-in person to change a credential with the action parameter, then reads the outcome from the me API.
---

# Sending a person to change a credential

An application that the tenant allows may send a person to Odudu to change one credential, and take them back when it is done. The
request is the usual authorization request with one more parameter, `action`, which takes `update-password`, `configure-totp`,
`configure-passkey` or `generate-recovery-codes`. The person sees the page Odudu already uses for that change, with a way to leave
it, and the redirect that follows carries the usual `code`, `state` and `iss` and one more member, `action_status`, which is
`success`, `cancelled` or `error`. [Send a person to change a credential](../../../guides/send-a-person-to-change-a-credential.md)
is the guide; this page is the run behind it.

Two rules decide what the page can do. The client has to be allowed the action, in its `allowed_actions` setting, and has to hold
the scope `me:read`, because the outcome is read from [the me API](./the-me-api.md), not from the redirect. A client that is not
allowed, a name that is not an action, an action sent twice and an action sent empty are each refused with `invalid_request` at
the client's redirect address, and no page is shown. A sign-in older than the tenant's `session_freshness_seconds` is asked for
again before the page is shown, as the me API asks for it before a change.

Every command was run, in this order, on a compose stack built for this page (port `3000`, the throttles at `10000`, the
schedules off), in the tenant `actions-demo`, which the first block makes. The stack had served the tenants of other pages first,
and none of them takes part. `$ADMIN` is a system administrator's token, got as in [Getting the token](../admin-paths/getting-the-token.md);
a token lives five minutes, and every block that needs one ran within the minutes of its own.

## A tenant, two people and two clients

`grace` and `lin` have a password each and nothing else. `profile-app` is a public client that may start all four actions. The
flag `--allow-action` names one each time it is given, and it also assigns `me:read` to the client, which the actions need.
`plain-app` holds `me:read` too and is allowed none. The first command also makes the tenant's first client, `demo-spa`, which
nothing below uses. The helpers do the sign-in every client does, with the me URL as the `resource` so the token is for
that API:

```bash
odudu() { docker compose -p odudu-p4f-i33 -f infra/docker/compose.yaml exec -T odudu node dist/main.js "$@"; }
BASE=http://localhost:3000
T=$BASE/tenants/actions-demo
ME=$T/me
REDIR=http://127.0.0.1:8080/callback
pkce() {
  VERIFIER=$(openssl rand -hex 32)
  CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 | openssl base64 | tr '+/' '-_' | tr -d '=')
}
authorize() { # client_id, then the members to add to the request
  pkce
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
shown() { # the heading of the page that came back, and whether it offers a way to leave
  local page=${1:-step.html}
  echo "page: $(grep -o '<h1>[^<]*' $page | sed 's/<h1>//')"
  if grep -q 'name="cancel"' $page; then echo "cancel control: yes"; else echo "cancel control: no"; fi
}
back() { grep -i '^location:' step.headers | tr -d '\r'; }
token() { # the access token for the code the last redirect carried
  local code; code=$(back | sed 's/.*[?&]code=//;s/&.*//')
  curl -sS --data-urlencode grant_type=authorization_code --data-urlencode "code=$code" --data-urlencode redirect_uri=$REDIR \
    --data-urlencode client_id=profile-app --data-urlencode "code_verifier=$VERIFIER" --data-urlencode "resource=$ME" \
    $T/protocol/openid-connect/token | jq -r .access_token
}
credentials() { curl -sS -H "Authorization: Bearer $1" $ME/credentials | jq -c '{types: [.items[].type], recovery_codes_left}'; }
made() { curl -sS -H "Authorization: Bearer $1" $ME/credentials | jq -r '.items[] | select(.type == "password") | .created_at'; }
totp() { node --input-type=module -e "
import { totpCode, totpCounter } from './packages/crypto/src/service/totp.ts';
console.log(totpCode('$1', totpCounter(new Date())));
"; }
odudu seed --tenant actions-demo --client demo-spa --redirect-uri $REDIR \
  --user grace --password correct-horse-battery --email grace@example.com
odudu seed user --tenant actions-demo --username lin --password correct-horse-battery --email lin@example.com
odudu seed client --tenant actions-demo --client-id plain-app --public --redirect-uri $REDIR --audience $ME
odudu seed assign-scope --tenant actions-demo --client-id plain-app --scope me:read --assignment optional
odudu seed client --tenant actions-demo --client-id profile-app --public --redirect-uri $REDIR \
  --audience $ME --allow-action update-password --allow-action configure-totp \
  --allow-action configure-passkey --allow-action generate-recovery-codes
curl -sS -H "Authorization: Bearer $ADMIN" "$BASE/admin/tenants/actions-demo/clients?client_id_exact=profile-app" \
  | jq -c '.items[0] | {client_id, type, allowed_actions, scopes: [.scopes[].name | select(startswith("me"))]}'
```

```
{"created":true,"tenant":"actions-demo","tenantId":"01a1cf2f-11bb-720e-9a25-da20113e2658","clientId":"demo-spa","userSubjectId":"01a1cf2f-128a-75e8-b244-0643911aa7ec"}
{"command":"user","tenant":"actions-demo","tenantId":"01a1cf2f-11bb-720e-9a25-da20113e2658","username":"lin","userSubjectId":"01a1cf2f-1447-77da-998e-1daa9212b05a"}
{"command":"client","created":true,"tenant":"actions-demo","tenantId":"01a1cf2f-11bb-720e-9a25-da20113e2658","clientId":"plain-app","clientDbId":"01a1cf2f-15e8-7e6f-957f-934d120705fe"}
{"command":"assign-scope","tenant":"actions-demo","tenantId":"01a1cf2f-11bb-720e-9a25-da20113e2658","clientId":"plain-app","scope":"me:read","assignment":"optional"}
{"command":"client","created":true,"tenant":"actions-demo","tenantId":"01a1cf2f-11bb-720e-9a25-da20113e2658","clientId":"profile-app","clientDbId":"01a1cf2f-1953-70aa-856c-9f518e0a61d9"}
{"client_id":"profile-app","type":"public","allowed_actions":["update-password","configure-totp","configure-passkey","generate-recovery-codes"],"scopes":["me:read"]}
```

## What is refused, at the redirect address

The request names a client and a redirect address that match, so a refusal is not an error page but a redirect with
`error=invalid_request`, `state` and `iss`, the way every other refusal of the request goes back. `plain-app` may start no action.
`profile-app` is sent a name that is not an action, the parameter twice, and the parameter empty:

```bash
rm -f jar
for query in "action=update-password" "action=delete-account" "action=configure-totp&action=update-password" "action="; do
  echo "action request: $query"
  client=profile-app; [ "$query" = "action=update-password" ] && client=plain-app
  authorize $client "$query"
  grep -i '^HTTP\|^location' auth.headers | tr -d '\r'
done
```

```
action request: action=update-password
HTTP/1.1 302 Found
location: http://127.0.0.1:8080/callback?error=invalid_request&error_description=This+client+may+not+start+that+action&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Factions-demo
action request: action=delete-account
HTTP/1.1 302 Found
location: http://127.0.0.1:8080/callback?error=invalid_request&error_description=action+is+not+valid&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Factions-demo
action request: action=configure-totp&action=update-password
HTTP/1.1 302 Found
location: http://127.0.0.1:8080/callback?error=invalid_request&error_description=A+parameter+was+sent+more+than+once&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Factions-demo
action request: action=
HTTP/1.1 302 Found
location: http://127.0.0.1:8080/callback?error=invalid_request&error_description=action+is+not+valid&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Factions-demo
```

## Changing an authenticator

`profile-app` asks for `configure-totp` for `grace`. She is not signed in, so the first page is the sign-in. After her password
comes the page of the action, the authenticator page, with a control to leave it that the page of a tenant that requires an
authenticator does not have:

```bash
rm -f jar
authorize profile-app "action=configure-totp"
grep -o '<h1>[^<]*' auth.html | sed 's/<h1>//'
step authenticate --data-urlencode username=grace --data-urlencode password=correct-horse-battery
shown
```

```
Sign in
page: Set up your authenticator
cancel control: yes
```

She scans the secret, types the code her authenticator shows, and confirms. A new authenticator owes recovery codes, so the next
page is the codes page every sign-in shows, and it has no control to leave, because the person has to be shown the codes once.
Her acknowledgement of it ends the action, and the redirect carries `action_status=success`:

```bash
SECRET=$(grep -o 'secret=[A-Z2-7]*' step.html | head -1 | sed 's/secret=//')
step "required-action?action=configure-totp" --data-urlencode "secret=$SECRET" --data-urlencode "code=$(totp $SECRET)"
shown
step "required-action?action=generate-recovery-codes"
back
```

```
page: Save your recovery codes
cancel control: no
location: http://127.0.0.1:8080/callback?code=zfR5htoE5dLbr9IiLhxU1z39ajtefQaB4osd2sEu1fM&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Factions-demo&action_status=success
```

`action_status` is a hint that travelled through the browser, and anyone can type it into an address. The outcome is in the credential
list of the me API, read with the token the code buys:

```bash
GRACE=$(token)
credentials "$GRACE"
```

```
{"types":["password","totp"],"recovery_codes_left":10}
```

## Replacing the recovery codes

A set of recovery codes can be replaced once an hour: it costs ten password hashes, and an application that could ask for one in a
loop would be asking for a cheap way to burn them. `grace` was issued a set a moment ago, so a request now is refused. The page says
how many minutes to wait, offers the way out and leaves the set alone. Leaving comes back as `cancelled`:

```bash
GRACE_ID=$(curl -sS -H "Authorization: Bearer $ADMIN" "$BASE/admin/tenants/actions-demo/subjects?username=grace" | jq -r '.items[0].id')
authorize profile-app "action=generate-recovery-codes"
echo "answered: $(head -1 auth.headers | tr -d '\r')"
grep -o 'Your recovery codes were issued recently[^<]*' auth.html
shown auth.html
step "required-action?action=generate-recovery-codes" --data-urlencode cancel=1
back
```

```
answered: HTTP/1.1 429 Too Many Requests
Your recovery codes were issued recently and still work. You can replace them in 60 minutes.
page: Save your recovery codes
cancel control: yes
location: http://127.0.0.1:8080/callback?code=kmEQWjHN8yCykJQoNC_2k_0opAfHOQrA1gZ5iJII2Q0&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Factions-demo&action_status=cancelled
```

The run does not wait an hour. It writes the recorded time of the last set an hour and a half back, which is the one thing the wait
would change (`psql` prints `t`, the time is now more than an hour back), and asks again. `grace` holds a set now, so the page asks before it replaces anything, and the set is still the old
one while the question is on the screen. Leaving it changes nothing and comes back as `cancelled`:

```bash
docker compose -p odudu-p4f-i51 -f infra/docker/compose.yaml exec -T postgres psql -U odudu -d odudu -qtc \
  "update subjects set recovery_codes_issued_at = now() - interval '90 minutes' where id = '$GRACE_ID' returning recovery_codes_issued_at < now() - interval '1 hour' as an_hour_ago"
authorize profile-app "action=generate-recovery-codes"
echo "answered: $(head -1 auth.headers | tr -d '\r')"
grep -o 'This replaces[^<]*' auth.html
step "required-action?action=generate-recovery-codes" --data-urlencode cancel=1
back
```

```
 t

answered: HTTP/1.1 200 OK
This replaces your current recovery codes. The old ones stop working as soon as you confirm.
location: http://127.0.0.1:8080/callback?code=D6IgHbs8vOO_N-E2foHf5WlYnlb2sE1CcdYtzkN0YeI&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Factions-demo&action_status=cancelled
```

Asked again, and this time confirmed, the page replaces the set and shows the new codes once. It has no control to leave, because
leaving would then say `cancelled` of a set that has changed:

```bash
authorize profile-app "action=generate-recovery-codes"
step "required-action?action=generate-recovery-codes" --data-urlencode confirm=1
shown
echo "codes shown: $(grep -c '<li>' step.html)"
step "required-action?action=generate-recovery-codes"
back
```

```
page: Save your recovery codes
cancel control: no
codes shown: 10
location: http://127.0.0.1:8080/callback?code=NRxpWX61vTtkNvrZskpjJFQ78vSX3UaKNJlVwv0VAZY&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Factions-demo&action_status=success
```

A person with an authenticator and no set is asked before a first set is made, too, and nothing is made while the question is on the
screen: reloading it, which is another request, still leaves no codes, and leaving it makes none. An administrator revokes `grace`'s
set without asking for a new one, and the application asks again:

```bash
curl -sS -o /dev/null -w 'revoked: %{http_code}\n' -X DELETE -H "Authorization: Bearer $ADMIN" \
  "$BASE/admin/tenants/actions-demo/subjects/$GRACE_ID/recovery-codes?require_new_set=false"
authorize profile-app "action=generate-recovery-codes"
echo "answered: $(head -1 auth.headers | tr -d '\r')"
grep -o 'This creates[^<]*' auth.html
shown auth.html
authorize profile-app "action=generate-recovery-codes"
step "required-action?action=generate-recovery-codes" --data-urlencode cancel=1
back
credentials "$(token)"
```

```
revoked: 204
answered: HTTP/1.1 200 OK
This creates a set of recovery codes. Each signs you in once, in place of your second factor, if you lose it.
page: Save your recovery codes
cancel control: yes
location: http://127.0.0.1:8080/callback?code=GFR21a01LHj-XlIxA1BOt8nW29j619NUpirH8KoFjV8&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Factions-demo&action_status=cancelled
{"types":["password","totp"],"recovery_codes_left":0}
```

Confirmed, the first set is made and shown, and the acknowledgement ends the action:

```bash
authorize profile-app "action=generate-recovery-codes"
step "required-action?action=generate-recovery-codes" --data-urlencode confirm=1
shown
echo "codes shown: $(grep -c '<li>' step.html)"
step "required-action?action=generate-recovery-codes"
back
credentials "$(token)"
```

```
page: Save your recovery codes
cancel control: no
codes shown: 10
location: http://127.0.0.1:8080/callback?code=eX3nxSi5c7M1W6Wzd8xz9rVMRxN8ExbU-8q_INCzcwA&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Factions-demo&action_status=success
{"types":["password","totp"],"recovery_codes_left":10}
```

## Changing the password

The password page of a requested change says an application asked, and wants the password in force before it takes a new one. `lin`
signs in for it. A wrong current password is refused on the page and counts as a failed sign-in against the tenant's lockout, so
a person who is asked for it can be locked out by guessing, as at the sign-in page; the right one changes the password and ends the
run of failures. The lockout is read through the admin API after each answer.

The credential list cannot show a password change, because it lists the password by type like any other. What it does list for
each credential is when it was made, and a new password is dated from the change, so the application reads the password's
`created_at` with a token from a sign-in before the change and with the token the redirect's code buys after it:

```bash
rm -f jar
LIN_ID=$(curl -sS -H "Authorization: Bearer $ADMIN" "$BASE/admin/tenants/actions-demo/subjects?username=lin" | jq -r '.items[0].id')
authorize profile-app ""
step authenticate --data-urlencode username=lin --data-urlencode password=correct-horse-battery
BEFORE=$(made "$(token)")
authorize profile-app "action=update-password"
shown auth.html
grep -o 'name="current_password"' auth.html
step "required-action?action=update-password" --data-urlencode current_password=wrong --data-urlencode password=another-horse-battery-2
head -1 step.headers | tr -d '\r'
grep -o 'The current password is not correct.' step.html
curl -sS -H "Authorization: Bearer $ADMIN" "$BASE/admin/tenants/actions-demo/subjects/$LIN_ID/lockout"; echo
step "required-action?action=update-password" --data-urlencode current_password=correct-horse-battery \
  --data-urlencode password=another-horse-battery-2
back
curl -sS -H "Authorization: Bearer $ADMIN" "$BASE/admin/tenants/actions-demo/subjects/$LIN_ID/lockout"; echo
AFTER=$(made "$(token)")
echo "password made: before $BEFORE, after $AFTER"
```

```
page: Change your password
cancel control: yes
name="current_password"
HTTP/1.1 400 Bad Request
The current password is not correct.
{"locked":false,"locked_until":null,"failure_count":1,"last_failure_at":"2026-11-12T09:55:36.751Z"}
location: http://127.0.0.1:8080/callback?code=IpCAl6roFrKNPmDJKAfPsF7JdN2DooBICPc9U9PamqA&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Factions-demo&action_status=success
{"locked":false,"locked_until":null,"failure_count":0,"last_failure_at":null}
password made: before 2026-11-12T09:55:31.521Z, after 2026-11-12T09:55:36.826Z
```

## A sign-in older than the window

A change of a credential needs a recent sign-in, the rule the me API's gated routes apply. The tenant's window is set to 30 seconds,
the shortest there is, so the page does not wait five minutes. `lin` has been signed in for longer than that when the next request
arrives, so it answers the sign-in page, not the page of the action. The old password is refused, the new one signs `lin` in, and
only then is the page of the action shown:

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN" -H 'content-type: application/json' \
  -d '{"session_freshness_seconds":30}' $BASE/admin/tenants/actions-demo/settings | jq -c '{session_freshness_seconds}'
sleep 35
authorize profile-app "action=update-password"
grep -o '<h1>[^<]*' auth.html | sed 's/<h1>//'
step authenticate --data-urlencode username=lin --data-urlencode password=correct-horse-battery
grep -o 'Sign-in failed. Check your details and try again.' step.html
step authenticate --data-urlencode username=lin --data-urlencode password=another-horse-battery-2
shown
```

```
{"session_freshness_seconds":30}
Sign in
Sign-in failed. Check your details and try again.
page: Change your password
cancel control: yes
```

## Leaving a page

`lin` leaves the password page, and nothing changes: the redirect says `cancelled`, and the credential list, read with the token
that redirect's code buys, is the one it was. A passkey page leaves the same way. The page of `configure-passkey` runs a browser's
ceremony before it submits, which a shell has no way to run, so the run shows the page and its way out and not an enrolment:

```bash
step "required-action?action=update-password" --data-urlencode cancel=1
back
LIN=$(token)
credentials "$LIN"
authorize profile-app "action=configure-passkey"
shown auth.html
step "required-action?action=configure-passkey" --data-urlencode cancel=1
back
```

```
location: http://127.0.0.1:8080/callback?code=QPO_mJgJ5UqVV3QMalwpGIPLzCT3ofnozyvPNmTxEpI&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Factions-demo&action_status=cancelled
{"types":["password"],"recovery_codes_left":0}
page: Add a passkey
cancel control: yes
location: http://127.0.0.1:8080/callback?code=X2d3Oc-Xw49Cwjw_uKcnyuhLbP3epRnBjF3WQ5j2ACg&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Factions-demo&action_status=cancelled
```

## An action the account cannot take

`lin` holds no authenticator, so recovery codes, which stand in for one, are not available to `lin`. The page that says so is shown
to the person, who stays at Odudu until they choose to leave: it has the link back to the application, which carries
`access_denied` and `action_status=error`. The action is recorded as `action.failed`.
The same page is shown to a person who has no password and is sent for `update-password`, which the run does not show:

```bash
authorize profile-app "action=generate-recovery-codes"
head -1 auth.headers | tr -d '\r'
grep -o '<h1>[^<]*' auth.html | sed 's/<h1>//'
grep -o 'This change is not available for your account.' auth.html
grep -o 'href="http://127[^"]*' auth.html | sed 's/href="//; s/&amp;/\&/g'
```

```
HTTP/1.1 400 Bad Request
Can&#39;t continue
This change is not available for your account.
http://127.0.0.1:8080/callback?error=access_denied&error_description=The+user+did+not+allow+the+request.&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Factions-demo&action_status=error
```

## What the tenant's audit trail holds

Each page shown is an `action.requested` row, and each ending is `action.completed`, `action.cancelled` or `action.failed`, with
the action in `detail`. A sign-in refused for a wrong password is a refused `login.password`. The rows are the tenant's whole trail, which this
page made, oldest first, with the other rows of the sign-ins left out:

```bash
curl -sS -H "Authorization: Bearer $ADMIN" "$BASE/admin/tenants/actions-demo/audit?limit=100" \
  | jq -c '.items | reverse | .[] | select(.action | startswith("action.") or . == "login.password" or startswith("recovery_codes.")) | {action, outcome, actor: .actor_name, detail}'
```

```
{"action":"login.password","outcome":"allowed","actor":"grace","detail":{"factor":"password"}}
{"action":"action.requested","outcome":"allowed","actor":"grace","detail":{"action":"configure-totp"}}
{"action":"action.completed","outcome":"allowed","actor":"grace","detail":{"action":"configure-totp"}}
{"action":"recovery_codes.issued","outcome":"allowed","actor":"grace","detail":{}}
{"action":"action.requested","outcome":"allowed","actor":"grace","detail":{"action":"generate-recovery-codes"}}
{"action":"recovery_codes.refused","outcome":"refused","actor":"grace","detail":{"reason":"rate_limited"}}
{"action":"action.cancelled","outcome":"allowed","actor":"grace","detail":{"action":"generate-recovery-codes"}}
{"action":"action.requested","outcome":"allowed","actor":"grace","detail":{"action":"generate-recovery-codes"}}
{"action":"action.cancelled","outcome":"allowed","actor":"grace","detail":{"action":"generate-recovery-codes"}}
{"action":"action.requested","outcome":"allowed","actor":"grace","detail":{"action":"generate-recovery-codes"}}
{"action":"recovery_codes.issued","outcome":"allowed","actor":"grace","detail":{}}
{"action":"action.completed","outcome":"allowed","actor":"grace","detail":{"action":"generate-recovery-codes"}}
{"action":"action.requested","outcome":"allowed","actor":"grace","detail":{"action":"generate-recovery-codes"}}
{"action":"action.requested","outcome":"allowed","actor":"grace","detail":{"action":"generate-recovery-codes"}}
{"action":"action.cancelled","outcome":"allowed","actor":"grace","detail":{"action":"generate-recovery-codes"}}
{"action":"action.requested","outcome":"allowed","actor":"grace","detail":{"action":"generate-recovery-codes"}}
{"action":"recovery_codes.issued","outcome":"allowed","actor":"grace","detail":{}}
{"action":"action.completed","outcome":"allowed","actor":"grace","detail":{"action":"generate-recovery-codes"}}
{"action":"login.password","outcome":"allowed","actor":"lin","detail":{"factor":"password"}}
{"action":"action.requested","outcome":"allowed","actor":"lin","detail":{"action":"update-password"}}
{"action":"action.completed","outcome":"allowed","actor":"lin","detail":{"action":"update-password"}}
{"action":"login.password","outcome":"refused","actor":"lin","detail":{"factor":"password","reason":"bad_credential"}}
{"action":"login.password","outcome":"allowed","actor":"lin","detail":{"factor":"password"}}
{"action":"action.requested","outcome":"allowed","actor":"lin","detail":{"action":"update-password"}}
{"action":"action.cancelled","outcome":"allowed","actor":"lin","detail":{"action":"update-password"}}
{"action":"action.requested","outcome":"allowed","actor":"lin","detail":{"action":"configure-passkey"}}
{"action":"action.cancelled","outcome":"allowed","actor":"lin","detail":{"action":"configure-passkey"}}
{"action":"action.requested","outcome":"allowed","actor":"lin","detail":{"action":"generate-recovery-codes"}}
{"action":"action.failed","outcome":"failed","actor":"lin","detail":{"action":"generate-recovery-codes"}}
```

## What is not shown

An action that was started and never ended, a tab closed on the page, writes no redirect and no `action.completed` row: nothing
reaches the client, so an application that waits for the redirect has to be able to wait forever, and reads the credential list
when the person comes back. Three more things the run does not reach: the browser ceremony that enrols a passkey, which needs an
authenticator; the unavailable page for `update-password`, which needs a person with no password, and a shell signs in with
one; and the sign-in older than the window when the person left the page by closing it, which sends no request.
