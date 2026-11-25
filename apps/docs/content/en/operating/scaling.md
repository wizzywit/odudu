---
title: Scaling
description: Why Odudu runs as one instance today, what that costs and where more are planned.
---

# Scaling

You will decide how big to make the one server Odudu runs as, and what to do when it is not enough. Run one instance. More than one is not supported yet, and the reasons are specific, so you can judge them for yourself.

## Why one instance

- **Migrations run at start, in every process, with no lock.** Two servers starting at once would race to change the same database.
- **The throttles count in one process's memory.** The per-origin, sign-in and client-secret limits are windows held by the process that served the request, so each of two instances would allow the full budget and a caller could spend both. The MCP endpoint's request limits (60 a minute for a person and client, 120 for a person across clients, 600 for a tenant, four at once for a person and client), the registration budget under the `mcp` policy and the limit on fetching client metadata documents work the same way.

[The roadmap](../roadmap.md#later) plans replicas, a migration lock and limits shared between instances under many instances and performance. It also plans a metrics endpoint and a deadline on the two outbound lookups that `/token` and `/userinfo` make. Nothing in the product today depends on them.

## What to do meanwhile

1. **Make the one instance bigger, not more.** Give it more CPU first. Password hashing is the expensive step of a sign-in, and it runs in the server.
2. **Watch the database.** Every request reads and writes Postgres, and every tenant shares it. Size it as you would any busy transactional database, and keep it close to the server.
3. **Keep the schedules on.** Retention keeps the tables that grow with every sign-in from growing without bound ([Deploying](./deploying.md), step 7).
4. **Restart fast.** One container means a restart is an outage. A restart takes as long as the migrations and the boot, so keep the image pulled and the health check watched.

## When two revokes meet

Ending a grant, a session, a client, a subject or an agent run takes its row locks in one fixed order, so two of them over the same chain of grants wait for each other and neither fails. Four narrow cases can still deadlock, and PostgreSQL then ends one of the two transactions with the error `40P01`. Its changes roll back and nothing is half done, and the server runs it again from the start, up to three attempts in all, after a short random pause. The caller sees the second attempt's answer and never the first's failure. Only a transaction that loses three times in a row is answered `500 Internal Server Error`, with the code `40P01` beside the failed request in the server's log. The same retry covers a lock the server gave up waiting for because the chain of grants kept changing under it. The cases are a run started after a revoke's first scan of the chain, a chain deeper than the scan's frontier, a revoke of everything a session, subject, client or actor holds that meets a grant created for it a moment after the revoke chose its targets, and a change to a service account that meets an exchange for the same client within a few milliseconds.

## How big it is meant to get

Odudu is designed for a tenant with a million people and ten thousand clients, for ten thousand tenants, and for a hundred million audit events. Every list endpoint is bounded and served by an index. [The roadmap](../roadmap.md#later) plans the load and latency numbers that prove it, and read replicas. Until then, measure your own before you rely on the design figure.
