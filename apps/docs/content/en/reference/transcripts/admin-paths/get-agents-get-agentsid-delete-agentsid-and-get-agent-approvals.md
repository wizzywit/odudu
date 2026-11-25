---
title: "A tenant's agents and approvals: list, read and revoke"
description: 'All four routes take manage-sessions; no agent token can call any of the four routes.'
---

# A tenant's agents and approvals: list, read and revoke

This page covers `GET /agents`, `GET /agents/:id`, `DELETE /agents/:id` and `GET /agent-approvals`.

It continues [the approval page](../request-paths/the-approval-page.md) on the same stack and in the same shell (see
[CIBA](../request-paths/ciba-bc-authorize-and-the-token-poll.md) for the stack and its helpers): the tenant `demo`, its
people `ada` and `grace`, the agent client `my-agent` and the service `agent-admin`, which holds `manage-sessions`. Every
command was run and every response is the one that came back; `$P` is the tenant's admin API, `$API` of the other pages.
The approvals the earlier pages left are the ones listed below, and the runs are the three this page starts.

All four take `manage-sessions`: an agent is what a sign-in handed out, and an operator who reads one is the operator who
can end it, as with sessions. No agent token can call any of the four: the door refuses a `GET` of the three reads
(`AGENT_DENIED_READS`) and has no allowlist entry for the `DELETE`, so an agent cannot list its siblings, read what its owner
was asked or end an instance, whatever scope it holds. That refusal is run by the integration tests of these routes, not
shown here, since an agent's token has to be made for the admin API's audience to be refused there.

## Three runs

Ada's agent starts a run and a run under it, and Grace's starts one. A run is what an exchange of a person's token makes for
an agent client:

```bash
person_token() { signin "$1" my-agent; curl -fsS -u "my-agent:$AGENT_SECRET" --data-urlencode grant_type=authorization_code --data-urlencode "code=$CODE" --data-urlencode redirect_uri=http://127.0.0.1:8123/callback --data-urlencode "code_verifier=$VERIFIER" "$TENANT/protocol/openid-connect/token" | token_of; }
exchange() { curl -fsS -u "my-agent:$AGENT_SECRET" --data-urlencode grant_type=urn:ietf:params:oauth:grant-type:token-exchange --data-urlencode "subject_token=$1" --data-urlencode subject_token_type=urn:ietf:params:oauth:token-type:access_token "$TENANT/protocol/openid-connect/token" | token_of; }
P=$API
ADA_RUN=$(exchange "$(person_token ada)"); ADA_CHILD=$(exchange "$ADA_RUN"); GRACE_RUN=$(exchange "$(person_token grace)")
decode "$ADA_CHILD"
```

```
{"iss":"http://localhost:3200/tenants/demo","sub":"01a2130c-2032-7e60-9357-bbf2d28f8a8a","aud":["http://localhost:3200/tenants/demo"],"client_id":"my-agent","scope":"openid","iat":1795615949,"exp":1795616249,"jti":"01a2130d-0166-7c78-832a-80ddd6803e35","sid":"01a2130d-0094-72f1-ab84-1fd9c293ccad","grant_id":"01a2130d-0162-721a-a3d7-6d2ce9c1979a","act":{"sub":"01a2130d-015f-75ce-b2e1-fd5e93d55619","act":{"sub":"01a2130d-0117-7eda-a16e-20d1c953db53"}}}
```

## `GET /agents` and `GET /agents/:id`

`GET /agents` lists the tenant's agent instances in id order, which is the order they were started in, so a parent comes before
its children. It is paged as the other lists are, `limit` up to 200 and `cursor`, which takes the `next` an answer carries, and narrowed by `owner` (a subject id) and
`state`:

- `live`: not revoked, and neither its lifetime nor its idle time has run out;
- `expired`: not revoked, and one of the two has run out. It stays so until the retention pass revokes it, and a token for it
  is refused in the meantime;
