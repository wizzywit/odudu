# 0027 — Consent defaults on for anonymous registration, not for dynamic registration

**Status:** Accepted · 2026-09-18

**Renamed 2026-09-22:** written when a tenant was called a realm; the decision is unchanged.

## Context

RFC 7591 §5 (Security Considerations) says of dynamic registration:

> An OAuth 2.0 authorization server can also present warning messages to
> end-users about dynamically registered clients in all cases, particularly
> if the client does not have a set of policy or terms of service URLs
> that display the client's data usage policies.

immediately after warning that "a rogue client might use the name and logo
of a legitimate client that it is trying to impersonate". The concern is
specifically about a client nobody vetted asking a real end user to grant
it scope, under a name and logo it chose for itself.

`client_oidc_config.consent_required` (migration 0045) already exists as a
per-client boolean, defaulting `false`. What P3a's registration task
settles is what the registration endpoint writes into it, and on what
axis — and the axis is not "was this client registered dynamically", which
would also catch a client an operator vetted and registered through a
minted token.

Keycloak's `DefaultClientRegistrationPolicies` is the precedent this
follows: `addAnonymousPolicies()` installs a `Consent Required` policy on a
realm's anonymous registration flow, and `addAuthPolicies()` — the flow
reached with a bearer credential — installs none. Keycloak draws the line
at authentication, not at dynamic-versus-seeded.

## Decision

**`consent_required` defaults to `true` when `registration_origin` is
`'anonymous'`, and to `false` for `'token'` and `'seeded'`.**

The axis is how the registration was _authorized_, not whether it went
through the dynamic-registration endpoint at all. An initial access token
is an operator's authorization for a client to exist, indistinguishable in
that respect from `seed client` naming one directly — both are an operator
vouching for the client before an end user ever sees its consent screen (or
would, once P3a's consent screen exists to show one). An anonymous
registration is vouched for by nobody but the registrant.

This is recorded at registration time, once, as the row's default — not
recomputed at every authorization request from `registration_origin`. An
operator who reviews an anonymously-registered client and decides to trust
it can flip the column directly; nothing about the origin re-asserts itself
on a later request.

## Alternatives considered

- **A flat default-off**, matching every other boolean this schema
  defaults false. Rejected: §5's recommendation is specific to
  registration nobody authorized, and a flat off declines it with nothing
  in its place — the one place RFC 7591 asks for caution beyond the
  protocol mechanics themselves.
- **Forcing consent on for every dynamically registered client, with no
  override.** Rejected: this removes an operator's ability to trust a
  client they vetted after the fact, and conflates "was registered through
  this endpoint" with "was registered by someone I don't know" — a
  token-authorized registration is the latter's opposite by construction,
  since minting the token was already an act of trust.
- **Deriving the default from client type** (public vs. confidential)
  **rather than from origin.** Rejected: a public client seeded by an
  operator (`seed client` with no `--client-secret`) is not the risk §5
  describes — the operator chose it — while a confidential client an
  anonymous registrant supplied a `jwks_uri` for is exactly that risk.
  Client type answers a different question (can this client keep a secret)
  than origin does (did anyone vouch for this client), and the two are
  independent.

## Consequences

`registration_origin` (`clients.registration_origin`: `'seeded' | 'anonymous'
| 'token'`, migration 0045) is now read by two things: the registration
usecase, to compute this default, and — once P3a's consent screen exists —
whatever reads `consent_required` to decide whether to show one. Nothing in
this task adds that reader; `client_oidc_config.consent_required` is stored
correctly and enforced by nothing yet, which is the seam P3a's own roadmap
entry in `README.md` names.
