---
title: Delegate to an agent
description: Mark a client as an agent, start a run for a person, nest a child run, ask the person for approval and end it all, with commands you can run.
sidebar_position: 15
---

# Delegate to an agent

An AI agent acts for a person, and Odudu gives each start of it an identity of its own, so a token says both who the person is and which run is acting. This guide makes an agent client, starts a run for `ada`, starts a run under it, asks `ada` to approve something, and ends the lot. [Agents](../concepts/agents.mdx) explains the ideas.

You need the stack from the [quick start](../quick-start/index.mdx) with its `demo` tenant and the person `ada`. Run the commands once, in order, in the folder that holds `compose.yaml`, in bash or zsh with `curl` and `openssl` installed. A second run finds the clients of the first and is refused.

## 1. Point the commands at your server

If you moved the port in the quick start, use that address instead of 3000.

```sh {run}
export ODUDU_BASE="${ODUDU_BASE:-http://localhost:3000}" && export TENANT="$ODUDU_BASE/tenants/demo" && export API="$ODUDU_BASE/admin/tenants/demo"
```

Two helpers keep the rest short. `token_of` takes the access token out of a token response, and `decode` shows what a token says.

```sh {run}
token_of() { sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p'; }; decode() { local p; p=$(printf '%s' "$1" | cut -d. -f2 | tr '_-' '/+'); while [ $(( ${#p} % 4 )) -ne 0 ]; do p="$p="; done; printf '%s' "$p" | openssl base64 -d -A; echo; }
```

## 2. A service that administers

Marking a client as an agent is an admin API call, so make a service that may make clients and end sessions. `--capability` gives its account the capability, once for each.

```sh {run expect="manage-sessions"}
docker compose exec odudu odudu seed client --tenant demo --client-id agent-admin --client-secret agent-admin-secret --grant-type client_credentials --audience urn:odudu:params:admin-api --capability manage-clients --capability manage-sessions --capability manage-tenant
```

A token for it lasts five minutes, so this function asks for a new one whenever a command needs it.

```sh {run}
admin_token() { curl -fsS -u agent-admin:agent-admin-secret --data-urlencode grant_type=client_credentials "$TENANT/protocol/openid-connect/token" | token_of; }
```

## 3. Make the agent client

An agent is a client whose `agent_type` is on. This one is confidential, signs `ada` in with the authorization code flow, and may exchange tokens and ask for approvals (the `ciba` grant).

```sh {run expect="my-agent"}
CREATED=$(curl -fsS -H "Authorization: Bearer $(admin_token)" -H 'content-type: application/json' -d '{"client_id":"my-agent","name":"My agent","redirect_uris":["http://127.0.0.1:8123/callback"],"grant_types":["authorization_code","refresh_token","urn:ietf:params:oauth:grant-type:token-exchange","urn:openid:params:grant-type:ciba"],"agent_type":true}' "$API/clients") && printf '%s\n' "$CREATED" | sed -n 's/.*\("client_id":"[^"]*"\).*\("agent_type":[a-z]*\).*/\1 \2/p'
```

The answer holds the client's secret once. Keep it.

```sh {run}
AGENT_SECRET=$(printf '%s' "$CREATED" | sed -n 's/.*"client_secret":"\([^"]*\)".*/\1/p')
```

## 4. Sign the person in

This is the authorization code flow with PKCE, as [Sign a user in](./sign-a-user-in.md) walks through it. The commands play the browser and sign in as `ada`.

```sh {run}
VERIFIER=$(openssl rand -hex 32) && CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 | openssl base64 | tr '+/' '-_' | tr -d '=')
```

```sh {run}
COOKIES=$(mktemp) && PAGE=$(curl -fsS -c "$COOKIES" -G --data-urlencode response_type=code --data-urlencode client_id=my-agent --data-urlencode redirect_uri=http://127.0.0.1:8123/callback --data-urlencode scope=openid --data-urlencode state=abc123 --data-urlencode "code_challenge=$CHALLENGE" --data-urlencode code_challenge_method=S256 "$TENANT/protocol/openid-connect/auth")
```

```sh {run expect="127.0.0.1:8123/callback?code="}
AUTH_SESSION=$(printf '%s' "$PAGE" | sed -n 's/.*name="auth_session_id" value="\([^"]*\)".*/\1/p' | head -1) && CALLBACK=$(curl -sS -o /dev/null -D - -b "$COOKIES" -c "$COOKIES" --data-urlencode "auth_session_id=$AUTH_SESSION" --data-urlencode username=ada --data-urlencode 'password=a long and unremarkable passphrase' "$TENANT/login-actions/authenticate" | sed -n 's/^[Ll]ocation: //p' | tr -d '\r') && echo "$CALLBACK"
```

