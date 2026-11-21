# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `timeoutMs` (default 30000, a finite number above zero or a `TypeError`) limits each attempt. A timed-out attempt is retried like any network error, bounded, and the call then fails with a `RequestTimeoutError`; a caller's own `signal` still aborts with its `AbortError`.
- The TypeScript types of the admin API, generated from its OpenAPI document.
