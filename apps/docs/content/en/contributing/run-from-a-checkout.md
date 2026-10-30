---
title: Run it from a checkout
description: Start Odudu from the source tree, with Postgres in Docker or on your machine, and try the console, the e2e suite and the Swagger UI.
---

# Run it from a checkout

You have cloned the repository and want a server running from it, for development or to try a change. This page sets up the two credential files, starts the stack three ways, and checks it. [The quick start](../quick-start/index.mdx) is the shorter path when you only want to use Odudu.

## Set up the credential files

Requires Node 24, pnpm and Docker. `pnpm install` first.

Two credential files, each read by a different thing, neither committed:

```bash
cp infra/docker/.env.example infra/docker/.env   # the compose stack
./infra/docker/ensure-console-key.sh             # ...and its console key, below
cp .env.example .env                             # the server, run on your host
```

Neither is created for you: the stack refuses to start without its own
(ADR 0015), so nothing can be lifted and run by accident.

`infra/docker/.env.example` carries a throwaway `ODUDU_KEK` for the compose
stack. The root `.env.example` deliberately leaves it empty, and the server
refuses to boot until it holds 32 base64-encoded bytes, so generate one
before the host run below:

```bash
node -e "console.log('ODUDU_KEK=' + require('node:crypto').randomBytes(32).toString('base64'))" >> .env
```

Changing this value later makes every private signing key already wrapped
with the old one unreadable. That example value is public, so a server with
`NODE_ENV=production` refuses to boot while `ODUDU_KEK` is exactly it.

