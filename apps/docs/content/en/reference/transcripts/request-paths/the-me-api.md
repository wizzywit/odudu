---
title: 'The me API'
description: 'A person’s own account read with their own token: the sign-in that gets one, the four reads, paging, and what the door refuses.'
---

# The me API

A tenant serves a small API that answers for one person only: the person whose token it is given. It is at
`/tenants/<name>/me` at the path address and at `/me` at a tenant's own domain, and it has four reads, `profile`,
`credentials`, `sessions` and `consents`. Its audience is the tenant's issuer followed by `/me`, and the scope that opens
it is `me:read`. No path or query names a subject: the token's own is the only one a request can act for, so the person
who calls it cannot ask for somebody else. Nothing secret crosses it. [Protocol in plain words](../../protocol.md#the-me-api)
says what the API is for.

This page is the reads. The writes, and the recent sign-in they need, are on [The me API: changes](./the-me-api-changes.md).

Every command was run, in this order, on a stack built for it and started from an empty volume (port `3000`, the throttles
at `10000`, the schedules off), driven only as far as this page goes: the tenant `me-doc`, its user `grace`, a public client
`me-app` that may ask for `me:read` at the tenant's me URL, and then the sign-ins and reads below. `$ADMIN` is a system
administrator's token, got as in [Getting the token](../admin-paths/getting-the-token.md). A token lives five minutes, so the
reads ran within them, one after another; the request ids, ids and times are that run's. The stack does not end TLS, so an
address is `http`.

## A client, a person and a token

The sign-in is the one every client does, with the me URL as the `resource` (RFC 8707) so the token is for that API. The
helper below is the sign-in of [the MCP write tools](./the-mcp-write-tools.md) with this tenant and person in it.

```bash
odudu() { docker compose -p odudu-p4f-i14 -f infra/docker/compose.yaml exec -T odudu node dist/main.js "$@"; }
BASE=http://localhost:3000
ME=$BASE/tenants/me-doc/me
REDIR=http://127.0.0.1:8080/callback
signin_code() { # client_id scope resource
  local cid=$1 scope=$2 resource=${3:-}
  VERIFIER=$(openssl rand -hex 32)
  CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 | openssl base64 | tr '+/' '-_' | tr -d '=')
  [ -z "${JAR:-}" ] && rm -f jar
  local extra=()
  [ -n "$resource" ] && extra=(--data-urlencode "resource=$resource")
  [ -n "${PROMPT:-}" ] && extra+=(--data-urlencode prompt=login)
  curl -sS -c ${JAR:-jar} -b ${JAR:-jar} -o authorize.html --get --data-urlencode response_type=code --data-urlencode "client_id=$cid" \
    --data-urlencode redirect_uri=$REDIR --data-urlencode "scope=$scope" "${extra[@]}" --data-urlencode state=s \
    --data-urlencode "code_challenge=$CHALLENGE" --data-urlencode code_challenge_method=S256 \
    $BASE/tenants/me-doc/protocol/openid-connect/auth
  local as
  as=$(grep -o 'name="auth_session_id" value="[^"]*"' authorize.html | head -1 | sed 's/.*value="//;s/"//')
  curl -sS -c ${JAR:-jar} -b ${JAR:-jar} -D login.headers -o login.html --data-urlencode "auth_session_id=$as" \
    --data-urlencode username=grace --data-urlencode password=correct-horse-battery \
    $BASE/tenants/me-doc/login-actions/authenticate
  if grep -q 'login-actions/consent' login.html; then
    [ -n "${SHOW:-}" ] && sed -n '/<header/,/<\/form>/p' login.html
    as=$(grep -o 'name="auth_session_id" value="[^"]*"' login.html | head -1 | sed 's/.*value="//;s/"//')
    local scopes=()
    for s in $scope; do [ "$s" != openid ] && scopes+=(--data-urlencode "scope=$s"); done
    curl -sS -c ${JAR:-jar} -b ${JAR:-jar} -D login.headers -o /dev/null --data-urlencode "auth_session_id=$as" "${scopes[@]}" \
      --data-urlencode decision=allow $BASE/tenants/me-doc/login-actions/consent
  fi
  CODE=$(grep -i '^location:' login.headers | sed 's/.*code=//;s/&.*//' | tr -d '\r')
}
token_for() { # client_id resource
  curl -sS --data-urlencode grant_type=authorization_code --data-urlencode "code=$CODE" --data-urlencode redirect_uri=$REDIR \
    --data-urlencode client_id=$1 --data-urlencode "code_verifier=$VERIFIER" --data-urlencode "resource=$2" \
    $BASE/tenants/me-doc/protocol/openid-connect/token
}
```

The client is registered for the me URL as an audience, marked as needing consent, and assigned `me:read` and `me:write`
as optional scopes, so a request names the ones it wants and the person approves them:

```bash
odudu seed --tenant me-doc --client demo-spa --redirect-uri http://localhost:8080/callback \
  --user grace --password correct-horse-battery --email grace@example.com
curl -sS -X POST -H "Authorization: Bearer $ADMIN" -H 'content-type: application/json' \
  -d '{"client_id":"me-app","name":"Account page","redirect_uris":["'$REDIR'"],"token_endpoint_auth_method":"none","grant_types":["authorization_code"],"audiences":["'$ME'"],"consent_required":true}' \
  $BASE/admin/tenants/me-doc/clients | jq -c '{client_id,name,type,audiences,consent_required}'
for s in me:read me:write; do odudu seed assign-scope --tenant me-doc --client-id me-app --scope $s --assignment optional; done
```

```
{"created":true,"tenant":"me-doc","tenantId":"01a1e3ed-c88d-735c-adab-80785f1240a7","clientId":"demo-spa","userSubjectId":"01a1e3ed-c96c-7e82-9aa6-3be00dac6ee5"}
{"client_id":"me-app","name":"Account page","type":"public","audiences":["http://localhost:3000/tenants/me-doc/me"],"consent_required":true}
{"command":"assign-scope","tenant":"me-doc","tenantId":"01a1e3ed-c88d-735c-adab-80785f1240a7","clientId":"me-app","scope":"me:read","assignment":"optional"}
{"command":"assign-scope","tenant":"me-doc","tenantId":"01a1e3ed-c88d-735c-adab-80785f1240a7","clientId":"me-app","scope":"me:write","assignment":"optional"}
```

## The sign-in and the consent

The first sign-in shows the consent page, with `me:read` as a box the person ticks (`openid` is already implied). The sign-in
itself ends in a code that this page does not redeem, which leaves a live session:

```bash
SHOW=1 signin_code me-app "openid me:read" "$ME"
SHOW=
```

```
<header class="intro">
<h1><bdi>Account page</bdi> is asking for access</h1>
<p class="tenant"><bdi>me-doc</bdi></p>
</header>
<form method="post" action="/tenants/me-doc/login-actions/consent">
  <input type="hidden" name="auth_session_id" value="01a1e3ed-273c-7b01-8cb0-2ac137199e72">
  <ul>
  <li><bdi>openid</bdi></li>
  </ul>
  <label><input type="checkbox" name="scope" value="me:read"> <bdi>me:read</bdi></label>
  <button type="submit" name="decision" value="allow">Allow</button>
  <button type="submit" name="decision" value="deny" class="secondary">Deny</button>
</form>
```

The second sign-in is on a new session and does not show the page again, since `grace` approved `me:read` the first time. Its
code is redeemed for the token the reads below use. The token is for the me URL and the issuer (the issuer is an audience of
every access token, for UserInfo), carries `me:read`, and lives five minutes:

```bash
signin_code me-app "openid me:read" "$ME"
token_for me-app "$ME" > me.json
TOKEN=$(jq -r .access_token me.json)
jq -c 'del(.access_token,.id_token)' me.json
echo "$TOKEN" | cut -d. -f2 | python3 -c "import sys,base64;s=sys.stdin.read().strip();print(base64.urlsafe_b64decode(s+'='*(-len(s)%4)).decode())" | jq -c '{aud,scope,client_id,lifetime:(.exp-.iat)}'
```

```
{"token_type":"Bearer","expires_in":300,"scope":"openid me:read"}
{"aud":["http://localhost:3000/tenants/me-doc/me","http://localhost:3000/tenants/me-doc"],"scope":"openid me:read","client_id":"me-app","lifetime":300}
```

## The four reads

Every answer carries `Cache-Control: no-store`. The profile is the OpenID Connect profile claims the person has, with
`sub` and `username` beside them, and `null` for a claim nobody set:

```bash
curl -sS -D - -H "Authorization: Bearer $TOKEN" $ME/profile
```

```
HTTP/1.1 200 OK
x-request-id: 01a1e3ed-28b3-7471-bcf6-386e3385e0c9
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 551
Date: Mon, 16 Nov 2026 10:35:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"sub":"01a1e3ed-229b-7782-b88f-cdc3925c7767","username":"grace","email":"grace@example.com","email_verified":false,"name":null,"given_name":null,"family_name":null,"middle_name":null,"nickname":null,"preferred_username":null,"profile":null,"picture":null,"website":null,"gender":null,"birthdate":null,"zoneinfo":null,"locale":null,"phone_number":null,"phone_number_verified":false,"address_formatted":null,"address_street":null,"address_locality":null,"address_region":null,"address_postal_code":null,"address_country":null,"profile_updated_at":null}
```

The credentials are the ways to sign in the person has, by type and label, with when each was made and last used, and the
number of recovery codes left unspent, and `recovery_codes_low`, which says whether that number has run below the tenant's
threshold. `grace` has a password and nothing else, so it is `false`. No hash, key, seed or code is in it:

```bash
curl -sS -D - -H "Authorization: Bearer $TOKEN" $ME/credentials
```

```
HTTP/1.1 200 OK
x-request-id: 01a1e3ed-28c7-7f65-bdaa-6abf9561d473
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 218
Date: Mon, 16 Nov 2026 10:35:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a1e3ed-22e6-78aa-8136-21b43bfa2978","type":"password","label":null,"created_at":"2026-11-16T10:35:31.093Z","last_used_at":null}],"next_cursor":null,"recovery_codes_left":0,"recovery_codes_low":false}
```

`recovery_codes_low` is `true` for a person who holds a recovery set with fewer unspent codes than the tenant's
`recovery_code_warn_below` setting, 3 by default and `0` to `10`, and `false` for a person who holds no set, whatever the
threshold. The sign-in never asks for a step on its account: an application reads the flag and shows its own warning. This
page does not run the ceremony that makes a set, so two rows written with `psql` stand in for a set with two codes left. The threshold is then moved with the admin API, to 2, to 0, which turns the warning off, and back to 3, and the
rows are deleted again, which leaves `grace` as before:

```bash
psql() { docker compose -p odudu-p4f-i14 -f infra/docker/compose.yaml exec -T postgres psql -U odudu -d odudu "$@"; }
GRACE="(select u.subject_id from users u join tenants t on t.id = u.tenant_id where t.name = 'me-doc' and u.username = 'grace')"
psql -c "insert into user_credentials (id, tenant_id, subject_id, type, secret_data) select gen_random_uuid(), s.tenant_id, s.id, 'recovery-code', '{\"kind\":\"recovery-code\",\"hash\":\"stand-in\"}'::jsonb from subjects s, generate_series(1, 2) where s.id = $GRACE"
creds() { curl -sS -H "Authorization: Bearer $TOKEN" $ME/credentials | jq -c '{recovery_codes_left, recovery_codes_low}'; }
set_below() { curl -sS -X PATCH -H "Authorization: Bearer $ADMIN" -H 'content-type: application/json' -d "{\"recovery_code_warn_below\": $1}" $BASE/admin/tenants/me-doc/settings | jq -c '{recovery_code_warn_below}'; }
creds
set_below 2
creds
set_below 0
creds
set_below 3
psql -c "delete from user_credentials where type = 'recovery-code' and subject_id = $GRACE"
creds
```

```
INSERT 0 2
{"recovery_codes_left":2,"recovery_codes_low":true}
{"recovery_code_warn_below":2}
{"recovery_codes_left":2,"recovery_codes_low":false}
{"recovery_code_warn_below":0}
{"recovery_codes_left":2,"recovery_codes_low":false}
{"recovery_code_warn_below":3}
DELETE 2
{"recovery_codes_left":0,"recovery_codes_low":false}
```

The sessions are the person's live ones. The one the token was issued for is marked `current`; the other is the sign-in
whose code the page did not redeem. `device` is `null` here because this block was captured before sessions recorded the
device they were opened on; [A session's device](#a-sessions-device) below is a run on a build that does:

```bash
curl -sS -D - -H "Authorization: Bearer $TOKEN" $ME/sessions
```

```
HTTP/1.1 200 OK
x-request-id: 01a1e3ed-2a4d-7a48-a7d1-bf4882bad161
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 591
Date: Mon, 16 Nov 2026 10:35:33 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a1e3ed-27cd-7b2b-8284-b569640697c9","created_at":"2026-11-16T10:35:32.681Z","last_active_at":"2026-11-16T10:35:32.681Z","expires_at":"2026-11-16T20:35:32.685Z","remembered":false,"current":false,"device":"e16cef51687a76d69b3b37ce4ea07331948990226051e7ef3992feccd14cf3d2"},{"id":"01a1e3ed-2856-718e-9c70-33f3d4d8e4ba","created_at":"2026-11-16T10:35:32.819Z","last_active_at":"2026-11-16T10:35:32.819Z","expires_at":"2026-11-16T20:35:32.822Z","remembered":false,"current":true,"device":"c00f0c2ae6affb16f6f9010c302e5d8c184839de3d194fdb9bdb1e49d5aac233"}],"next_cursor":null}
```

The consents are the applications the person has approved, each by its `client_id`, with the scopes granted and when:

```bash
curl -sS -D - -H "Authorization: Bearer $TOKEN" $ME/consents
```

```
HTTP/1.1 200 OK
x-request-id: 01a1e3ed-2a7e-7f31-9822-550be8aad50e
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 128
Date: Mon, 16 Nov 2026 10:35:33 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"client_id":"me-app","scope_names":["openid","me:read"],"granted_at":"2026-11-16T10:35:32.675Z"}],"next_cursor":null}
```

## A session's device

A sign-in that ends in a redirect also sets a cookie, `me-doc-device`, on the browser that made it, and every later sign-in
from that browser sends it back. It is random, `HttpOnly`, same-site and good for 400 days, and it names no one: it only lets
the server say which sessions were opened on one browser. What a session row stores, and every list shows as `device`, is the
SHA-256 of the cookie's value, so a list never yields a value a browser sends. Each command below is one run of the sign-in
helper above, which keeps the cookie jar it is given (`JAR`) instead of deleting it, and asks for `prompt=login` when `PROMPT`
is set, so a second sign-in in a jar that already holds a session asks for the password instead of reusing it. The run was on a freshly
built stack (see [how the transcripts were made](../../../contributing/transcripts.md)), so its ids and times are not those of
the blocks above. Two sign-ins in `browser-a`; the second sends the cookie the first set and is given the same one back:

```bash
PROMPT=1 JAR=browser-a signin_code me-app "openid me:read" "$ME"; grep -i "^set-cookie: me-doc-device" login.headers
```

```
set-cookie: me-doc-device=cWK15GQGWukAxzPuV3M1Xg; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000
```

```bash
PROMPT=1 JAR=browser-a signin_code me-app "openid me:read" "$ME"; grep -i "^set-cookie: me-doc-device" login.headers
```

```
set-cookie: me-doc-device=cWK15GQGWukAxzPuV3M1Xg; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000
```

A third sign-in, in a jar of its own, is another browser and is given another cookie:

```bash
PROMPT=1 JAR=browser-b signin_code me-app "openid me:read" "$ME"; grep -i "^set-cookie: me-doc-device" login.headers
```

```
set-cookie: me-doc-device=i-hzfgKVQoPQBgF1UMxulw; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000
```

The sessions read, in full, then reduced to what matters. Two of the four sessions share a `device`, the one for the other browser
and the one the token came from do not, and the token's own is `current`:

```bash
curl -sS -D - -H "Authorization: Bearer $TOKEN" $ME/sessions
```

```
HTTP/1.1 200 OK
x-request-id: 01a1e3ed-d0d6-778a-8b55-71b5de1ab2ce
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 1153
Date: Mon, 16 Nov 2026 10:36:15 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a1e3ed-cefb-7be4-b746-4be0957d90df","created_at":"2026-11-16T10:36:15.477Z","last_active_at":"2026-11-16T10:36:15.477Z","expires_at":"2026-11-16T20:36:15.483Z","remembered":false,"current":true,"device":"ee12a66861b89a25f52ed21f9d13e48124586a2115eea67819ea012ca89d3f26"},{"id":"01a1e3ed-cfdb-74d1-b38e-2d0ed611082d","created_at":"2026-11-16T10:36:15.704Z","last_active_at":"2026-11-16T10:36:15.704Z","expires_at":"2026-11-16T20:36:15.707Z","remembered":false,"current":false,"device":"0b4f1b98c57ab049faa1518e68b478bd55ac63239b772d63cd9725af27d87ff0"},{"id":"01a1e3ed-d050-7b73-93f9-35fa53ea0d7c","created_at":"2026-11-16T10:36:15.820Z","last_active_at":"2026-11-16T10:36:15.820Z","expires_at":"2026-11-16T20:36:15.824Z","remembered":false,"current":false,"device":"0b4f1b98c57ab049faa1518e68b478bd55ac63239b772d63cd9725af27d87ff0"},{"id":"01a1e3ed-d0c1-775a-861e-5d4581f07d93","created_at":"2026-11-16T10:36:15.935Z","last_active_at":"2026-11-16T10:36:15.935Z","expires_at":"2026-11-16T20:36:15.937Z","remembered":false,"current":false,"device":"91ea92015b2e52ae1bfaea0ca4ce4cbe0fcf3d7bf68c2d1f7cfa65417a572d5a"}],"next_cursor":null}
```

```bash
curl -sS -H "Authorization: Bearer $TOKEN" $ME/sessions | jq -c ".items[] | {current, device}"
```

```
{"current":true,"device":"ee12a66861b89a25f52ed21f9d13e48124586a2115eea67819ea012ca89d3f26"}
{"current":false,"device":"0b4f1b98c57ab049faa1518e68b478bd55ac63239b772d63cd9725af27d87ff0"}
{"current":false,"device":"0b4f1b98c57ab049faa1518e68b478bd55ac63239b772d63cd9725af27d87ff0"}
{"current":false,"device":"91ea92015b2e52ae1bfaea0ca4ce4cbe0fcf3d7bf68c2d1f7cfa65417a572d5a"}
```

The `device` of `browser-a` is the SHA-256 of the value its jar holds, not the value:

```bash
printf "%s" "$(awk '$6 == "me-doc-device" {print $7}' browser-a | head -1)" | openssl dgst -sha256 -r | cut -d" " -f1
```

```
0b4f1b98c57ab049faa1518e68b478bd55ac63239b772d63cd9725af27d87ff0
```

The admin API's lists of sessions carry the same field, so an operator reads the same grouping, for one subject and for the
whole tenant:

```bash
GRACE_ID=$(docker compose -p odudu-p4f-i14 -f infra/docker/compose.yaml exec -T postgres psql -U odudu -d odudu -At -c "select u.subject_id from users u join tenants t on t.id = u.tenant_id where t.name = 'me-doc' and u.username = 'grace'")
curl -sS -H "Authorization: Bearer $ADMIN" $BASE/admin/tenants/me-doc/subjects/$GRACE_ID/sessions | jq -c ".items[] | {device}"
```

```
{"device":"ee12a66861b89a25f52ed21f9d13e48124586a2115eea67819ea012ca89d3f26"}
{"device":"0b4f1b98c57ab049faa1518e68b478bd55ac63239b772d63cd9725af27d87ff0"}
{"device":"0b4f1b98c57ab049faa1518e68b478bd55ac63239b772d63cd9725af27d87ff0"}
{"device":"91ea92015b2e52ae1bfaea0ca4ce4cbe0fcf3d7bf68c2d1f7cfa65417a572d5a"}
```

```bash
curl -sS -H "Authorization: Bearer $ADMIN" $BASE/admin/tenants/me-doc/sessions | jq -c ".items[] | {username, device}"
```

```
{"username":"grace","device":"ee12a66861b89a25f52ed21f9d13e48124586a2115eea67819ea012ca89d3f26"}
{"username":"grace","device":"0b4f1b98c57ab049faa1518e68b478bd55ac63239b772d63cd9725af27d87ff0"}
{"username":"grace","device":"0b4f1b98c57ab049faa1518e68b478bd55ac63239b772d63cd9725af27d87ff0"}
{"username":"grace","device":"91ea92015b2e52ae1bfaea0ca4ce4cbe0fcf3d7bf68c2d1f7cfa65417a572d5a"}
```

## Paging

Each of `credentials`, `sessions` and `consents` is a page of `limit` rows (50 unless asked, 200 at most) after an opaque
`cursor`, and answers `items` and `next_cursor`, which is `null` on the last page. A cursor that is made up is refused:

```bash
curl -sS -H "Authorization: Bearer $TOKEN" "$ME/sessions?limit=1" | jq -c '{items: [.items[] | {id, current}], next_cursor}'
NEXT=$(curl -sS -H "Authorization: Bearer $TOKEN" "$ME/sessions?limit=1" | jq -r .next_cursor)
curl -sS -H "Authorization: Bearer $TOKEN" "$ME/sessions?limit=1&cursor=$NEXT" | jq -c '{items: [.items[] | {id, current}], next_cursor}'
curl -sS -D - -H "Authorization: Bearer $TOKEN" "$ME/sessions?cursor=not-a-cursor"
```

```
{"items":[{"id":"01a1e3ed-27cd-7b2b-8284-b569640697c9","current":false}],"next_cursor":"WyJzZXNzaW9ucyIsIjAxYTFlM2VkLTI3Y2QtN2IyYi04Mjg0LWI1Njk2NDA2OTdjOSJd"}
{"items":[{"id":"01a1e3ed-2856-718e-9c70-33f3d4d8e4ba","current":true}],"next_cursor":null}
HTTP/1.1 400 Bad Request
x-request-id: 01a1e3ed-2ac7-74ed-b443-4d15061c7442
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 73
Date: Mon, 16 Nov 2026 10:35:33 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"error":"invalid_request","error_description":"The cursor is not valid"}
```

## What the door refuses

A request with no token is answered with a bare `Bearer` challenge. A token this tenant did not issue is
`invalid_token`; here the system administrator's token, which another tenant signed for the admin API, is one:

```bash
curl -sS -D - $ME/profile
```

```
HTTP/1.1 401 Unauthorized
x-request-id: 01a1e3ed-2ad9-7028-9e1f-d154dbbdd71b
www-authenticate: Bearer
cache-control: no-store
content-length: 0
Date: Mon, 16 Nov 2026 10:35:33 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```

A token for another API does not open this one, and a request for the me URL without a me scope never gets a token:
`/authorize` refuses it with `invalid_scope` before anything is signed. The refusal below is the second request:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN" $ME/profile
curl -sS -D - -o /dev/null --get --data-urlencode response_type=code --data-urlencode client_id=me-app \
  --data-urlencode redirect_uri=$REDIR --data-urlencode scope=openid --data-urlencode "resource=$ME" \
  --data-urlencode state=s --data-urlencode "code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM" \
  --data-urlencode code_challenge_method=S256 $BASE/tenants/me-doc/protocol/openid-connect/auth
```

```
HTTP/1.1 401 Unauthorized
x-request-id: 01a1e3ed-2ae5-707a-ba4f-0da7864a2435
www-authenticate: Bearer error="invalid_token"
cache-control: no-store
content-length: 0
Date: Mon, 16 Nov 2026 10:35:33 GMT
Connection: keep-alive
Keep-Alive: timeout=72

HTTP/1.1 302 Found
x-request-id: 01a1e3ed-2af4-715b-a720-9047462b7d5e
location: http://127.0.0.1:8080/callback?error=invalid_scope&error_description=A+requested+scope+is+not+available+to+this+client.&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fme-doc
content-length: 0
Date: Mon, 16 Nov 2026 10:35:33 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```

A refusal for a token that holds `me:write` and not `me:read`, a `403` with `insufficient_scope`, cannot be reached from a sign-in,
because a request for `me:write` carries `me:read` with it; an integration test mints one and runs it against the real door.

No request names a subject. A read refuses a query member it does not know with `400`, the profile as the lists do, and a
subject in the path matches no route. The block shows a list, the profile and the path:

```bash
SUB=$(echo "$TOKEN" | cut -d. -f2 | python3 -c "import sys,base64;s=sys.stdin.read().strip();print(base64.urlsafe_b64decode(s+'='*(-len(s)%4)).decode())" | jq -r .sub)
curl -sS -D - -H "Authorization: Bearer $TOKEN" "$ME/sessions?subject=$SUB"
echo
curl -sS -D - -H "Authorization: Bearer $TOKEN" "$ME/profile?subject=$SUB"
echo
curl -sS -D - -H "Authorization: Bearer $TOKEN" "$ME/$SUB/profile"
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a1e3ed-2b1f-7fa1-a46e-df43602e0965
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 72
Date: Mon, 16 Nov 2026 10:35:33 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"error":"invalid_request","error_description":"The query is not valid"}
HTTP/1.1 400 Bad Request
x-request-id: 01a1e3ed-2b30-7e09-8479-b9918e24830a
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 72
Date: Mon, 16 Nov 2026 10:35:33 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"error":"invalid_request","error_description":"The query is not valid"}
HTTP/1.1 404 Not Found
x-request-id: 01a1e3ed-2b41-7e9d-b7d0-5552e3dae394
content-type: application/problem+json; charset=utf-8
content-length: 151
Date: Mon, 16 Nov 2026 10:35:33 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank#not-found","title":"Not Found","status":404,"detail":"No resource at this path","instance":"01a1e3ed-2b41-7e9d-b7d0-5552e3dae394"}
```

Last, a me token is not an MCP token. The MCP endpoint answers it with its own challenge, and the reverse is held by the
integration tests of both doors:

```bash
curl -sS -D - -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' $BASE/tenants/me-doc/mcp
```

```
HTTP/1.1 401 Unauthorized
x-request-id: 01a1e3ed-2b50-7260-978a-7d43617ff39f
cache-control: no-store
www-authenticate: Bearer error="invalid_token", resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/tenants/me-doc/mcp", scope="mcp:read"
content-length: 0
Date: Mon, 16 Nov 2026 10:35:33 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```

## Nothing secret

The four answers above were each searched for a password hash, a secret, a private key and a TOTP key; none is in any of them:

```bash
for r in profile credentials sessions consents; do
  curl -sS -H "Authorization: Bearer $TOKEN" $ME/$r | grep -c -i -E 'argon|hash|secret|private|totp_key'
