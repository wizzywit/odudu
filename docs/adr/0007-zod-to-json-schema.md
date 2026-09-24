# 0007 — Zod 4 authored, JSON Schema executed

**Status:** Accepted · 2026-09-10

## Decision

Schemas are authored in Zod 4 in `packages/contracts`, then compiled via
`z.toJSONSchema()` for Fastify/ajv validation and OpenAPI generation.

## Rationale

Zod gives the best authoring ergonomics; ajv gives compiled validation
speed and OpenAPI for free. One source of truth, no duplication.

Zod refinements deliberately do not survive translation to JSON Schema.
This aligns with the layering rather than fighting it: **the boundary
validates structure, services validate rules.** A malformed request gets a
400 from ajv at the view layer; an invalid one gets a domain error from a
service. Two failures, two layers, no overlap.

## Alternatives rejected

**TypeBox.** Natively JSON Schema, so no translation step, but clunkier to
author and weaker at transforms.

**Valibot.** Smallest bundle, but immature for a system with this lifespan.

## Amendment — 2026-09-24

This ADR governs **JSON endpoints**; the admin API (P4c) is its first
execution.

The form-encoded protocol endpoints keep `parseStructure` rather than a
Zod-authored contract, for two reasons. Their 400 body is RFC-defined
(`error`/`error_description`), and ajv's is not. And at `/authorize`, a
check's _position in the sequence_ is what makes it safe: boundary
validation that rejects every structurally invalid request up front would
collapse the render-versus-redirect distinction for a missing
`redirect_uri`, where the response has to render rather than redirect.

`authorizeQuerySchema` and `AuthorizeQuery` are deleted from
`packages/contracts`, `2e1e0e4`'s deletion of `tokenRequestSchema` being the
precedent. Both had no consumer and were stale in the same way — no
`response_mode`, no `resource`, no `claims`, all three accepted by
`/authorize` since P3b.
