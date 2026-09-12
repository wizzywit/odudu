# Odudu

> ## ⚠️ Not production ready — do not put this in front of real users
>
> Odudu is an identity provider under active construction. Credential
> handling, session management, and the token pipeline are incomplete and
> have not been security reviewed. A working `docker compose up` exists so
> the project can be developed and tested; it is **not** evidence that any
> part of this is safe to deploy. Use Keycloak, Ory, or Zitadel for anything
> real.
>
> This notice will be removed only after a deliberate hardening pass, and
> its removal will be announced in the changelog.

_Odudu_ — power, authority. Ibibio, Akwa Ibom, Nigeria.

An identity and access management platform: an OAuth 2.1 / OpenID Connect
provider with Keycloak feature parity, plus a first-class agent identity
layer for delegated authority, guardrails, and machine-readable
administration.

Self-hostable as one container plus PostgreSQL.

## Status

**The OAuth 2.1 / OpenID Connect core is built.** A realm serves discovery,
JWKS, `/authorize` with a password login, `/token` and `/userinfo`, and
answers the `authorization_code` (PKCE mandatory, no exception),
`refresh_token` (rotating, with reuse detection that revokes the family) and
`client_credentials` grants. That sits on the P0 foundation: the monorepo and
its single `pnpm verify` gate, machine-checked architectural boundaries, the
kernel primitives, one ordered migration timeline with PostgreSQL row-level
security, and a container CI builds and boots on every pull request and on
every merge to `main` — a branch push with no pull request open runs
nothing, by design (`.github/workflows/verify.yml`).

There is still no consent screen, no admin API, no second factor, and no
token exchange — P2 onwards.

> ### → [docs/request-paths.md](docs/request-paths.md)
>
> **Every request this server answers, and every branch each one can take,
> as commands you can paste.** Discovery, `/authorize`, the login form,
> `/token` for all three grants, `/userinfo` — each with the real response,
> each refusal with the reason it is that refusal and not another, and what
> a client does next from wherever it has landed. Every command in it was
> run against the stack these instructions build.
>
> Read it once [Running it](#running-it) below has handed you a token.

- [Design specification](docs/superpowers/specs/2026-09-10-odudu-design.md) —
  what this is, and the twelve phases with their exit criteria
- [Architecture decision records](docs/adr/) — the decisions, several with
  dated corrections recording what turned out wrong
- [Decision log](docs/superpowers/p0-decision-log.md) — judgement calls made
  during P0, each with what it would cost if wrong
- [What to do next](docs/NEXT.md) — including what has been deliberately
  deferred, and to when

## Running it

Requires Node 24, pnpm and Docker. `pnpm install` first.

Two credential files, each read by a different thing, neither committed:

```bash
cp infra/docker/.env.example infra/docker/.env   # the compose stack
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
with the old one unreadable.

That has a consequence worth knowing before you hit it. The two files hold
**different** keys — the compose stack's throwaway one, and the one you just
generated — and both point at the same database. Seed a realm under one and
serve it under the other, and discovery and `/authorize` keep working, while
`/token` returns a 500 reading `Unsupported state or unable to authenticate
data`: that is the private key failing to unwrap, and it says nothing about
why. If you intend to move between the two ways of running, copy the
`ODUDU_KEK` line from `infra/docker/.env` into the root `.env` so both
processes hold the same key.

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

**Everything on your host** — your own Postgres, no Docker at all. Needs one
bootstrap statement, because the restricted serving role is normally created
by the compose stack's init scripts:

```sql
CREATE DATABASE odudu;
CREATE USER odudu_svc LOGIN PASSWORD 'choose-one';
```

The owner role in `ODUDU_DATABASE_URL` must be able to `CREATE ROLE` —
migrations create `odudu_app` and grant `odudu_svc` membership in it, which
is what puts the serving connection under row-level security. Point both URLs
at your own port (5432 by default, not 5442) and start the server:

```bash
pnpm --filter @odudu/server dev
```

**Check the whole thing works**, including that row-level security is
genuinely enforced in the container:

```bash
./infra/docker/smoke.sh
```

That drives a full authorization-code-with-PKCE exchange against the
container — seed a realm and client, request `/authorize`, submit the login
form the way a browser would, redeem the code at `/token` — and then tears
the stack down, volumes included.

**Sign somebody in yourself.** There is no admin API yet, so the first realm,
client, user and signing key come from the seed command in the server image:

```bash
cd infra/docker && docker compose up -d --build
until curl -fsS http://localhost:3000/health/ready; do sleep 2; done
```

Wait for that, rather than seeding straight after `up -d`. The container is
started before it has finished applying migrations, and a seed run in the
gap fails with `relation "realms" does not exist`.

```bash
docker compose exec -T odudu node dist/main.js seed \
  --realm demo --client demo-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@example.com
```

```json
{ "created": true, "realm": "demo", "realmId": "01a096f4-…", "clientId": "demo-spa" }
```

That realm now serves the protocol. The discovery document is the one
request every client makes first, and every URL below comes out of it:

```bash
curl -sS http://localhost:3000/realms/demo/.well-known/openid-configuration
```

```json
{
  "issuer": "http://localhost:3000/realms/demo",
  "authorization_endpoint": "http://localhost:3000/realms/demo/protocol/openid-connect/auth",
  "token_endpoint": "http://localhost:3000/realms/demo/protocol/openid-connect/token",
  "userinfo_endpoint": "http://localhost:3000/realms/demo/protocol/openid-connect/userinfo",
  "jwks_uri": "http://localhost:3000/realms/demo/protocol/openid-connect/certs"
}
```

(Five of the fifteen members it returns; the other ten, and what a client
does with each, are in the guide.)

And this signs ada in and comes back with tokens — the whole
authorization-code-with-PKCE flow, with `curl` standing in for the browser,
whose only job in it is to follow a redirect and submit a form:

```bash
BASE=http://localhost:3000/realms/demo/protocol/openid-connect
VERIFIER=$(openssl rand -hex 32)
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 \
  | openssl base64 | tr '+/' '-_' | tr -d '=')

