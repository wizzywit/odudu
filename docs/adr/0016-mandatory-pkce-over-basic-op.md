# 0016 — Mandatory PKCE, and the Basic OP certification it forecloses

**Status:** Accepted · 2026-09-12

## Context

P1's design makes PKCE mandatory on every `authorization_code` request, for
every client, with no exception — public and confidential alike, and with no
per-client opt-out. That follows OAuth 2.1
(`draft-ietf-oauth-v2-1-15` §4.1.1, "the client MUST use PKCE") and it is one
of the specific places the design set out to be stricter than the incumbents,
which make PKCE optional and configurable per client.

P1's exit criteria also required the OpenID Foundation's **Basic OP**
certification plan to pass. Standing the suite up revealed that the two
cannot both hold.

Basic OP is an OIDC certification profile written against OpenID Connect
Core 1.0, which predates PKCE being mandatory anywhere. Every module in the
plan except its one dedicated PKCE module sends a plain authorization request
carrying no `code_challenge`. Odudu rejects each of them with
`invalid_request`, which is the behaviour the phase set out to guarantee.

Measured against `release-v5.1.36`, with the harness's own defects fixed
first: 28 of 35 modules fail, and every one of the 28 was individually
confirmed — not sampled — to fail on exactly this divergence and nothing
else. The dedicated PKCE module passes. The full exports are committed
under `infra/conformance/results/`.

Three ways out were put to the project owner:

**(a)** Keep PKCE mandatory; change the exit criterion.
**(b)** Make mandatory-PKCE a per-client policy defaulting to on, and
configure a conformance-only client with it off.
**(c)** Relax the requirement globally.

## Decision

**(a).** PKCE stays mandatory for every client with no exception, and the
P1 exit criterion changes from "Basic OP passes" to "Basic OP runs
reproducibly, and every divergence from it is an individually confirmed
consequence of a recorded decision."

Odudu does not claim, and will not claim, OIDF Basic OP certification. The
external conformance evidence for the phase is the **Config OP** plan, which
passes and runs unattended in CI, together with the adversarial corpus and
the clause-level traceability tables.

## Consequences

- The Basic OP run stays in the repository and stays reproducible, but its
  purpose changes: it is no longer a pass/fail gate, it is the evidence that
  the only thing standing between Odudu and that profile is the intended
  divergence. That evidence is worth keeping precisely because it is
  checkable — a future change that breaks something unrelated shows up as a
  module failing for a new reason.
- Because each module's cause must be individually confirmed for that
  evidence to mean anything, the failure inventory in
  `infra/conformance/README.md` is load-bearing documentation, not a
  summary. A single-cause summary written without reading every module's
  log is what concealed a genuine unimplemented MUST (OIDC Core §3.1.2.1,
  POST at the authorization endpoint) when this was first run.
- Any deployment needing to interoperate with a relying party that cannot
  do PKCE cannot use Odudu. That is the intended trade and it should be
  stated to operators rather than discovered by them.
- Reopening this — a per-client policy, as in (b) — requires a superseding
  ADR, not a configuration change.

## Alternatives rejected

**(b) Per-client policy, defaulting to on, with a conformance-only client
that has it off.** This buys the certificate. It also reintroduces exactly
the surface the decision closes: a downgrade path that is one row of
configuration away from being switched on in production, on the client most
likely to be misconfigured. A security property that any operator can turn
off per client is a default, not a guarantee, and the phase's claim was a
guarantee. Certification of a profile that predates the requirement is not
worth converting a guarantee into a default.

**(c) Relax PKCE globally.** Undoes the decision outright to satisfy a test
suite. Rejected without qualification.

**Certify against a newer profile instead.** Genuinely attractive, and not
rejected so much as deferred: the OIDF profiles that assume PKCE are the
FAPI 2.0 family, which brings sender-constrained tokens (DPoP or mTLS) and
PAR with it. Those are P3-and-later surfaces. When they land, this ADR
should be revisited to name the profile Odudu can actually certify against,
rather than leaving "no certification" as the permanent answer.
