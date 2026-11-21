# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `createOduduHandlers` makes the route handlers (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`) that run the sign-in, the session and the proxy of `@odudu-io/bff` in a Next.js App Router catch-all route, and `getSession()`, which reads the signed-in person on the server. `withAuth` sends a request for a protected path with no session to the login route.
- `getSession()` only reads the stored session. It never asks Odudu, so a person disabled or revoked there stays signed in to a page that only calls it until `sessionTtlMs` (7 days when omitted) or until the BFF's next renewal is refused; the documentation says how to notice it sooner.
