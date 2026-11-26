---
title: The assistant's trace
description: What the console assistant records of each turn beyond the audit trail, what it masks or never stores, how it is bounded, and what happens when it cannot be written.
---

# The assistant's trace

The console assistant leaves two records. The [audit trail](../concepts/consent-and-audit.mdx) says that a turn happened and what it cost, and holds no message text. The trace says why: what the model was given and answered, which tools it called with what, what they returned, and the choices the server made around each model call. This page is for the person who runs the server and answers for what that record holds, who can read it and how long it is kept.

## What a turn records

Three tables, scoped to the tenant like the rest of its data. A turn is one row in `assistant_turns`: the conversation, the profile, a SHA-256 hash of the system prompt, when it started and ended and why it stopped. Each model call is one row in `assistant_steps`: the slot, the provider and model id, the provider's own request id, the input and output tokens the provider reported, and when it started and ended. A step may name a parent step, which is how a run started by another run will nest. The events are in `assistant_events`, numbered in the order they happened:

| Event                                    | Holds                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `model_call`                             | the model, why the call finished, its tokens and how long it took                           |
| `text`                                   | what the model answered in that call                                                        |
| `tool_call`, `tool_result`, `tool_error` | the tool's name and call id, the input the model gave it, what it returned or how it failed |
| `error`                                  | the name and message of a failure or an abort                                               |
| `slot_chosen`                            | the slot, the profile that asked for it and the model that answers                          |
| `reservation`                            | the tokens held for a call, and the level that refused it, if one did                       |
| `narrowing`                              | the mode, and how many read and change tools the turn was offered                           |
| `policy`                                 | what the mode and the approval rules did with a proposed change: allowed, asked or refused  |
| `trimming`                               | how many messages compaction left out or cut to fit the request                             |
| `truncated`                              | how many events were left out of a turn that passed its bound                               |

Reads always run, so only a proposed change has a `policy` event.

## What is never stored

- The system prompt, only its hash. The same prompt gives the same hash, so two turns can be told to have run under one.
- The model provider's key, the headers of any request and the request itself. The recorder keeps named fields of the SDK's events and nothing else.
- The model's reasoning, if the provider returns any.
- The person's own message. It is in the conversation, which holds what was said, and not in the trace.

## What is masked before it is written

A tool's result can carry a one-time secret or key material: the `client_secret` that creating or rotating a client returns, a registration token, the private part of a key. The trace is built not to hold one, in a tool result, in the input the model gave a tool, in the model's own words or in an error message, and each of those is tested, including a seeded test of 2,000 secrets with quotes, backslashes, newlines and unicode in sixteen carriers (JSON, JSON inside JSON, headers, assignments, query strings, cookies, error text, each also cut off at a random point). Masking works from names and shapes, so it is a strong filter and not a proof: a secret that has neither (a short value under an unlisted name, a secret a person types and the model repeats) can be stored. Before an event is stored:

- A character PostgreSQL refuses in text (NUL, or half of a surrogate pair) is replaced by U+FFFD, so one odd character in an answer cannot fail the write of a whole step.
- Text that is or holds JSON is parsed and masked by member name, so quotes, escapes and nesting are read as JSON reads them, and written back compactly when something changed.
- Other text is scanned for `name: value`, `name=value` and header forms, including a quote after the name (a fragment of JSON), escaped quotes, and the same percent-encoded (`Authorization%3A%20Bearer%20...`, `access_token%3D...`). A `Bearer`, `Basic`, `Token` or `Negotiate` scheme (in any case) stays and its credential goes; a `Digest` header's parameters all go; in a `Cookie` or `Set-Cookie` header every value goes and every name stays. A value that is not quoted runs to the end of the line, however it is punctuated, so a password with a comma or a space in it is one value, and a YAML block scalar (`password: |`) takes the indented lines under it. A quoted value whose closing quote is followed by more word (`'it''s-tail'`) is masked to the end of the line. `=>` and `:=` separate a name and a value as `=` and `:` do.
- A value that is cut off, or a text too hostile to read within its budget, is masked to the end of the text, because what follows may be the rest of it.
- A bearer token, a JWT, a PEM private key, a password hash (`$argon2...`, `$2b$...`) and a run of base64url characters that looks issued, 40 or more with a letter and a digit, or 32 or more with both cases and a digit, are replaced wherever they appear. A hex digest is not. A long token that is not a secret, such as a key's thumbprint, is masked too.
- A value the recorder masked under a secret member, if it is 12 characters or longer, is remembered for the rest of the turn (at most 64 values) and masked wherever it turns up in what a tool returned or the model wrote, so a secret the model read and then repeated is not kept either. A remembered value is hidden as it was read, as JSON writes it, percent-encoded and in base64; upper-casing it or taking spaces out defeats that. The provider's keys, the secret that signs approvals and each token minted for the turn are kept in a set of their own, which junk cannot use up. The recorder never learns a value from prose such as `password: word`, and the choices the server records itself (the slot, a reservation, the policy outcome) are masked by name and shape only, so text a tool returned cannot rewrite them.
- The password in a URL or a connection string, whatever its scheme (`https://`, `postgres://`, `redis://`, `amqp://`, `mongodb+srv://`), is masked; the user and the host stay. So is the content of a tag that names a secret (`<password>...</password>`), the password of `curl -u user:password`, and the value of a flag that names one (`--password x`, `--client-secret=x`).
- When an object has a `name`, `key` or `header` member that names a secret, its `value` is masked (environment lists, header lists, HAR entries), and so is the second item of a two-item array whose first names a secret (`["Authorization", "Bearer ..."]`).
- Secrets in the name of a member are masked like those in its value. Past the first 500 members of an object or items of an array, the rest is replaced by a count.
- JSON nested deeper than 32 levels is not read: the text from there is masked whole. Nothing the masker meets can make it fail for the rest of the turn; if it ever throws on an input, that one event is stored as `unreadable` and the trace goes on.
- With a tenant's **Mask email addresses** on, an address in anything the trace keeps is reduced to its first letter, three asterisks and its domain, the same as in what the model was sent.

### Which names count

The name is read as snake case (`clientSecret`, `client-secret` and `Client_Secret` are one). A member is a secret when any word of its name is `secret`, `password`, `passwd`, `pwd`, `passphrase`, `token`, `credential`, `cookie`, `authorization`, `otp`, `assertion`, `sig` or `signature`, when it contains `api_key`, or when it ends in `key` or `hash` after another word (`signing_key`, `etag_hash`). The private members of a key that has a `kty` are masked too.

Not masked as member names: `auth`, `private`, `pin`, `code`, `sid`, `refresh`, `passkey`, a bare `key` and `public_key`, `session_id`, full-width or zero-width-split spellings, and any name in another language (`пароль`). A secret under such a name is caught only by its shape.

### Forms that are not masked

These stay as written unless the value has a shape the masker knows (a JWT, a long issued token, a PEM key):

- HTML and SQL: `<input name=password value=...>`, `<input type=password value=...>`, `INSERT ... (password) VALUES (...)`.
- Markup around a name: `**password**: x`.
- A cookie named in prose without a colon: `cookie odudu_session=abc`.
- A short flag other than `-u`: `-p secret`.
- A secret that is a bare AWS secret access key (the `/` is outside the run alphabet), a 64-character hex key with no name, a JWT with `=` padding, `bearer:token` with no space, double percent-encoding (`password%253D`), and a Slack webhook URL.
- A secret split over two events (the second half is not recognised alone), or cut off between a name and its value in separate members.
- A secret that the model upper-cases or edits before repeating.
- A JSON text that was changed is written back compactly, which changes whitespace and very large integers in it.

Masked although they hold no secret: `monkey_hash` and any other `..._hash` or `..._key`, `secret_question`, and a name made of a secret word and a word for something else, such as `token_expiry_note`. A name that ends in `type`, `count`, `endpoint`, `method`, `lifetime`, `ttl`, `expires`, `length`, `format`, `algorithm`, `policy`, `required`, `enabled`, `min`, `max`, `rotation`, `status`, `state`, `size`, `limit`, `age`, `at`, `days`, `seconds`, `hours` or `minutes` is kept (`token_type`, `token_count`, `password_policy`, `token_endpoint_auth_method`, `client_secret_expires_at`).

### What an attacker can do with the learning

