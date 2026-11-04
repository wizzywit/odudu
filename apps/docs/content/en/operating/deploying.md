---
title: Deploying
description: Put Odudu on a server other people can reach, with its own Postgres, TLS in front and secrets you generated.
---

# Deploying

You will run the Odudu image against a PostgreSQL 17 you operate, behind a proxy that ends TLS, and sign in to the console as the first administrator. At the end the server answers on your own address over https, and you have checked that it refuses to start when a safety setting is wrong.

You need what [Before you start](./index.md#before-you-start) lists. The image is the thing you deploy. The compose file from the quick start is not, because its credentials are public and it serves plain http.

## 1. Get the image

The image is named `ghcr.io/wizzywit/odudu`, and runs on `linux/amd64` and `linux/arm64`. Each release has a tag with its full version, such as `0.1.0`, and a stable release also moves `0.1` and `latest`. Pin the full version in production, so a restart cannot change what you run. A release candidate has only its own tag, such as `0.1.0-rc.1`.

```text
docker pull ghcr.io/wizzywit/odudu:<version>
```

Versions and their changes are on [the releases page](https://github.com/wizzywit/odudu/releases). Every image is signed by the workflow that built it. Check the signature before you run an image you have not run before. You need cosign 3.0 or newer.

```text
cosign verify ghcr.io/wizzywit/odudu:<version> --certificate-identity-regexp '^https://github.com/wizzywit/odudu/.github/workflows/release.yml@refs/tags/v' --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

The image also carries a list of its contents and a record of how it was built. The maintainers' [release procedure](https://github.com/wizzywit/odudu/blob/main/RELEASING.md) has the commands to read them. The image runs as a non-root user and checks its own health against `/health/ready`.

## 2. Make the two database roles

Odudu uses two roles. The owner runs the migrations when the server starts. The serving role handles requests and is held to row-level security, which is what keeps one tenant's rows from another's.

On your PostgreSQL 17, as an administrator, create both and a database the owner owns. Choose your own passwords, without a quote in them. Run these once: creating a role that exists is an error.

```text
CREATE ROLE odudu_owner LOGIN CREATEROLE BYPASSRLS PASSWORD '<owner password>';
CREATE ROLE odudu_svc LOGIN PASSWORD '<serving password>';
CREATE DATABASE odudu OWNER odudu_owner;
```

`CREATEROLE` lets the migrations create the `odudu_app` role and make `odudu_svc` a member of it. `BYPASSRLS` is needed because the server resolves `{tenant}` from the path with the owner connection before it knows which tenant's rows to ask for. Under a plain owner that read returns nothing and every request answers "unknown tenant". A superuser works too, and is more than Odudu needs.

## 3. Make the secrets

Make the encryption key and the console's key once, and keep them where only the server's operator can read them.

```text
openssl rand -base64 32
```

That is `ODUDU_KEK`. It wraps every signing key and stored console token, so changing it later makes the stored keys unreadable, and it must be kept with your [backups](./backups.md). Do not use the example key from the repository: the server refuses it in production.

The console's key comes from the image itself:

```text
docker run --rm ghcr.io/wizzywit/odudu:<version> odudu console keygen
```

It prints a line to set as `ODUDU_CONSOLE_CLIENT_KEY`.

## 4. Start the server

Give the container these variables, from your own secret handling. Odudu reads its secrets from the environment, and does not yet read them from a secret store ([operational readiness on the roadmap](../roadmap.md#later)). The first block is what the server will not start without; [Production settings](./configuration.md) lists them all.

```text
NODE_ENV=production
ODUDU_DATABASE_URL=postgres://odudu_owner:<owner password>@<host>:5432/odudu
ODUDU_APP_DATABASE_URL=postgres://odudu_svc:<serving password>@<host>:5432/odudu
ODUDU_KEK=<the key from step 3>
ODUDU_CONSOLE_CLIENT_KEY=<the key from step 3>
ODUDU_PUBLIC_BASE_URL=https://id.example.com
ODUDU_TLS=true
ODUDU_TRUST_PROXY=true
```

`ODUDU_TLS=true` is what gives every cookie `Secure` and the `__Host-` prefix. Production refuses to start without it, and [Cookie names](./configuration.md#cookie-names) lists what each cookie becomes.

The image already sets `NODE_ENV=production`, so what you leave out is refused, not defaulted. The first start applies the migrations, which create the `odudu_app` role and every table, then listens on port 3000. Run one container (see [Scaling](./scaling.md)).

Check it is up from inside the container network:

```text
curl -fsS http://<container>:3000/health/ready
```

It answers `200` with `{"status":"ok","checks":{"database":"ok"}}` while the database answers, and `503` when it does not.

## 5. Put TLS in front

The server speaks plain http and never ends TLS itself. Put a reverse proxy in front that terminates TLS for the address in `ODUDU_PUBLIC_BASE_URL` and forwards to port 3000. Four things about that proxy matter.

**Serve Odudu at the root of its origin.** The documentation built into the server is served under a `docs` route, and its links name that route from the root. The documentation must sit at the root of the address `ODUDU_PUBLIC_BASE_URL` names: a reverse proxy that mounts the server under a path prefix is not supported. Give Odudu a host of its own.

**Overwrite `X-Forwarded-*`, never append.** Set `ODUDU_TRUST_PROXY=true` only behind a proxy that overwrites `X-Forwarded-*`. Otherwise a client controls `request.ip`, and with it the key the throttle counts on. A spoofed `X-Forwarded-For` then gets round the limit. Appending is not enough: the value must be replaced.

**Raise the request body limit for tenant import.** `POST /admin/tenant-imports` accepts a body of up to 16 MiB, since an export with its subjects runs to several megabytes. Every other route keeps a 1 MiB limit. nginx refuses anything over 1 MiB by default and answers `413` before Odudu sees the request. Set `client_max_body_size 16m;` on the location that forwards `/admin/` and `/console/api/`.

**Mutual TLS is the proxy's job.** `tls_client_auth` client authentication works only while `ODUDU_TRUST_PROXY` is on. The server reads the client certificate's subject from the header named by `ODUDU_TLS_CLIENT_CERT_HEADER` (default `x-ssl-client-s-dn`). The name is not standardized, so set it to whatever your proxy emits.

- The proxy must strip this header from every inbound request before adding its own. A deployment that trusts the header without stripping it lets any caller assert any client's identity.
- The proxy must also verify the certificate, with nginx's `ssl_verify_client on` and not `optional_no_ca`. An unverified certificate is just a header a caller wrote into its own request.
- When no certificate is presented, the header must be absent or empty, never a placeholder like `(null)` or `-`. Either would be read as a real subject and refuse every ordinary `client_secret_basic` request from that proxy.

With the flag off, `tls_client_auth` is unavailable end to end: discovery does not advertise it and registration refuses to create a client for it.

## 6. Create the first administrator

The first administrator is made from the command line, because nothing can sign in before one exists. This also creates the `system` tenant if it is not there.

```text
docker exec <container> odudu seed admin --username ada
```

It prints a one-time password, once. Open `https://id.example.com/console/`, type `system` as the tenant, and sign in as `ada`. Odudu asks you to choose a new password before it lets you in.

The issuer is `ODUDU_PUBLIC_BASE_URL` plus `/tenants/<name>`, whatever `Host` a request carries. Set it to the public address, with no path. A client that reaches the server by another name still sees that issuer, so it must use the public one. One base serves every tenant; a domain per tenant is not supported yet.

Then check the issuer your server reports is that address:

```text
curl -fsS https://id.example.com/tenants/system/.well-known/openid-configuration
```

The `issuer` in the answer must begin `https://id.example.com/`. If it does not, `ODUDU_PUBLIC_BASE_URL` is wrong.

## 7. Leave the schedules on

The server runs four background passes by itself, and you should leave them on.

- **Retention.** It reaps expired state hourly. Without it `authentication_sessions`, `authorization_codes` and `refresh_tokens` grow without bound. Shorten the interval with `ODUDU_REAP_INTERVAL_SECONDS`.
- **Mail.** It sends queued mail every 15 seconds. With nothing sending, every verification and reset link sits unsent, and the flows that queued them answer exactly as they do when mail is going out.
- **Back-channel logout.** It delivers logout tokens to the apps that registered for them.
- **Domain recheck.** It looks up the ownership record of every verified custom domain hourly. A domain whose record is gone for three passes in a row fails, and its tenant returns to the path address. A resolver outage counts as nothing. Without it a domain you no longer own keeps serving a tenant's sign-in.

To schedule one yourself instead, set its `ODUDU_REAP_ENABLED`, `ODUDU_OUTBOX_ENABLED`, `ODUDU_LOGOUT_SENDER_ENABLED` or `ODUDU_DOMAIN_RECHECK_ENABLED` to `false` and run `odudu reap`, `odudu send-mail`, `odudu send-logouts` or `odudu domains recheck` from cron or a Kubernetes CronJob. Do one or the other. Doing both is harmless. The retention pass and the domain recheck each take a Postgres advisory lock, and whoever loses a tick skips it. The mail and logout senders claim each message, so none is sent twice.

The retention pass needs `ODUDU_APP_DATABASE_URL`, because its deletes are scoped by the row-level-security policy that the owner role escapes. Its one transaction covers every tenant, which is what to watch if a deployment has many tenants and very large tables.

The domain recheck needs `ODUDU_APP_DATABASE_URL` for the same reason, and `ODUDU_PUBLIC_BASE_URL`, because a tenant falling back goes to its path address. Without either the server logs a warning at start and does not schedule it, and `odudu domains recheck` refuses or does nothing.

## 8. Set up mail

To send real mail, set `ODUDU_SMTP_HOST` and `ODUDU_SMTP_FROM`, and `ODUDU_SMTP_USERNAME`, `ODUDU_SMTP_PASSWORD` and `ODUDU_SMTP_STARTTLS=true` if your relay needs a login. The server refuses to set a password without STARTTLS, so credentials never travel in the clear. A tenant can also set its own relay through the console. Send a test message from the tenant's email page before you rely on it.

## What is not here yet

Odudu runs as one container beside one Postgres. Secret storage beyond environment variables, written and proven backup and restore, and running several instances are all on the [roadmap](../roadmap.md), not in the product today.
