# I5 fix report

Branch `p5c-i5`, after merging `origin/p5c-console-assistant` (clean, no conflicts). Not pushed.

- I-1: `callerOf` returns null unless `principal.issuerTenantId` equals the target tenant; all four routes answer the 404 problem and the port is never called. Test: a system-tenant token (`manage-tenants`, `use-assistant`) on another tenant's path, all four routes.
- I-2: new `messageRepository.replaceLast(conversationId, seq, message)`: compare-and-swap, in the database. It takes the conversation row lock, and throws `ConversationTailChangedError` unless `seq` is still the last message, then updates in place. Chosen over a `turn_running_until` column because it needs no migration (0149 may be taken by a parallel increment), is safe whatever the number of servers, and fails closed. Cost: when two servers overlap on one conversation, the earlier turn's later steps are refused and that turn ends (logged as `assistant.store_failed`), both turns' stored messages stay. Cross-server 409 and cross-server stop still need a column. Tests: repository CAS test with foreign-tenant probe; two-instance overlap test (neither turn's messages lost).
- I-3: `convertToModelMessages` takes `ignoreIncompleteToolCalls: true`. Test: stop while the mint is pending, then send again returns a stream.
- M-1: history loads `HISTORY_MESSAGES` (40); the GET bound (100) is stated in the `messages` field description.
- M-2: `unlessAborted` races mint and tool run against the turn's signal.
- M-3/M-4: mint refusals are logged with their reason (no token); store failures and the deadline go through `ChatDeps.log`, wired to the server logger.
- M-5: `turnDeadlineMs` (default 5 min) aborts the turn and releases the slot; tested.
- M-6: body limit uses 6 bytes per character.
- M-7: no redundant final store (compares serialized parts); the injected `now` is used.
- Spikes: the I0c section carries the correction.

Red observed first: system-tenant test (403 until the test token held `manage-tenants`, then fixed handler), replaceLast missing, overlap test lost messages, pending-tool test raised MissingToolResultsError.

Run: tsc (assistant, protocol-admin, contracts, server, console-gateway), eslint, boundaries, heavy-slot int for assistant tests, protocol-admin assistant tests, server assistant tests, schema-drift (101 tests pass), `pnpm test:plans` (33), docs `pnpm generate` (OpenAPI still 444,308 bytes, so the transcript quote stands), `scripts/generate.test.ts` and `coverage-ratchet.test.ts` pass.
Not run to green: `tests/ia.test.ts` needs `apps/docs/dist` and `build:pages` was killed here (exit 144, no output).