AUTH_SESSION_ID=$(curl -sS --get \
  --data-urlencode 'response_type=code' --data-urlencode 'client_id=demo-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid profile email' --data-urlencode 'state=xyz-123' \
  --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode 'code_challenge_method=S256' \
  "$BASE/auth" | sed -n 's/.*name="auth_session_id" value="\([^"]*\)".*/\1/p')

CODE=$(curl -sS -D - -o /dev/null \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=ada' --data-urlencode 'password=correct-horse-battery' \
  http://localhost:3000/realms/demo/login-actions/authenticate \
  | sed -n 's/.*[?&]code=\([^&[:space:]]*\).*/\1/p' | tr -d '\r')

curl -sS --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode "code=$CODE" \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'client_id=demo-spa' --data-urlencode "code_verifier=$VERIFIER" \
  "$BASE/token"
```

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs…",
  "id_token": "eyJhbGciOiJSUzI1NiIs…",
  "refresh_token": "oXh8ADRkl4m7eVdblQ3r…",
  "token_type": "Bearer",
  "expires_in": 300,
  "scope": "openid profile email"
}
```

(Token values truncated; they differ every run.)

**[docs/request-paths.md](docs/request-paths.md) takes it from there** — what
each of those tokens is for, what `/userinfo` does with them, how a refresh
rotates, and every way each request above can be refused, with the response
each refusal actually returns.

Enable the repo's git hooks once per clone — they reject commit messages
carrying tool-attribution trailers, which CI also enforces:

```bash
git config core.hooksPath .githooks
```

**The gate** everything must pass — formatting, types, lint, architectural
boundaries, and tests including container-backed integration ones. Needs
Docker running:

```bash
pnpm verify
```

## Why not Keycloak

Keycloak has no notion of an agent as an identity. A service account is
shared, coarse, and permanent; there is no way to say "this agent, acting
for this person, with strictly less authority than they have, for the next
ten minutes, within this budget, revocable independently."

Odudu makes that the centre of the design rather than an afterthought, and
does it with standard mechanisms — RFC 8693 token exchange, `act` and
`may_act` claims, CIBA for out-of-band approval — so relying parties need
no special knowledge.

## Conformance, and what is not claimed

The OpenID Foundation's **Config OP** plan passes, unattended, in CI, against
the stack in `infra/conformance/` — a real TLS-terminating proxy in front of
the server, because the suite demands `https` unconditionally.

Odudu does **not** claim OIDF **Basic OP** certification, and will not. Basic
OP is written against OpenID Connect Core 1.0, which predates PKCE being
mandatory anywhere, so every module in it but the dedicated PKCE one sends an
authorization request carrying no `code_challenge`. Odudu requires PKCE of
every client with no exception and no per-client opt-out, and refuses those
requests. The run is kept reproducible and every divergence individually
confirmed — 28 of 35 modules, each checked rather than sampled — so the
evidence says exactly what stands between this server and that profile.
ADR 0016 records the ruling and the two alternatives rejected;
`infra/conformance/README.md` carries the module-by-module inventory.

The trade is real and worth stating plainly: a relying party that cannot do
PKCE cannot use Odudu.

## Deploying

**The deployable artifact is the container image, not `infra/docker/compose.yaml`.**
That compose file is development-only and says so at the top: its credentials
are committed and publicly known, and both ports bind to loopback. Do not
`docker compose up` it in production.

A real deployment today looks like:

1. Build the image from `infra/docker/Dockerfile`. It is multi-stage, runs as
   a non-root user, and carries a `HEALTHCHECK` against `/health/ready`.
2. Provide a PostgreSQL 17 you operate, with two roles: an owner that can
   `CREATE ROLE` and own the schema, and a restricted login role for serving.
3. Set `ODUDU_DATABASE_URL` (owner, used for migrations) and
   `ODUDU_APP_DATABASE_URL` (restricted, used to serve). **The server refuses
   to boot with `NODE_ENV=production` if the second is unset** — serving as
   the owner would bypass row-level security, so that failure is deliberate.
4. Terminate TLS in front of it. The server speaks plain HTTP. **With
   `NODE_ENV=production` it refuses to boot until `ODUDU_TLS=true` says
   something in front of it is doing that** — every credential it issues
   travels as plaintext over the connection, so the assertion is demanded
   rather than assumed. Set `ODUDU_TRUST_PROXY=true` only behind a proxy
   that overwrites `X-Forwarded-*`, or `request.ip` becomes
   client-controlled.
5. Run one instance. Migrations run on boot from every process and take no
   advisory lock, so concurrent replicas would race.

### What is not built yet

Being straight about this, because "self-hostable" should mean something:

|                                                                    | Phase |
| ------------------------------------------------------------------ | ----- |
| A consent screen, and dynamic client registration                  | P3    |
| An admin API — seeding is the only administrative surface          | P4    |
| Token introspection and revocation, and any logout endpoint        | —     |
| Published images and a release process                             | —     |
| Secret management beyond environment variables                     | —     |
| Backup and restore guidance                                        | —     |
| Multi-replica support: migration locking, shared session cache, HA | P11   |
| Helm chart or Kubernetes manifests                                 | P11   |

The single-container-plus-Postgres shape is a deliberate design decision
(ADR 0002) and the image is built for it. There is now a protocol surface to
serve, and users can be authenticated against it — but credentials are
seeded from a command line, nothing has had a hardening pass, and the full
list of what each endpoint does not yet do is in
[docs/request-paths.md](docs/request-paths.md). The notice at the top of this
file is not boilerplate.

## License

[Apache-2.0](LICENSE). The patent grant is deliberate: identity
infrastructure is exactly the kind of thing an organisation's legal team
asks about before adopting.
