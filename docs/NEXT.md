# Next

## Start here

**P0 is complete and merged. P1 (the OAuth 2.1 / OpenID Connect core) is
underway on `p1-oauth-oidc-core`; closing `docs/protocols/oidc-core.md` is
the most recent increment — see "The last of OIDC Core's MUST gaps" below.
What remains is the decision about strict traceability, and then the
phase's final exit-criteria confirmation.**

**The last of OIDC Core's MUST gaps.** `docs/protocols/oidc-core.md` went
from 29 MUST rows with no test to 6. Twenty-two were closed — the ID
Token's REQUIRED claims and its signature read off a token `/token`
actually returned, the Token Endpoint's registered-authentication-method
rule, the `id_token` that arrives exactly when the code was issued for a
request carrying `openid`, the Token Error Response's media type and
status, the UserInfo endpoint's RFC 6750 §3 error shape, RS256, and
`auth_time` — and seven of those cite RFC 6749 assertions rather than new
tests, because §3.1.3.2 restates §4.1.3's verification steps for the OIDC
case and Odudu has one token endpoint. One row moved to `deferred: P2`:
`prompt=login`'s "an error is returned if reauthentication cannot be
performed" has no reachable branch until a session can be reused, which is
what `deferred:` is for.

**A covered row was passing for a reason that was not the requirement.**
`RFC9068-2.1-03` proved "no key may spell `none`" by inserting
`alg = 'none'` with `status = 'active'` and asserting the insert fails. It
does fail — because of `signing_keys_one_active`, the unique index that
refuses any second active key whatever its algorithm. Relaxing
`signing_keys_alg_check` to admit `'none'` left the test green. Both that
assertion and the new `OIDC-CORE-2-06` now offer the probe row as
`retired`, so the algorithm check is the only thing that can turn it away,
and the relaxed-constraint breakage proof turns both red.

**Six oidc-core MUSTs stay `gap` on purpose**, with a reading note each:
§3.1.2, §3.1.3, §5.3 and §16.17 ×2 are TLS on the wire, and §2's `iss` row
asks for an `https` scheme this process does not choose — the same operator
assertion `docs/protocols/rfc9207.md` already declines to treat as proof.
The phase-wide residue and what to do about strict mode are set out at the
end of `.superpowers/sdd/2026-09-11-p1-oauth-oidc-core/progress.md`, under
"Strict mode and the residue"; the recommendation there is a new
`accepted:` status that strict mode tolerates but that keeps printing, and
it is the project owner's call, not a decision already taken.

**Two defects found by reading a row against its test.** Both were found
while writing clause tests, and both were real rather than theoretical.

`readOptionalField` (`packages/protocol-oidc/src/usecase/token-issuance.ts`)
returned `''` for a parameter sent with an empty value, where RFC 6749 §3.2
requires it to be read as omitted. Its two callers are `client_secret` and
`client_id`; the first one mattered. A redemption carrying an
`Authorization: Basic` header **and** `client_secret=` was refused 401
`invalid_client` as two authentication methods presented at once (§2.3.1),
where the identical request with the parameter left out returned 200 — the
rule being applied was right and its trigger was wrong. §3.2's row is now
`RFC6749-3.2-04` rather than a gap, and the test is built around the
optional parameter, because a required one cannot tell empty from absent:
both fail it identically. The reading note under "The default scope, and
the empty parameter value" records why that distinction is the whole of
the row.

**Nothing is consumed on the refresh grant until the grant has been
evaluated.** `issueRefreshTokens` rotated first and checked the
token-to-client binding afterwards. The binding was enforced — so no MUST
was broken — but rotation marks the presented token used and commits in
its own transaction, so any client registered in the realm that learned
another client's refresh token could burn it: the victim's next legitimate
refresh was then detected as reuse, and reuse revokes the entire family.
Reuse detection is one of this phase's headline security properties, and
it was usable as a weapon against the client it exists to protect. The
same was true of a client's own request that merely asked for a wider
scope than it was granted.

