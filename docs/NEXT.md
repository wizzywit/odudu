# Next

**Position:** P0.5 complete. `@odudu/kernel` now also exports
`ModuleRegistry`, `ModuleContext`, and `OduduModule` — a module registry
that starts modules in dependency order, stops them in reverse, fails
`start` loudly on unknown dependencies or cycles, and continues past a
module that throws on `stop`, reporting the aggregate failure.

**Next increment:** Task 6.

**Verify:** `pnpm verify` exits zero.

**Blocked on:** nothing.
