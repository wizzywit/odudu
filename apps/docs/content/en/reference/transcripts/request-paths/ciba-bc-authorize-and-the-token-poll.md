---
title: 'CIBA: bc-authorize and the token poll'
description: 'An agent asks a named person to approve, polls the token endpoint, and is answered pending, slow down, denied, expired or with tokens; the mail, the refusals and what discovery says.'
---

# CIBA: `bc-authorize` and the token poll

OpenID Connect CIBA (Client-Initiated Backchannel Authentication), in poll mode, lets a client ask a person it names to
approve something without sending the person's browser anywhere. The client posts to `bc-authorize`, is given an
`auth_req_id`, and polls the token endpoint with it until the person has answered. Odudu mails the person a link to
[the approval page](./the-approval-page.md), where they answer. Only `poll` is served: `ping` and `push`, a `user_code`
and signed requests are not, and discovery says so.

Every command on this page and the pages that follow it ([the approval page](./the-approval-page.md),
[agent delegations through the me API](./agent-delegations-through-the-me-api.md) and
[a tenant's agents and approvals](../admin-paths/get-agents-get-agentsid-delete-agentsid-and-get-agent-approvals.md))
was run in that order against one stack built for them and started from an empty volume: the quick start's compose file
with its mail catcher, `mailpit`, as the relay and the two request throttles raised to 1,000 so that the page's many sign-ins
are not slowed. The server answers at `http://localhost:3200`, so every address in an output
says port 3200 and the catcher's is `http://localhost:8225`. Request ids, ids and times are that run's. A token is cut to
its first twelve characters, marked `…`, where it would fill the page.

## The tenant, two people and an agent

The tenant `demo` has `ada`, who has no address, and `grace`, whose address `grace@example.com` is verified below.
`agent-admin` is a service that may administer the tenant, and `my-agent` is a confidential client that is an agent type
and holds the `ciba` grant; [Delegate to an agent](../../../guides/agent-delegation.md) makes them the same way.

```bash
export TENANT=http://localhost:3200/tenants/demo API=http://localhost:3200/admin/tenants/demo
token_of() { sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p'; }
docker compose exec -T odudu odudu seed tenant --name demo
docker compose exec -T odudu odudu seed user --tenant demo --username ada --password 'a long and unremarkable passphrase'
docker compose exec -T odudu odudu seed user --tenant demo --username grace --password 'a long and unremarkable passphrase' --email grace@example.com
docker compose exec -T odudu odudu seed client --tenant demo --client-id agent-admin --client-secret agent-admin-secret --grant-type client_credentials --audience urn:odudu:params:admin-api --capability manage-clients --capability manage-sessions --capability manage-tenant --capability manage-users --capability view-audit
```

```
{"command":"tenant","created":true,"tenant":"demo","tenantId":"01a2130c-1dcd-7060-bcb7-e43792df7046"}
{"command":"user","tenant":"demo","tenantId":"01a2130c-1dcd-7060-bcb7-e43792df7046","username":"ada","userSubjectId":"01a2130c-2032-7e60-9357-bbf2d28f8a8a"}
{"command":"user","tenant":"demo","tenantId":"01a2130c-1dcd-7060-bcb7-e43792df7046","username":"grace","userSubjectId":"01a2130c-21e7-7bb7-a059-cab1a9a29253"}
{"command":"client","created":true,"tenant":"demo","tenantId":"01a2130c-1dcd-7060-bcb7-e43792df7046","clientId":"agent-admin","clientDbId":"01a2130c-23c8-75b6-816b-7a30c6bc5e26","capabilities":["manage-clients","manage-sessions","manage-tenant","manage-users","view-audit"]}
```

```bash
admin_token() { curl -fsS -u agent-admin:agent-admin-secret --data-urlencode grant_type=client_credentials "$TENANT/protocol/openid-connect/token" | token_of; }
CREATED=$(curl -fsS -H "Authorization: Bearer $(admin_token)" -H 'content-type: application/json' -d '{"client_id":"my-agent","name":"My agent","redirect_uris":["http://127.0.0.1:8123/callback"],"grant_types":["authorization_code","refresh_token","urn:ietf:params:oauth:grant-type:token-exchange","urn:openid:params:grant-type:ciba"],"agent_type":true}' "$API/clients")
AGENT_SECRET=$(printf '%s' "$CREATED" | sed -n 's/.*"client_secret":"\([^"]*\)".*/\1/p')
printf '%s\n' "$CREATED" | sed -n 's/.*\("client_id":"[^"]*"\).*\("grant_types":\[[^]]*\]\).*\("agent_type":[a-z]*\).*/\1 \2 \3/p'
```

```
"client_id":"my-agent" "grant_types":["authorization_code","refresh_token","urn:ietf:params:oauth:grant-type:token-exchange","urn:openid:params:grant-type:ciba"] "agent_type":true
```

The helpers below are used on every page of this set. `bc` makes a request to `bc-authorize` and shows the whole response,
`poll` asks the token endpoint once, `decode` shows what a token says, and `signin` plays a browser signing a person in
through a client, leaving the session in a cookie jar, `$JAR`, which [the approval page](./the-approval-page.md) opens
pages with. `decide` is what a person's browser does on the approval page, `mail_link` finds the link in the latest mail, and
`approval_id` reads the newest pending approval from the admin API, which is how this set finds one without sending a mail,
since a person's address is mailed at most three approval notices an hour.

```bash
bc() { curl -sS -i -u "my-agent:$AGENT_SECRET" "$@" "$TENANT/protocol/openid-connect/bc-authorize"; }
poll() { curl -sS -u "my-agent:$AGENT_SECRET" --data-urlencode grant_type=urn:openid:params:grant-type:ciba --data-urlencode "auth_req_id=$1" "$TENANT/protocol/openid-connect/token"; echo; }
cut_tokens() { sed -E 's/("[a-z_]*token":"[^"]{12})[^"]*"/\1…"/g'; }
decode() { local p; p=$(printf '%s' "$1" | cut -d. -f2 | tr '_-' '/+'); while [ $(( ${#p} % 4 )) -ne 0 ]; do p="$p="; done; printf '%s' "$p" | openssl base64 -d -A; echo; }
req_id() { sed -n 's/.*"auth_req_id":"\([^"]*\)".*/\1/p'; }
signin() { # user client
  JAR=$(mktemp); local v c p a l
  v=$(openssl rand -hex 32); c=$(printf '%s' "$v" | openssl dgst -binary -sha256 | openssl base64 | tr '+/' '-_' | tr -d '=')
  p=$(curl -fsS -c "$JAR" -G --data-urlencode response_type=code --data-urlencode "client_id=$2" --data-urlencode redirect_uri=http://127.0.0.1:8123/callback --data-urlencode "scope=${SCOPE:-openid}" --data-urlencode state=s ${RESOURCE:+--data-urlencode "resource=$RESOURCE"} --data-urlencode "code_challenge=$c" --data-urlencode code_challenge_method=S256 "$TENANT/protocol/openid-connect/auth")
  a=$(printf '%s' "$p" | sed -n 's/.*name="auth_session_id" value="\([^"]*\)".*/\1/p' | head -1)
  l=$(curl -sS -o /dev/null -D - -b "$JAR" -c "$JAR" --data-urlencode "auth_session_id=$a" --data-urlencode "username=$1" --data-urlencode 'password=a long and unremarkable passphrase' "$TENANT/login-actions/authenticate" | sed -n 's/^[Ll]ocation: //p' | tr -d '\r')
  CODE=$(printf '%s' "$l" | sed -n 's/.*[?&]code=\([^&]*\).*/\1/p'); VERIFIER=$v
}
mail_link() { docker compose exec -T odudu odudu send-mail >/dev/null; curl -sS http://localhost:8225/api/v1/message/latest | jq -r .Text | grep -o 'http://[^ ]*' | head -1 | tr -d '\r'; }
approval_id() { curl -fsS -H "Authorization: Bearer $(admin_token)" "$API/agent-approvals?state=pending" | jq -r '.items[0].id'; }
decide() { # approval-id approve|deny
  local page token
  page=$(curl -fsS -b "$JAR" "$TENANT/approval/$1"); token=$(printf '%s' "$page" | sed -n 's/.*name="csrf" value="\([^"]*\)".*/\1/p')
  curl -fsS -b "$JAR" --data-urlencode "csrf=$token" --data-urlencode "decision=$2" "$TENANT/approval/$1" | grep -o '<h1>.*</h1>'
}
```

The people's addresses are checked by the mail they are sent. Grace's is not yet, so ask the admin API to send her the verification link, send the mail, and follow the link; its page asks for one more click, a form post carrying the link's key:

```bash
GRACE=$(curl -fsS -H "Authorization: Bearer $(admin_token)" "$API/subjects?limit=20" | jq -r '.items[] | select(.username=="grace") | .id')
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer $(admin_token)" "$API/subjects/$GRACE/verification"
LINK=$(mail_link); echo "$LINK"
curl -sS --data-urlencode "key=${LINK##*key=}" "$TENANT/login-actions/action-token" | grep -o '<h1>.*</h1>'
```

```
202
http://localhost:3200/tenants/demo/login-actions/action-token?key=lCwjjS5_9olcv-0KZ5n-D8IL1gxAroCnq5Xwn_hSbno
<h1>Your email address is confirmed</h1>
```

## Asking

The client names the person with `login_hint`, says what it wants shown to them in `binding_message`, and asks for the scope
it wants. It authenticates as at the token endpoint. The answer is `200` with the `auth_req_id`, the seconds the request
lives and the seconds to wait between polls. It is never cached.

```bash
ASKED=$(bc --data-urlencode scope=openid --data-urlencode login_hint=grace --data-urlencode 'binding_message=Tidy the demo roles'); printf '%s\n' "$ASKED"; AUTH_REQ_ID=$(printf '%s' "$ASKED" | req_id)
```

```
HTTP/1.1 200 OK
x-request-id: 01a2130c-2791-7885-abdd-4b0ad8f90f19
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8
content-length: 91
Date: Wed, 25 Nov 2026 14:11:33 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"auth_req_id":"2nZ2aXzqnqNRMmggSKu324LTyM4LXpKfTJQmtgE1i_c","expires_in":600,"interval":5}
```

## The mail

Grace is mailed a link to the approval page. The mail goes to a verified address, names the client that asks and carries only
the approval's id:

```bash
LINK=$(mail_link); curl -sS http://localhost:8225/api/v1/message/latest | jq -r '.Subject, .Text'
```

```
My agent is asking for your approval at demo
⁨My agent⁩ is asking to act for you on your ⁨demo⁩ account. Open this link to see the request and to approve or deny it:

http://localhost:3200/tenants/demo/approval/01a2130c-27b8-7322-ac9b-83e58612092d

If you do not recognize this request, ignore this message and do not approve it. The request expires on its own.

--
You received this because a request was made for your account at ⁨demo⁩.
© 2026 Odudu · Powered by odudu
```

## Polling

The client asks the token endpoint with the `urn:openid:params:grant-type:ciba` grant and the `auth_req_id`. While the person
has not decided the answer is `authorization_pending`. Asked again before the interval has passed, it is `slow_down`, and the interval grows by five seconds, so the third poll waits eleven:

```bash
poll "$AUTH_REQ_ID"
poll "$AUTH_REQ_ID"
sleep 11
poll "$AUTH_REQ_ID"
```

```
{"error":"authorization_pending","error_description":"The user has not decided yet."}
{"error":"slow_down","error_description":"Poll less often."}
{"error":"authorization_pending","error_description":"The user has not decided yet."}
```

## The person approves

Grace signs in and answers on the approval page, as [the approval page](./the-approval-page.md) shows in full. The next poll
answers with the tokens of the person who approved:

```bash
signin grace my-agent
APPROVAL=${LINK##*/approval/}; decide "$APPROVAL" approve
sleep 11; TOKENS=$(poll "$AUTH_REQ_ID"); printf '%s\n' "$TOKENS" | cut_tokens
```

```
<h1>Request approved</h1>
{"access_token":"eyJhbGciOiJS…","id_token":"eyJhbGciOiJS…","token_type":"Bearer","expires_in":300,"scope":"openid"}
```

The access token is Grace's, with no `act` claim, since no run acts yet. The tokens are issued once: the same id polled again
is no longer valid.

```bash
decode "$(printf '%s' "$TOKENS" | token_of)"
sleep 11; poll "$AUTH_REQ_ID"
```

```
{"iss":"http://localhost:3200/tenants/demo","sub":"01a2130c-21e7-7bb7-a059-cab1a9a29253","aud":["http://localhost:3200/tenants/demo"],"client_id":"my-agent","scope":"openid","iat":1795615916,"exp":1795616216,"jti":"01a2130c-819d-7d10-b2ba-86811945532d","grant_id":"01a2130c-8197-7714-8072-872d6842c0cc"}
{"error":"invalid_grant","error_description":"The code or token is not valid."}
```

## The person denies

A request the person denies is answered `access_denied` on the next poll:

```bash
LATEST=$(bc --data-urlencode scope=openid --data-urlencode login_hint=grace --data-urlencode 'binding_message=Delete the demo tenant' | tail -1 | req_id)
signin grace my-agent; decide "$(approval_id)" deny
sleep 6; poll "$LATEST"
```

```
<h1>Request denied</h1>
{"error":"access_denied","error_description":"The user did not allow the request."}
```

## The request runs out

`requested_expiry` shortens the life of a request, in seconds; a tenant setting caps it. Once it has passed the poll answers
`expired_token`:

```bash
SHORT=$(bc --data-urlencode scope=openid --data-urlencode login_hint=grace --data-urlencode requested_expiry=5 | tail -1); echo "$SHORT"
sleep 7; poll "$(printf '%s' "$SHORT" | req_id)"
```

```
{"auth_req_id":"WQZB_fz3YR9x0wsI0U10xTrSeCAFO2DFfFqBhnbNZVQ","expires_in":5,"interval":5}
{"error":"expired_token","error_description":"The request has expired."}
```

## A person who does not exist

A hint that names nobody is answered exactly as one that names a person: the same status, the same members and the same
poll answers, so the endpoint cannot be used to find out who has an account. No mail is sent for it. Here is the
acknowledgement for `nobody`, then its poll:

```bash
NOBODY=$(bc --data-urlencode scope=openid --data-urlencode login_hint=nobody); printf '%s\n' "$NOBODY" | sed -n '1p;$p'
sleep 6; poll "$(printf '%s' "$NOBODY" | req_id)"
```

```
HTTP/1.1 200 OK
{"auth_req_id":"48wsEigPeNGH3wkyJ2fgUmmIjlKHY803dj1BYxGCIO8","expires_in":600,"interval":5}
{"error":"authorization_pending","error_description":"The user has not decided yet."}
```

## What it refuses

A request with no hint, a `user_code` (not supported, so discovery says `false`), a scope the client does not have, and a
request that does not authenticate:

```bash
bc --data-urlencode scope=openid | sed -n '1p;$p'; echo
bc --data-urlencode scope=openid --data-urlencode login_hint=grace --data-urlencode user_code=1234 | sed -n '1p;$p'; echo
bc --data-urlencode scope=nonsense --data-urlencode login_hint=grace | sed -n '1p;$p'; echo
curl -sS -i --data-urlencode scope=openid --data-urlencode login_hint=grace "$TENANT/protocol/openid-connect/bc-authorize" | sed -n '1p;$p'; echo
```

```
HTTP/1.1 400 Bad Request
{"error":"invalid_request","error_description":"The request is missing a parameter or has a wrong one."}
HTTP/1.1 400 Bad Request
{"error":"invalid_request","error_description":"The request is missing a parameter or has a wrong one."}
HTTP/1.1 400 Bad Request
{"error":"invalid_scope","error_description":"A requested scope is not available to this client."}
HTTP/1.1 401 Unauthorized
{"error":"invalid_client","error_description":"Client authentication failed."}
```

The endpoint takes a `POST` and nothing else, and a client that does not hold the `ciba` grant cannot use it. `agent-admin`
holds only `client_credentials`:

```bash
curl -sS -i "$TENANT/protocol/openid-connect/bc-authorize" | sed -n '1p;$p'; echo
curl -sS -i -u agent-admin:agent-admin-secret --data-urlencode scope=openid --data-urlencode login_hint=grace "$TENANT/protocol/openid-connect/bc-authorize" | sed -n '1p;$p'; echo
```

```
HTTP/1.1 404 Not Found
{"type":"about:blank#not-found","title":"Not Found","status":404,"detail":"No resource at this path","instance":"01a2130c-fb13-75fd-873e-ba7985483073"}
HTTP/1.1 400 Bad Request
{"error":"unauthorized_client","error_description":"This client may not use this grant type."}
```

A poll for an id that was never issued is `invalid_grant`, and a client that does not hold the grant is refused at the token endpoint as it is at `bc-authorize`, whatever id it presents:

```bash
poll nonsense
curl -sS -u agent-admin:agent-admin-secret --data-urlencode grant_type=urn:openid:params:grant-type:ciba --data-urlencode "auth_req_id=$AUTH_REQ_ID" "$TENANT/protocol/openid-connect/token"; echo
```

```
{"error":"invalid_grant","error_description":"The code or token is not valid."}
{"error":"unauthorized_client","error_description":"This client may not use this grant type."}
```

## What discovery says

The endpoint, the one delivery mode and the grant are advertised, and a `user_code` is not:

```bash
curl -sS "$TENANT/.well-known/openid-configuration" | jq '{backchannel_authentication_endpoint, backchannel_token_delivery_modes_supported, backchannel_user_code_parameter_supported, ciba: (.grant_types_supported | map(select(test("ciba"))))}'
```

```
{
  "backchannel_authentication_endpoint": "http://localhost:3200/tenants/demo/protocol/openid-connect/bc-authorize",
  "backchannel_token_delivery_modes_supported": [
    "poll"
  ],
  "backchannel_user_code_parameter_supported": false,
  "ciba": [
    "urn:openid:params:grant-type:ciba"
  ]
}
```