A tool's result can contain a member named `token` or `secret` that a person chose (a user-defined attribute, say) holding a value of 12 characters or more. The recorder takes it for a secret: that value shows as `[masked]` wherever it appears in the turn's later tool calls, results and text (never in the server's own choice records). Junk of this kind, or one large `password_policy`-style object under a secret name, can use up the 64 values and 4,096 characters the recorder will learn, after which it stops learning real secrets from members; it still masks them by name and shape wherever they appear.

## How much it keeps

An event's content is cut at 8 KiB once serialised; a cut event holds `truncated: true`, its original size and a preview. A turn keeps its first 499 events and at most 128 KiB of content, and a last event says how many were left out. The tables refuse more than 16 KiB for an event and more than 500 events for a turn, so a fault in the recorder cannot grow a turn without bound.

On disk, a turn of three events of 1.5 KB each, with its steps and indexes, took about 6 KB in a measurement on PostgreSQL (the test `trace.int.test.ts`, the tables divided by the 40,000 turns that have events), so an event costs a little over its content. These are estimates built from that, not measurements of a deployment. A typical turn of 20 events averaging 1.5 KB is about 35 KB, and a turn at the 128 KiB cap about 140 KB. A tenant that runs 500 turns a day and keeps 30 days holds 15,000 turns: about 0.5 GB typically and no more than about 2.1 GB. For 10,000 tenants at that rate, about 5 TB typically and 21 TB at the cap; the tenant's token limits, not the trace, bound how many turns that is. The caps were halved from 256 KiB for this reason, and **Keep traces for** is the lever that scales the rest. Reads through the indexes (a conversation's turns, the oldest turns past a cutoff, each cascade lookup) were measured with EXPLAIN over 50,000 turns and 120,000 events, 46 percent of them older than 30 days.

## When it cannot be written

The trace is written in short transactions at the start and end of each model call, never while one is running. A write that fails is logged as `assistant.trace_failed`, the recorder stops writing for that turn, and the turn goes on: the person's answer does not wait on the trace. The `ended` event of the turn's `assistant.turn` audit record then carries `trace_lost: true`, so a turn whose trace stops short can be found. It is `false` otherwise. Each write also has a deadline of two seconds, because the model's loop waits for it: a write that takes longer is given up the same way. When the trace stops, the turn's row is closed once, best effort, so a turn with `trace_lost: true` normally has an end time and a stop reason but fewer events than it should. A turn or a step whose row has no end time means the server died, the database could not be reached even to close it, or a slow write was given up and then committed after the one retry the turn's end makes (the retry waits 300 ms). Such a row can stay open for good; to tell it from one that is running, compare its `started_at` with the clock.

## Who can read it

Not the model: the assistant has no tool that reads these tables, and the audit trail and the trace are not among the things it can see. A person always reads their own conversations, in full, through the conversation routes. Others read them through three admin routes that need `read-assistant-activity`, which `tenant-admin` carries. What they get depends on a tenant setting, **Let auditors read conversation text** (`assistant_auditor_visible`), which is **off by default**.

**Metadata, always.** A holder of the capability sees who used the assistant, the profile and mode, when a conversation started and was last active, its turns, steps and tokens by model slot, the tools it called by name, how each turn stopped and why, the changes it proposed and what was decided, whether it is reported, and, in a replay, the kind, time and size of every event. The list never hides a row because of the setting.

**Text, when the tenant allows it.** What the person asked, what the model answered, and what each tool was given and returned are shown only while the setting is on. While it is off the replay and the export give the same structure with the placeholder `[text not visible to auditors in this tenant]` where the words were, and the size of what was left out; `text_visible` says which. A tenant that saved a value before the default changed keeps it; a tenant that never did starts with the text hidden.

**Every read of text is recorded.** When a replay or an export returns text to someone other than the person the conversation belongs to, an `assistant.text_read` event is written in the same transaction as the read, naming the reader, the conversation, its owner and the part (`replay` or `export`), never the text. A read that is refused or returns no text leaves none. The event is an admin change, so a tenant's audit event types cannot drop it, and the owner is on its `resource` and `detail`, so the reads of a person's conversations can be listed for them with `GET /admin/tenants/{tenant}/audit?action=assistant.text_read`. Telling the person, in the console or by mail, is not done yet: it belongs to the increment that lists a person's own conversations, and until then the record is the only trace of a read.

No operator or system-tenant path reads a tenant's conversation text. A system administrator reaching a tenant's routes is a reader of that tenant like any other, bound by its setting and recorded the same way, and nothing in the server, the command line or the console reads a conversation outside those routes.

