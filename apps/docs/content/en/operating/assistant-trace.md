---
title: The assistant's trace
description: What the console assistant records of each turn beyond the audit trail, what it masks or never stores, how it is bounded, and what happens when it cannot be written.
---

# The assistant's trace

The console assistant leaves two records. The [audit trail](../concepts/consent-and-audit.mdx) says that a turn happened and what it cost, and holds no message text. The trace says why: what the model was given and answered, which tools it called with what, what they returned, and the choices the server made around each model call. This page is for the person who runs the server and answers for what that record holds.

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

A tool's result can carry a one-time secret or key material: the `client_secret` that creating or rotating a client returns, a registration token, the private part of a key. The trace is built not to hold one, in a tool result, in the input the model gave a tool, in the model's own words or in an error message, and each of those is tested. Masking works from names and shapes, so it is a strong filter and not a proof: a secret that has neither (a short value under an unlisted name, a secret a person types and the model repeats) can be stored. Before an event is stored:

- A character PostgreSQL refuses in text (NUL, or half of a surrogate pair) is replaced by U+FFFD, so one odd character in an answer cannot fail the write of a whole step.
- A member whose name holds a secret is replaced by `[masked]` whatever it holds. The name is read as snake case, and a member is a secret when any word of it is `secret`, `password`, `token`, `credential`, `cookie`, `authorization` and the like (`clientSecret`, `new_password`, `session_token`), or when it ends in `key` or `hash` after another word (`signing_key`, `etag_hash`); `public_key` and a bare `key` are not. The private members (`d`, `p`, `q`, `dp`, `dq`, `qi`, `k`) of a key that has a `kty` are masked too. This holds inside text that is JSON, which is how a tool's result reaches the recorder.
- The value of such a name in an error message or a header (`client_secret=...`, `Authorization: Bearer ...`) is replaced the same way; a `Bearer` or `Basic` scheme takes its credential with it.
- A bearer token, a JWT, a PEM private key, a password hash (`$argon2...`, `$2b$...`) and a run of base64url characters that looks issued, 40 or more with a letter and a digit, or 32 or more with both cases and a digit, are replaced wherever they appear. A hex digest is not.
- A value the recorder masked under a secret member, if it is 12 characters or longer, is remembered for the rest of the turn (at most 64 values) and masked wherever it turns up in what a tool returned or the model wrote, so a secret the model read and then repeated is not kept either. The recorder never learns a value from prose such as `password: word`, and the choices the server records itself (the slot, a reservation, the policy outcome) are masked by name and shape only, so text a tool returned cannot rewrite them.
- With a tenant's **Mask email addresses** on, an address in anything the trace keeps is reduced to its first letter, three asterisks and its domain, the same as in what the model was sent.

A long token that is not a secret, such as a key's thumbprint, is masked too.

## How much it keeps

An event's content is cut at 8 KiB once serialised; a cut event holds `truncated: true`, its original size and a preview. A turn keeps its first 499 events and at most 128 KiB of content, and a last event says how many were left out. The tables refuse more than 16 KiB for an event and more than 500 events for a turn, so a fault in the recorder cannot grow a turn without bound.

On disk, a turn of three events of 1.5 KB each, with its steps and indexes, took about 6 KB in a measurement on PostgreSQL (the test `trace.int.test.ts`), so an event costs a little over its content. These are estimates built from that, not measurements of a deployment. A typical turn of 20 events averaging 1.5 KB is about 35 KB, and a turn at the 128 KiB cap about 140 KB. A tenant that runs 500 turns a day and keeps 30 days holds 15,000 turns: about 0.5 GB typically and no more than about 2.1 GB. For 10,000 tenants at that rate, about 5 TB typically and 21 TB at the cap; the tenant's token limits, not the trace, bound how many turns that is. The caps were halved from 256 KiB for this reason, and **Keep traces for** is the lever that scales the rest. Reads through the indexes (a conversation's turns, the oldest turns past a cutoff, each cascade lookup) were measured with EXPLAIN over 50,000 turns and 120,000 events, 46 percent of them older than 30 days.

## When it cannot be written

The trace is written in short transactions at the start and end of each model call, never while one is running. A write that fails is logged as `assistant.trace_failed`, the recorder stops writing for that turn, and the turn goes on: the person's answer does not wait on the trace. The `ended` event of the turn's `assistant.turn` audit record then carries `trace_lost: true`, so a turn whose trace stops short can be found. It is `false` otherwise. Each write also has a deadline of two seconds, because the model's loop waits for it: a write that takes longer is given up the same way. When the trace stops, the turn's row is closed once, best effort, so a turn with `trace_lost: true` normally has an end time and a stop reason but fewer events than it should. A turn whose row has no end time at all means the server died or the database could not be reached even to close it.

## Who can read it

Nothing reads the trace yet, not the model, not the console and not an API. The assistant has no tool that reads these tables, and the audit trail and the trace are not among the things it can see. The route that lists conversations and replays a turn will need the `read-assistant-activity` capability, which a tenant restricts with **Auditors can read conversations**.

## Retention

A tenant's **Keep traces for** setting (`assistant_trace_retention_days`, 30 days by default) is stored, but nothing yet removes trace rows when they pass it. They go when their conversation does: deleting a person deletes their conversations, and with them every turn, step and event. The pass that applies the setting is not yet in place, so until it is, the trace of a conversation stays as long as the conversation.

## OpenTelemetry

The server writes no OpenTelemetry output yet. When it does, content will be off by default. An operator's own exporter can be given to a turn beside the recorder, and a turn's integrations replace any registered globally, so one registered globally receives nothing from the assistant.
