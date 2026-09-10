# 0004 — Fastify 5 for HTTP

**Status:** Accepted · 2026-09-10

## Decision

Fastify 5.

## Rationale

Fastify's plugin encapsulation maps almost one-to-one onto the `kernel`
module registry: each module becomes a scoped plugin with its own hooks and
decorators, so the framework and the architecture pull in the same
direction. It is schema-first, which yields OpenAPI generation for the
admin API, which in turn feeds the console's typed client.

## Alternatives rejected

**Hono.** Elegant and web-standard, but its advantage is edge portability,
worth nothing for a single self-hosted container. Session and rate-limiting
ecosystems are thinner.

**NestJS.** Provides dependency injection and modules out of the box, but
its decorator-metadata model would duplicate or fight the five-layer
convention, and learning Nest is not learning identity.

**Express 5.** Ubiquitous, slowest, no schema story, weakest typing.
