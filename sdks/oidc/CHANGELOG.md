# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `clientCredentials` signs a service in as itself with a client secret (`client_secret_basic`) or a private key (`private_key_jwt`, signed with ES256, RS256 or the algorithm you name), and returns the access token, its expiry and its scope.
- `createTokenSource` returns a function that gives a valid access token for a service, asking the server again 30 seconds before the held one expires (`skewMs` changes that). Concurrent calls share one request, a failed request rejects all of them and the next call tries again, and it holds no timer.
- `refresh` renews the access tokens of a sign-in. Concurrent calls with the same refresh token make one request (a call naming another audience waits and continues with the rotated token), a rotated refresh token replaces the old one in the result, and a refused refresh rejects every caller with the same error.
- `requestAudience` starts a second authorization for an audience the first sign-in did not carry; a refresh naming such an audience rejects with `audience_not_granted`.
- `signOutUrl` builds the address that ends the person's session, with the ID token hint and the post-logout redirect.

### Changed

- A `TokenSet` now carries `issuer` and `clientId`, which `refresh` reads.

### Fixed

- A refresh response that names no scope no longer empties the scope stored with the tokens.
- `completeSignIn` rejects a malformed redirect URI or callback address with `invalid_callback` instead of a `TypeError`.
- `completeSignIn` refuses a callback that did not arrive at the redirect URI.
- Metadata read from an `http` issuer with `allowInsecureRequests` is no longer served to a caller that did not ask for it.
