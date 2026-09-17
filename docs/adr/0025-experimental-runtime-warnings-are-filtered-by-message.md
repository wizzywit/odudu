# 0025 — Two experimental warnings are filtered by exact message

**Status:** Accepted · 2026-09-17

## Context

Every test process printed the same two lines:

```
ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time
```

They looked like a dependency this project had opted into too early, and the
first guess was wrong in a way worth recording: nothing in `jose` emits them,
and importing `jose` alone emits nothing. The pair survives in a test that
touches only the database, which is what pointed at the real cause — such a
test imports `@odudu/testkit`, and `@odudu/testkit` imports
`@simplewebauthn/server`.

`--trace-warnings` names it exactly:

```
at SubtleCrypto.supports (node:internal/crypto/webcrypto:1490:5)
at runtimeSupportsWebCryptoKeyAlg (.../runtimeSupportsWebCryptoKeyAlg.js:11:35)
at new BaseSettingsService (.../services/settingsService.js:24:36)
at .../services/settingsService.js:61:32
```

Line 61 constructs a module-level singleton, so the constructor runs on
import, and it unconditionally feature-detects post-quantum passkey support:

```js
this._runtimeSupportsPQC = runtimeSupportsWebCryptoKeyAlg('ML-DSA-44');
```

That calls `subtle.supports('verify', 'ML-DSA-44')`, and Node 24 warns twice
— once because `supports()` is experimental, once because the algorithm name
is. Node de-duplicates an experimental warning by message per process, so the
cost is two lines per test worker rather than two per test.

**Both packages are on their latest stable release** — `jose@6.2.12` and
`@simplewebauthn/server@14.0.2`, each the only `latest` dist-tag, neither a
prerelease. The detection has no setting that skips it. So there is no
dependency to resolve, which is the question this ADR was opened to answer.

## Decision

Filter exactly those two messages out of the **test** runner's warning
output, in `tests/setup/runtime-warnings.ts`, wired into both Vitest projects
as a `setupFiles` entry. Leave the server's own output alone.

Matching is on `name === 'ExperimentalWarning'` and the **whole** message
against a two-entry list. Node prints warnings from its own `onWarning`
listener, so the filter removes that listener and calls it for everything it
does not recognise, which keeps Node's formatting for every other warning.

## Rationale

A warning printed on every run is worse than no warning, because it teaches
the reader to skim the part of the output where a real warning would appear.
Filtering the two we have diagnosed keeps that channel meaningful.

Matching the whole message rather than a substring is the load-bearing part.
`ML-DSA-87` becoming experimental-and-then-not, or a different WebCrypto
method being flagged, is news about the runtime we depend on;
`tests/setup/runtime-warnings.test.ts` holds the predicate to refusing a
changed algorithm, a different API and a `DeprecationWarning` carrying the
same text.

## Consequences

- The server still prints both lines when it boots, including in
  `docs/request-paths.md` transcripts captured from the CLI. That is
  deliberate: an operator learning their runtime is using an experimental
  WebCrypto surface is being told something true, and the place to decide
  otherwise is the server's logging configuration, not a test helper.
- The filter is a list of two strings that will eventually be wrong. When
  Node stabilises `supports()` or ML-DSA, the entries stop matching and
  nothing breaks — the warnings simply stop arriving. Nothing detects a
  stale entry, so this file is worth re-reading on a Node major upgrade.
- We learned something the codebase did not record: passkey verification
  accepts ML-DSA credentials wherever the runtime supports them, because
  `_runtimeSupportsPQC` is true on Node 24. That is a capability inherited
  from a dependency and asserted nowhere.

## Alternatives rejected

**Downgrade `@simplewebauthn/server` to `13.3.3`.** Silences the warning by
removing the post-quantum support that provokes it, and pins us a major
version behind on the library that verifies our WebAuthn assertions. Giving
up a capability to quiet a log line is the wrong trade.

**Run tests with `--no-warnings`.** Hides every warning, including the
unhandled-rejection and deprecation notices that have caught real defects
here. The problem is two known messages, not warnings.

**Accept the noise and document it.** Cheapest, and what was in place while
the cause was unknown. Rejected once the cause was known: the reason to
tolerate a recurring warning is not being sure it is harmless, and we are.

**Patch the dependency** (`pnpm.patchedDependencies`) to defer the detection
to first use. Fixes it at the source for us, and makes every future upgrade
of that package carry a patch to re-apply. Better asked for upstream, which
is where it went:
[SimpleWebAuthn#807](https://github.com/MasterKale/SimpleWebAuthn/issues/807)
proposes memoising the probe behind a getter, so only a caller that reaches
the PQC path pays the warnings. If it lands, the two entries in the filter
stop matching on their own and the file can go.
