# Working on Odudu

Read `docs/superpowers/specs/2026-09-10-odudu-design.md` first. Decisions
and their rejected alternatives are in `docs/adr/`. Current position is in
`docs/NEXT.md`.

## Comments

Comments carry only what the code cannot express. No restating the obvious,
no ceremony, no verbose block headers. Where no comment is needed, write
none.

## Layering

Five functional layers, in the consoles and on the server alike:

| Layer      | Contains                                | Business logic    |
| ---------- | --------------------------------------- | ----------------- |
| view       | rendering, integration code             | no                |
| usecase    | orchestration of one journey            | no                |
| repository | state, refetch decisions                | no                |
| adapter    | wire contract: endpoints, DTOs, mapping | API-contract only |
| service    | domain and application logic            | yes               |

Permitted imports:

- `view` → own model, `shared/view`. Never repository or adapter.
- `usecase` → repository, service, view models. Never adapter.
- `repository` → adapter, service.
- `adapter` → transport, service.
- `service` → nothing.

Features expose one `index.ts`. No feature reaches into another's
internals.

Domain packages never import protocol packages. Protocol packages never
import each other.

## Non-negotiables

- Test-driven. Tests precede implementation.
- Integration tests run against real PostgreSQL via Testcontainers, never a
  mock.
- Every repository method is probed with a foreign `realm_id`.
- `SET LOCAL`, never `SET`, for realm context. A session-scoped setting
  leaks between pooled requests.
- Every increment ends with CI green, branch merged, and `docs/NEXT.md`
  updated.
