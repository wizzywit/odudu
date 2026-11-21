# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Synchronous and asynchronous clients for the admin API and the account (`me`) API, generated from
  their OpenAPI documents, with cursor iteration, retries and a typed `ProblemError`.

### Fixed

- The verifier refuses a `jwks_uri` that is not https when its issuer is https, with `KeyFetchError`; an http development issuer (`allow_insecure_issuers`) may still name an http one.
