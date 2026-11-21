# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Sign-out no longer redirects to an `end_session_endpoint` that is not https (the session is still ended here and the response carries no address); an http endpoint passes only with `allowInsecureRequests`.
