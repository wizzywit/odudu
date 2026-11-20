# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `createVerifier` checks an Odudu access token for an API: the signature against the issuer's keys (RS256 or ES256, read from the `jwks_uri` of its discovery document), the issuer, the audience, `typ` `at+jwt`, the expiry and the required scope. A refusal is a `VerificationError` carrying the HTTP status (401 or 403) and the `WWW-Authenticate` challenge to send.
- A token that names the "me" audience beside the API's is refused, as the server refuses it.
- Keys are cached for five minutes (`jwksTtlMs`), shared between concurrent requests and read again at most once every 10 seconds when a token names an unknown `kid`. At most 20 keys are kept per issuer and 256 issuers. Failing to read the keys rejects with `KeyFetchError`, which is not a fault of the token.
