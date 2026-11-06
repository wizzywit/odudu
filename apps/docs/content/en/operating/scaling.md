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

## How big it is meant to get

Odudu is designed for a tenant with a million people and ten thousand clients, for ten thousand tenants, and for a hundred million audit events. Every list endpoint is bounded and served by an index. [The roadmap](../roadmap.md#later) plans the load and latency numbers that prove it, and read replicas. Until then, measure your own before you rely on the design figure.
