# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- `useBffFetch` signs the UI out only on a `401` that carries the BFF's `X-Odudu-Session: ended` header, so an API's own `401` leaves the person signed in.