- `revoked`.

Each answer is an object with `items` (and `next` when another page follows), or for the third a single instance, with these
members:

| Member             | What it holds                                                                         |
| ------------------ | ------------------------------------------------------------------------------------- |
| `id`               | the instance's id, which is the `act.sub` of its tokens                               |
| `owner`            | the subject the agent acts for                                                        |
| `owner_username`   | the owner's username, or `null` for a subject with none                               |
| `agent_client`     | the `client_id` of the agent client it runs under                                     |
| `parent`           | the instance that started it, or `null`                                               |
| `depth`            | 1 for an instance started under a sign-in, one more for each instance above it        |
| `state`            | `live`, `expired` or `revoked`                                                        |
| `scope`            | the scope its tokens carry                                                            |
| `created_at`       | when it started                                                                       |
| `expires_at`       | when it ends whatever it does                                                         |
| `revoked_at`       | when it was revoked, or `null`                                                        |
| `remaining_budget` | `{ "mutating", "creates" }`: what the instance's own share of changing calls has left |

`remaining_budget` is that share only, never below 0. The sign-in's budget and the owner's daily limit are counted as well and
are not shown. A page of two, then the next:

```bash
PAGE1=$(mktemp); curl -sS -H "Authorization: Bearer $(admin_token)" "$P/agents?limit=2" | tee "$PAGE1" | jq -c '{ids: [.items[].id], next: (.next != null)}'
curl -sS -H "Authorization: Bearer $(admin_token)" "$P/agents?limit=2&cursor=$(jq -r .next "$PAGE1")" | jq -c '{ids: [.items[].id], next: (.next != null)}'
```

```
{"ids":["01a2130d-0117-7eda-a16e-20d1c953db53","01a2130d-015f-75ce-b2e1-fd5e93d55619"],"next":true}
{"ids":["01a2130d-025d-7d4f-bcb1-e23970f7d6bd"],"next":false}
```

Every instance, then those of one owner, then one instance read alone:

```bash
curl -sS -H "Authorization: Bearer $(admin_token)" "$P/agents?state=live" | jq -c '.items[] | {id, owner_username, parent, depth, state, remaining_budget}'
OWNER=$(curl -sS -H "Authorization: Bearer $(admin_token)" "$P/agents?state=live" | jq -r '.items[] | select(.owner_username=="grace") | .owner' | head -1)
curl -sS -H "Authorization: Bearer $(admin_token)" "$P/agents?owner=$OWNER" | jq -c '.items[] | {id, owner_username}'
CHILD_ID=$(decode "$ADA_CHILD" | jq -r .act.sub)
curl -sS -H "Authorization: Bearer $(admin_token)" "$P/agents/$CHILD_ID" | jq .
```

```
{"id":"01a2130d-0117-7eda-a16e-20d1c953db53","owner_username":"ada","parent":null,"depth":1,"state":"live","remaining_budget":{"mutating":20,"creates":10}}
{"id":"01a2130d-015f-75ce-b2e1-fd5e93d55619","owner_username":"ada","parent":"01a2130d-0117-7eda-a16e-20d1c953db53","depth":2,"state":"live","remaining_budget":{"mutating":20,"creates":10}}
{"id":"01a2130d-025d-7d4f-bcb1-e23970f7d6bd","owner_username":"grace","parent":null,"depth":1,"state":"live","remaining_budget":{"mutating":20,"creates":10}}
{"id":"01a2130d-025d-7d4f-bcb1-e23970f7d6bd","owner_username":"grace"}
{
  "id": "01a2130d-015f-75ce-b2e1-fd5e93d55619",
  "owner": "01a2130c-2032-7e60-9357-bbf2d28f8a8a",
  "owner_username": "ada",
  "agent_client": "my-agent",
  "parent": "01a2130d-0117-7eda-a16e-20d1c953db53",
  "depth": 2,
  "state": "live",
  "scope": "openid",
  "created_at": "2026-11-25T14:12:29.108Z",
  "expires_at": "2026-11-25T14:17:29.000Z",
  "revoked_at": null,
  "remaining_budget": {
    "mutating": 20,
    "creates": 10
  }
}
```

