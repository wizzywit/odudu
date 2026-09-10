# 0015 — Environment-driven credentials

**Status:** Accepted · 2026-09-10
**Supersedes:** 0014

## Context

ADR 0014 accepted fixed passwords committed inline in
`infra/docker/compose.yaml` and `infra/docker/initdb/01-app-role.sql`, on the
grounds that a fixed, publicly-known local password is not a secret. That
reasoning answered the wrong question. It defended _whether the values are
secret_, not _where they live_ — and the property actually worth buying is
neither: it is that the file **cannot run as lifted**. A header comment
saying "never deploy this" is a request; a missing environment variable that
the file refuses to start without is a control.

## Decision

Move every credential out of `compose.yaml` and `initdb/01-app-role.sql` and
into `infra/docker/.env`, which is gitignored. `compose.yaml` references
each value as `${VAR:?message}` with no default, so `docker compose up`
fails immediately, before creating anything, when `.env` is absent. A
committed `infra/docker/.env.example` documents the required variables as
local-development placeholders and names `compose.yaml` as its consumer.

`initdb/01-app-role.sql` becomes `initdb/01-app-role.sh`, since compose
cannot interpolate into a `.sql` file: Postgres' entrypoint runs `*.sh`
scripts from `docker-entrypoint-initdb.d` with the container's environment
already present, so the script reads `$ODUDU_SVC_PASSWORD` and passes it to
`psql` as a bound variable (`-v svc_password=...`), which applies SQL
string-literal quoting via `:'…'` rather than concatenating it into SQL
text.

`infra/docker/smoke.sh` creates `.env` from `.env.example` when absent, so
CI and first-time runs still start the stack without a manual step.

## Consequences

- `docker compose up` is no longer zero-setup: a first run (or CI) must
  have `infra/docker/.env` present, whether bootstrapped by
  `.env.example` or supplied deliberately. This is the property being
  bought, not a side effect to minimize.
- The known local passwords are gone from the committed tree, which
  matters independently of secrecy: this repository has secret scanning
  enabled, and a scanner (or a reader) no longer needs a special case for
  "these hits are fine, see the header."
- One mechanism (environment variables read by compose) replaces two
  special cases (values embedded in YAML, a value embedded in SQL).
- Copying `compose.yaml` into a real environment without also copying
  `.env` now fails loudly instead of producing a running stack with known
  passwords — the residual risk ADR 0014 accepted as unavoidable is
  closed.

## Alternatives rejected

**Generated secrets written to a gitignored `.env` by a bootstrap script.**
Strictly more secure — no fixed password appears anywhere, not even in
`.env.example`. Rejected as disproportionate to a loopback-bound local
stack: it does not change what an attacker can do (the stack is
unreachable from the network regardless), and it would require the
bootstrap script to also mint and thread values other tooling (the test
harness, a hand-rolled local Postgres) currently gets from a fixed,
documented value.

**Leaving `initdb` as `.sql` and passing the password via `psql`'s
`\set` from a wrapper only in CI.** Rejected: it would leave the
non-CI path (a developer running compose directly) with the old hardcoded
password, half-solving exactly the problem ADR 0014's own consequences
section flagged.

## Amendment — 2026-09-10 — smoke.sh no longer bootstraps `.env`

The Decision section above says `infra/docker/smoke.sh` creates `.env`
from `.env.example` when absent. That was true as originally implemented,
but it defeated the property this ADR exists to buy: the normal way to run
the stack (`smoke.sh`) never actually required the deliberate act, it just
started with the example's placeholder values silently copied into place.

`smoke.sh` now fails closed instead: if `infra/docker/.env` is missing, it
prints instructions and exits 1 without creating anything. CI's `container`
job in `.github/workflows/verify.yml` gained its own explicit step that
copies `.env.example` to `.env` before calling `smoke.sh`, so the bootstrap
that CI still needs is a visible, deliberate line in the pipeline rather
than a silent default inside the script.