`evaluateRefreshGrant` now runs on both sides of the rotation. Before it,
from a read-only lookup, as a gate that can only refuse: a request that
was never going to succeed marks nothing used. After it, against the grant
the rotating transaction itself read, as the decision that governs — a
family revoked between the two reads must not still yield an access token.
What is atomic is unchanged and deliberately so: the single-use `consume`
in `refreshTokenRepository` is still one `UPDATE ... WHERE used_at IS NULL
AND expires_at > now() RETURNING *`, and it alone picks the winner between
two concurrent redemptions. Adding a read in front of it cannot turn that
into a race, because the read grants nothing — two concurrent redemptions
by the rightful client both pass the gate, and exactly one `UPDATE` still
matches. The widened window can only produce additional refusals, never an
additional success.

`client_oidc_config_refresh_token_ttl_floor` (migration 0014) puts a floor
of one second under `refresh_token_ttl_seconds`, which had no bound of any
kind. Zero or less issues a refresh token that expired before the client
received it, indistinguishable to every caller from one that was never
issued. There is deliberately **no** ceiling to match 0013's hour: an
`at+jwt` access token is self-contained, so its TTL is the whole
unrevocable window, whereas every refresh token presentation is a database
round-trip that reads the grant — revoking the grant ends it whatever the
column says, which makes the TTL an idle timeout rather than exposure. No
clause row asks for a number and none is derivable, so none was invented.

**`prompt` and `id_token_hint` are answered at `/authorize`.** OIDC Core
§15.1's mandatory `prompt` behaviours are implementable without P2's
reusable session: `/authorize` starts a fresh authentication every time and
never reads the SSO cookie it sets, so no End-User is ever already
authenticated there and `prompt=none` is `login_required` unconditionally —
§3.1.2.3's actual requirement, not a stand-in. `none` beside any other
value is refused (§3.1.2.1 makes them exclusive), as is a value outside the
four the specification defines. `id_token_hint` is verified as a token this
realm signed carrying this realm's `iss` (§3.1.2.2) against the same keys
`/jwks` publishes, before the prompt is acted on; the validated subject
rides on the parked request, so a sign-in by somebody else answers
`login_required` with no code, no cookie and no consumed authentication
session. Two rows stay `gap` knowingly — see the reading note in
`docs/protocols/oidc-core.md`.

**`pnpm trace` consults every test result carrying a row's id, not the
last one.** A `describe('[ID] …')` holding several `it`s reports one result
per `it`, all under that id, so an id naming several results is the
ordinary case — 55 of 104 ids in a full run. Indexing one result per id
kept whichever the reporter emitted last, and a red test could reconcile
its row green behind a passing sibling. A row is now covered only when
every result carrying its id passed, and the finding names the test that
failed.

**Three defaults that were safe by accident.** An access token's lifetime
now has a ceiling the server owns rather than one its clients happen to
choose: `client_oidc_config_access_token_ttl_ceiling` (migration 0013)
holds `access_token_ttl_seconds` between 1 second and one hour, so no row
a longer-lived token could be issued from can exist. The bound sits on the
column rather than at issuance deliberately — a clamp while minting would
issue something other than the registration says, and would be true only
of the code path that remembers it, while a constraint is true of every
writer including the admin API that does not exist yet. Raising it costs a
migration on purpose. That closes RFC 6750 §5.2's "token lifetime is
limited" and §5.3's "one hour or less" with a test about what the database
will hold at all plus the `exp - iat` of a token issued for the
longest-lived client that can exist — not about a fixture's own TTL.

`verifyJwt` no longer accepts a token with no audience policy stated:
`audience` is a required argument, and a call site that is genuinely not
the token's audience — the OP reading an `id_token_hint`, whose `aud` is
the requesting client — passes `AUDIENCE_UNCHECKED`. An optional option
made RFC 7519 §4.1.3 switch off by silence, which is what let a token
minted for another audience reach `/userinfo`; the type now carries the
guarantee, and `packages/crypto/src/service/sign.test.ts` holds it with a
`@ts-expect-error` that `pnpm typecheck` fails on the moment the argument
becomes optional again. **`packages/protocol-oidc/src/usecase/authorization-request.ts`
was the one live call site that named no audience.** Whether an
`id_token_hint` issued to one client should be honoured when presented by
another is left open, and recorded under "Known limitations" below.

