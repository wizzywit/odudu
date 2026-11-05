---
title: Custom domains
description: Give a tenant a public address of its own, such as login.acme.com, behind your reverse proxy, and learn what switching to it and back costs.
---

# Custom domains

By default every tenant is reached under your server's one address, as `/tenants/<name>`. You will give a tenant an address of its own instead, `login.acme.com`, with its sign-in pages, its issuer, its cookies and the links in its mail all following it. A tenant that does nothing about this behaves exactly as it did before, and a tenant that moves to a domain can return to the default at any moment, including after it has lost the domain.

Odudu does not issue certificates. Your reverse proxy does, and asks Odudu whether a host is one it should answer for. Read [Deploying](./deploying.md) first: this page assumes a server behind TLS with `ODUDU_PUBLIC_BASE_URL` set.

## The one idea: a canonical address

A tenant has exactly one **canonical address**, either its path address (`https://id.example.com/tenants/acme`, the default) or one verified domain (`https://login.acme.com`, with the same routes at the root). Four things follow it: the `iss` that tokens carry, the host passkeys are tied to, the cookies, and every link Odudu writes, mail included.

A tenant can register up to twenty domains and have one of them as its address. The others are idle: they serve nothing and your proxy is told not to get a certificate for them. The one exception is a domain the tenant has just left, which keeps answering for an hour ([what a switch costs](#what-a-switch-costs)). Registering a host claims nothing, and several tenants may register the same one. The first to prove it owns it keeps it.

The console itself stays on your base address, and the admin API is reached there too. A tenant on a domain signs its administrators in through its domain, so the admin plane follows the tenant's address, and switching a tenant back still needs nothing from the domain. The system tenant cannot have a domain and is unaffected.

## 1. Point the commands at your server

A server upgraded from a version before domains has tenants without the `view-domains` and `manage-domains` roles, so run `odudu console provision` once, as [Upgrading](./upgrading.md) says, before anyone manages a domain. A tenant made after the upgrade has them. A fresh quick start needs nothing.

The commands on this page run against the stack from the [quick start](../quick-start/index.mdx), in the folder that holds `compose.yaml`. They read the server's address from one variable. If you moved the port, use that address instead of 3000.

```sh {run}
export ODUDU_BASE="${ODUDU_BASE:-http://localhost:3000}"
```

Make a tenant to move, so nothing the other guides use is touched:

```sh {run expect="acme"}
docker compose exec odudu odudu seed tenant --name acme
```

## 2. Register a domain and prove you own it

In the console this is the **Domains** area ([Domains in the console](../admin-console/domains.mdx)), and through the API it is `POST /admin/tenants/acme/domains` with `{"host": "login.acme.com"}`. The answer holds a record to publish at your DNS provider:

| Record type | Name                              | Value                                   |
| ----------- | --------------------------------- | --------------------------------------- |
| `TXT`       | `_odudu-challenge.login.acme.com` | `odudu-domain-verification=<the token>` |

Once the record resolves, `POST /admin/tenants/acme/domains/<id>/verify` marks the domain verified. A tenant may ask for a lookup at most once every 30 seconds for a host and ten times a minute in all, and a refused try says to wait. A host another tenant verified first cannot be verified.

Odudu looks the record up again on a schedule, for every verified domain. A domain whose record is gone for three passes in a row fails, and a tenant that has it as its address falls back to its path address. That is how a domain you let expire, and somebody else bought, stops serving your tenant's sign-in. A resolver that is down counts as nothing, so an outage does not fail every domain. A failed domain verifies again once its record is seen.

To try the rest of this page without a DNS record, `odudu seed domain` registers a host and, with `--assume-verified`, marks it verified at once. It refuses to run in production, because it skips the proof.

```sh {run expect="verified"}
docker compose exec odudu odudu seed domain --tenant acme --host login.acme-corp.dev --assume-verified
```

A verified domain that is not the tenant's address, and was not in the last hour, is idle, and your proxy's question about it is answered no:

```sh {run expect="404"}
curl -sS -o /dev/null -w '%{http_code}\n' "$ODUDU_BASE/internal/domain-check?domain=login.acme-corp.dev"
```

## 3. Put the domain behind your proxy

Point the host's DNS at your proxy. The proxy ends TLS, and it gets the certificate on the first request for a host. That needs Odudu's answer to one question, `GET /internal/domain-check?domain=<host>`: `200` with no body for a host Odudu serves, `404` with no body for every other. It takes no secret and tells a caller nothing but whether the host is served, which certificate transparency logs and DNS already show.

**Keep `/internal` off the public network.** Call it from the proxy by the server's internal name, and make the proxy refuse the path on every public listener. A public caller could otherwise ask it about any name. It is limited to 300 questions a minute from one address, and a proxy asks from a single address, so a flood of handshakes for names nobody registered through the proxy spends the whole budget: new certificates then wait, and are tried again, until the minute passes. Certificates already issued are unaffected.

An illustration for Caddy. It is a sketch to adapt, and no job here runs a real Caddy against real DNS:

```text
{
	on_demand_tls {
		ask http://odudu:3000/internal/domain-check
	}
}

https:// {
	tls {
		on_demand
	}
	handle /internal/* {
		respond 404
	}
	reverse_proxy odudu:3000
}
```

Odudu reads the host a request arrived for from the `Host` header, which Caddy passes through unchanged. If your proxy rewrites it, set `ODUDU_TRUST_PROXY=true` and have it set `X-Forwarded-Host`: Odudu then reads the last entry, the one your proxy wrote, and never one a client could have sent. With trust off, `X-Forwarded-Host` is ignored.

Three kinds of host are told apart. A host with no verified row, whether nobody registered it or it is only pending or failed, is routed as before, which at the root reaches nothing. A verified host that is not the tenant's address answers a bare `404` on every path. The address of a tenant is served at the root, and only its own tenant's routes, so `/tenants/<name>` on a domain is refused, and so are `/admin`, `/console` and `/docs`.

## 4. Switch the tenant to it

In the console, choose **Make the address** on the domain's row, or `POST /admin/tenants/acme/domains/<id>/activate` with the tenant's current `ETag` in `If-Match`. Here the same thing is done from the command line, which is how a seeded domain is made the address:

```sh {run expect="canonical"}
docker compose exec odudu odudu seed domain --tenant acme --host login.acme-corp.dev --assume-verified --canonical | grep -o '"canonical":true'
```

The proxy's question is now answered yes, and discovery at the domain names the domain as the issuer. The scheme is `https` whenever `ODUDU_TLS` is true, which production requires:

```sh {run expect="login.acme-corp.dev/protocol/openid-connect/auth"}
curl -fsS -H "Host: login.acme-corp.dev" "$ODUDU_BASE/.well-known/openid-configuration"
```

```sh {run expect="200"}
curl -sS -o /dev/null -w '%{http_code}\n' "$ODUDU_BASE/internal/domain-check?domain=login.acme-corp.dev"
```

The old address no longer signs anybody in. It answers with a page that points to the new one:

```sh {run expect="410"}
curl -sS -o /dev/null -w '%{http_code}\n' "$ODUDU_BASE/tenants/acme/protocol/openid-connect/auth?response_type=code"
```

## What a switch costs

A switch is one change, and it is worth reading this list before you make it, because some of it cannot be undone.

- **Everyone signs in again.** A session cookie belongs to one host, so people sign in again at the new address. Sessions at the address left are not ended, and they resume if the tenant switches back, until their own limits. A person's refresh tokens are bound to the tenant, not an address, and keep working: the app uses them at the new address.
- **There are two addresses for an hour.** One hour is the longest an access token lives. For that long the old address still serves the token, userinfo, introspection, revocation, key and logout endpoints and discovery, so what was issued keeps working, and a token minted there carries the old issuer. It refuses sign-in, registration and password-reset pages and points to the new address. When the hour ends it serves nothing for the tenant. A second switch inside the hour leaves both previous addresses valid until their own times.
- **A resource server must accept both issuers for that hour.** An API that checks a token's `iss` against one string rejects tokens minted at the other. Odudu's own `/userinfo` and `/introspect` accept both. Each app also has to move to the new issuer: its discovery URL, and the issuer it checks, are the new address. It has an hour to do it. A token minted at the address left late in that hour carries the old issuer, so a resource server that then stops accepting it refuses the token before its own expiry.
- **Passkeys are hidden, not lost.** A passkey belongs to the host it was registered at. At the new address Odudu offers only passkeys registered there, so the ones from the old address are not offered, and a switch back brings them back. Nothing is deleted. The console counts the people it affects before you switch.
- **Administrators sign in through the domain.** A tenant's administrators open the console on your base address as before, and the console sends them to the tenant's domain to sign in; they come back to the console on the base address. A token for the admin API is accepted while its issuer is the tenant's current address or one it left in the last hour. A machine client of the admin API must fetch its tokens from the tenant's canonical token endpoint, and tokens it got from the address left stop working when the hour ends. A console session opened before the switch carries on: no access token lives longer than the hour, so the console refreshes its token at the new address before the old one runs out, and nobody is signed out.
- **A client's redirect URIs, web origins and logout addresses do not change.** They name the app, not Odudu. `odudu seed client` and the console leave them as they are.
- **Mail follows the new address.** A link already in somebody's inbox still names the address it was written for, and for a reset link that address refuses the page.
- **Brand images move with the address**, since they are served from it.

### A person with only passkeys

Password sign-in is not affected by a switch, so a person with a password signs in at the new address as before. A person whose way in was a passkey registered at the old address, and who has no password, is not offered it at the new one. Recovery codes do not help: a code stands in for an authenticator-app code and nothing else. They can get back in three ways:

- You switch the tenant back, which needs nothing from the domain.
- They ask for a password reset, if reset is switched on for the tenant and mail works, or an administrator issues them a one-time password. Either gives them a password.
- They register a new passkey at the new address once they are signed in.

A tenant whose sign-in flow has no password step at all has only the first way. Check this before you switch such a tenant.

## 5. Switch back

Choose **Switch back** in the console, or `POST /admin/tenants/acme/domains/<id>/deactivate`. It works whatever state the domain is in, and it makes no call to the domain. Everything above applies in the other direction: people sign in again, administrators sign in at the path address, the address you leave serves its token endpoints for an hour and tokens issued at the domain keep working on the admin API for that hour, and the passkeys hidden at the domain come back. The domain stays registered. You can [remove it](../reference/transcripts/admin-paths/get-domains-post-domains-and-the-domain-routes.md) only while it is not the address.

## Settings

| Variable                                 | Default  | What it does                                                             |
| ---------------------------------------- | -------- | ------------------------------------------------------------------------ |
| `ODUDU_DOMAIN_RECHECK_ENABLED`           | `true`   | Whether the server rechecks the ownership of verified domains itself     |
| `ODUDU_DOMAIN_RECHECK_INTERVAL_SECONDS`  | `3600`   | Seconds between rechecks                                                 |
| `ODUDU_DOMAIN_RECHECK_FAILURES`          | `3`      | Consecutive misses before a domain fails                                 |
| `ODUDU_RETENTION_PENDING_DOMAIN_SECONDS` | `604800` | How long a registered domain that was never verified is kept: seven days |

To schedule the recheck yourself, set `ODUDU_DOMAIN_RECHECK_ENABLED=false` and run `odudu domains recheck` from cron. The full list is in [the configuration reference](../reference/generated/configuration.md).

## What this does not do

- It does not issue or renew certificates. That is the proxy's work.
- It does not serve the console or the admin API at a tenant's domain: they stay on the base address, and a tenant's administrators sign in through the domain to reach them.
- It does not run more than one domain as a tenant's address at once, and it does not share passkeys between addresses.
- It does not move a tenant's export or import: a tenant's domains are left out of an export, so a host can only be claimed by proving it.
- The limits on verification lookups are per process. With more than one instance the budget is per instance ([Scaling](./scaling.md)).

[ADR 0049](https://github.com/wizzywit/odudu/blob/main/docs/adr/0049-a-tenant-has-one-canonical-address.md) has the reasoning and the alternatives that were rejected.
