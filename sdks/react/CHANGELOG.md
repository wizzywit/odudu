# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-23

### Added

- `{ kind: 'bff', baseUrl, proxyPath? }`: `useBffFetch` calls `proxyPath` (a path of this origin such as `/api/proxy`; no host, dot segment, escape or trailing slash, or the provider throws `invalid_options` when it mounts) in place of `<baseUrl>/proxy`, for a server whose BFF has a custom `proxyPath`.

### Fixed

- `browser` mode signs the person out when a refresh returns an ID token for another subject (`invalid_id_token`), as the BFF ends its session, and not only for `invalid_grant`.
- `useBffFetch` signs the UI out only on a `401` that carries the BFF's `X-Odudu-Session: ended` header, so an API's own `401` leaves the person signed in.