done
```

```
0
0
0
0
```

That search finds what it names and no more. What holds the same is an integration test that reads every key of every answer and every
stored secret of the person.

## A browser application on another origin

A client lists the origins its page runs at in `web_origins`, as it does for the token endpoint. The me routes answer a token
issued to a client with `access-control-allow-origin` for an origin that client lists, and with no allowance for any other,
and every answer to a request that names an origin says `Vary: Origin`. `me-spa` is a public client of the tenant that lists
`https://spa.example`:

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN" -H 'content-type: application/json' \
  -d '{"client_id":"me-spa","name":"Account SPA","redirect_uris":["'$REDIR'"],"token_endpoint_auth_method":"none","grant_types":["authorization_code"],"audiences":["'$ME'"],"web_origins":["https://spa.example"]}' \
  $BASE/admin/tenants/me-doc/clients | jq -c '{client_id,type,web_origins}'
for s in me:read me:write; do odudu seed assign-scope --tenant me-doc --client-id me-spa --scope $s --assignment optional >/dev/null; done
signin_code me-spa "openid me:read" "$ME"
SPA=$(token_for me-spa "$ME" | jq -r .access_token)
for o in https://spa.example https://other.example; do
  echo "Origin: $o"
  curl -sS -D - -o /dev/null -H "Authorization: Bearer $SPA" -H "Origin: $o" $ME/profile | grep -iE '^(HTTP|access-control|vary)'