**The console's key.** While the console is on, which is the default, the
server also refuses to boot without `ODUDU_CONSOLE_CLIENT_KEY`, naming it: the
private key the console's gateway authenticates with, as every tenant's
`odudu-admin` client, by `private_key_jwt`
([ADR 0038](https://github.com/wizzywit/odudu/blob/main/docs/adr/0038-the-admin-console-and-its-gateway.md)). It is an
ES256 private JWK, base64-encoded as the KEK is. `infra/docker/.env.example`
carries none, since a private key is not something to commit; after copying
it, `./infra/docker/ensure-console-key.sh` adds one to `infra/docker/.env`
and changes nothing if one is there. For the host run:

```bash
node apps/server/src/main.ts console keygen >> .env
```

Every tenant registers the key's public half, so the key outlives the
database it was made for: a stack you keep keeps its key, and a different
one means `odudu console provision` ([Upgrading](../operating/upgrading.md)). With `ODUDU_CONSOLE=false` no key
is read.

**Upgrading an existing install.** The console needs the key to boot, so an
install that predates it has two things to do, in this order:

1. Give it a key. For the compose stack, `./infra/docker/ensure-console-key.sh`
   adds one to its existing `infra/docker/.env` and leaves a key already there
   alone; for a host run or a deployment, `console keygen` prints one to set as
   `ODUDU_CONSOLE_CLIENT_KEY`. Start the new version.
2. Register it, once: `node dist/main.js console provision` converts every
   tenant's public `odudu-admin` to confidential under that key. Until it has
   run, the console's sign-in is refused with `invalid_client` for the tenants it
   has not reached, and nothing else changes. Running it again writes nothing.

`infra/docker/smoke.sh` and `apps/admin-console/e2e/run.sh` start stacks with a
new database each time, so each makes a key of its own for the run and writes
nothing to `.env`; a stack you keep, such as the one in `infra/docker`, keeps the
key `ensure-console-key.sh` gave it, which is registered on its tenants.

That has a consequence worth knowing before you hit it. The two files hold
**different** keys — the compose stack's throwaway one, and the one you just
generated — and both point at the same database. Seed a tenant under one and
serve it under the other, and discovery, JWKS and `/authorize` keep working,
while `/token` returns a 500 reading `Unsupported state or unable to
authenticate data`: that is the private key failing to unwrap, and it says
nothing about why. If you intend to move between the two ways of running,
copy the `ODUDU_KEK` line from `infra/docker/.env` into the root `.env` so
both processes hold the same key.

## Run it

**Everything in Docker** — server and Postgres, closest to how it deploys:

```bash
cd infra/docker && docker compose up --build
curl http://localhost:3000/health/ready
```

**Postgres in Docker, server on your host** — the actual development loop,
with watch mode:

```bash
cd infra/docker && docker compose up -d postgres
cd ../.. && pnpm --filter @odudu/server dev
curl http://localhost:3000/health/ready
```

Both print `{"status":"ok","checks":{"database":"ok"}}`. The server applies
migrations on boot, so there is no separate migrate step.

Do not run both at once: each wants port 3000. Postgres is published on
**5442**, not 5432, because a host commonly already has one there.

**Browsing the admin API.** The same stack starts a Swagger UI beside the
server when asked for it:

```bash
cd infra/docker && docker compose --profile swagger up -d --build
```

It serves `http://localhost:3001` and loads `/admin/openapi.json` live from
the server, so reloading the page after a server restart shows the current
routes. Without `--profile swagger` the stack starts exactly as above. It is
for reading only: "Try it out" cannot reach the admin API from another
origin, because only the OpenAPI document is readable cross-origin — use
`curl`, as [the admin paths](../reference/transcripts/admin-paths/index.md) does, to call it.

**Everything on your host** — your own Postgres, no Docker at all. Needs one
bootstrap statement, because the restricted serving role is normally created
by the compose stack's init scripts:

```sql
CREATE DATABASE odudu;
CREATE USER odudu_svc LOGIN PASSWORD 'choose-one';
```

The owner role in `ODUDU_DATABASE_URL` must be able to `CREATE ROLE` —
migrations create `odudu_app` and grant `odudu_svc` membership in it, which
is what puts the serving connection under row-level security.

**It must also be `SUPERUSER` or `BYPASSRLS`, and that is a real
constraint, not a convenience.** Every tenant table carries `FORCE ROW LEVEL
SECURITY`, which removes the _owner's_ exemption — owning a table stops
being enough to read it. The owner connection has exactly one job at
request time: resolving `{tenant}` from the path, which happens before any
tenant id exists to `SET LOCAL app.tenant_id` into (ADR 0009's amendment of
2026-09-13). Under a plain owner that read returns zero rows and **every
request answers "unknown tenant"**, whatever is in the database.
`packages/authn-flows/tests/migrate-backfill.int.test.ts` asserts exactly
that, against a container, so the requirement is recorded rather than
folklore. A least-privilege owner is what this deployment shape wants and
cannot have yet; closing it means resolving a tenant without the bypass.

The same property is what a **migration** that reads or writes across tenants
has to be written for: under a role without the exemption it sees nothing,
writes nothing, and raises no error doing it.
`0040_recovery_code_execution.sql` is the worked example — it lifts `FORCE`
for its one statement rather than assuming the privilege — and the suite
above runs the whole migration set as a non-exempt owner so a migration that
only works for a superuser fails in CI.

Point both URLs at your own port (5432 by default, not 5442) and start the
server:

```bash
pnpm --filter @odudu/server dev
```

Which of the three you picked changes one thing past starting the server:
how the seed command is invoked, because the container runs a built bundle
and a host run has the source. The guide defines both once, as a shell
function every command in it then uses —
[Pick how you are running it](../reference/transcripts/request-paths/bootstrap.md#pick-how-you-are-running-it).
The endpoints are on `http://localhost:3000` either way.

## Check it works

Run this to check the whole thing, including that row-level security is
genuinely enforced in the container:

```bash
./infra/docker/smoke.sh
```

That drives a full authorization-code-with-PKCE exchange against the
container — seed a tenant and client, request `/authorize`, submit the login
form the way a browser would, redeem the code at `/token` — checks that the
image serves the console's shell with its CSP and a hashed asset as
`immutable`, and then tears the stack down, volumes included. It runs as its
own compose project, `odudu-smoke`, on ports 3100 and 5452, so it runs
beside the stack at the end of this page and its teardown never reaches that one.

## The console

**What the console covers.** A tenant's rail groups its areas by task:
Overview; Identity (Subjects, Groups, Roles); Applications (Clients, Scopes,
Registration tokens); Security (Sign-in flow, Signing keys, Sessions); Tenant
(Settings, Branding, Email, Export); Observe (the Audit trail). A system administrator
signed in to `system` also has System, with Tenants and System
administrators; a tenant's record ends in a danger zone that deletes it,
once it is disabled and its name is typed. What the rail lists, and what a
page lets a caller change, follows `whoami`'s capabilities; the server still
decides every request. Settings ends in "Clear all lockouts", which clears
every failed-sign-in count in the tenant once its name is typed, and Email lists
the tenant's latest mail and what became of it. Two admin routes have no screen,
each by decision: `POST /subjects/bulk` and `GET /audit/count` (the audit trail
has no count).
`tests/lint/console-covers-admin-routes.test.ts`
names each, so a new admin route with neither a screen nor a reason fails
the build. The console's own sign-in, drafts and sections are described in
[the console paths](../reference/transcripts/console-paths/index.md) and
[the P4d note](https://github.com/wizzywit/odudu/blob/main/docs/phases/p4d.md).

**Drive the console in a browser** against the same image:

```bash
./apps/admin-console/e2e/run.sh
```

It builds the image, starts it as the compose project `odudu-e2e` on ports
3080 and 5462 (`ODUDU_HOST_PORT` and `POSTGRES_HOST_PORT` move them), seeds
throwaway tenants and administrators, and runs the Playwright specs in
`apps/admin-console/e2e/` in Chromium. Any page fails its test on a
content-security-policy violation or a console error, and each console page
a spec reaches is held to axe's WCAG 2.2 AA rules, contrast included, in
both colour schemes and under both theme overrides. The stack is torn down
afterwards unless `E2E_KEEP_STACK=1`, and arguments after the script go to
`playwright test`. CI runs it as the `e2e` job, in three slices of the specs on
three runners (`E2E_SHARD=2/3` runs one; `E2E_PREBUILT=1` starts an image that is
already built, which CI builds against a layer cache).

**Developing the console.** `pnpm --filter @odudu/admin-console dev` starts
its Vite dev server, which proxies `/console/api` and `/console/auth` to a
running server — `http://localhost:3000` by default, the port a host-run
server above listens on. Name a different one, such as the throwaway
stack under "Try the console" below, 3090, with:

```bash
ODUDU_CONSOLE_UPSTREAM=http://localhost:3090 pnpm --filter @odudu/admin-console dev
```

`pnpm --filter @odudu/admin-console build` produces the static bundle the
image serves; the Dockerfile copies it to `/app/console`
(`ODUDU_CONSOLE_DIR`'s default). Every console package is a
devDependency, so nothing it needs reaches the running container.

**The component gallery** shows every Instrument component and its states,
outside the app shell:

```bash
pnpm --filter @odudu/admin-console gallery
```

Serves it at `http://localhost:5173/console/gallery.html`; `?theme=dark` and
`?dialog=plain|typed|secret|unsaved` put it in a given state from the URL.
It is a development-only page — `build` above never bundles it.

## Try the console

This is a stack that leaves no trace: its own compose
project, `odudu-try`, on ports 3090 and 5472, beside anything already
running:

```bash
cd infra/docker
./ensure-console-key.sh   # the stack refuses to start without the console's key
./try-certs.sh           # a throwaway certificate for the logout sink in the stack at the end of this page
export COMPOSE_PROJECT_NAME=odudu-try ODUDU_HOST_PORT=3090 POSTGRES_HOST_PORT=5472
docker compose -f compose.yaml -f compose.try.yaml up -d --build
until curl -fsS http://localhost:3090/health/ready; do sleep 2; done
```

`compose.try.yaml` adds two containers for trying what needs another server.
Mailpit catches every message the stack sends and shows it at
`http://localhost:8090`; on the console's Email page point a tenant's relay at
host `mailpit`, port `1025`, STARTTLS off, no credentials, and press the test
send. A request sink at `https://logout-sink:8443/` (certificate trusted by the
server through `try-certs.sh`; back-channel logout URIs must be `https`)
prints whatever it is sent, in its logs (`docker compose logs logout-sink`),
for a client's back-channel logout URI.

Bootstrap the first administrator, whose one-time password is printed
once:

```bash
docker compose exec -T odudu node dist/main.js seed admin --username ada
```

Give a tenant its own administrator too, with a forced password change on
the first sign-in:

```bash
docker compose exec -T odudu node dist/main.js seed tenant --name demo
docker compose exec -T odudu node dist/main.js seed user --tenant demo \
  --username grace --password correct-horse-battery --require-password-change
docker compose exec -T odudu node dist/main.js seed grant-role \
  --tenant demo --username grace --role odudu-admin:tenant-admin
```

Open `http://localhost:3090/console/` and sign in as either: `ada` lives in
`system`, so she types `system` at the tenant question (or opens
`http://localhost:3090/console/system`), and from there system authority
reaches every tenant; `grace` signs in to `demo`, and is asked for a new
password first. Tear the stack down,
volumes included, when you're done:

```bash
docker compose -f compose.yaml -f compose.try.yaml down -v
```

## Sign somebody in

The first tenant, client, user and signing key come from the server's `seed` command. [The bootstrap transcript](../reference/transcripts/request-paths/bootstrap.md) runs it step by step, for each of the three ways above.
