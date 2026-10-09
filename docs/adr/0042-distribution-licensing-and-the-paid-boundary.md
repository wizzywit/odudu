# 0042 — Distribution, licensing, and where the paid product begins

**Status:** Accepted · 2026-10-09

## Context

Odudu will be released for anyone to self-host, and its owner intends to run
a paid, hosted service beside it. The paid service adds AI assistance,
chiefly in the admin console. Three things follow from that plan, and each is
costly to change after outside contributors arrive.

1. Where the open product ends.
2. Under which licence it is released.
3. How paid code relates to open code.

None of these had a recorded decision. The repository is Apache 2.0 by
default, and nothing yet governs contributions.

## Decision

**The open product is the whole identity provider.** It includes every
protocol, the admin API, the admin console, the CLI, theming and
extensibility. It also includes the agent identity layer (P5). Agents as
first-class principals are protocol, and they are this project's thesis.
Holding protocol back would invite forks and lose the trust an identity
provider needs.

**The paid product is hosting plus an AI layer.** Hosting means uptime,
backups, upgrades, scaling, patching and compliance, and it is what people
pay for. The AI layer is a differentiator on top of hosting. It covers:

- natural-language administration in the console;
- configuration review;
- audit-log anomaly explanation;
- policy suggestions.

**The paid layer is a separate, private package, never a fork.** It plugs into
public extension points only: the admin API, and P10's providers and console
extension points. If the paid layer needs an extension point, that extension
point is added to the open product first, where everyone can use it.

**The AI acts as a principal.** It calls the admin API under a real identity.
It is held to the same capability ceiling (ADR 0040) and the same audit trail
as a human administrator, and it never gets a privileged side door.

**Licence: AGPL-3.0 for the server, Apache 2.0 for what runs in other people's code.**

- **AGPL-3.0** covers everything that runs as the service: the server, the
  console, the gateway and the CLI. Anyone who offers Odudu over a network
  must publish their changes, so a competitor cannot sell a closed, improved
  copy of it.
- **Apache 2.0** covers client libraries, SDKs and the example applications.
  Integrating Odudu into a product is never constrained, and an application
  that only talks to Odudu over OIDC is not a derivative of it whatever its
  licence.
- **A commercial licence** is offered to organisations whose policy forbids
  AGPL. It is a second source of revenue, and it is why the contribution
  terms below are a CLA rather than only a DCO.

**Contributions are accepted under a CLA, enforced in CI, from the first
outside pull request.** It grants the project the right to offer the
contribution under the commercial licence too. Relicensing from Apache 2.0
costs nothing today: every commit so far is the owner's, apart from
Dependabot's version bumps.

## Consequences

- The P10 extension points become a product boundary, not only an
  engineering convenience. Their stability is versioned.
- The relicence lands in P4g, before anything is published: `LICENSE`, each
  package's `license` field, a short header policy, and a `LICENSING.md`
  that says which licence covers which directory.
- `CONTRIBUTING.md` states the sign-off rule and the licence. The public
  release phase (P4g) owns both.
- The hosted service needs a security attestation such as SOC 2 once
  customers ask for one. That is outside this repository.

## Alternatives rejected

- **Keeping agent identity (P5) paid.** It is protocol. Splitting it would
  fork the standard surface and the project's reason to exist.
- **A paid fork of the server.** Every upstream change becomes a merge, and
  the open product drifts behind.
- **Keeping Apache 2.0 throughout.** It gives the widest adoption, but any
  host, a cloud provider included, could sell Odudu without returning
  anything, and the hosted service is how the project is funded.
- **A source-available licence (BSL, SSPL).** It is not open source, so it
  costs the community trust and the issue reports the release exists to
  attract.
- **A DCO alone.** It certifies origin but grants no right to relicense, so
  it would rule out the commercial licence.
- **No contribution terms until they are needed.** Retrofitting them means
  contacting every past contributor.