done
```

```
{"client_id":"me-spa","type":"public","web_origins":["https://spa.example"]}
Origin: https://spa.example
HTTP/1.1 200 OK
vary: Origin
access-control-allow-origin: https://spa.example
access-control-expose-headers: WWW-Authenticate, Retry-After
Origin: https://other.example
HTTP/1.1 200 OK
vary: Origin
```

A script cannot read a header that is not exposed, and the step-up challenge and the wait of a `429` are headers, so
every answer to an allowed origin names `WWW-Authenticate` and `Retry-After` in `access-control-expose-headers`. A refusal that
comes before the token is read has no client to ask, so the origin is judged as the preflight judges it: allowed when some enabled
client of the tenant lists it. A request with no usable token:

```bash
for o in https://spa.example https://other.example; do
  echo "Origin: $o"
  curl -sS -D - -o /dev/null -H "Authorization: Bearer nonsense" -H "Origin: $o" $ME/profile | grep -iE '^(HTTP|www-authenticate|access-control|vary)'
done
```

```
Origin: https://spa.example
HTTP/1.1 401 Unauthorized
access-control-allow-origin: https://spa.example
vary: Origin
access-control-expose-headers: WWW-Authenticate, Retry-After
www-authenticate: Bearer error="invalid_token"
Origin: https://other.example
HTTP/1.1 401 Unauthorized
vary: Origin
www-authenticate: Bearer error="invalid_token"
```

The preflight carries no token, so it is answered for an origin that any enabled client of the tenant lists, with the methods
the routes take and the headers a call sends:

```bash
for o in https://spa.example https://other.example; do
  echo "Origin: $o"
  curl -sS -D - -o /dev/null -X OPTIONS -H "Origin: $o" -H 'Access-Control-Request-Method: PATCH' $ME/profile | grep -iE '^(HTTP|access-control|vary)'
