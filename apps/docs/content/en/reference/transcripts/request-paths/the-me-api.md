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
odudu() { docker compose -p odudu-p4f-i25 -f infra/docker/compose.yaml exec -T odudu node dist/main.js "$@"; }
BASE=http://localhost:3000
ME=$BASE/tenants/me-doc/me
REDIR=http://127.0.0.1:8080/callback
signin_code() { # client_id scope resource
  local cid=$1 scope=$2 resource=${3:-}
  VERIFIER=$(openssl rand -hex 32)
  CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 | openssl base64 | tr '+/' '-_' | tr -d '=')
  rm -f jar
  local extra=()
  [ -n "$resource" ] && extra=(--data-urlencode "resource=$resource")
  curl -sS -c jar -b jar -o authorize.html --get --data-urlencode response_type=code --data-urlencode "client_id=$cid" \
    --data-urlencode redirect_uri=$REDIR --data-urlencode "scope=$scope" "${extra[@]}" --data-urlencode state=s \
    --data-urlencode "code_challenge=$CHALLENGE" --data-urlencode code_challenge_method=S256 \
    $BASE/tenants/me-doc/protocol/openid-connect/auth
  local as
  as=$(grep -o 'name="auth_session_id" value="[^"]*"' authorize.html | head -1 | sed 's/.*value="//;s/"//')
  curl -sS -c jar -b jar -D login.headers -o login.html --data-urlencode "auth_session_id=$as" \
    --data-urlencode username=grace --data-urlencode password=correct-horse-battery \
    $BASE/tenants/me-doc/login-actions/authenticate
  if grep -q 'login-actions/consent' login.html; then
    [ -n "${SHOW:-}" ] && sed -n '/<header/,/<\/form>/p' login.html
    as=$(grep -o 'name="auth_session_id" value="[^"]*"' login.html | head -1 | sed 's/.*value="//;s/"//')
    local scopes=()
    for s in $scope; do [ "$s" != openid ] && scopes+=(--data-urlencode "scope=$s"); done
    curl -sS -c jar -b jar -D login.headers -o /dev/null --data-urlencode "auth_session_id=$as" "${scopes[@]}" \
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
{"created":true,"tenant":"me-doc","tenantId":"01a1cbbd-f40b-7b71-a4bb-436d1e542fcc","clientId":"demo-spa","userSubjectId":"01a1cbbd-f4bd-76a0-a67d-61e9db000d38"}
{"client_id":"me-app","name":"Account page","type":"public","audiences":["http://localhost:3000/tenants/me-doc/me"],"consent_required":true}
{"command":"assign-scope","tenant":"me-doc","tenantId":"01a1cbbd-f40b-7b71-a4bb-436d1e542fcc","clientId":"me-app","scope":"me:read","assignment":"optional"}
{"command":"assign-scope","tenant":"me-doc","tenantId":"01a1cbbd-f40b-7b71-a4bb-436d1e542fcc","clientId":"me-app","scope":"me:write","assignment":"optional"}
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
  <input type="hidden" name="auth_session_id" value="01a1cbbd-f832-7be7-8cd5-a8cbd7a2d6bb">
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
x-request-id: 01a1cbbd-f968-7e7f-979c-79a51d6a1c56
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 551
Date: Wed, 11 Nov 2026 17:53:07 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"sub":"01a1cbbd-f4bd-76a0-a67d-61e9db000d38","username":"grace","email":"grace@example.com","email_verified":false,"name":null,"given_name":null,"family_name":null,"middle_name":null,"nickname":null,"preferred_username":null,"profile":null,"picture":null,"website":null,"gender":null,"birthdate":null,"zoneinfo":null,"locale":null,"phone_number":null,"phone_number_verified":false,"address_formatted":null,"address_street":null,"address_locality":null,"address_region":null,"address_postal_code":null,"address_country":null,"profile_updated_at":null}
```

The credentials are the ways to sign in the person has, by type and label, with when each was made and last used, and the
number of recovery codes left unspent, and `recovery_codes_low`, which says whether that number has run below the tenant's
threshold. `grace` has a password and nothing else, so it is `false`. No hash, key, seed or code is in it:

```bash
curl -sS -D - -H "Authorization: Bearer $TOKEN" $ME/credentials
```

```
HTTP/1.1 200 OK
x-request-id: 01a1cf4e-c49b-7d5c-9338-0e74bfcb57df
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 218
Date: Thu, 12 Nov 2026 10:30:08 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a1cf4e-0e3c-76e4-8da8-b8dc2e009109","type":"password","label":null,"created_at":"2026-11-12T10:29:21.399Z","last_used_at":null}],"next_cursor":null,"recovery_codes_left":0,"recovery_codes_low":false}
```

`recovery_codes_low` is `true` for a person who holds a recovery set with fewer unspent codes than the tenant's
`recovery_code_warn_below` setting, 3 by default and `0` to `10`, and `false` for a person who holds no set, whatever the
threshold. The sign-in never asks for a step on its account: an application reads the flag and shows its own warning. This
page does not run the ceremony that makes a set, so two rows written with `psql` stand in for a set with two codes left. The threshold is then moved with the admin API, to 2, to 0, which turns the warning off, and back to 3, and the
rows are deleted again, which leaves `grace` as before:

```bash
psql() { docker compose -p odudu-p4f-i52 -f infra/docker/compose.yaml exec -T postgres psql -U odudu -d odudu "$@"; }
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
whose code the page did not redeem. `device` is `null` because nothing records one yet:

```bash
curl -sS -D - -H "Authorization: Bearer $TOKEN" $ME/sessions
```

```
HTTP/1.1 200 OK
x-request-id: 01a1cbbd-f987-775d-b370-35b516b151b7
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 467
Date: Wed, 11 Nov 2026 17:53:07 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a1cbbd-f897-7862-84f1-9f9fd67fe794","created_at":"2026-11-11T17:53:07.221Z","last_active_at":"2026-11-11T17:53:07.221Z","expires_at":"2026-11-12T03:53:07.223Z","remembered":false,"current":false,"device":null},{"id":"01a1cbbd-f907-7e27-a736-43fd4af03546","created_at":"2026-11-11T17:53:07.333Z","last_active_at":"2026-11-11T17:53:07.333Z","expires_at":"2026-11-12T03:53:07.335Z","remembered":false,"current":true,"device":null}],"next_cursor":null}
```

The consents are the applications the person has approved, each by its `client_id`, with the scopes granted and when:

```bash
curl -sS -D - -H "Authorization: Bearer $TOKEN" $ME/consents
```

```
HTTP/1.1 200 OK
x-request-id: 01a1cbbd-f995-7e01-b42a-30234faaa2dd
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 128
Date: Wed, 11 Nov 2026 17:53:07 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"client_id":"me-app","scope_names":["openid","me:read"],"granted_at":"2026-11-11T17:53:07.217Z"}],"next_cursor":null}
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
{"items":[{"id":"01a1cbbd-f897-7862-84f1-9f9fd67fe794","current":false}],"next_cursor":"WyJzZXNzaW9ucyIsIjAxYTFjYmJkLWY4OTctNzg2Mi04NGYxLTlmOWZkNjdmZTc5NCJd"}
{"items":[{"id":"01a1cbbd-f907-7e27-a736-43fd4af03546","current":true}],"next_cursor":null}
HTTP/1.1 400 Bad Request
x-request-id: 01a1cbbd-f9cf-7c6e-a251-14389fcf4971
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 73
Date: Wed, 11 Nov 2026 17:53:07 GMT
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
x-request-id: 01a1cbbd-f9dc-7fa4-95fb-0ba6adc9cd12
www-authenticate: Bearer
cache-control: no-store
content-length: 0
Date: Wed, 11 Nov 2026 17:53:07 GMT
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
x-request-id: 01a1cbbd-f9e6-74f1-9e5e-1a47e3eaa80a
www-authenticate: Bearer error="invalid_token"
cache-control: no-store
content-length: 0
Date: Wed, 11 Nov 2026 17:53:07 GMT
Connection: keep-alive
Keep-Alive: timeout=72

HTTP/1.1 302 Found
x-request-id: 01a1cbbd-f9f1-75a8-8f80-073c9f33d467
location: http://127.0.0.1:8080/callback?error=invalid_scope&error_description=A+requested+scope+is+not+available+to+this+client.&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fme-doc
content-length: 0
Date: Wed, 11 Nov 2026 17:53:07 GMT
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
x-request-id: 01a1cbbd-fa14-77a2-ac3b-c5a66952fe77
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 72
Date: Wed, 11 Nov 2026 17:53:07 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"error":"invalid_request","error_description":"The query is not valid"}
HTTP/1.1 400 Bad Request
x-request-id: 01a1cbbd-fa21-755c-9c6b-853b3087fa7a
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 72
Date: Wed, 11 Nov 2026 17:53:07 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"error":"invalid_request","error_description":"The query is not valid"}
HTTP/1.1 404 Not Found
x-request-id: 01a1cbbd-fa2e-77a2-b61b-5c43b0dac50b
content-type: application/problem+json; charset=utf-8
content-length: 151
Date: Wed, 11 Nov 2026 17:53:07 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank#not-found","title":"Not Found","status":404,"detail":"No resource at this path","instance":"01a1cbbd-fa2e-77a2-b61b-5c43b0dac50b"}
```

Last, a me token is not an MCP token. The MCP endpoint answers it with its own challenge, and the reverse is held by the
integration tests of both doors:

```bash
curl -sS -D - -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' $BASE/tenants/me-doc/mcp
```

```
HTTP/1.1 401 Unauthorized
x-request-id: 01a1cbbd-fa3a-7e8c-ab61-9e1ac0f61015
cache-control: no-store
www-authenticate: Bearer error="invalid_token", resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/tenants/me-doc/mcp", scope="mcp:read"
content-length: 0
Date: Wed, 11 Nov 2026 17:53:07 GMT
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

What this page does not show: the API at a tenant's own domain (the path is `/me/profile` there, and a token for the path
address names the path address's me URL), a rate limit and CORS on these routes, which they do not have yet, and the end of a
session or a grant, which a token already issued outlives until it expires on a read. What a person changes through the API is on
[The me API: changes](./the-me-api-changes.md).
