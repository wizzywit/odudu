# 0026 — Client registration is a tenant policy, closed by default

**Status:** Accepted · 2026-09-18

**Renamed 2026-09-22:** written when a tenant was called a realm; the decision is unchanged.

## Context

RFC 7591 defines the wire format of a registration request and response but
takes no position on who may call the endpoint — §3.1 states plainly that
"the authorization server MAY restrict this endpoint to registered
clients or authorized users" and, in the next sentence, that it "MAY allow
anonymous registration requests as well". Both are conforming; the choice
is deployment policy, not protocol.

Every tenant toggle P2a and P2b added — `registration_allowed`,
`verify_email`, `reset_password_allowed`, `otp_required` — defaults off.
Keycloak reaches a similar posture for client registration indirectly: an
empty Trusted Hosts policy on a fresh realm refuses every anonymous
registration, though nothing stops an operator from also handing out an
initial access token in that state, so the two controls can disagree with
each other. Odudu's own migration 0045 already declares three states —
`disabled`, `open`, `token` — on `tenants.client_registration_policy`, which
this ADR is the design record for rather than a proposal: the column
predates this task, written when the schema for P3a was laid down.

`disabled` and an unknown tenant are two different facts a client-supplied
`{tenant}` cannot be permitted to distinguish. Discovery and JWKS already
collapse "does not exist" and "exists but not for you" into one 404 for the
same reason: a status code that tells them apart is an enumeration oracle
that costs the server nothing to remove and hands an attacker a working
tenant-name scanner for free.

## Decision

**Three states on one column, not a boolean.**

- `disabled` (default): the endpoint answers 404, and `registration_endpoint`
  is absent from discovery — not published empty, not published pointing at
  something that refuses everything. The same treatment a disabled tenant
  gets from `/jwks` and discovery already.
- `open`: any request registers a client. RFC 7591 §3.1's anonymous case.
- `token`: a request needs a valid, unspent `client_registration_tokens` row
  (`packages/domain-tenant/src/repository/client-registration-tokens.ts`,
  minted by `seed registration-token`) presented as a Bearer credential.
  Missing entirely, the request is refused with 401 and
  `WWW-Authenticate: Bearer` and no `error` parameter (RFC 6750 §3.1's own
  distinction between absent and rejected credentials); present but unspent
  is spent and consumed in the same transaction the client is inserted in,
  never earlier — no half-registered client exists on a rolled-back write.

`open` also honours a presented token: the policy names the floor, not a
ceiling, so an operator's own credential is not devalued by leaving the
tenant open. A token presented and rejected is refused outright rather than
downgraded to an anonymous registration — a caller that got its credential
wrong must be told, not quietly granted the weaker of the two outcomes it
never asked for.

## Alternatives considered

- **Open by default.** Rejected for the same reason every other tenant
  toggle in this codebase defaults off: an operator who never reads the
  registration section of the manual should not wake up to clients they
  never authorized. RFC 7591 §3.1 permits open registration; it does not
  recommend it as a default.
- **A boolean plus a separate "require token" flag.** Two settings that can
  disagree — `registration_allowed=false, require_token=true` is
  meaningless, and `registration_allowed=true, require_token=` unset needs
  its own default. Keycloak's Trusted Hosts-plus-initial-access-token
  arrangement is exactly this shape, and it is why operators there can
  configure a realm into a state where anonymous and token registration
  disagree about which is on. One column with three named states has no
  such gap: every value is a complete answer.
- **Always requiring a token.** RFC 7591 §3.1 explicitly declines to
  mandate this — "authorization is left as policy decisions" — and an
  always-token posture is just `token` chosen as the only value, which the
  three-state column already offers without removing `open` as an option
  for an operator who wants it.

## Consequences

`resolveDiscoveryDocument` reads `clientRegistrationPolicy` off the same
`TenantLookup` row it already fetches to answer 404/200 — no second query.
The registration endpoint's own 404 for `disabled` and for an unknown tenant
share one code path (`registerClient`,
`packages/protocol-oidc/src/usecase/client-registration.ts`), which is what
keeps the two indistinguishable by construction rather than by two branches
that happen to return the same status today.
