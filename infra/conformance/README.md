# Conformance

The OpenID Foundation conformance suite, stood up against odudu, answering
the two spikes this phase deferred and recording what a Basic OP run
actually found.

## The suite

verified: `git clone --depth 1 --branch release-v5.1.36
https://gitlab.com/openid/conformance-suite.git`, then `docker compose -f
builder-compose.yml run --rm builder` (a `maven:3-eclipse-temurin-17`
container running `mvn -B clean package -DskipTests=true`), 2026-09-12.
Pinned tag: **`release-v5.1.36`**. It is a Java application (Spring Boot)
plus MongoDB, with an Apache `httpd` in front terminating TLS — three
containers, brought up here by `suite-compose.yaml` from a source tree
`run-config-op.sh` clones and builds on demand (not vendored; ~130 MB jar,
~4 minutes to build cold). Every service needs `extra_hosts: -
"localhost:host-gateway"` to reach a provider on the host — not used by
this run, which instead puts the suite and odudu on one shared docker
network (`odudu-conformance`) and addresses odudu by container name
(`proxy`), which needs no host-gateway trick and works identically in CI.

## Spike 2: does a Config OP plan accept `http://`?

**No — HTTPS is demanded unconditionally, not just recommended.**

verified: read `CheckDiscEndpointAllEndpointsAreHttps` and
`AbstractJsonUriIsValidAndHttps` in the suite's own source
(`src/main/java/net/openid/conformance/condition/client/`) — every
`*_endpoint` URL in the discovery document, and `server.discoveryUrl`
itself, is checked against `theURL.getProtocol().equals("https")` with no
configuration path around it; a plain-HTTP value is a hard `error()`, not
a warning.

Then reproduced it directly against a running odudu, pointed at
`http://odudu:3000/realms/conformance/.well-known/openid-configuration`
(reachable — this was not a network-error false negative). The suite's own
log:

```
"msg": "Expected https protocol for server.discoveryUrl", "result": "FAILURE", "actual": "http", "expected": "https"
"msg": "issuer listed in the discovery document is not consistent with the location the discovery document was retrieved from...", "result": "FAILURE"
"msg": "Expected https protocol for authorization_endpoint", "result": "FAILURE", ...
"msg": "Expected https protocol for token_endpoint", "result": "FAILURE", ...
"msg": "Expected https protocol for userinfo_endpoint", "result": "FAILURE", ...
"msg": "Expected https protocol for jwks_uri", "result": "FAILURE", ...
```

test result: `FAILED`.

**What this means for Task 10's cookie decision.** The `__Host-` cookie
prefix's `ODUDU_TLS`/`ODUDU_TRUST_PROXY` fallback (see
`packages/kernel/src/config.ts`) was already the right shape for this —
this is the trigger condition it was waiting for. A conformance run now
sets both: `compose.yaml` runs odudu with `ODUDU_TLS=true` and
`ODUDU_TRUST_PROXY=true`, behind a proxy that actually terminates TLS, so
the cookie really does get `Secure` semantics rather than merely claiming
them.

**The cheapest route: a reverse proxy, not a certificate in the app.**
odudu's server (`apps/server`) only ever speaks plain HTTP — adding TLS
termination to the Node process itself would touch product code for a
need that exists only in this conformance stack. `proxy/` is a tiny
`nginx:1.27-alpine` image with a self-signed certificate baked in at
build time (`openssl req -x509 ...`, 3650-day throwaway cert, regenerated
on every image build) that terminates TLS and forwards to `odudu:3000`
over plain HTTP inside the compose network, setting
`X-Forwarded-Proto: https` so odudu's own trust-proxy logic sees HTTPS.

**A finding surfaced by building this, not designed for it:** the proxy
listens on port **443**, not some other port mapped in from the host, and
that is deliberate rather than cosmetic. Fastify's `request.hostname` —
which `packages/protocol-oidc/src/view/routes/discovery.ts` and
`login.ts` both build the issuer and redirect targets from — strips the
port unconditionally, including when reading `X-Forwarded-Host` under
`trustProxy`. Verified directly against the odudu container:
`X-Forwarded-Host: myhost.example:9999` with `X-Forwarded-Proto: https`
still comes back as issuer `https://myhost.example/realms/...` — port
silently dropped. Every URL in the discovery document is built the same
way, so a run on port 443 (the scheme default, where "no port" is
correct) never exercises this, but a real deployment terminating TLS on
any other port would advertise the wrong endpoint URLs. That is a product
bug, not a conformance-harness one, and it is out of this task's scope to
fix — flagged as a follow-up rather than patched here.

## Spike 3: can Config OP be driven without a browser?

**Yes — fully, through the suite's own HTTP API, and in dev mode it does
not even need a token.**

