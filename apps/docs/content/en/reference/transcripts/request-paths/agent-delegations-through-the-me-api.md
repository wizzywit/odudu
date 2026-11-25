---
title: 'Agent delegations through the me API'
description: 'A person lets an agent client act for them with POST /me/delegations: what the token then says, who may exchange it, and what withdrawing it does.'
---

# Agent delegations through the me API

A person decides which agent clients may act for them. The me API has three operations for it: `POST /me/delegations`, `GET
/me/delegations` and `DELETE /me/delegations/{id}`. A delegation names the client the person signs in with, an agent client
and a scope ceiling, and lasts at most 90 days (`expires_in`, 60 to 7,776,000 seconds). A person holds at most 20 live ones.
The token the person gets from that sign-in client then carries `may_act` naming the agent clients, and an exchange by any
other client is refused. Making one needs a recent sign-in and is refused to an agent's own token.

This page continues [the agents page](../admin-paths/get-agents-get-agentsid-delete-agentsid-and-get-agent-approvals.md) on
the same stack and in the same shell (see [CIBA](./ciba-bc-authorize-and-the-token-poll.md) for the stack and its helpers).
`my-app` is a public client that signs Grace in and may ask for `me:read` and `me:write` at the tenant's me address, which is
its audience; `other-agent` is a second agent client. Every command was run and every response is the one that came back.

## A client that signs the person in, and a second agent

```bash
ME=$TENANT/me; OTHER_JSON=$(mktemp)
curl -fsS -H "Authorization: Bearer $(admin_token)" -H 'content-type: application/json' -d '{"client_id":"my-app","name":"My app","redirect_uris":["http://127.0.0.1:8123/callback"],"token_endpoint_auth_method":"none","grant_types":["authorization_code"],"audiences":["'$ME'"],"web_origins":["https://spa.example"]}' "$API/clients" | jq -c '{client_id, type, audiences, web_origins}'
for s in me:read me:write; do docker compose exec -T odudu odudu seed assign-scope --tenant demo --client-id my-app --scope $s --assignment optional >/dev/null; done
curl -fsS -H "Authorization: Bearer $(admin_token)" -H 'content-type: application/json' -d '{"client_id":"other-agent","name":"Other agent","redirect_uris":["http://127.0.0.1:8123/callback"],"grant_types":["authorization_code","urn:ietf:params:oauth:grant-type:token-exchange"],"agent_type":true}' "$API/clients" > "$OTHER_JSON"
OTHER_SECRET=$(jq -r .client_secret "$OTHER_JSON"); jq -c '{client_id, agent_type}' "$OTHER_JSON"
```

```
{"client_id":"my-app","type":"public","audiences":["http://localhost:3200/tenants/demo/me"],"web_origins":["https://spa.example"]}
{"client_id":"other-agent","agent_type":true}
```

