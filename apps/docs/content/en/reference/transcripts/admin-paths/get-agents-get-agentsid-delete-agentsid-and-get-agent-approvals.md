---
title: "A tenant's agents and approvals: list, read and revoke"
description: 'All four routes take manage-sessions; no agent token can call any of the four routes.'
---

# A tenant's agents and approvals: list, read and revoke

This page covers `GET /agents`, `GET /agents/:id`, `DELETE /agents/:id` and `GET /agent-approvals`.

**This page was not run against a stack.** Every other page of this guide shows output that came back from
a running server. An agent instance is made by an agent calling the MCP endpoint, or asking a person
through a CIBA request, and a stack for these commands would need an agent client, a person's sign-in and
an approval, which the guide has no page for. So the commands below are illustrative and show no output;
what each answers is described. The integration tests of these routes run every one of them against a
real database, including each refusal.

All four take `manage-sessions`: an agent is what a sign-in handed out, and an operator who reads
one is the operator who can end it, as with sessions. No
agent token can call any of the four: the door refuses a `GET` of the three reads
(`AGENT_DENIED_READS`) and has no allowlist entry for the `DELETE`, so an agent cannot list its siblings,
read what its owner was asked or end an instance, whatever scope it holds.

## `GET /agents` and `GET /agents/:id`

`GET /agents` lists the tenant's agent instances in id order, which is the order they were started in, so
a parent comes before its children. It is paged as the other lists are, `limit` up to 200 and `next`, and
narrowed by `owner` (a subject id) and `state`:

- `live`: not revoked, and neither its lifetime nor its idle time has run out;
- `expired`: not revoked, and one of the two has run out. It stays so until the retention pass revokes it,
  and a token for it is refused in the meantime;
- `revoked`.

```text
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/agents?state=live&limit=50"
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/agents?owner=$OWNER_ID"
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/agents/$INSTANCE_ID"
```

Each answer is an object with `items` (and `next` when another page follows), or for the third a single
instance, with these members:

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

`remaining_budget` is that share only, never below 0. The sign-in's budget and the owner's daily limit are
counted as well and are not shown. A `limit` of 0, an `owner` that is not an id, a `state` that is not one
of the three, a cursor made for another list and a member the route does not know are each answered `400`,
an id that is no instance's answers `404` and a value that is no id at all `400`.

## `DELETE /agents/:id`

Revokes the instance and every instance started beneath it, then the grants any of them acted in and
everything exchanged from those, and answers how many it ended:

```text
curl -sS -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$P/agents/$INSTANCE_ID"
```

The answer is `{"grants": <n>, "instances": <n>}`. `instances` counts the one asked for and everything
beneath it, and the instances that hung from a grant it ended. A second call finds nothing to end, answers
`{"grants":0,"instances":0}` and records nothing. An owner holding an admin capability the caller does not is
out of reach (the target ceiling every change to a user is held to), answered `403` with the capabilities
the caller lacks.

With `?dry_run=true` it answers the same two numbers and changes nothing, so a console can say what a
revocation would end before it is asked for. The counts are the real ones because the revocation is the
code that runs, and everything it wrote, its audit rows included, is undone before the answer is sent.
`dry_run` takes `true` or `false`, and anything else is `400`.

```text
curl -sS -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$P/agents/$INSTANCE_ID?dry_run=true"
```

A revocation writes two audit rows. `agent.instance_revoked` (event type `agent_identity`, `via` set to
`admin`) names the instance, its owner, its agent client, its depth and, in `count`, how many instances the
call ended; its actor is the instance's owner, as for every row of that action. `agent.instance_revoke`
(event type `admin_mutation`) has the administrator as its actor and the numbers of grants and instances in
`detail`. A call refused for the owner's capabilities writes the second only, with the outcome `refused`.
Any instance a grant it ended was the root of is recorded as `agent.instance_revoked` with `via` set to
`cascade`.

## `GET /agent-approvals`

Lists what agents asked their owners to approve, newest first, paged and narrowed by `state` (`pending`,
`approved`, `denied`, `expired` or `consumed`):

```text
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/agent-approvals?state=pending"
```

Each item has `id`, `owner`, `owner_username` (or `null`), `agent_client`, `instance` (or `null`), `kind`, `summary`, `state`,
`created_at`, `expires_at`, `decided_at` and `decided_via` (`ciba_page` or `console`, or `null`). `summary`
is the words the owner is shown, which the agent wrote. The digest of the action an approval covers is
never in an answer. A `pending` approval past its `expires_at` can no longer be decided and is marked
`expired` by the next retention pass.
