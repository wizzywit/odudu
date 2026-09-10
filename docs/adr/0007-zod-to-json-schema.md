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