The suite's `WebSecurityResourceServerConfig` requires every `/api/**`
call to be authenticated, normally via `POST /api/token` against a
browser-authenticated session. But `docker-compose-dev.yml` (which this
setup is based on) passes `--fintechlabs.devmode=true`, which activates
`DummyUserFilter`: it injects an authenticated (admin, by default)
principal into every request before the bearer-token filter runs, so
`/api/plan` and `/api/runner` work with **no `Authorization` header at
all**. Confirmed empirically — `curl -X POST
https://localhost:8443/api/plan?planName=... ` with no token returned
`201` and a real plan id.

The exact calls (see `run-config-op.sh` for the working script):

```bash
# 1. Create the plan (config-op.json is this repo's committed config)
curl -X POST 'https://localhost:8443/api/plan?planName=oidcc-config-certification-test-plan' \
  -H 'Content-Type: application/json' --data @config-op.json
# -> {"name":"...","id":"<planId>","modules":[{"testModule":"oidcc-discovery-endpoint-verification", ...}]}

# 2. Start the (only) module — no request body when creating from a plan
curl -X POST 'https://localhost:8443/api/runner?test=oidcc-discovery-endpoint-verification&plan=<planId>'
# -> {"name":"...","id":"<testId>","url":"https://.../test/a/<alias>"}

# 3. Poll for a terminal status
curl 'https://localhost:8443/api/info/<testId>'
# -> {"status":"FINISHED","result":"PASSED", ...}

# 4. (Optional) the human-readable log, or the zip export for a whole plan
curl 'https://localhost:8443/api/log/<testId>'
curl 'https://localhost:8443/api/plan/export/<planId>' -o export.zip
```

Because it needs no browser, **Config OP is the plan wired into CI** (see
below) — this matches the design decision already on record (P1 design
spec, §2.8). Basic OP stays a documented, reproducible manual run: it
covers an actual login (the suite's built-in HtmlUnit-driven browser
handles that fine, matched against odudu's real login form — see
`basic-op.json`'s `browser` block — so "no browser available" is not why
it stays manual), but its exit criteria and the CI wiring are this task's
alone to build for Config OP; Basic OP's own unattended path is deferred
per the design decision already on record.

## Basic OP: what the run found

Ran to completion against a seeded `conformance` realm (client
`conformance-client` / `conformance-secret`, user `conformance-user` /
`conformance-password`), plan id `zhhmzqbbCArGd`, suite `5.1.36`, on
2026-09-12. Export committed at
`results/basic-op-2026-09-12-v5.1.36.json` (compact per-module summary)
and `results/basic-op-2026-09-12-v5.1.36-logs.zip` (the suite's own
per-test export, `GET /api/plan/export/<planId>`).

**30 of 35 modules failed, 2 passed, 3 skipped.** This is not 30
independent bugs — it is one cause, hit 30 times:

> odudu makes PKCE mandatory on every `authorization_code` request (P1
> design decision: OAuth 2.1 alignment, `S256` only, no exception for
> confidential clients). The Basic OP profile's tests only add
> `code_challenge`/`code_challenge_method` in the one module that exists
> to test PKCE explicitly (`oidcc-ensure-request-with-valid-pkce-succeeds`
> — passed). Every other module sends a plain `authorization_code`
> request with no PKCE parameters, which odudu correctly rejects as
> `invalid_request` under its own mandatory-PKCE rule — but the Basic OP
> profile expects those requests to succeed.

Confirmed directly from the suite's own request/response log for the
first module (`oidcc-server`):

```
request_uri: https://proxy/realms/conformance/protocol/openid-connect/auth?client_id=conformance-client&redirect_uri=...&scope=openid&state=...&nonce=...&response_type=code
  (no code_challenge, no code_challenge_method)
-> callback?error=invalid_request&state=...
"msg": "The authorization was expected to succeed, but the server returned an error from the authorization endpoint", "result": "FAILURE"
```

The 3 `SKIPPED` modules (`oidcc-scope-address`, `oidcc-scope-phone`,
`oidcc-scope-all`) are a separate, expected consequence: odudu's
`scopes_supported` is `openid`, `profile`, `email` only (P1's deliberate
scope — `address` and `phone` are not part of this phase), and the suite
skips scope tests for scopes the discovery document does not advertise
rather than failing them.

**This is reported, not patched.** Making PKCE optional to pass Basic OP
would reverse an explicit, documented P1 design decision for the sake of
a certification profile that predates the OAuth 2.1/PKCE-mandatory
posture — that trade is not this task's to make silently. It is recorded
here as the finding this phase's conformance work exists to surface;
closing it (if it is ever closed, rather than accepted as a permanent,
documented divergence from the Basic OP profile) belongs with the tasks
that follow this one, not this one.

## Running it yourself

```bash
# Config OP — the same thing CI runs, ~5 minutes cold (suite build), seconds warm
pnpm conformance:config-op

# Basic OP — reproduces the run above; not wired into CI (see spike 3)
./infra/conformance/run-basic-op.sh
# runs and polls all 35 modules in sequence, then prints where it wrote the
# summary JSON and the suite's own zip export (does not overwrite results/)
```
