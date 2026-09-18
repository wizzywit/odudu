# 0031 — The Dynamic OP plan cannot pass, code-only

**Status:** Accepted · 2026-09-19

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
realm seeded with `client_registration_policy=open`
(`infra/conformance/run-dynamic-op.sh`, suite `release-v5.1.36`, plan id
`4JhQ5ffOdtF1Q`, 2026-09-19), found it is not the dominant one.

## What the run found

**23 modules: 1 PASSED, 3 SKIPPED, 11 FAILED on the same mandatory-PKCE
divergence ADR 0016 already records, 1 FAILED on the response_types check
above, 2 FAILED on a decision already in `docs/request-paths.md`, 5
INTERRUPTED on a harness limitation matching ADR 0016's own precedent. No
module failed for a reason not already covered by a recorded decision.**

**Mandatory PKCE (ADR 0016) is the majority cause, not the discovery
check.** `OIDCCDynamicTestPlan` carries no PKCE-specific module — every
module that reaches `/authorize` sends a plain `authorization_code`
request with no `code_challenge`, exactly as Basic OP's non-PKCE modules
do, and odudu rejects each with `invalid_request` for the same reason.
Confirmed individually, not sampled, from each module's own
`redirect_to_authorization_endpoint` log entry and its
`CheckIfAuthorizationEndpointError` failure:
`oidcc-idtoken-rs256`, `oidcc-userinfo-rs256`,
`oidcc-redirect-uri-query-OK`, `oidcc-server`,
`oidcc-registration-logo-uri`, `oidcc-registration-policy-uri`,
`oidcc-registration-tos-uri`, `oidcc-registration-jwks-uri`,
`oidcc-refresh-token-rp-key-rotation`, `oidcc-refresh-token`,
`oidcc-ensure-client-assertion-with-iss-aud-succeeds` — 11 modules, all
`error=invalid_request` at the authorization endpoint, none reaching a
token endpoint (so `private_key_jwt` client authentication, P3b's, is
never actually exercised by this plan: PKCE refuses every one of these
requests before client authentication would matter).

**The response_types check fails exactly one module**,
`oidcc-discovery-endpoint-verification`, exactly as predicted: the
suite's own log records
`OIDCCCheckDiscEndpointResponseTypesSupportedDynamic` failing because
`response_types_supported` is `["code"]`, not the required
`{code, id_token, token id_token}`. This is `docs/protocols/oidc-discovery.md:73`'s
`n/a:` clause, confirmed live.

**Two modules fail on a decision already recorded, not a new one.**
`oidcc-request-uri-unsigned` and `oidcc-request-uri-signed-rs256` both
fail with `error=request_uri_not_supported` — odudu refuses the
`request_uri` parameter outright, which `docs/request-paths.md` ("No
request objects") already records as a deliberate OIDC Core §6.1 choice,
deferred to **P13** alongside PAR and DPoP. Nothing here changes that
placement.

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

**Five modules are INTERRUPTED on the same class of harness limitation ADR
0016 already names for Basic OP's two manual-review modules** — a suite
condition that requires a human to confirm something in the suite's own
UI before the module can continue, which this project's scripted,
unattended run has no way to supply:

- `oidcc-ensure-redirect-uri-in-authorization-request`,
  `oidcc-redirect-uri-query-mismatch`, `oidcc-redirect-uri-query-added`,
  `oidcc-ensure-request-object-with-redirect-uri` each reach
  `ExpectRedirectUriErrorPage` or `ExpectRedirectUriMissingErrorPage` —
  odudu correctly serves its 400 "unregistered redirect URI" page, and the
  suite then waits on a screenshot review that never comes before
  `run-dynamic-op.sh`'s per-module poll window elapses and the next module
  claims the shared alias.
- `oidcc-server-rotate-keys` reaches `TellUserToRotateOpKeys` — "Please
  rotate the keys on the authorization server then press the 'Start'
  button" — a manual step this run cannot perform even given more time,
  since odudu has no key-rotation operation yet
  (`docs/request-paths.md`'s "Key rotation is not implemented", **P4**).

None of the five is evidence of anything odudu does wrong; each is the
suite waiting on a human, on a feature already placed elsewhere, or both.

## Decision

**The plan's exit criterion is the reproducible run itself, with every
divergence traced to a recorded decision — which this run does, and which
this ADR is that record for the parts not already covered.** No server
behaviour changes as a result of this run. Specifically:

- Mandatory PKCE stays exactly as ADR 0016 decided; this run is further
  evidence for that ADR's claim, not a reason to revisit it.
- `response_types_supported` stays `["code"]`; a Dynamic OpenID Provider's
  three-response-type requirement is out of scope by the same OAuth 2.1
  reasoning `docs/protocols/oidc-discovery.md:73` already gives, restated
  here because this is the first live run that exercises the check.
- The two sector modules' self-skip needs no decision — it follows
  directly from `subject_types_supported: ["public"]`, itself already
  decided (pairwise is out of P3a's scope).
- `request_uri` support stays deferred to P13, per `docs/request-paths.md`.
- Key rotation stays P4, per `docs/request-paths.md`.

Odudu does not claim, and will not claim, OIDF Dynamic OP certification.

## Consequences

- The run stays reproducible (`infra/conformance/run-dynamic-op.sh`,
  `pnpm conformance:dynamic-op`) and runs in CI alongside Config OP,
  non-gating, so a module failing for a **new** reason — one not on the
  list above — is what future CI runs would actually be watching for.
- `infra/conformance/README.md`'s Dynamic OP section is load-bearing
  documentation in the same sense ADR 0016 already establishes for Basic
  OP: a single-cause summary is exactly what would have hidden that PKCE,
  not the discovery check the plan was expected to fail on, is the
  majority cause here.
- P3b inherits the same caution `docs/NEXT.md` already states: read what a
  suite plan actually demands before writing a criterion around it, not
  after.

## Alternatives rejected

**Relax mandatory PKCE, or implement Implicit/Hybrid response types, to
chase a passing run.** Rejected without qualification, for the same
reason ADR 0016 rejects it for Basic OP: these are deliberate P1
decisions this phase does not own, and passing a certification plan is
not a reason to reopen either.

**Treat this ADR as superseding ADR 0016.** Rejected: nothing about
mandatory PKCE changed. This ADR is additive — it is the Dynamic-OP-specific
record of a check ADR 0016's Basic OP run never exercised
(`response_types_supported`'s three-value requirement) and confirmation
that ADR 0016's own divergence reaches here too, not a new ruling on PKCE
itself.