RFC 7519 §4.1's `jti` row is closed where the claim is actually minted
(`packages/protocol-oidc/src/usecase/token-issuance.ts`), by asserting
that an access token fetched from `/token` carries a uuidv7 and that two
of them differ — `packages/crypto` could never have answered it, since
`signJwt` assigns no `jti`.

**The issuer, TLS, userinfo POST and email.** The issuer is canonical
again: the previous increment's move to `request.host` kept a non-default
port but let `Host: idp.example:443` and `Host: idp.example` become two
issuers for one deployment, which `/userinfo` — verifying an access token
against the issuer recomputed from that request's Host — turned into a 401. The scheme's default port is now dropped and every other port kept,
IPv6 literals included, and `realmIssuer` joins base and realm in one
place all five producers use.

`ODUDU_TLS` is no longer advisory: with `NODE_ENV=production` and TLS
unasserted, the server refuses to boot. That closes the four RFC 6749 rows
phrased as _the authorization server requires TLS_ and nothing else — a
boot guard proves an operator was made to assert TLS, not that TLS is on
the wire, and `docs/protocols/rfc6749.md`'s reading note names every row
it deliberately leaves as a gap. The development compose stack now says
`NODE_ENV=development`, since it serves plain HTTP on loopback;
`infra/conformance/compose.yaml` is the stack that runs the production
configuration behind real TLS.

`/userinfo` answers POST as well as GET (OIDC Core §5.3), accepting the
token in the `Authorization` header or, on a POST, in a form-encoded
`access_token` body (RFC 6750 §2.2) — the reading note that excused
GET-only contradicted a MUST and is corrected. Both methods present at
once is §3.1's `invalid_request`. `/authorize` and `/userinfo` now share
one media-type rule, which also answers a body arriving with no
`Content-Type` rather than letting Fastify's own 415 reply in a second
representation.

`email` is constrained **on the column it is emitted from**
(`users_email_addr_spec`, migration 0012), against a stated subset of RFC
5322 addr-spec rather than an approximation of the whole grammar — see the
reading note in `docs/protocols/oidc-core.md` for what the subset refuses.
Validating in `userRepository.create` alone left OIDC Core §5.1 enforced
on no path that produces a claim: nothing in production passed an email to
that method, and every `email` Odudu emitted was inserted raw by a test
helper. The repository keeps its check as the friendlier, earlier refusal;
a parity assertion holds the SQL and TypeScript spellings of the subset in
agreement case by case. `seed --email` exists so the user every demo and
end-to-end run authenticates as can carry the claim at all.