Grace signs in through `my-app` for the me API (the same sign-in as [the me API's](./the-me-api.md), with the me address as the `resource`), and her token is the one the calls below carry:

```bash
app_token() { SCOPE="$1" RESOURCE=$ME signin grace my-app; curl -fsS --data-urlencode grant_type=authorization_code --data-urlencode "code=$CODE" --data-urlencode redirect_uri=http://127.0.0.1:8123/callback --data-urlencode client_id=my-app --data-urlencode "code_verifier=$VERIFIER" --data-urlencode "resource=$ME" "$TENANT/protocol/openid-connect/token" | token_of; }
GRACE_ME=$(app_token "openid me:read me:write")
decode "$GRACE_ME" | jq -c '{sub, aud, client_id, scope}'
curl -sS -H "Authorization: Bearer $GRACE_ME" "$ME/delegations"
```

```
{"sub":"01a2130c-21e7-7bb7-a059-cab1a9a29253","aud":["http://localhost:3200/tenants/demo/me","http://localhost:3200/tenants/demo"],"client_id":"my-app","scope":"openid me:read me:write"}
{"items":[]}
```

## `POST /me/delegations`

Grace lets `my-agent` act for her through `my-app`, for the scope `openid`, for an hour. The answer is `201` with the delegation:

```bash
curl -sS -i -H "Authorization: Bearer $GRACE_ME" -H 'content-type: application/json' -d '{"client_id":"my-app","actor_client_id":"my-agent","scope_ceiling":"openid","expires_in":3600}' "$ME/delegations" | tee /dev/stderr | tail -1 | jq -r .id > /dev/null
```

```
HTTP/1.1 201 Created
x-request-id: 01a2130d-166d-7340-bfc3-cc8b8471445e
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 200
Date: Wed, 25 Nov 2026 14:12:34 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a2130d-1677-7688-9b0d-79406439b3eb","client_id":"my-app","actor_client_id":"my-agent","scope_ceiling":"openid","expires_at":"2026-11-25T15:12:34.551Z","created_at":"2026-11-25T14:12:34.548Z"}
```

The list shows what she holds, newest first, never paged, since at most 20 are live:

```bash
curl -sS -H "Authorization: Bearer $GRACE_ME" "$ME/delegations" | jq .
```

```
{
  "items": [
    {
      "id": "01a2130d-1677-7688-9b0d-79406439b3eb",
      "client_id": "my-app",
      "actor_client_id": "my-agent",
      "scope_ceiling": "openid",
      "expires_at": "2026-11-25T15:12:34.551Z",
      "created_at": "2026-11-25T14:12:34.548Z"
    }
  ]
}
```

A request is refused when the body names a field it does not know, when the actor is not an agent client of the tenant, and
when a scope is not a scope token:

```bash
for body in '{"client_id":"my-app","actor_client_id":"my-app","scope_ceiling":"openid","expires_in":3600}' '{"client_id":"my-app","actor_client_id":"my-agent","scope_ceiling":"open id\"","expires_in":3600}' '{"client_id":"my-app","actor_client_id":"my-agent","scope_ceiling":"openid","expires_in":5}' '{"client_id":"my-app","actor_client_id":"my-agent","scope_ceiling":"openid","expires_in":3600,"extra":1}'; do
  curl -sS -w '  %{http_code}\n' -H "Authorization: Bearer $GRACE_ME" -H 'content-type: application/json' -d "$body" "$ME/delegations" | jq -c . 2>/dev/null || true
done
```

```
{"error":"invalid_request","error_description":"actor_client_id: is not an agent client"}
400
{"error":"invalid_request","error_description":"The request body is not valid: scope_ceiling: must name at least one scope"}
400
{"error":"invalid_request","error_description":"The request body is not valid: expires_in: Too small: expected number to be >=60"}
400
{"error":"invalid_request","error_description":"The request body is not valid: Unrecognized key: \"extra\""}
400
```

## What her token says

Signing in through `my-app` again, the access token carries `may_act` naming the agent client, and the grant keeps it:

```bash
GRACE_APP=$(app_token "openid me:read")
decode "$GRACE_APP" | jq -c '{sub, client_id, scope, may_act}'
```

```
{"sub":"01a2130c-21e7-7bb7-a059-cab1a9a29253","client_id":"my-app","scope":"openid me:read","may_act":{"sub":"my-agent","iss":"http://localhost:3200/tenants/demo"}}
```

The agent client she named exchanges that token, for the scope `openid` that her delegation allows, and is given a run. A second agent client, which she did not name, is refused `invalid_request`, which RFC 8693 §2.2.2 gives for a token the server will not accept:

```bash
exchange_as() { curl -sS -u "$1:$2" --data-urlencode grant_type=urn:ietf:params:oauth:grant-type:token-exchange --data-urlencode "subject_token=$3" --data-urlencode subject_token_type=urn:ietf:params:oauth:token-type:access_token --data-urlencode scope=openid "$TENANT/protocol/openid-connect/token"; echo; }
exchange_as my-agent "$AGENT_SECRET" "$GRACE_APP" | cut_tokens
exchange_as other-agent "$OTHER_SECRET" "$GRACE_APP" | cut_tokens
```

```
{"access_token":"eyJhbGciOiJS…","token_type":"Bearer","expires_in":300,"scope":"openid","issued_token_type":"urn:ietf:params:oauth:token-type:access_token"}
{"error":"invalid_request","error_description":"The request is missing a parameter or has a wrong one."}
```

The run's token is Grace's, with the agent's run in `act`:

```bash
decode "$(exchange_as my-agent "$AGENT_SECRET" "$GRACE_APP" | head -1 | token_of)" | jq -c '{sub, scope, act}'
```

```
{"sub":"01a2130c-21e7-7bb7-a059-cab1a9a29253","scope":"openid","act":{"sub":"01a2130d-17ec-7784-bfae-2251a00445fc"}}
```

## `DELETE /me/delegations/{id}` and what it leaves

Withdrawing the delegation answers `204`. It does not end a run already started: the runs above run until they expire, and
the administrator can end them from [the agents routes](../admin-paths/get-agents-get-agentsid-delete-agentsid-and-get-agent-approvals.md).
What changes is a sign-in made after it. Where the sign-in client names no `delegated_actors`, the access token has no
`may_act` again and any agent client may act for her, the rule before delegations existed:

```bash
curl -sS -i -X DELETE -H "Authorization: Bearer $GRACE_ME" "$ME/delegations/$DELEG" | sed -n '1p'
curl -sS -H "Authorization: Bearer $GRACE_ME" "$ME/delegations" | jq -c .
AFTER=$(app_token "openid me:read")
decode "$AFTER" | jq -c '{sub, client_id, may_act}'
exchange_as other-agent "$OTHER_SECRET" "$AFTER" | cut_tokens
```

```
HTTP/1.1 204 No Content
{"items":[]}
{"sub":"01a2130c-21e7-7bb7-a059-cab1a9a29253","client_id":"my-app","may_act":null}
{"access_token":"eyJhbGciOiJS…","token_type":"Bearer","expires_in":300,"scope":"openid","issued_token_type":"urn:ietf:params:oauth:token-type:access_token"}
```

A delegation that is not the caller's, or does not exist, is `404` and nothing else:

```bash
curl -sS -i -X DELETE -H "Authorization: Bearer $GRACE_ME" "$ME/delegations/$DELEG" | sed -n '1p'
curl -sS -i -X DELETE -H "Authorization: Bearer $GRACE_ME" "$ME/delegations/not-an-id" | sed -n '1p'
```

```
HTTP/1.1 404 Not Found
HTTP/1.1 404 Not Found
```

## From a browser

A browser application on another origin lists it in `web_origins`, as it does for the rest of the me API. The preflight of
`POST` is answered for that origin and for no other:

```bash
for o in https://spa.example https://other.example; do
  echo "Origin: $o"
  curl -sS -D - -o /dev/null -X OPTIONS -H "Origin: $o" -H 'Access-Control-Request-Method: POST' $ME/delegations | grep -iE '^(HTTP|access-control|vary)'
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
