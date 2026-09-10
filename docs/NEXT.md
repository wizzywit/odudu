# Next

**Position:** P0.3 complete. `pnpm boundaries` enforces the package graph
(domain never reaches protocol, protocols never reach each other) and the
five-layer import direction, proven by fixtures under `tests/boundaries`
that deliberately violate two of the rules.

**Next increment:** Task 4.

**Verify:** `pnpm verify` exits zero.

**Blocked on:** nothing.
