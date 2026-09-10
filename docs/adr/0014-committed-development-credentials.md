# 0014 — Development credentials are committed inline

**Status:** Accepted · 2026-09-10

## Context

`infra/docker/compose.yaml` and `infra/docker/initdb/01-app-role.sql` contain
fixed passwords in plain text, committed to a public repository for an
identity and access management platform. That combination reasonably draws a
second look.

## Decision

Keep the values inline. Do not move them to a `.env` file, and do not require
them to be supplied.

## Rationale

A fixed, publicly-known local password is deliberately not a secret. Moving
it to `.env` usually relocates it to a committed `.env.example` that everyone
copies verbatim, which adds a setup step and buys no secrecy — while teaching
readers that credentials live in `.env`, a worse habit than "credentials live
in a file stamped never-deploy".

Zero-setup `docker compose up` is also a property ADR 0002 optimises for
explicitly. Requiring a bootstrap step trades that for a security property
this threat model does not need.

## What makes it acceptable

Three controls, not one:

- `compose.yaml` opens with a header stating it is local development only,
  that the credentials are public, and that it must never be deployed.
- Both published ports bind to loopback, so the stack is unreachable from the
  network even on a machine that runs it.
- The server refuses to boot in production without `ODUDU_APP_DATABASE_URL`,
  so the most dangerous misconfiguration — serving as the RLS-bypassing owner
  role — fails loudly rather than silently.

## Consequences

- The residual risk is a deliberate lift-and-run: the file works as-is, so
  copying it into a real environment produces a running stack with known
  passwords. The header is a request, not a control.
- `initdb/01-app-role.sql` sets a password in SQL, which compose cannot
  interpolate. Any future move to environment variables must convert that
  file to a shell script, or it only half-solves the problem.

## Revisit when

Any of: the compose stack stops being development-only; someone other than
the author runs it routinely; or the project starts publishing images that
embed these defaults. At that point the strongest cheap change is
`${VAR:?}` with no default, so the file cannot run without a deliberate act —
optionally with generated rather than fixed values.

## Alternatives rejected

**Required variables with a committed `.env.example`.** Makes the file
unrunnable as lifted, which is the real security property — but the known
passwords stay in the repository, so it is a smaller improvement than it
appears, and it costs the zero-setup property.

**Generated secrets written to a gitignored `.env`.** Strictly the most
secure: no credentials in the repository at all, and the file cannot be
lifted and run. Rejected for now as disproportionate to a loopback-bound
local stack, and because it adds a bootstrap script that CI must also run.
