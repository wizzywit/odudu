# 0031 — The Dynamic OP plan cannot pass, code-only

**Status:** Accepted · 2026-09-19

**Renamed 2026-09-22:** written when a tenant was called a realm; the decision is unchanged.

## Context

P3a's exit criterion is the OpenID Foundation's Dynamic OP plan
(`oidcc-dynamic-certification-test-plan`), run reproducibly with every
divergence confirmed as a recorded decision — not "passes". `docs/NEXT.md`
already records why a passing run was never on the table: the plan's
discovery check, when `ClientRegistration` is `dynamic_client` (true for
every module group `OIDCCDynamicTestPlan` defines), requires
`response_types_supported` to contain `code`, `id_token` and
`token id_token`, all three
(`OIDCCCheckDiscEndpointResponseTypesSupportedDynamic`,
`minimumMatchesRequired = SET_VALUES.length`). Odudu is `code`-only by
construction — OAuth 2.1 removes the flows the other two depend on — so
that check fails on every run, and `docs/protocols/oidc-discovery.md:73`
already carries the clause as `n/a:`.

That was the known-before-the-run divergence. The run itself, against a
tenant seeded with `client_registration_policy=open`
(`infra/conformance/run-dynamic-op.sh`, suite `release-v5.1.36`, plan id
`4JhQ5ffOdtF1Q`, 2026-09-19), found it is not the dominant one — and a
module can fail more than one condition, so **this section attributes by
condition, not by module**: counting modules once each hides how often
each condition actually fired.

## What the run found

**23 modules: 1 PASSED, 3 SKIPPED (self-skip), 18 FAILED, 1 never reached
a terminal status.** Every `FAILURE`-result condition across all 23
modules' committed logs (`infra/conformance/results/dynamic-op-2026-09-19-v5.1.36-logs.zip`)
was tallied, not sampled — 32 `FAILURE` entries in total
(15 + 11 + 2 + 1 + 1 + 1 + 1, the table below), covering 6 distinct
conditions:

