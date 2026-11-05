---
title: Operating Odudu
description: Deploy, configure, upgrade, back up and scale a running installation.
---

# Operating Odudu

You have tried Odudu with the [quick start](../quick-start/index.mdx) and now want it running where other people can reach it. This section takes you there in the order you will need it: put a server up, set it up, keep it up to date, back it up and harden it.

Be clear about what you are taking on before you start. Odudu has had no outside security review ([Security](../security/index.md) says what has and has not been checked). It runs as one instance, and its backup and restore guidance is not yet proven by a full restore. Each page says where it stands, and the [roadmap](../roadmap.md) says when the gaps close.

## Before you start

You need these before the first page.

- **PostgreSQL 17**, which you operate. The compose files and the integration tests all run version 17.
- **Two database roles.** The owner role in `ODUDU_DATABASE_URL` runs the migrations. It must be able to `CREATE ROLE`, because the migrations create the `odudu_app` role and make the serving role a member of it. It must also be `SUPERUSER` or `BYPASSRLS`: every tenant table forces row-level security, and under a plain owner every request answers "unknown tenant". The serving role, a restricted login role, goes in `ODUDU_APP_DATABASE_URL`.
- **Variables.** `ODUDU_DATABASE_URL`, `ODUDU_APP_DATABASE_URL` and `ODUDU_KEK`, the key the server wraps its signing keys and stored tokens under. The console also needs `ODUDU_CONSOLE_CLIENT_KEY`, a private key, and `ODUDU_PUBLIC_BASE_URL`, the address people reach you at.
- **TLS in front.** The server speaks plain HTTP. With `NODE_ENV=production` it refuses to start until `ODUDU_TLS=true` says a proxy in front of it terminates TLS. Set `ODUDU_TRUST_PROXY=true` only behind a proxy that overwrites `X-Forwarded-*`.
- **A mail relay**, if people will register, verify an address or reset a password. Without one the server logs each message instead of sending it.

The quick start's compose file is for trying Odudu out and is not a deployment. Its database password is public and it serves plain http.

## The pages

1. [Deploying](./deploying.md) takes you from an empty Postgres to a server people sign in to.
2. [Production settings](./configuration.md) says which variables the server refuses to start without, and links the full list.
3. [Upgrading](./upgrading.md) moves a running server to a newer version.
4. [Backups](./backups.md) says what to copy and what is not yet proven.
5. [Scaling](./scaling.md) says why there is one instance and where more are placed.
6. [Hardening](./hardening.md) is the checklist of every guard the server starts under.
7. [Custom domains](./custom-domains.md) gives a tenant a public address of its own behind your proxy.
8. [Releasing](./releasing.md) is for the people who publish a version.
