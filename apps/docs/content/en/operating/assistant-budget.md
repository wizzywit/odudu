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

Before a call the loop reserves the most it could cost: one token for every byte of the whole request (the instructions, the tool definitions and the messages), which no tokenizer exceeds, plus 8,192 tokens for the answer. A request is kept under 150,000 bytes by compacting the conversation first, so a reservation is at most about 170,000 tokens. The reservation is taken at all four levels in one step, in the same order every time, so calls made together can never spend past a limit.

When the call ends, the provider's own count replaces the reservation. If a provider reports more than was reserved, the actual is charged and the difference is recorded in an `assistant.budget` audit event with `outcome` `allowed`; the next reservation then refuses, so one call can overshoot and a second cannot.

A call that ends in an error or is aborted reports no count. If it reached the provider it is settled at its full reservation, because what it cost is unknown; if it never did, it is settled at nothing.

A level that has no room ends the answer. The person is told which limit was reached and who can change it, the audit trail gets an `assistant.budget` event with `outcome` `refused`, and the assistant does not move to a cheaper model. A monthly allowance below about 700,000 tokens can refuse every call, because a quarter of it is less than one reservation.

## When a process dies mid-call

A reservation is written before the call is made and marked sent just before the request leaves, so a process that dies in between leaves a reservation behind that says which of the two it was. Nothing is lost by the death: the reserved tokens are already counted at every level.

`odudu reap` does the rest, in every tenant, for reservations left open more than fifteen minutes:

- A reservation whose call **was sent** is settled and stays counted in full. How much the provider charged is not known, so Odudu assumes all of it, and repeated crashes cannot spend past a limit.
- A reservation whose call **was not sent** is settled and its tokens are given back at every level.

At most 200 reservations are resolved in one round; the pass takes rounds while a round comes back full, up to ten for a tenant, and the next pass takes the rest.

## What else the pass deletes

Per tenant, a bounded batch of each at a time, found through an index so a pass costs the batch and not the table:

- Counters of the turn and administrator-day levels whose window began more than two days ago, and of the tenant-month and conversation levels more than 62 days ago. A counter this old would start over at its next use anyway.
- Settled reservations older than seven days.
- Answer places (leases) that lapsed more than a day ago.

An answer in progress holds a lease in the database so a tenant's **Answers at once** limit counts every server. A lease lapses six minutes after the answer's own five-minute deadline if nothing released it, so a server that died gives its place back without anyone's help.

## Running it

The pass is part of `odudu reap`, which the server also runs on its own timer unless `ODUDU_REAP_ENABLED` is `false`; see [Deploying](./deploying.md). Its report gains an `assistant` object on a pass where it did something, and none otherwise:

```text
{"ran":true,"deleted":{ … },"cleared":{ … },"assistant":{"reservationsReleased":0,"reservationsCharged":1,"reservationsDeleted":0,"countersDeleted":0,"leasesDeleted":0}}
```

That example is illustrative: it is not the output of a run against a live stack. A pass that finds a failure logs it and the timer runs the next pass on schedule.
