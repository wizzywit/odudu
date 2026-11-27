# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The admin API types carry `agent_type` and `delegated_actors` on a client and the nine `agent_*` tenant settings.
- The assistant's approval card types carry `tier`, `confirm_with` and an optional `diff`, and the decision body takes an optional `confirm`.

## [0.1.1] - 2026-11-23

### Changed

- No code change. The first version published from the release workflow, which checks that releases from CI reach npm.

## [0.1.0] - 2026-11-23

### Added

- `timeoutMs` (default 30000, a finite number above zero or a `TypeError`) limits each attempt. A timed-out attempt is retried like any network error, bounded, and the call then fails with a `RequestTimeoutError`; a caller's own `signal` still aborts with its `AbortError`.
- The TypeScript types of the admin API, generated from its OpenAPI document.