- `GET /admin/tenants/{tenant}/assistant/activity` lists the tenant's conversations, newest activity first. It filters by `person`, `conversation`, `tool`, `outcome` (how the latest turn ended) and `kind` (`approval`, `budget_refusal` or `tool_error`), and pages with a signed cursor at up to 200 a page. A filter that looks inside conversations (`tool`, `outcome`, `kind`) looks at no more than 1,000 conversations a request, so a page it does not fill is returned short, even empty, with `next` to carry on from. `report_old` marks a conversation reported more than 180 days ago.
- `GET /admin/tenants/{tenant}/assistant/activity/conversations/{id}` replays one: its latest 25 turns, oldest first, each with its steps, its events, why each model was chosen and why the turn stopped, the changes proposed with where each stands, and what the person asked.
- `GET /admin/tenants/{tenant}/assistant/activity/conversations/{id}/promptfoo` exports it as a [promptfoo](https://www.promptfoo.dev) test case, as a JSON download.

Tool inputs, tool results and the model's words in a replay are as the trace stored them, masked. What the person asked is not in the trace: it comes from the conversation, and is masked when it is read, with the same rules and, where the tenant masks email addresses, those as well. The export holds the person's messages, the tools the assistant called with their inputs, the answer text and why each turn stopped, and it says so in its `metadata.contains` and `metadata.excludes`: it leaves out the system prompt, what the tools returned, the model's reasoning and any key. It has no assertions; whoever files it writes them. The shape it holds to is the published schema of the route's response.

The same `404` that a path never served gets answers a deployment with no model configured, and a conversation that is not this tenant's. An AI agent's token is refused all three routes, and the assistant has no tool for them. A conversation is read in the tenant it belongs to.

### Reporting a conversation

`POST /admin/tenants/{tenant}/assistant/conversations/{id}/report` keeps a conversation, with its turns, steps, events and approval cards, past retention. The person it belongs to may report it, and so may someone holding `read-assistant-activity`, whatever the setting says, since reporting shows no text; anyone else gets `404`. Reporting one already reported answers the same `reported_at` and changes nothing. A tenant keeps at most 100 reported conversations, and a further one is refused with `409`, because a conversation kept for good is not weighed by the retention that bounds the rest. The response says `near_limit` from 80, and the list flags a conversation reported more than 180 days ago, so someone can see what has been kept; nothing removes one. The route does not un-report. A report that takes effect is audited as `assistant.report`; one that changes nothing is not.

## Retention

A tenant's **Keep traces for** setting (`assistant_trace_retention_days`, 1 to 365, 30 by default) is applied by `odudu reap`, which the server also runs on its own timer, so the trace is bounded the way the audit trail is. The pass runs after the retention deletes of every tenant have committed, in a transaction of its own for each tenant, and takes three things, each against the tenant's window counted back from the pass:

| What             | Removed when                                      | With it                                      |
| ---------------- | ------------------------------------------------- | -------------------------------------------- |
| A turn           | it started more than the window ago               | its steps and events                         |
| An approval card | it was made more than the window ago              | nothing; the approval keeps its own 30 days  |
| A conversation   | it has had no activity for longer than the window | its messages, turns, steps, events and cards |

A turn exactly the window old is kept and one a moment older goes. The window is at least a day, and an approval lives at most 15 minutes, so a card the pass removes was settled hours before. A conversation that has been reported, and everything under it, is never removed by these. Each kind goes in rounds of 1,000, at most ten rounds for a tenant in a pass, found through an index by age, so a tenant with a backlog costs a bounded amount and the next pass takes the rest; the pass waits two seconds at most for a row a live turn holds and leaves it to the next one.

A conversation idle for longer than the window is removed whole, and so is what the person said in it: a person's history in the console lasts as long as the window after they last used it. Report a conversation to keep it.

The report of `odudu reap` carries what the pass did under `assistant`, as `turnsDeleted`, `approvalCardsDeleted` and `conversationsDeleted` beside the budget upkeep's counts, and `failed` counts the tenants for which either half failed. The command exits `1` when it is more than zero, so a scheduled job shows it, while the other tenants and the other half of that tenant's work stand. Shortening the setting removes more on the next pass; lengthening it does not bring back what a pass has removed.

Deleting a person still deletes their conversations at once, and with them every turn, step and event.

## OpenTelemetry

The server writes no OpenTelemetry output yet. When it does, content will be off by default. An operator's own exporter can be given to a turn beside the recorder, and a turn's integrations replace any registered globally, so one registered globally receives nothing from the assistant.