done
```

```
Origin: https://spa.example
HTTP/1.1 204 No Content
vary: Origin
access-control-allow-origin: https://spa.example
access-control-allow-methods: GET, POST, PATCH, DELETE, OPTIONS
access-control-allow-headers: authorization, content-type
access-control-max-age: 600
Origin: https://other.example
HTTP/1.1 204 No Content
vary: Origin
```

Every request to these routes, a preflight included, spends a budget of 600 a minute for the address it comes from, before the token
is read. Past it the answer is `429` with the seconds to wait. The block waits out the minute so that its count is its own; the limiter's window moves in steps, so the split falls a few requests short of 600. The last request names an origin, and its `429` carries the allowance and the exposed headers, since a script that cannot read the wait cannot back off (that allowance is itself limited, to 60 a minute from one address):

```bash
sleep 61
for i in $(seq 1 602); do curl -s -o /dev/null -w '%{http_code}\n' $ME/profile; done | sort | uniq -c
curl -sS -D - -o /dev/null -H 'Origin: https://spa.example' $ME/profile | grep -iE '^(HTTP|retry-after|access-control|vary)'
```

```
 595 401
   7 429
HTTP/1.1 429 Too Many Requests
access-control-allow-origin: https://spa.example
vary: Origin
access-control-expose-headers: WWW-Authenticate, Retry-After
retry-after: 9
```

## The description of the API

An OpenAPI 3.1 description of these routes is served at `/me/openapi.json`, with no token and no tenant in the path, since it describes the API rather than reaching into a tenant. It is generated from the same route table the API registers from, and `@odudu-io/me-client` is generated from it. Like `/admin/openapi.json`, it is readable from any origin. This section needs only a running server, so it depends on nothing the page did before it.

```bash
curl -sS -D - -o me-openapi.json http://localhost:3000/me/openapi.json
jq '.paths | length' me-openapi.json
wc -c < me-openapi.json | tr -d ' '
```

```
HTTP/1.1 200 OK
x-request-id: 01a1fc76-d932-7669-9c1b-6cd5f05e4180
access-control-allow-origin: *
content-type: application/json; charset=utf-8
content-length: 29734
Date: Sat, 21 Nov 2026 04:56:49 GMT
Connection: keep-alive
Keep-Alive: timeout=72