The traceability tables have a fifth status, `documented:`, for the
clauses that oblige an authorization server to _state_ something (RFC 6749
§3.3's scope defaults). Its reference must quote a reading-note heading of
its own file and `pnpm trace` checks the heading still exists, so the
promise that prose exists is enforced rather than trusted. A MUST recorded
this way is reported, and fails under strict mode.

The TLS reading note now says that four `covered` rows rest on **two**
operator assertions, not one: `NODE_ENV` gates the guard and is exactly as
operator-controlled as `ODUDU_TLS` — `infra/docker/compose.yaml` disables
the guard on the production image with one line. `README.md`'s deployment
steps and `.env.example` document the guard.

OIDC Core §3.1.2.6's "no other parameters on an error response" is
recorded as a knowing deviation rather than a gap: RFC 9207 §2 MUSTs `iss`
onto every authorization response, and a future reader closing that gap
would delete a mix-up-attack countermeasure.

**The authorization endpoint's normative gaps.** `iss` now rides on error
authorization responses as well as successful ones (RFC 9207 §2, whose
single MUST is tabled as two rows precisely because one row covered by a
success-path test is what hid the omission); an empty parameter value is
treated as omitted (RFC 6749 §3.1); an unsupported `response_mode` is
refused with a bare HTTP 400 and discovery states
`response_modes_supported: ["query"]` rather than inheriting Discovery
§3's `["query", "fragment"]` default; `request` and `request_uri` are
answered with `request_not_supported` / `request_uri_not_supported`
instead of being dropped in silence; and `code_challenge` is checked
against RFC 7636 §4.2's shape, sharing one pattern with the verifier. The
issuer has one definition (`packages/protocol-oidc/src/view/issuer.ts`),
which fixes the dropped-port bug recorded below.

Before any endpoint code, write the clause tables:
`docs/protocols/rfc6749.md` and `docs/protocols/rfc7636.md`, mapping each
MUST and SHOULD to the test that covers it (design spec, section 10). That
table is what makes "P1 is done" countable instead of a feeling, and it is
the same activity as the learning goal.

Then follow the phase sequence in `CLAUDE.md` — brainstorm P1's scope,
write its spec and plan, execute it task by task.

Everything below is the record of P0: what it delivered, what it
deliberately deferred, and the decisions taken with their trigger
conditions.

---

**Task 19: the conformance harness.** `infra/conformance/` stands up the
OpenID Foundation suite (pinned `release-v5.1.36`) against odudu. Both
open spikes are answered and recorded in `infra/conformance/README.md`:
a Config OP plan demands `https://` unconditionally (verified against the
suite's own source and by provoking the failure directly), and Config OP
is fully driveable through the suite's HTTP API with no browser and — in
the dev-mode setup this harness uses — no token either. `compose.yaml`
puts a self-signed-TLS `nginx` proxy in front of the otherwise-unmodified
odudu container (`ODUDU_TLS=true`, `ODUDU_TRUST_PROXY=true`), which is the
trigger condition Task 10's `__Host-` cookie fallback was waiting for.
`.github/workflows/verify.yml`'s new `conformance` job runs Config OP on
every push to `main` and every pull request, mirroring `container`'s
structure.

Running the **Basic OP** plan (35 modules, `results/`) exposed a genuine
conflict, now settled in **ADR 0016**: odudu requires PKCE on every
`authorization_code` request, and Basic OP — a profile written before PKCE
was mandatory anywhere — sends plain requests in every module but its own
PKCE one, which passes. The ruling is that mandatory PKCE stays and the
exit criterion changes. Odudu does not claim Basic OP certification.

The run stays, with its purpose changed: it is the evidence that the only
divergence is the intended one. That holds only while every module's cause
is individually confirmed, which is why `infra/conformance/README.md`
carries a per-module inventory rather than a summary. The first summary
written for this run said "30 failures, one cause" and concealed an
unimplemented MUST — OIDC Core §3.1.2.1 requires POST at the authorization
endpoint, and it returned 404.

A latent, unrelated bug surfaced while wiring the TLS proxy, and has
since been fixed: odudu's issuer and endpoint URLs were built from
Fastify's `request.hostname`, which silently drops the port even when
`X-Forwarded-Host` supplies one under `trustProxy` — verified directly
against the container. The conformance proxy sidesteps it by listening on
the default HTTPS port 443, so no conformance run would have caught it.
There is now one issuer definition, built on `request.host`
(`packages/protocol-oidc/src/view/issuer.ts`), with `issuer.test.ts`
driving Fastify directly for the ports the proxy never exercises.

---

**Position:** P0 complete. All exit criteria met:

- `pnpm verify` green locally and in CI (format, typecheck, lint,
  boundaries, unit, integration)
- the server boots in a container and reports ready; CI proves it on every
  push
- the migration runner is proven, including idempotency
- ADRs 0001–0013 committed
- dependency-cruiser enforces both package and layer boundaries, with
  fixtures proving the rules reject violations

**Task 9: container, compose, and the boot proof.** The bundler path was
taken, not the `pnpm deploy` fallback: `apps/server` builds with tsup
(`noExternal: [/.*/]`, ESM, `target: node24`), and the bundle was run for
real against a live PostgreSQL container before it went anywhere near the
Dockerfile — pino's transport machinery, the documented risk, did not
misbehave under the bundle. The multi-stage `infra/docker/Dockerfile` builds
with `pnpm --filter @odudu/server build` and ships only `dist/` plus a
separately-copied `packages/db/drizzle` (bundling destroys the
`import.meta.url`-relative path `MIGRATIONS_DIR` computes, so the directory
is passed explicitly via `ODUDU_MIGRATIONS_DIR`). The runtime stage runs as
a non-root `odudu` user — confirmed inside a running container
(`uid=100(odudu) gid=101(odudu)`), not just read off the Dockerfile.

`infra/docker/compose.yaml` uses two connection strings on purpose:
`ODUDU_DATABASE_URL` (the `odudu` owner) runs migrations; the server itself
serves on `ODUDU_APP_DATABASE_URL` (`odudu_svc`), which is subject to the
`realms_isolation` RLS policy from Task 7. Verified from inside the running
stack, not asserted: `psql -U odudu_svc -d odudu -c 'select count(*) from
realms;'` returns `0` (not a permission error), and `select policyname from
pg_policies where tablename = 'realms'` returns `realms_isolation`. Setting
`ODUDU_APP_DATABASE_URL` also means `main.ts`'s bypass warning never fires
in the compose stack — confirmed absent from the container's logs.

Wiring `odudu_svc` into RLS originally needed a workaround the brief's
literal SQL did not have — see "Review fixes" below for the finished
shape. `infra/docker/initdb/01-app-role.sql` now creates `odudu_app`,
`odudu_svc`, and grants membership between them during Postgres cluster
init, all before the `odudu` container (and therefore any migration) ever
starts. `packages/db/drizzle/0001_row_level_security.sql`'s `CREATE ROLE
odudu_app` is guarded (`IF NOT EXISTS`) so it still creates the role in
the integration-test path, where no `initdb` script runs and
`@odudu/testkit`'s `createAppRole` grants membership explicitly after
migrations, the same as before. `packages/db/drizzle/0002_grant_service_role.sql`
is kept as a harmless guarded no-op backstop rather than deleted (Drizzle
already recorded it applied); its comment is now explicit that it does not
make every ordering safe — see "Review fixes" for the production ordering
it still cannot repair.

The host-side `postgres` port in `compose.yaml` was moved from `5432` to
`5442` (the container still listens on 5432) because this machine already
has a native PostgreSQL bound to host port 5432; changing the host mapping
rather than the in-container port keeps every service in the file
addressing postgres by its default port. Both host-side ports
(`127.0.0.1:5442:5432` and `127.0.0.1:3000:3000`) are now bound to
loopback only — see "Review fixes".

`infra/docker/smoke.sh` brings the stack up, polls `/health/ready` for up
to 120s, then asserts from inside the running stack that `odudu_svc` can
query `realms` and sees `0` rows (not a permission error) and that the
`realms_isolation` policy exists, before tearing the stack down on exit
either way. It is the `container` job in `.github/workflows/verify.yml`,
run on every push alongside the existing `verify` job.

**Review fixes (post-merge hardening of this task).** A scoped review
found three hardening gaps and two smaller issues, all now closed:

1. `smoke.sh` originally only probed `/health/ready`, which runs `select 1`
   and needs no table privilege — it could not tell a working RLS grant
   from a broken one, and both smoke runs during the original
   implementation were green before and after the grant migration existed.
   `smoke.sh` now runs the brief's step 8 as hard, automatic assertions
   (query `realms` as `odudu_svc`, expect `0` not `permission denied`;
   query `pg_policies` for `realms_isolation`) so CI enforces this on every
   push. Verified by breaking the grant deliberately (commenting out both
   the `initdb` grant and the 0002 migration's grant) and confirming
   `smoke.sh` still reports `odudu became ready` but then fails on the new
   check with `permission denied for table realms`, not a readiness
   timeout; restored, and confirmed green again.
2. The grant migration's `IF EXISTS` guard made it a permanent silent
   no-op in a third ordering — `odudu_svc` created by tooling after
   migrations, with nothing playing `createAppRole`'s part — which is
   invisible to `/health/ready` forever after. Fixed by moving role and
   membership provisioning for the compose stack into
   `infra/docker/initdb/01-app-role.sql`, which always runs before
   migrations, rather than depending on a migration to grant membership
   into a role that may not exist yet. `0001`'s `CREATE ROLE odudu_app`
   was made idempotent so it still works standalone in the
   Testcontainers-based integration-test path. `0002` is kept as a
   redundant backstop with an honest comment about what it still cannot
   fix (a real deployment with a third provisioning path).
3. `compose.yaml` committed a plainly-passworded Postgres and app server
   published on `0.0.0.0`, unmarked, in a public repository for a security
   product. Added a header comment stating this file is local-development
   only and the credentials are public knowledge, and bound both publishes
   to `127.0.0.1`.
4. The Dockerfile's build stage did not copy the root `.npmrc`
   (`engine-strict=true`), so the image build silently ran `pnpm install`
   with engine enforcement off. Added `.npmrc` to the `COPY`.
5. `smoke.sh`'s `cleanup` trap ran under `set -e`; a failing
   `docker compose down` could mask a pending success exit code. `cleanup`
   now tolerates its own failure.

**Carried review item, closed:** Task 8 added a `res` serializer so
`res.headers["set-cookie"]` redaction was live but unproven.
`apps/server/src/logger.test.ts` now has a test that sets a real
`set-cookie` header on a reply via `buildApp`/`inject()` and asserts the
cookie value is absent from the captured log while `[redacted]` is present.
Confirmed this test actually exercises the redact path: removing
`'res.headers["set-cookie"]'` from `logger.ts`'s redact paths makes it fail
with the raw cookie value in the log line.

**Next increment:** P1.1 — begin the OAuth 2.1 / OIDC core. Start by
writing `docs/protocols/rfc6749.md` and `docs/protocols/rfc7636.md` with
the clause tables described in spec section 10, before any endpoint code.
The requirement table is what makes "P1 is done" countable.

**Verify:** `pnpm verify` exits zero; `./infra/docker/smoke.sh` exits zero
(one-time setup: `cp infra/docker/.env.example infra/docker/.env` — the
stack deliberately refuses to start without it, see ADR 0015; CI does this
itself as an explicit step in `.github/workflows/verify.yml`'s `container`
job).

**Blocked on:** nothing.

**Known limitations carried into P1:**

- An `id_token_hint` is verified with `AUDIENCE_UNCHECKED`: this server
  checks that it issued the token (OIDC Core §3.1.2.2) but not that the
  client presenting it is the one the token was issued to. The hint only
  constrains which End-User may complete the login, so a foreign hint
  grants nothing; tightening it to the requesting `client_id` is a
  behaviour change that wants its own clause row and test.
- Realm cookies are namespaced rather than host-isolated (spec section 6).
- Only the `realms` table has an RLS policy. Every new tenant table needs
  `ENABLE`/`FORCE ROW LEVEL SECURITY` plus a policy, and a foreign-realm
  probe in the adversarial suite.
- The server bundle inlines all dependencies (tsup, `noExternal: [/.*/]`).
  P2 introduces `@node-rs/argon2`, a native module that must be marked
  external in `tsup.config.ts` regardless of which bundling path is in use
  by then — a native `.node` binary cannot be inlined into an ESM bundle.
- `infra/docker/compose.yaml` publishes postgres on host port `5442`
  instead of the default `5432` to avoid colliding with a native postgres
  on the development host; anyone connecting to the compose stack's
  database directly from the host needs to use that port. Both host
  publishes are bound to `127.0.0.1`, and the file is local-development
  only — its credentials are fixed and public.
- `infra/docker/initdb/01-app-role.sql` is what makes `odudu_svc`'s RLS
  grant reliable in this repository's only deployment surface (compose). A
  real production deployment that provisions `odudu_svc` a different way —
  after migrations, with nothing playing the part of that script or
  `@odudu/testkit`'s `createAppRole` — would still hit the silent,
  permanent no-op described in `packages/db/drizzle/0002_grant_service_role.sql`'s
  comment: Drizzle marks the grant migration applied on the first run
  regardless, and no later redeploy repairs it, while `/health/ready` stays
  green throughout. There is no production deployment target yet to build
  the equivalent safeguard for; whoever adds one needs an explicit,
  idempotent, post-migration provisioning step for this role, not a
  migration.
- `databaseModule` runs `runMigrations` on every boot, from every process,
  with no advisory lock. One replica is fine; the three replicas P11
  promises would all attempt the migration runner concurrently on
  deployment, racing each other. Whoever adds the second replica needs a
  `pg_advisory_lock`-guarded runner (or an out-of-band migration step) before
  scaling `odudu` horizontally.
- The plan for this phase listed `apps/server/src/context.ts` as a file to
  create. It was never created — its job (correlation id generation,
  per-request setup) folded into `app.ts`'s `genReqId` option and its
  `onRequest` hook instead, which turned out to be all that was needed.

## Login page theming, for P2 to decide

The design spec lists `ThemeProvider` among `kernel`'s registries (section 8)
and puts theming in P10, whose exit criterion is that a third-party provider
loads without a rebuild. Nothing is in place yet: the registry does not exist,
and the sign-in and error pages are hardcoded HTML in
`packages/protocol-oidc/src/view/authorize-html.ts` — dependency-free, with
every interpolated value escaped.

Those forty-odd lines are not the risk. The risk is page count: P2 adds an OTP
page and a passkey page, P3 a consent screen, P4 the console. Each one written
the same way, by a different task, leaves P10 retrofitting a theming contract
across six pages that never shared a shape. The spec's promise that
extensibility is "additive rather than a rewrite" is made about modules, and
does not extend to pages on its own.

Defining that contract now, against a single page, would be guessing. **P2 is
where it should be decided**, when three pages exist and the real variation is
visible. Whoever picks it up: the seam is the render function's signature, and
the question is what a theme is allowed to replace — the whole document, a
body fragment, or only styling.

## Deployment gaps, for whoever asks next

`README.md` now has a Deploying section stating plainly that the container
image is the artifact and the compose file is development-only. What it lists
as missing, in the order it would matter: there is no protocol surface to
serve until P1; there is no published image or release process; secrets are
environment variables and nothing more; there is no backup or restore
guidance; and multi-replica deployment is blocked on migration locking and a
shared session cache, both P11.

The fully-local path (your own Postgres, no Docker) needs exactly one
bootstrap statement — `CREATE USER odudu_svc` — because migration 0001
creates `odudu_app` and 0002 grants membership when the serving role already
exists. Verified against a bare PostgreSQL 17 with no init scripts: the
server boots, migrations apply, and the serving role sees zero rows through
row-level security rather than a permission error.

## Recorded decisions with trigger conditions

**Affected-package-only CI.** Turborepo and pnpm both support
`--filter='...[<ref>]'` — changed packages plus their dependents — so no
tooling change is needed to adopt it. Not adopted now: CI runs in about 50
seconds end to end, and `test` is a root-level `vitest run` rather than a
per-package Turbo task, which is a prerequisite. When adopting, prefer
Turborepo **caching** first: an unchanged package replays its cached result
instead of being skipped, which gives the same wall-clock win without the
"we did not run those tests" semantics that a wrong graph turns into an
untested merge. Apply filtering only to genuinely slow jobs, keep typecheck,
lint, boundaries and unit tests always-full, and set `globalDependencies` at
the same time so a root config or lockfile change still forces everything.

- Trigger for caching: CI exceeds roughly 5 minutes (likely P4, when
  Playwright arrives).
- Trigger for filtering: slow suites dominate — P8 SAML interop, P9 policy
  evaluation, or the nightly conformance suite.

**Committed development credentials.** Kept inline deliberately; see
ADR 0014 for the reasoning, the three controls that make it acceptable, and
the conditions under which to revisit.

## Deferred from the final review

- `meta/0002_snapshot.json` records `policies: {}` while `realms_isolation`
  exists in every migrated database. Declaring `pgPolicy(...)` on the table
  would make `drizzle-kit generate` emit a `CREATE POLICY` that fails with
  42710 on existing databases. Record the policy in the snapshot, or leave a
  comment in `realms.ts`, before touching policies declaratively.
- `ODUDU_TRUST_PROXY=` (a bare key) now refuses boot rather than defaulting
  off — correct by strictness, but a new way for a previously-booting
  environment to fail.
- The boundary suite's negative control filters a fixture with no imports at
  all, so it cannot demonstrate that `service-is-a-leaf` is not over-broad.
  A service importing another service would.
- The `res` serializer still emits all reply headers with only `set-cookie`
  denylisted — the remaining instance of the pattern removed on the request
  side.
