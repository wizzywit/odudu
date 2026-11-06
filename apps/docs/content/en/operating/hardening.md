---
title: Hardening
description: A checklist of the guards the server starts under and the settings around them, to go through before real people sign in.
---

# Hardening

You will go through a checklist before real people use your server. Most of it is the server's own start-up guards, which refuse to boot rather than run unsafe, so a deployment that passes them has already avoided the commonest mistakes. The rest is what only you can do, because the server cannot see it.

Tick each item by checking the thing named, not by remembering that you did it.

## The guards, and what each checks

These are the checks the server makes when it starts. Each one stops it with a message that names the variable.

- [ ] **The serving role is configured.** `ODUDU_APP_DATABASE_URL` is set, so the owner's `ODUDU_DATABASE_URL` is for migrations only. The server refuses to start without it. What role it names is the first item under "Around the guards".
- [ ] **The encryption key is yours.** `ODUDU_KEK` is a key you generated, kept in your secret store and in your backups, and not the example from the repository, which the server refuses.
- [ ] **TLS ends in front.** `ODUDU_TLS=true`, with an https `ODUDU_PUBLIC_BASE_URL`, and a proxy really does end TLS. The server refuses the two disagreeing but cannot tell the rest. Check that `https://id.example.com/health/live` answers, and that plain http to the same host is refused or redirected.
- [ ] **Clients cannot point the server inward.** `ODUDU_ALLOW_PRIVATE_CLIENT_URLS` is unset. On, a client could make the server fetch a private address, which is server-side request forgery.
- [ ] **Passkeys have a home.** `ODUDU_PUBLIC_BASE_URL` is the https address people use, with no path. A passkey is bound to its host and is never offered again if that changes.
- [ ] **The console is set up consistently.** `ODUDU_CONSOLE_CLIENT_KEY` is set, and the base URL is https with `ODUDU_TLS=true`. Or `ODUDU_CONSOLE=false` and you run no console.

## Around the guards

These the server does not check when it starts, so only you can.

- [ ] **The serving role is restricted.** `ODUDU_APP_DATABASE_URL` names a role that is neither a superuser nor able to bypass row-level security, and is not the owner's. The server only refuses to start when the variable is missing. `odudu reap`, `odudu send-mail` and `odudu send-logouts` check the role and refuse a bad one, but a server started on the wrong role runs. Check: `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'odudu_svc';` shows two `f`. A boot check for this is planned under [operational readiness](../roadmap.md#later).
- [ ] **The proxy overwrites `X-Forwarded-*`.** Appending is not enough. See [Deploying](./deploying.md), step 5.
- [ ] **The proxy strips the client-certificate header and verifies the certificate**, if you use `tls_client_auth`.
- [ ] **Odudu has a host of its own**, served at the root, not under a path.
- [ ] **`ODUDU_PUBLIC_BASE_URL` is set if the MCP endpoint is used.** The endpoint, at `/tenants/<name>/mcp` or at `/mcp` on a tenant's own domain, answers only the hosts the instance states as its own, and, with no base address set, only a loopback `Host` and `Origin`, so a page that rebinds a name to your machine cannot reach it. Hosted clients such as claude.ai are called from Anthropic's servers and need a public `https` address, which is the base address.
- [ ] **The database is reachable only from the server and from you.** Odudu does not enforce this. Your network does.
- [ ] **Administrators are named people.** Sign in as the first administrator, change its password, and make an account for each person who administers. A person's password is never chosen in the console, so nobody else handles it.
- [ ] **Mail goes through a relay with STARTTLS**, so reset and verification links reach people.
- [ ] **The schedules are on**, or you schedule the commands yourself ([Deploying](./deploying.md), step 7).
- [ ] **Logs are read only by operators.** Request logs carry paths without query strings and never a credential. A failed request (500) logs the error's message and stack. A database error logs only its kind and code, since its message can hold values.
- [ ] **Backups exist, and you have restored one** into a scratch database ([Backups](./backups.md)).
- [ ] **You read [the threat model](../security/threat-model.md)** and know what is not covered.

## See a guard refuse

On the quick start's stack you can see a guard do its job. This starts a second copy of the server with the production check on and TLS off, which it refuses, and prints the exit status.

```sh {run expect="ODUDU_TLS must be true"}
docker compose run --rm --no-deps -e NODE_ENV=production -e ODUDU_TLS=false odudu || echo "exit status $?"
```

The server stops before it listens, which is what you want from a deployment that is missing something. Read its message to the end. Each one names the setting and says what to do.