The agent client swaps the code for the person's own tokens, proving itself with its secret.

```sh {run expect="Bearer"}
CODE=$(printf '%s' "$CALLBACK" | sed -n 's/.*[?&]code=\([^&]*\).*/\1/p') && TOKENS=$(curl -fsS -u "my-agent:$AGENT_SECRET" --data-urlencode grant_type=authorization_code --data-urlencode "code=$CODE" --data-urlencode redirect_uri=http://127.0.0.1:8123/callback --data-urlencode "code_verifier=$VERIFIER" "$TENANT/protocol/openid-connect/token") && printf '%s\n' "$TOKENS" | sed -E 's/("[a-z_]*token":"[^"]{12})[^"]*"/\1…"/g'
```

```sh {run}
PERSON_TOKEN=$(printf '%s' "$TOKENS" | token_of)
```

This token is `ada`'s. Its `sub` is her and it has no `act`, because nobody acts for her yet.

```sh {run expect="client_id"}
decode "$PERSON_TOKEN"
```

## 5. Start a run

The agent exchanges her token for one of its own. The request is RFC 8693's token exchange, authenticated as the agent client. Because the client is an agent, Odudu makes a run.

```sh {run expect="issued_token_type"}
exchange() { curl -sS -u "my-agent:$AGENT_SECRET" --data-urlencode grant_type=urn:ietf:params:oauth:grant-type:token-exchange --data-urlencode "subject_token=$1" --data-urlencode subject_token_type=urn:ietf:params:oauth:token-type:access_token "$TENANT/protocol/openid-connect/token"; }; RUN=$(exchange "$PERSON_TOKEN") && printf '%s\n' "$RUN" | sed -E 's/("access_token":"[^"]{12})[^"]*"/\1…"/'
```

```sh {run expect="act"}
RUN_TOKEN=$(printf '%s' "$RUN" | token_of) && decode "$RUN_TOKEN"
```

`sub` is still `ada`. `act.sub` is the run's own id, the thing an audit row will name. The run exists only as that id and as a record the administrator can see.

## 6. Start a run under it

The run exchanges its own token for a child's.

```sh {run expect="act"}
CHILD=$(exchange "$RUN_TOKEN") && CHILD_TOKEN=$(printf '%s' "$CHILD" | token_of) && decode "$CHILD_TOKEN"
```

`act` now nests: the child's id first, then the run that started it. A resource server that reads the claim sees the whole chain.

## 7. See the runs

The admin API lists a tenant's runs in the order they started, so a parent comes before its children.

```sh {run expect="my-agent"}
curl -fsS -H "Authorization: Bearer $(admin_token)" "$API/agents?state=live"
```

Each item names its owner, its agent client, its parent, its depth and what its own share of the write budget has left. The console shows the same under **Agents**; see [Agents in the console](../admin-console/agents.mdx).

## 8. Lower the depth

A tenant decides how deep runs may nest. Set it to one, and a run can no longer start a child.

```sh {run expect="agent_max_delegation_depth"}
curl -fsS -X PATCH -H "Authorization: Bearer $(admin_token)" -H 'content-type: application/json' -d '{"agent_max_delegation_depth":1}' "$API/settings" | sed -n 's/.*\("agent_max_delegation_depth":[0-9]*\).*/\1/p'
```

```sh {run expect="invalid_target"}
exchange "$RUN_TOKEN"; echo
```

Put the setting back to its default of three.

```sh {run expect="agent_max_delegation_depth"}
curl -fsS -X PATCH -H "Authorization: Bearer $(admin_token)" -H 'content-type: application/json' -d '{"agent_max_delegation_depth":3}' "$API/settings" | sed -n 's/.*\("agent_max_delegation_depth":[0-9]*\).*/\1/p'
```

## 9. Ask the person to approve

Sometimes an agent should wait for a yes. It asks through CIBA in poll mode: it names the person and says what it wants shown to them.

```sh {run expect="auth_req_id"}
ASKED=$(curl -fsS -u "my-agent:$AGENT_SECRET" --data-urlencode scope=openid --data-urlencode login_hint=ada --data-urlencode 'binding_message=Tidy the demo roles' "$TENANT/protocol/openid-connect/bc-authorize") && echo "$ASKED"
```