A `limit` of 0, an `owner` that is not an id, a `state` that is not one of the three, a cursor made for another list and a member the route does not know are each answered `400`, an id that is no instance's answers `404` and a value that is no id at all `400`:

```bash
for q in "limit=0" "owner=nobody" "state=gone" "cursor=abc" "color=red"; do printf '%s  ' "$q"; curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $(admin_token)" "$P/agents?$q"; done
for id in 01a21300-0000-7000-8000-000000000000 not-an-id; do printf '%s  ' "$id"; curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $(admin_token)" "$P/agents/$id"; done
```

```
limit=0  400
owner=nobody  400
state=gone  400
cursor=abc  400
color=red  400
01a21300-0000-7000-8000-000000000000  404
not-an-id  400
```

## `DELETE /agents/:id`

Revokes the instance and every instance started beneath it, then the grants any of them acted in and everything exchanged
from those, and answers how many it ended. The answer is `{"grants": <n>, "instances": <n>}`. `instances` counts the one
asked for and everything beneath it, and the instances that hung from a grant it ended. With `?dry_run=true` it answers the
same two numbers and changes nothing, so a console can say what a revocation would end before it is asked for. The counts
are the real ones because the revocation is the code that runs, and everything it wrote, its audit rows included, is undone
before the answer is sent. `dry_run` takes `true` or `false`, and anything else is `400`.

Ada's first run has one run under it:

```bash
ADA_ID=$(decode "$ADA_RUN" | jq -r .act.sub)
curl -sS -X DELETE -H "Authorization: Bearer $(admin_token)" "$P/agents/$ADA_ID?dry_run=true"; echo
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE -H "Authorization: Bearer $(admin_token)" "$P/agents/$ADA_ID?dry_run=maybe"
curl -sS -H "Authorization: Bearer $(admin_token)" "$P/agents?owner=$(curl -sS -H "Authorization: Bearer $(admin_token)" "$P/agents/$ADA_ID" | jq -r .owner)" | jq -c '.items[] | {state}'
```

```
{"grants":2,"instances":2}
400
{"state":"live"}
{"state":"live"}
```

The dry run changed nothing. Now the revocation itself, and the same call again, which finds nothing to end and records nothing:

```bash
curl -sS -X DELETE -H "Authorization: Bearer $(admin_token)" "$P/agents/$ADA_ID"; echo
curl -sS -X DELETE -H "Authorization: Bearer $(admin_token)" "$P/agents/$ADA_ID"; echo
curl -sS -H "Authorization: Bearer $(admin_token)" "$P/agents?state=revoked" | jq -c '.items[] | {id, parent, state, revoked_at}'
```

```
{"grants":2,"instances":2}
{"grants":0,"instances":0}
{"id":"01a2130d-0117-7eda-a16e-20d1c953db53","parent":null,"state":"revoked","revoked_at":"2026-11-25T14:12:31.559Z"}
{"id":"01a2130d-015f-75ce-b2e1-fd5e93d55619","parent":"01a2130d-0117-7eda-a16e-20d1c953db53","state":"revoked","revoked_at":"2026-11-25T14:12:31.559Z"}
```

A revocation writes two audit rows. `agent.instance_revoked` (event type `agent_identity`, `via` set to `admin`) names the
instance, its owner, its agent client, its depth and, in `count`, how many instances the call ended; its actor is the
instance's owner, as for every row of that action. `agent.instance_revoke` (event type `admin_mutation`) has the
administrator as its actor and the numbers of grants and instances in `detail`. The first, with its allowlisted detail, then
the second:

```bash
curl -sS -H "Authorization: Bearer $(admin_token)" "$P/audit?action=agent.instance_revoked" | jq -c '.items[] | {event_type, action, outcome, detail}'
curl -sS -H "Authorization: Bearer $(admin_token)" "$P/audit?action=agent.instance_revoke" | jq -c '.items[] | {event_type, action, outcome, detail}'
```

```
{"event_type":"agent_identity","action":"agent.instance_revoked","outcome":"allowed","detail":{"via":"admin","count":2,"depth":1,"owner":"01a2130c-2032-7e60-9357-bbf2d28f8a8a","instance":"01a2130d-0117-7eda-a16e-20d1c953db53","agent_client":"my-agent"}}
{"event_type":"admin_mutation","action":"agent.instance_revoke","outcome":"allowed","detail":{"grants":2,"instances":2}}
```

The child's token is refused now, though it has most of its five minutes left:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $ADA_CHILD" "$TENANT/protocol/openid-connect/userinfo"
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $GRACE_RUN" "$TENANT/protocol/openid-connect/userinfo"
```

```
401
200
```

An owner holding an admin capability the caller does not is out of reach (the target ceiling every change to a user is held
to), answered `403` with the capabilities the caller lacks. Ada is given `manage-users`, which `agent-admin` holds, and then
`manage-keys`, which it does not, and a run of hers is out of reach:

```bash
docker compose exec -T odudu odudu seed grant-role --tenant demo --username ada --role odudu-admin:manage-keys | jq -c '{role: .role}'
ADA_RUN2=$(exchange "$(person_token ada)"); ADA_ID2=$(decode "$ADA_RUN2" | jq -r .act.sub)
curl -sS -i -X DELETE -H "Authorization: Bearer $(admin_token)" "$P/agents/$ADA_ID2" | sed -n '1p;$p'
```

```
{"role":"odudu-admin:manage-keys"}
HTTP/1.1 403 Forbidden
{"type":"about:blank","title":"Forbidden","status":403,"detail":"the subject holds what the caller does not: manage-keys","instance":"01a2130d-0fda-75c9-936f-443819b0b2d2"}
```

## `GET /agent-approvals`

Lists what agents asked their owners to approve, newest first, paged and narrowed by `state` (`pending`, `approved`,
`denied`, `expired` or `consumed`). Each item has `id`, `owner`, `owner_username` (or `null`), `agent_client`, `instance` (or
`null`), `kind`, `summary`, `state`, `created_at`, `expires_at`, `decided_at` and `decided_via` (`ciba_page` or `console`, or
`null`). `summary` is the words the owner is shown, which the agent wrote. The digest of the action an approval covers is
never in an answer. A `pending` approval past its `expires_at` can no longer be decided and is marked `expired` by the next
retention pass. What the earlier pages left, by state:

```bash
for s in pending approved denied expired consumed; do printf '%s  ' "$s"; curl -sS -H "Authorization: Bearer $(admin_token)" "$P/agent-approvals?state=$s" | jq -c '[.items[] | {owner_username, kind, summary, decided_via}] | length'; done
curl -sS -H "Authorization: Bearer $(admin_token)" "$P/agent-approvals?state=approved&limit=1" | jq '.items[0]'
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $(admin_token)" "$P/agent-approvals?state=gone"
```

```
pending  2
approved  1
denied  1
expired  0
consumed  1
{
  "id": "01a2130c-fc03-7094-8a3d-c2099f701d14",
  "owner": "01a2130c-21e7-7bb7-a059-cab1a9a29253",
  "owner_username": "grace",
  "agent_client": "my-agent",
  "instance": null,
  "kind": "ciba",
  "summary": "My agent asks to sign in as you with: openid",
  "state": "approved",
  "created_at": "2026-11-25T14:12:27.746Z",
  "expires_at": "2026-11-25T14:22:27.744Z",
  "decided_at": "2026-11-25T14:12:28.737Z",
  "decided_via": "ciba_page"
}
400
```
