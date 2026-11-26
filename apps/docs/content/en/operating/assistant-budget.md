---
title: The assistant's token budget
description: How the console assistant counts the tokens it spends, what happens to a call that was cut off, and what odudu reap does about it.
---

# The assistant's token budget

The console assistant is metered in tokens, by model slot, never in money. This page is for the person who runs the server: it says what is counted, what happens when a process dies in the middle of a model call, and what the retention pass does about the bookkeeping. What a tenant administrator sets is on [Settings in the console](../admin-console/settings.mdx#console-assistant).

## What is counted

Four levels count each model call, and a call is made only if every one of them has room:

| Level          | Counts                                    | Limit                                             |
| -------------- | ----------------------------------------- | ------------------------------------------------- |
| `tenant_month` | the tenant, for one model slot, per month | the tenant's `assistant_monthly_tokens_*` setting |
| `admin_day`    | one administrator, one slot, per UTC day  | a quarter of the tenant's month for that slot     |
| `conversation` | one conversation, per UTC month           | 2,000,000 tokens                                  |
| `turn`         | one answer                                | 1,000,000 tokens                                  |

The last two are built into Odudu and have no setting. A month and a day are UTC.

## Reserve, then settle

Before a call the loop reserves what it could cost: one token for every byte of the messages, which no tokenizer exceeds; the instructions and tool definitions, which are the same on every call, at one token for every 1.9 bytes, which is the 2.38 bytes a token that Bedrock counted on them less 20 percent ([the measurement](https://github.com/wizzywit/odudu/blob/main/docs/phases/p5c-spikes.md#bytes-per-token-of-the-fixed-part-of-a-request)); and 8,192 tokens for the answer. From the second call of an answer on, the reservation is never less than the input the provider reported for the previous call, plus the bytes of the messages added since and the answer's 8,192 tokens. A request is kept under 150,000 bytes (counted at one token a byte) by compacting the conversation first: the oldest exchanges go, then the output of earlier tool calls, and the newest tool result is cut to a prefix that fits, with a note saying so. One tool result is cut at 60,000 characters before the model sees it. With the current tool set a reservation is about 37,000 tokens at the least and at most about 132,000. The reservation is taken at all four levels in one step, in the same order every time, so two calls made together cannot both take the last of a limit; a call can still overshoot by one call, as the next paragraph says.

When the call ends, the provider's own count replaces the reservation. If a provider reports more than was reserved, the actual is charged and the difference is recorded in an `assistant.budget` audit event with `outcome` `allowed`; the next reservation then refuses, so one call can overshoot and a second cannot.

The count is the provider's, and it is trusted only when it is not empty: a call that reports no usage, or only zeros, is charged its whole reservation. A self-hosted server that does not report usage (an OpenAI-compatible one without `includeUsage`) therefore makes the meter an estimate, always at the reserved size and never free. A call that ends in an error or is aborted reports no count. If it reached the provider it is settled at its full reservation, because what it cost is unknown; if it never did, it is settled at nothing.

A level that has no room ends the answer. The person is told which limit was reached and who can change it, the audit trail gets an `assistant.budget` event with `outcome` `refused`, and the assistant does not move to a cheaper model. A monthly allowance below about 150,000 tokens refuses every call, because a quarter of it is less than the smallest reservation, and one below about 530,000 can refuse some, because a quarter of it is less than the largest.

## When a process dies mid-call

A reservation is written before the call is made and marked sent just before the request leaves, so a process that dies in between leaves a reservation behind that says which of the two it was. Nothing is lost by the death: the reserved tokens are already counted at every level.

`odudu reap` does the rest, after its retention deletes have committed, in every tenant and each in a transaction of its own, for reservations left open more than fifteen minutes. A tenant whose upkeep fails (it waits at most two seconds for a row a live call holds) is logged as `assistant_upkeep_failed` and the next tenant goes on; no retention delete is undone by it:

- A reservation whose call **was sent** is settled and stays counted in full. How much the provider charged is not known, so Odudu assumes all of it, and repeated crashes cannot spend past a limit.
- A reservation whose call **was not sent** is settled and its tokens are given back at every level.

At most 200 reservations are resolved in one round; the pass takes rounds while a round comes back full, up to ten for a tenant, and the next pass takes the rest.

## What else the pass deletes

Per tenant, a bounded batch of each at a time, found through an index so a pass costs the batch and not the table:

- Counters of the turn and administrator-day levels whose window began more than two days ago, and of the tenant-month and conversation levels more than 62 days ago. A counter this old would start over at its next use anyway.
- Settled reservations older than seven days.
- Answer places (leases) that lapsed more than a day ago.

An answer in progress holds a lease in the database so a tenant's **Answers at once** limit counts every server. A lease lapses sixty seconds after the answer's own five-minute deadline, six minutes after it began, if nothing released it, so a server that died gives its place back without anyone's help.

## Changes in Act mode

An approved change is a write, so it is counted in the write allowance of the console sign-in it was approved from (`agent_writes_per_grant`, 20 by default, shared with every agent's writes under that sign-in): after that many the person signs in again. It does not count the administrator's own edits in the console. Pending changes are capped at five for a conversation and ten for a person, apart from the 20 pending approvals the tenant allows across the assistant and CIBA. A provider that gives its tool calls small ids it reuses from one answer to the next, such as `call_0`, makes Act mode unusable, because a proposal cannot be told from an earlier one; the assistant refuses the proposal and stays safe, and Ask mode is unaffected. The assistant signs each pending approval with a key derived from `ODUDU_KEK`, so there is nothing more to configure, and a server with an empty `ODUDU_KEK` will not start.

## Running it

The pass is part of `odudu reap`, which the server also runs on its own timer unless `ODUDU_REAP_ENABLED` is `false`; see [Deploying](./deploying.md). Its report gains an `assistant` object on a pass where it did something, and none otherwise:

```text
{"ran":true,"deleted":{ … },"cleared":{ … },"assistant":{"reservationsReleased":0,"reservationsCharged":1,"reservationsDeleted":0,"countersDeleted":0,"leasesDeleted":0,"writeGrantsRevoked":0,"failed":0}}
```

That example is illustrative: it is not the output of a run against a live stack. `failed` counts the tenants whose upkeep failed. A command run with `odudu reap` exits 1 when it is more than zero, so a cron job or Kubernetes Job shows it, while the retention deletes of that pass stand. The server's own timer logs each failure and runs the next pass on schedule.