7
29734
```

Seven paths: the four reads, and the routes of one credential, one session and one consent. `/me/openapi.json` is not among them: the document does not describe itself. Its first bytes, and the scheme it declares:

```bash
head -c 150 me-openapi.json; echo
jq -c '.components.securitySchemes' me-openapi.json
jq -r '.paths | keys[]' me-openapi.json
```

```
{"openapi":"3.1.0","info":{"title":"Odudu me API","version":"0.0.0"},"security":[{"bearerAuth":[]}],"paths":{"/tenants/{tenant}/me/profile":{"get":{"s
{"bearerAuth":{"type":"http","scheme":"bearer","bearerFormat":"JWT","description":"An access token whose \"aud\" claim is the tenant’s `/me` URL, with the scope the operation names. A token minted for another audience is refused with 401."}}
/tenants/{tenant}/me/consents
/tenants/{tenant}/me/consents/{client_id}
/tenants/{tenant}/me/credentials
/tenants/{tenant}/me/credentials/{id}
/tenants/{tenant}/me/profile
/tenants/{tenant}/me/sessions
/tenants/{tenant}/me/sessions/{id}
```

The paths name the tenant as a parameter, so one document serves every tenant; at a tenant's own domain the same routes are at `/me/...`, as above.

What this page does not show: the API at a tenant's own domain (the path is `/me/profile` there, and a token for the path
address names the path address's me URL), and the end of a session or a grant, which a token already issued outlives until it
expires on a read. What a person changes through the API is on [The me API: changes](./the-me-api-changes.md).
