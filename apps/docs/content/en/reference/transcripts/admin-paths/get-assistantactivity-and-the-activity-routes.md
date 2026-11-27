---
title: 'Assistant activity: list, replay, export and report'
description: 'How a holder of read-assistant-activity lists the console assistant conversations of a tenant, replays one, exports it as a test case and reports one.'
---

# Assistant activity: list, replay, export and report

This page covers `GET /assistant/activity`, `GET /assistant/activity/conversations/{id}`, `GET /assistant/activity/conversations/{id}/promptfoo` and `POST /assistant/conversations/{id}/report`.

The first three need `read-assistant-activity`, which `tenant-admin` carries. The last needs `use-assistant`, or `read-assistant-activity`. An AI agent's token is refused all four, and a caller with none of the capabilities is refused `403`. All four answer as a path that was never served (`404`) where the server has no model configured.

**This page has no captured output.** The routes are new, and the commands below were not run against a live stack: the output shown is
described, not recorded, and the blocks are tagged `text` for that reason. The behaviour is run by integration tests against a real database,
which cover the routes with their audit rows, the queries, the retention, the report cap and the query plans over 100,000 turns. A transcript from a running stack
replaces this page's description when one is captured.

## The list

```text
GET /admin/tenants/{tenant}/assistant/activity?person=&conversation=&tool=&outcome=&kind=&cursor=&limit=
```

The tenant's conversations, newest activity first, each with `person` and `person_username`, `profile`, `mode`, `turns`, `steps`, `tokens`
by slot (`fast`, `standard`, `deep`), `stop_reason` (how the latest turn ended), `tools` (the names it called, at most 20), `approvals`,
`reported_at` and `report_old` (reported more than 180 days ago). It is metadata, and a holder of the capability always gets it: the list
holds no conversation text and is not narrowed by the tenant's **Let auditors read conversation text** setting, except for `title`, which is text: a placeholder while the setting is off, and, while it is on, a list that returns a title of someone else's conversation is recorded once as `assistant.text_read` with part `list`. `person` and `conversation` narrow by
owner and id. `tool`, `outcome` and `kind` (`approval`, `budget_refusal` or `tool_error`) look inside each conversation, at no more than
1,000 conversations a request, so a page they do not fill is returned short, even empty, with `next`, and the `Link` header names the
next page. `limit` is at most 200, and an unknown parameter or a value outside its range is refused `400`.

## The replay

```text
GET /admin/tenants/{tenant}/assistant/activity/conversations/{id}
```

The conversation's latest 25 turns, oldest first, each with its steps, its events as the trace recorded them, `why_model` (the model
choices the server recorded) and `why_stopped` (what the stop reason meant for this turn), then `approvals` with where each stands, and `asked`,
what the person sent. `text_visible` says whether the text is in the answer. While the setting is off, every event keeps its kind, its
tool name and its timing, and its words are `[text not visible to auditors in this tenant]` beside a `bytes` count. While it is on the
text is there, masked as the trace masked it, and the read by someone other than the conversation's owner is recorded as
`assistant.text_read`, in the transaction of the read, with the reader, the conversation, its owner and `replay`, and no text. A
conversation that is not this tenant's, or does not exist, is `404`, and so is a malformed id.

## The export

```text
GET /admin/tenants/{tenant}/assistant/activity/conversations/{id}/promptfoo
```

The conversation as one promptfoo test case, with `content-disposition: attachment`. `vars` holds the profile, the mode, the first message
as `prompt` and every message as `messages`; `assert` is empty; `metadata.observed` holds the tools called with their inputs, the
answers and each turn's stop reason, and `metadata.contains` and `metadata.excludes` say in words what is in the file and what is left out
(the system prompt, what the tools returned, reasoning and any key). The text follows the same setting as the replay, and a read that
returns it is recorded as `assistant.text_read` with `export`.

## The report

```text
POST /admin/tenants/{tenant}/assistant/conversations/{id}/report
```

Keeps the conversation, with its trace, past retention. It answers `reported_at`, `reported_count` and `near_limit` (true from 80). The person it
belongs to may report it, and so may a holder of `read-assistant-activity`; anyone else is `404`. A conversation that is already reported
answers the same time and writes nothing. A tenant keeps at most 100: the next is refused `409`. A report that takes effect is recorded
as `assistant.report`. Nothing removes a reported conversation, and nothing here un-reports one.
