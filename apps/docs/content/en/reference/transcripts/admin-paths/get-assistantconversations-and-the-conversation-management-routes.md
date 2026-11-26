---
title: 'Assistant conversations: list, reopen, hide, export and delete'
description: 'How an administrator lists their own console assistant conversations, reopens the latest, hides one, exports one and deletes one with a tombstone.'
---

# Assistant conversations: list, reopen, hide, export and delete

This page covers `GET /assistant/conversations`, `GET /assistant/last-conversation`, `PUT /assistant/conversations/{id}/archived`, `DELETE /assistant/conversations/{id}`, `GET /assistant/conversations/{id}/export` and `GET /assistant/conversations/{id}/export/markdown`.

All six need `use-assistant`, which `tenant-admin` carries, and all six answer for the caller's own conversations and nobody else's: a conversation that is another administrator's is `404`, whatever other capability the caller holds, `read-assistant-activity` included. An AI agent's token is refused all six. They answer as a path that was never served (`404`) where the server has no model configured.

**This page has no captured output.** The routes are new, and the commands below were not run against a live stack: the output shown is described, not recorded, and the blocks are tagged `text` for that reason. The behavior is run by integration tests against a real database, which cover the routes, the audit rows, the tombstone, the foreign-tenant probes of every repository method and the query plans. A transcript from a running stack replaces this page's description when one is captured.

## The list

```text
GET /admin/tenants/{tenant}/assistant/conversations?archived=&cursor=&limit=
```

The caller's own conversations, newest activity first, each with `id`, `title`, `profile`, `mode`, `created_at`, `last_active_at`, `archived`, `archived_at`, `reported` and `target_tenant_id`. The `title` is made once, from the first thing the person asked: its first line, with email addresses, links, long numbers and anything the masker takes for a secret removed, cut at 60 characters. A conversation with nothing asked yet has `null`. `archived=true` lists the hidden conversations, and the default lists the rest. A page is one indexed read of at most `limit` rows, `limit` is at most 200, and `next` with the `Link` header carries on from where it ended. A cursor is signed, and is bound to the tenant, the list and the person it was issued for.

## Reopening the latest

```text
GET /admin/tenants/{tenant}/assistant/last-conversation
```

`{ "conversation": ... }` with the caller's most recently active conversation that is not hidden, its latest messages included, or `{ "conversation": null }` when there is none. `continuable` is `false` when the sign-in the conversation acts under has ended: the messages can be read, and a message sent to it is refused `409` (`about:blank#conversation-ended`) before any turn starts. The way to carry on is a new conversation.

## Hiding and bringing back

```text
PUT /admin/tenants/{tenant}/assistant/conversations/{id}/archived
{ "archived": true }
```

Answers `{ "archived": true, "archived_at": "..." }`, or `{ "archived": false, "archived_at": null }` for a conversation brought back. Nothing is removed: the conversation keeps its messages and its trace, retention still counts from its last message, and it can still be opened by its id. Hiding a hidden one answers the first time.

## Exporting

```text
GET /admin/tenants/{tenant}/assistant/conversations/{id}/export
GET /admin/tenants/{tenant}/assistant/conversations/{id}/export/markdown
```

The caller's own conversation as a download: its fields and its messages, oldest first and at most 500 (`truncated` says when there were more), each with `role`, `at`, `text` and, for an answer, the names of the tools it called. The text has secrets hidden, and email addresses too where the tenant masks them. A tool's input and result are not exported. The Markdown route gives the same content as a document. No other route exports a conversation: an auditor and an operator have none. Each export is audited as `assistant.conversation_exported`, in the transaction of the read, naming the conversation, the format and how many messages it carried, never the text.

## Deleting

```text
DELETE /admin/tenants/{tenant}/assistant/conversations/{id}
```

`204` with no body. The conversation's messages, its trace and its approval cards go at once, and the grant it acted under is ended. A tombstone stays in its place: the conversation's id, its owner, when it began and was last used, who deleted it and when, how many messages and turns it held, and a digest of its messages. The digest is an HMAC-SHA256 under a key derived from the deployment's key and the tenant, so it confirms a copy of the text to whoever holds the key and tells nobody else anything. An `assistant.conversation_deleted` row is written in the same transaction, with the same counts and digest and no text, and no existing audit row is touched: the person's `assistant.turn` and `assistant.approval` rows stay.

A conversation that is reported is refused `409` (`about:blank#conversation-reported`), and so is one with an answer running in it (`about:blank#conversation-busy`); a delete that cannot write its audit row deletes nothing. Deleting works while the tenant has the assistant switched off.
