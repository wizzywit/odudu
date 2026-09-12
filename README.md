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

_Odudu_ — power, authority. Ibibio, Akwa Ibom, Nigeria.

An identity and access management platform: an OAuth 2.1 / OpenID Connect
provider with Keycloak feature parity, plus a first-class agent identity
layer for delegated authority, guardrails, and machine-readable
administration.

Self-hostable as one container plus PostgreSQL.

## Status

**P0 (foundation) complete.** No protocol surface yet — P0 built the ground
the rest stands on: the monorepo and its single `pnpm verify` gate,
machine-checked architectural boundaries, the kernel primitives, one ordered
migration timeline with PostgreSQL row-level security, a Fastify server
composed from kernel modules, and a container proven to boot by CI on every
push. P1 begins the OAuth 2.1 / OpenID Connect core.

- [Design specification](docs/superpowers/specs/2026-09-10-odudu-design.md) —
  what this is, and the twelve phases with their exit criteria
- [Architecture decision records](docs/adr/) — the decisions, several with
  dated corrections recording what turned out wrong
- [Decision log](docs/superpowers/p0-decision-log.md) — judgement calls made
  during P0, each with what it would cost if wrong
- [What to do next](docs/NEXT.md) — including what P0 deliberately deferred

## Running it

Requires Node 24, pnpm and Docker. `pnpm install` first.

Two credential files, each read by a different thing, neither committed:

```bash
cp infra/docker/.env.example infra/docker/.env   # the compose stack
cp .env.example .env                             # the server, run on your host
```

Neither is created for you: the stack refuses to start without its own
(ADR 0015), so nothing can be lifted and run by accident.

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
| Any authentication endpoint to actually serve                      | P1    |
| Published images and a release process                             | —     |
| Secret management beyond environment variables                     | —     |
| Backup and restore guidance                                        | —     |
| Multi-replica support: migration locking, shared session cache, HA | P11   |
| Helm chart or Kubernetes manifests                                 | P11   |

The single-container-plus-Postgres shape is a deliberate design decision
(ADR 0002) and the image is built for it. But until P1 lands there is no
protocol surface, so there is nothing for users to authenticate against —
the notice at the top of this file is not boilerplate.

## License

[Apache-2.0](LICENSE). The patent grant is deliberate: identity
infrastructure is exactly the kind of thing an organisation's legal team
asks about before adopting.
