# Next

**Position:** P0.4 complete. `@odudu/kernel` now exports the error
taxonomy, an injectable `Clock` (with a `FakeClock` for tests), UUIDv7
`newId`, Zod-validated `loadConfig` that reports every offending key at
once, and a `Logger` interface with no implementation below `apps/server`.

**Next increment:** Task 5.

**Verify:** `pnpm verify` exits zero.

**Blocked on:** nothing.