| Condition                                                               | Occurrences | Modules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Cause                                                                                                                                               |
| ----------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EnsureServerConfigurationSupportsPrivateKeyJwt`                        | 15          | `oidcc-ensure-client-assertion-with-iss-aud-succeeds`, `oidcc-ensure-redirect-uri-in-authorization-request`, `oidcc-ensure-request-object-with-redirect-uri`, `oidcc-idtoken-rs256`, `oidcc-redirect-uri-query-OK`, `oidcc-redirect-uri-query-added`, `oidcc-redirect-uri-query-mismatch`, `oidcc-refresh-token` (×2), `oidcc-refresh-token-rp-key-rotation`, `oidcc-registration-jwks-uri`, `oidcc-request-uri-signed-rs256`, `oidcc-request-uri-unsigned`, `oidcc-server`, `oidcc-userinfo-rs256` | **P3b**: `private_key_jwt` client authentication is not implemented (`docs/request-paths.md`, "No `private_key_jwt` or mTLS client authentication") |
| `CheckIfAuthorizationEndpointError` (`error=invalid_request`)           | 11          | `oidcc-ensure-client-assertion-with-iss-aud-succeeds`, `oidcc-idtoken-rs256`, `oidcc-redirect-uri-query-OK`, `oidcc-refresh-token`, `oidcc-refresh-token-rp-key-rotation`, `oidcc-registration-jwks-uri`, `oidcc-registration-logo-uri`, `oidcc-registration-policy-uri`, `oidcc-registration-tos-uri`, `oidcc-server`, `oidcc-userinfo-rs256`                                                                                                                                                      | Mandatory PKCE — ADR 0016                                                                                                                           |
| `CheckIfAuthorizationEndpointError` (`error=request_uri_not_supported`) | 2           | `oidcc-request-uri-signed-rs256`, `oidcc-request-uri-unsigned`                                                                                                                                                                                                                                                                                                                                                                                                                                      | **P13**: `request_uri` refused (`docs/request-paths.md`, "No request objects")                                                                      |
| `OIDCCCheckDiscEndpointResponseTypesSupportedDynamic`                   | 1           | `oidcc-discovery-endpoint-verification`                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `response_types_supported` is `["code"]`, not the required 3 — this ADR (below)                                                                     |
| `OIDCCCheckDiscEndpointGrantTypesSupportedDynamic`                      | 1           | `oidcc-discovery-endpoint-verification`                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `grant_types_supported` has no `implicit` — this ADR (below)                                                                                        |
| `CheckDiscEndpointRequestObjectSigningAlgValuesSupportedContainsRS256`  | 1           | `oidcc-request-uri-signed-rs256`                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **P13**: corollary of not supporting request objects — `request_object_signing_alg_values_supported` is never advertised                            |
| `CheckDiscEndpointUserinfoSigningAlgValuesSupportedContainsRS256`       | 1           | `oidcc-userinfo-rs256`                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **P3b**: corollary of `/userinfo` never signing a response (`docs/request-paths.md`, "No signed or encrypted UserInfo responses")                   |

**`private_key_jwt` is the single most common failing condition, not
mandatory PKCE.** It fires as a discovery-configuration check, before any
authorization request is sent, and does not depend on PKCE — the two are
independent findings that happen to co-occur in most of the same modules
(11 of the 14 modules with a `private_key_jwt` failure also fail PKCE;
`oidcc-ensure-redirect-uri-in-authorization-request`,
`oidcc-ensure-request-object-with-redirect-uri`,
`oidcc-redirect-uri-query-added` and `oidcc-redirect-uri-query-mismatch`
fail on `private_key_jwt` alone and never reach the PKCE check because
their modules test something else entirely — a missing or mismatched
`redirect_uri`). Confirmed from each module's own condition log, in
order: `EnsureServerConfigurationSupportsPrivateKeyJwt` fires during
setup, immediately after dynamic registration completes and before any
`/authorize` request is built.

**The two new discovery findings, `response_types_supported` and
`grant_types_supported`, are the same OAuth 2.1 removal.**
`OIDCCCheckDiscEndpointGrantTypesSupportedDynamic` requires
`grant_types_supported` to contain both `authorization_code` and
`implicit`
(`src/main/java/net/openid/conformance/condition/client/OIDCCCheckDiscEndpointGrantTypesSupportedDynamic.java`).
Odudu's live discovery document in this run carried
`"grant_types_supported":["authorization_code","refresh_token","client_credentials"]`
— no `implicit`, because OAuth 2.1 removes the Implicit flow the same way
it removes the response types the sibling check demands
(`docs/protocols/oidc-discovery.md:73`). Both checks are read from the
same module, `oidcc-discovery-endpoint-verification`, and both stay `n/a`
for the reason already on record there.

**Two conditions are corollaries of decisions already placed, not new
divergences.** `oidcc-request-uri-signed-rs256` additionally fails
`CheckDiscEndpointRequestObjectSigningAlgValuesSupportedContainsRS256`
because `request_object_signing_alg_values_supported` is absent from
discovery — a direct consequence of odudu never supporting request
objects at all (P13, same module list entry that also produces the
`request_uri_not_supported` row above). `oidcc-userinfo-rs256`
additionally fails
`CheckDiscEndpointUserinfoSigningAlgValuesSupportedContainsRS256`
because `userinfo_signing_alg_values_supported` is absent — a direct
consequence of `/userinfo` never signing a response yet (P3b, already
named in `docs/request-paths.md`).

**Two modules self-skip**, exactly as the pre-run spike found reading
`fireTestSkipped`: `oidcc-registration-sector-uri` and
`oidcc-registration-sector-bad` both check
`server.subject_types_supported` for `pairwise` before running, find only
`["public"]`, and skip rather than fail. `oidcc-idtoken-unsigned` also
self-skips, on a separate, already-documented cause:
`id_token_signing_alg_values_supported` never lists `none`
(`docs/protocols/oidc-discovery.md`'s reading notes), so the module logs
"servers are not required to support 'none'" and stops.

**One module passes**: `oidcc-redirect-uri-regfrag`.

**A `REVIEW`-status checkpoint is not a `FAILURE`, and does not explain
why a module failed — only why five ended up in a non-terminal status.**
Seven modules reach a suite condition that logs `REVIEW` (a screenshot a
human confirms in the suite's own UI) rather than `FAILURE`:
`oidcc-ensure-redirect-uri-in-authorization-request`,
`oidcc-ensure-request-object-with-redirect-uri`,
`oidcc-redirect-uri-query-added`, `oidcc-redirect-uri-query-mismatch`
(`ExpectRedirectUriErrorPage`/`ExpectRedirectUriMissingErrorPage` — odudu
correctly serves its 400 page, and the suite then waits on a review this
unattended run cannot supply) and `oidcc-registration-logo-uri`,
`oidcc-registration-policy-uri`, `oidcc-registration-tos-uri`
(`ExpectLoginPageWith{Logo,PolicyLink,TosLink}`). All seven already carry
a genuine `FAILURE` condition from the table above before they ever reach
the review checkpoint (`private_key_jwt` for the first four, PKCE for the
last three) — the module's failure is real and already explained; the
review checkpoint only decides whether the run ends cleanly
(`FINISHED`/`FAILED`) or gets cut off mid-wait when the next module
claims the shared alias. In the committed export, the four
`private_key_jwt`-then-review modules recorded status `WAITING`; the
three PKCE-then-review modules recorded status `INTERRUPTED`, same as
every other PKCE module — the review checkpoint changed nothing about
their outcome. `oidcc-server-rotate-keys` is the eighth and last
non-terminal case, but for a different reason: it never fails any
condition at all (no `code_challenge`, no client auth, nothing to
attribute) — it reaches `TellUserToRotateOpKeys`, "Please rotate the keys
on the authorization server then press the 'Start' button", a manual step
this run cannot perform even given more time, since odudu has no
key-rotation operation yet (`docs/request-paths.md`'s "Key rotation is
not implemented", **P4**). Its committed status is `CONFIGURED` with no
result — it never got far enough to fail anything.

## Decision

**The plan's exit criterion is the reproducible run itself, with every
divergence traced to a recorded decision — which this run does, and which
this ADR is that record for the parts not already covered.** No server
behaviour changes as a result of this run. Specifically:

- `private_key_jwt` client authentication stays **P3b**'s, per
  `docs/request-paths.md`. This run does not move that placement — it
  confirms `private_key_jwt` is the condition this plan checks most, so
  P3b's rerun of this plan should expect it to be the first thing that
  changes the module count.
- Mandatory PKCE stays exactly as ADR 0016 decided; this run is further
  evidence for that ADR's claim, not a reason to revisit it.
- `response_types_supported` stays `["code"]` and `grant_types_supported`
  stays without `implicit`; a Dynamic OpenID Provider's three-response-type
  and two-grant-type requirements are out of scope by the same OAuth 2.1
  reasoning `docs/protocols/oidc-discovery.md:73` already gives for the
  first, restated here because this is the first live run that exercises
  either check.
- `request_object_signing_alg_values_supported` and
  `userinfo_signing_alg_values_supported` stay absent from discovery, as
  direct consequences of the P13 and P3b placements above — no separate
  decision needed for either.
- The two sector modules' self-skip needs no decision — it follows
  directly from `subject_types_supported: ["public"]`, itself already
  decided (pairwise is out of P3a's scope).
- `request_uri` support stays deferred to P13, per `docs/request-paths.md`.
- Key rotation stays P4, per `docs/request-paths.md`.

Odudu does not claim, and will not claim, OIDF Dynamic OP certification.

## Consequences

- The run stays reproducible (`infra/conformance/run-dynamic-op.sh`,
  `pnpm conformance:dynamic-op`) and runs in CI alongside Config OP,
  non-gating. **No automated comparison against the committed baseline
  exists** — the CI step proves the plan still runs to completion under
  the same harness, nothing more. Building a real regression check (diff
  each module's condition-level failures against
  `results/dynamic-op-2026-09-19-v5.1.36.json`) is future work, not a
  property of this step today.
- `infra/conformance/README.md`'s Dynamic OP section is load-bearing
  documentation in the same sense ADR 0016 already establishes for Basic
  OP: a module-level summary is exactly what would have hidden that
  `private_key_jwt`, not the discovery check the plan was expected to
  fail on, is the most common failing condition here.
- P3b inherits the same caution `docs/NEXT.md` already states: read what a
  suite plan actually demands before writing a criterion around it, not
  after — and this run's own evidence is now the reference for what
  changes when `private_key_jwt` lands.

## Alternatives rejected

**Relax mandatory PKCE, or implement Implicit/Hybrid response types, to
chase a passing run.** Rejected without qualification, for the same
reason ADR 0016 rejects it for Basic OP: these are deliberate P1
decisions this phase does not own, and passing a certification plan is
not a reason to reopen either.

**Treat this ADR as superseding ADR 0016.** Rejected: nothing about
mandatory PKCE changed. This ADR is additive — it is the Dynamic-OP-specific
record of checks ADR 0016's Basic OP run never exercised
(`response_types_supported` and `grant_types_supported`'s multi-value
requirements) and confirmation that ADR 0016's own divergence reaches
here too, not a new ruling on PKCE itself.
