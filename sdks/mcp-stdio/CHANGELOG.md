# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `odudu-mcp`, the command, installable with `npx @odudu-io/mcp-stdio --base-url … --tenant …` on a machine with neither the Odudu image nor a checkout. It takes the options of `odudu mcp`, signs a person in through the browser or a service account through a private key, and writes only the protocol to standard output. `--help` prints the options.
- A failure line and the commands a message tells you to type (`--logout`, `--keygen`) name the command you ran: `odudu-mcp` here, `odudu mcp` from the server's command line.
