# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The me API operations for delegations: list, create and revoke.
- The admin API models carry `agent_type` and `delegated_actors` on a client and the nine `agent_*` tenant settings.
- The assistant's approval card model carries `tier`, `confirm_with` and an optional `diff`, and the decision body takes an optional `confirm`.

## [0.1.0] - 2026-11-23

### Added

- Synchronous and asynchronous clients for the admin API and the account (`me`) API, generated from
  their OpenAPI documents, with cursor iteration, retries and a typed `ProblemError`.

### Fixed

- The verifier builds each public key once and keeps it (256 keys, least recently used first) instead of on every token, so a token costs one signature check.
- The verifier refuses a `jwks_uri` that is not https when its issuer is https, with `KeyFetchError`; an http development issuer (`allow_insecure_issuers`) may name an http one only on its own origin.
- `required_scope` is one RFC 6749 scope token: a value with a space is refused with `ValueError` when the verifier is made, because it could never match one member of the token's scope.