It polls the token endpoint with the `auth_req_id` it was given, and is told to wait. A poll that comes sooner than the five seconds the acknowledgement named, its `interval`, is answered `slow_down` and lengthens the wait, so the poll after the approval below comes after a pause.

```sh {run expect="authorization_pending"}
AUTH_REQ_ID=$(printf '%s' "$ASKED" | sed -n 's/.*"auth_req_id":"\([^"]*\)".*/\1/p') && poll() { curl -sS -u "my-agent:$AGENT_SECRET" --data-urlencode grant_type=urn:openid:params:grant-type:ciba --data-urlencode "auth_req_id=$AUTH_REQ_ID" "$TENANT/protocol/openid-connect/token"; } && poll; echo
```

Odudu mails `ada` a link to an approval page, and this stack has no mail relay, so read the approval's id from the admin API instead. The agent never sees it.

```sh {run expect="pending"}
APPROVAL=$(curl -fsS -H "Authorization: Bearer $(admin_token)" "$API/agent-approvals?state=pending" | sed -n 's/^{"items":\[{"id":"\([^"]*\)".*/\1/p') && curl -fsS -H "Authorization: Bearer $(admin_token)" "$API/agent-approvals?state=pending"
```

The page is for the signed-in person. `ada` still holds the session from step 4, so the cookie jar opens it. It names the agent, what it asks for and her own words.

```sh {run expect="is asking for your approval"}
APPROVAL_PAGE=$(curl -fsS -b "$COOKIES" "$TENANT/approval/$APPROVAL") && printf '%s\n' "$APPROVAL_PAGE" | grep -o '<h1>.*</h1>\|It says: .*</p>'
```

Approving is a form posted with a token that ties it to her session and to this approval.

```sh {run expect="Request approved"}
FORM_TOKEN=$(printf '%s' "$APPROVAL_PAGE" | sed -n 's/.*name="csrf" value="\([^"]*\)".*/\1/p') && curl -fsS -b "$COOKIES" --data-urlencode "csrf=$FORM_TOKEN" --data-urlencode decision=approve "$TENANT/approval/$APPROVAL" | grep -o '<h1>.*</h1>'
```

The next poll answers with tokens.

```sh {run expect="Bearer"}
sleep 11; poll | sed -E 's/("[a-z_]*token":"[^"]{12})[^"]*"/\1…"/g'; echo
```

## 10. End it

The child's token works until its run is ended.

```sh {run expect="sub"}
curl -fsS -H "Authorization: Bearer $CHILD_TOKEN" "$TENANT/protocol/openid-connect/userinfo"; echo
```

Name the first run, and ask what ending it would do. `dry_run=true` ends nothing.

```sh {run expect="instances"}
RUN_ID=$(decode "$RUN_TOKEN" | sed -n 's/.*"act":{"sub":"\([^"]*\)".*/\1/p') && curl -fsS -X DELETE -H "Authorization: Bearer $(admin_token)" "$API/agents/$RUN_ID?dry_run=true"; echo
```

Two runs and two grants: the run and its child. End them.

```sh {run expect="instances"}
curl -fsS -X DELETE -H "Authorization: Bearer $(admin_token)" "$API/agents/$RUN_ID"; echo
```

The child's token is refused now, though it has most of its five minutes left.

```sh {run expect="401"}
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $CHILD_TOKEN" "$TENANT/protocol/openid-connect/userinfo"
```

## What a person can do themselves

A person decides which agents may act for them through the "me" API: `POST /tenants/demo/me/delegations` names the client they sign in with, an agent client, a scope ceiling and how long it lasts, `GET` lists their live ones and `DELETE /me/delegations/<id>` withdraws one. Making one needs a recent sign-in. Withdrawing one does not end runs already started. [The me API: delegations](../reference/transcripts/request-paths/agent-delegations-through-the-me-api.md) shows the requests.

## Where the pieces are

- [The CIBA request and its poll](../reference/transcripts/request-paths/ciba-bc-authorize-and-the-token-poll.md) and [the approval page](../reference/transcripts/request-paths/the-approval-page.md) show every answer, the refusals included.
- [A tenant's agents and approvals](../reference/transcripts/admin-paths/get-agents-get-agentsid-delete-agentsid-and-get-agent-approvals.md) shows the admin routes.
- The nine settings are under **Agents** in the console's Settings, and in the [configuration of a tenant](../reference/generated/admin-api/settings/index.md).
