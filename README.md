# Odudu

_Odudu_ — power, authority. Ibibio, Akwa Ibom, Nigeria.

An identity and access management platform: an OAuth 2.1 / OpenID Connect
provider with Keycloak feature parity, plus a first-class agent identity
layer for delegated authority, guardrails, and machine-readable
administration.

Self-hostable as one container plus PostgreSQL.

## Status

Design complete. Implementation begins at P0.

- [Design specification](docs/superpowers/specs/2026-09-10-odudu-design.md)
- [Architecture decision records](docs/adr/)
- [What to do next](docs/NEXT.md)

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

**Check the whole thing works**, including that row-level security is
genuinely enforced in the container:

```bash
./infra/docker/smoke.sh
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
