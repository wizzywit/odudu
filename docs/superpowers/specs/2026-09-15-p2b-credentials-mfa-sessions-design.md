# P2b — Credentials, MFA and the session lifecycle

Status: accepted, 2026-09-15. Supersedes nothing; extends
`docs/superpowers/specs/2026-09-10-odudu-design.md` section 11 for one phase,
and amends that section in four places (section 13).

P1 delivered one authenticator behind one hardcoded step, an SSO cookie that
is written and never read, and no way to end a session. P2a delivered the
identity model that a token carries. This phase builds what happens between
a browser arriving at `/authorize` and a session ending: which
authenticators run and in what order, what a user can authenticate _with_,
what stops an attacker guessing it, how long the resulting session lives,
and when the wreckage is deleted.

It is the last phase before the surface widens. P3 adds clients and consent,
P4 adds the admin API; both read the session this phase makes real.

## 1. What P2b delivers

In build order. Each numbered item is several increments; the order is a
dependency order, not a preference.

1. **The session lifecycle.** A `grants` table giving the refresh-token
   family a home, `last_active_at` on `sessions`, realm-configured idle and
   maximum lifespans, and the SSO cookie read at `/authorize`.
2. **RP-initiated logout and offline access.** `end_session_endpoint`, the
   per-client `post_logout_redirect_uris` it matches against, and
   `offline_access` producing a grant no session expiry or logout touches.
3. **The flow engine.** A flat ordered list of executions per realm with
   `REQUIRED` / `ALTERNATIVE` / `CONDITIONAL` / `DISABLED` semantics,
   replacing `STEPS = ['password']`.
4. **Credentials and required actions.** The `user_credentials` widening,
   password policy, TOTP, passkeys, recovery codes, and the required-action
   mechanism that enrols them.
5. **Brute-force protection.** Postgres-backed account lockout, and an
   in-process per-IP throttle on the expensive unauthenticated routes.
6. **Reaping.** A retention pass as a command, scheduled in-process, bounded
   by the detection window ADR 0021 defines.
7. **The email outbox.** P2a's password-reset timing oracle, closed on the
   scheduler item 6 builds.

The session lifecycle leads for the reason web origins led in P2a, inverted:
it is the item everything else touches. Eight clause rows recorded
`deferred: P2` become reachable the moment a session can be read (section
12), and items 2, 3 and 6 all read the `grants` table item 1 adds.

## 2. What P2b does not deliver

Named here so that "we could just also…" is answered by a document rather
than by a judgement call mid-increment. **Every row has an owner**; the one
row without a phase has a reason instead, and that reason is a decision
recorded in section 11 of the umbrella spec rather than an omission.

| Not in P2b                                      | Owner | Why                                                                                                                                                                                                                                        |
| ----------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Front-channel and back-channel logout           | P3    | Both are addressed to a client, not a browser: they need registered per-client logout URIs, and back-channel issues a logout token — a second token type with its own claim rules and its own clause table.                                |
| RFC 7009 revocation, RFC 7662 introspection     | P3    | Placed there with the rest of the client-facing surface. This is why `end_session_endpoint` here revokes grants and no RP-facing revocation endpoint appears: the endpoint is P3's, the state it would revoke is this phase's.             |
| `prompt=select_account`, multi-account browsers | P3    | Needs several concurrent sessions per browser, which reshapes the single-session read this phase invents. P3 already renders a user-choice page during `/authorize` for consent. Three clause rows move by amendment (sections 12 and 13). |
| Nested subflows in the flow engine              | P4    | P4 owns the API and console that would author one. A flat flow is a valid single-level tree, so P4 extends the model rather than converting it (section 13).                                                                               |
| Account-console credential management           | P4    | Enrolment here is a required action inside the login flow. Listing, renaming and deleting a credential at leisure is the self-service console, already placed in P4.                                                                       |
| Administrative session termination              | P4    | P4's exit criterion names it. `sessions` gains `last_active_at` here partly so that list has something worth showing.                                                                                                                      |
| Signing-key rotation                            | P4    | Settled 2026-09-14. Nothing in this phase needs it.                                                                                                                                                                                        |
| Per-realm SMTP configuration                    | P4    | Unchanged from P2a: ADR 0015 puts credentials in the environment. The outbox changes _when_ mail is sent, not where the credentials come from.                                                                                             |
| Step-up authentication driven by `acr`          | —     | Deliberately unplaced in section 11, grouped with DPoP and PAR to be scoped alongside the FAPI 2.0 decision ADR 0016 identifies. This phase _emits_ `acr` and `amr`; honouring a requested value per request is the unplaced part.         |

## 3. The session, read

The central decision of the phase. Everything in sections 4 through 9 is
mechanism; this is the behaviour change a relying party can observe.

### 3.1 What a live session is

Two conditions, both enforced at read time, in `sessionRepository`:

```
now < expires_at              -- created_at + the realm's maximum lifespan
now - last_active_at < idle   -- the realm's idle timeout
```

`expires_at` keeps the meaning it has today — the hard deadline — and stops
being the fixed 12 hours `SESSION_TTL_MS` hardcodes. `last_active_at` is new
and is _touched_, not recomputed into `expires_at`, so the two numbers stay
separately readable: "idled out" and "hit its ceiling" remain
distinguishable after the fact, and P4's session list has a last-use time to
show.

Touched by exactly two things: a successful cookie read at `/authorize`, and
a refresh of a session-bound grant. A refresh counts as activity because a
client refreshing every five minutes on the user's behalf _is_ the session
being used; a client holding an offline grant is not, which falls out of
offline grants having no session to touch.

### 3.2 The gate the cookie read must re-check

`docs/NEXT.md` names this trap and it is closed in the same increment as the
read, not after it. The email-verified login gate lives in
`login-submission.ts`, reached only through
`POST /realms/{realm}/login-actions/authenticate`. A cookie that can
complete an authorization request is a second door into the same decision:
an unverified self-registered user holding a live session cookie would
otherwise sign in for free.

Nothing today would catch it. The existing tests exercise the form POST, and
the form POST keeps working. So the check moves out of `login-submission`
into a place both paths call, and the increment carries a test that drives
the cookie path specifically: a realm with `verify_email` on, an unverified
account, a live session row, and an `/authorize` request that must not
succeed.

### 3.3 What a readable session makes reachable

| Request                      | P1 behaviour                                | P2b behaviour                                                                                                                                     |
| ---------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| no `prompt`, live session    | fresh authentication every time             | the session is reused; a code is issued without a page                                                                                            |
| `prompt=none`, live session  | unconditional `login_required`              | a code is issued, still with no page, no authentication session and no cookie written                                                             |
| `prompt=none`, no session    | `login_required`                            | unchanged — and the reading note's constraints hold: it stays a redirect, below the §4.1.2.1 boundary, with no page and no authentication session |
| `prompt=login`, live session | fresh authentication (accidentally correct) | reauthentication is deliberate, and refusable — the §3.1.2.1 row that had no reachable branch acquires one                                        |
| `max_age` exceeded           | ignored                                     | reauthentication is forced; `auth_time` is emitted because a `max_age` was carried                                                                |

`auth_time` comes from the session, not from the clock at issuance: it is
when the user authenticated, which after reuse is in the past. The flow
records which authenticators ran, which is what makes `acr` and `amr`
statements about this login rather than constants.

## 4. Data model

Migrations 0026 onward; 0025 is the last one P2a left. Every policy is
hand-authored SQL in `packages/db/drizzle/`, never `pgPolicy()`, and every
new table gets its isolation policy in the same migration —
`rls-policy.int.test.ts` fails the build on a table without one, and
`schema-drift.int.test.ts` on a typed view that drifts from it.

Bounds are `CHECK` constraints, not clamps at the point of use, following
migration 0013's reasoning: a constraint is true of every writer there will
ever be, including P4's admin API, whereas a clamp is true only of the code
path that remembers to apply it.

### 0026 — `grants`

The refresh-token family has a name in the code (`grantId`) and no home. It
acquires one:

| Column       | Notes                                                             |
| ------------ | ----------------------------------------------------------------- |
| `grant_id`   | primary key; what `refresh_tokens.grant_id` already carries       |
| `realm_id`   | denormalized for isolation without a join, as `sessions` does     |
| `subject_id` | composite FK to `subjects(realm_id, id)`                          |
| `client_id`  | the client the grant was issued to                                |
| `session_id` | **nullable — null means offline**; FK to `sessions`               |
| `scope`      | the scope the grant was issued for                                |
| `created_at` | when the family started, which is what dates the detection window |
| `revoked_at` | set by logout, by reuse detection, and by nothing else            |

`refresh_tokens` keeps only what is per-token: `token_hash`, `grant_id`,
`issued_at`, `expires_at`, `used_at`, `replaced_by`. Three consequences
follow, and each is the reason the table exists rather than four more
columns on the token:

- **Logout is one statement.** `UPDATE grants SET revoked_at = now() WHERE
session_id = $1` revokes every family belonging to a session, whatever
  their rotation depth.
- **Offline is the absence of a session**, not a boolean anybody can
  contradict. A grant with no `session_id` cannot be expired by a session
  lifespan or ended by a logout, because there is no session to read.
- **The detection window is dated once.** Retention is bounded below by the
  life of the family (ADR 0021); with `created_at` on the grant, that is a
  column, not a `MIN` over the ~288 rotations a five-minute client leaves
  behind each day.

Rotation's reads change with it: `refresh-rotation.ts` currently decides
from the token row alone, and must now also refuse a grant whose
`revoked_at` is set or whose session is no longer live. ADR 0019 already
fixes the order — the grant is decided before the rotation — so this adds
conditions to an existing decision point rather than moving it.

### 0027 — `sessions` gains `last_active_at`

`NOT NULL DEFAULT now()`, backfilled to `created_at` for existing rows.
`expires_at` stays, with its meaning narrowed to the maximum-lifespan
deadline.

### 0028 — realm session lifespans and password policy

Columns on `realms`, each `CHECK`-bounded:

- `sso_session_idle_seconds` (default 1800), `sso_session_max_seconds`
  (default 36000), with a constraint that idle does not exceed maximum — an
  idle timeout longer than the ceiling is not a lenient configuration but a
  meaningless one.
- `password_min_length` (default 8), `password_require_digit`,
  `password_require_uppercase`, `password_require_lowercase`,
  `password_require_special`, `password_not_username`, `password_not_email`,
  `password_history_depth` (default 0), `password_max_age_days` (default 0,
  meaning no expiry).
- `brute_force_max_failures` (default 5),
  `brute_force_lockout_seconds` (default 60),
  `brute_force_max_lockout_seconds` (default 900),
  `brute_force_failure_reset_seconds` (default 43200).

Every default is chosen so that **a realm upgraded into this migration
behaves as it did before**, except where behaving as before is the defect
the phase exists to fix. Lockout is on by default because "protects any
endpoint using password authentication against brute-force attacks" is a
MUST (RFC 6749 §2.3.1) and a MUST that ships off is not held. Password rules
default to a minimum length of 8 and no class requirements, which is the
weakest policy this phase is willing to call a policy.

### 0029 — `user_credentials` widening

Four changes, in one migration because the uniqueness rule and the type
check are one decision seen from two sides:

1. `CHECK (type IN ('password','totp','webauthn','recovery-code','password-history'))`.
   `password-history` is in the check because section 6.1 stores retired
   password hashes as ordinary credential rows; it is the one type no
   authenticator ever verifies against.
2. `secret_data` `text` → `jsonb`, existing password rows converted to
   `{"hash": "<the PHC string>"}` in the same statement. The conversion is
   the migration's whole risk and gets the spike in section 10.
3. `UNIQUE (subject_id, type)` dropped, replaced by partial unique indexes
   on `password` and `totp` alone. A user has one password and one TOTP
   secret; they may hold several passkeys and several recovery codes, and
   the old constraint would have refused the second of either.
4. New columns: `label` (user-supplied, for telling two passkeys apart),
   `last_used_at`, and `lookup_key` — nullable, unique per realm, holding
   the WebAuthn credential ID.

`lookup_key` is what makes a passwordless login possible at all: a
discoverable-credential assertion arrives identifying a credential, not a
user, so the server must resolve a subject from the credential ID through an
index rather than by scanning `jsonb` across a realm.

The per-type shape of `secret_data` is a discriminated union parsed with Zod
at the repository boundary — `unknown` narrowed, never `any`, and never a
cast. `CredentialRecord.type` stops being the literal `'password'`.

### 0030 — `authentication_executions`

`(realm_id, index)` unique, `authenticator` text, `requirement` constrained
to the four values. Provisioned with the default browser flow when a realm
is created, by the same `provision-defaults` path that already seeds client
scopes.

### 0031 — `user_required_actions`

`(realm_id, subject_id, action)` unique, with `created_at`. Rows are
consumed when the action completes.

### 0032 — `login_failures`

`(realm_id, subject_id)` primary key, `failure_count`,
`first_failure_at`, `last_failure_at`, `locked_until`. Keyed by subject, not
by username: a lockout that follows a username would let an attacker lock an
account out of existence by guessing at a username the account no longer
uses, and would miss an attacker who reaches the same account by email.

### 0033 — `clients.post_logout_redirect_uris`

RP-initiated logout's own client metadata. It is here and not P3 for the
same reason `end_session_endpoint` is: an endpoint that redirects to a URI
it cannot validate is an open redirector, so the registration arrives with
the endpoint that reads it, not with the phase that happens to own most
client metadata.

### 0034 — `email_outbox`

`id`, `realm_id`, `to_address`, `subject`, `body`, `created_at`,
`sent_at` (nullable), `attempts`, `last_error` (nullable),
`next_attempt_at`. Claimed by the sender with `FOR UPDATE SKIP LOCKED` so
two schedulers never send the same message twice.

## 5. The flow engine

`advance()` keeps its signature. That is the constraint the P1 comment in
`executor.ts` set — "P2 replaces it with a tree of requirements without
changing what a caller of `advance` sees" — and it is worth keeping because
`login-submission.ts` reads the result and should not learn about
requirements.

### 5.1 Evaluation

Executions for the realm are loaded in `index` order and evaluated as a
single level:

- `DISABLED` — skipped entirely, as though absent.
- `REQUIRED` — must succeed; a failure fails the flow.
- `ALTERNATIVE` — consecutive `ALTERNATIVE` executions form one group, and
  any one success satisfies the whole group. This is how Keycloak evaluates
  alternatives _within_ a flow; making the grouping positional rather than
  structural is exactly what lets a flat list express it.
- `CONDITIONAL` — the authenticator decides its own applicability from the
  subject's enrolled credentials and the realm's policy, and an inapplicable
  step is skipped rather than failed.

Nesting is P4's (section 13). A flat list is a valid single-level tree, so
the rows P2b writes are rows P4 extends.

### 5.2 The default browser flow

| Index | Authenticator | Requirement   |
| ----- | ------------- | ------------- |
| 0     | `passkey`     | `ALTERNATIVE` |
| 1     | `password`    | `ALTERNATIVE` |
| 2     | `otp`         | `CONDITIONAL` |

A passkey or a password gets you through the first group. The conditional
OTP step applies when the subject has a TOTP credential enrolled, or the
realm requires one — and **not after a passkey**, because a passkey
assertion is already two factors and demanding a second is a policy this
phase does not hold.

### 5.3 State across steps

A multi-step login needs to resume, not restart, so
`authentication_sessions` records the executions already satisfied.
`AuthenticatorResult`'s challenge widens from `form: 'password'` to the form
each authenticator renders, and the executor's `STEPS`/`AUTHENTICATORS`
lookup becomes a registry keyed by the `authenticator` column — an unknown
authenticator name in a row is a startup-time failure, not a login-time one.

The constant-time property P1 built survives: `DUMMY_SUBJECT_ID` and
`DUMMY_HASH` exist so an unknown username costs what a wrong password
costs, and the password step's contract (no `tx`, no repository, verification
gathered by the caller) does not change.

## 6. Credentials

### 6.1 Password policy

One service in `domain-identity` evaluates a candidate against a realm's
policy and returns **every** violation, not the first. A form that rejects a
password one rule at a time is a form that takes four attempts to satisfy.

It is called by every writer of a password without exception: registration,
password reset, the admin seed path, and the change-password required
action. A policy enforced at three of four call sites is a policy with a
bypass.

`password_history_depth` needs previous hashes retained. They go in
`user_credentials` as `password-history` rows — ordinary credential rows,
subject to the same reaping rules, never verified against for
authentication. `password_max_age_days` produces a required action rather
than a refused login: an expired password is a user who must change it, not
a user who is locked out.

### 6.2 TOTP: built, not depended upon

RFC 6238 over `node:crypto`, in `packages/crypto`. Roughly twenty lines of
HMAC, truncation and a time-step window. Three reasons, in order of weight:

1. **The RFC ships its own test vectors** (§5, appendix B, for SHA-1,
   SHA-256 and SHA-512), so correctness is checked against the specification
   rather than against a library's agreement with itself.
2. `packages/crypto` is the one package already under Stryker mutation
   testing, and a twenty-line algorithm with published vectors is precisely
   what mutation testing is good at.
3. A dependency here would be a supply-chain surface accepted for no
   arithmetic anybody needs help with.

Verification accepts a ±1 time-step window and records the last accepted
step in `secret_data`, so a code cannot be replayed inside its own validity
window. The enrolment page renders the `otpauth://` URI both as text and as
a QR code; the QR encoder is a dependency, since that _is_ a problem nobody
needs to re-solve, and it is confined to the view layer.

### 6.3 Passkeys

`@simplewebauthn/server`, pinned, because attestation parsing, CBOR and COSE
key handling are not twenty lines and the failure modes are not the kind
tests find by accident. Registration and authentication ceremonies both,
with the assertion resolved through `lookup_key` so no username need be
typed. The signature counter is checked and stored on every assertion —
a counter that fails to increase is a cloned authenticator, and refusing
that is the point of storing it.

The relying-party ID is derived from `ODUDU_PUBLIC_BASE_URL`, never from a
request header, for the reason P2a's mailed links are: an RP ID an attacker
can influence is an RP ID an attacker can move.

### 6.4 Recovery codes

Ten single-use codes, generated together, each hashed with the same Argon2id
parameters as a password and stored as its own row. Shown exactly once, at
generation. Consumed by deleting nothing — a used code is marked used, so a
replay is distinguishable from an unknown code, which is the same reasoning
ADR 0021 applies to every other single-use credential in the schema.

They are in this phase because a realm that requires TOTP and has no
recovery path is a realm that locks a user out permanently: there is no
admin API until P4. The migration and the required-action surface are
already being built here, so the cost is a fourth type rather than a
mechanism.

### 6.5 Required actions

A pending action blocks the completion of a login: it runs after
authentication succeeds and **before** the session is established and the
code is issued. Pages render server-side, in the style
`packages/account/src/view` already established for registration, reset and
verification.

Actions in P2b: `configure-totp`, `configure-passkey`, `update-password`,
`generate-recovery-codes`. Each is added by policy — a realm requiring OTP
adds `configure-totp` to a subject with no TOTP credential; a password past
`password_max_age_days` adds `update-password` — and removed on completion.

This mechanism is what makes a realm-level requirement expressible at all.
Without it, "this realm requires OTP" can only mean "OTP is offered to
whoever already has it", and the `CONDITIONAL` step in section 5.2 would
have nothing to require.

## 7. Logout and offline access

### 7.1 `end_session_endpoint`

Per OpenID Connect RP-Initiated Logout 1.0, advertised in discovery. The
request carries `id_token_hint`, `client_id`,
`post_logout_redirect_uri` and `state`; the hint is validated the way
`/authorize` already validates one — this realm's keys, this realm's `iss`,
with an access token refused by `typ`.

A `post_logout_redirect_uri` is matched against the client's registrations
before any redirect, and an unmatched one is rendered, never redirected to.

**A logout with no `id_token_hint` renders a confirmation page** — the
specification's SHOULD, and the reason it is honoured rather than noted is
that ending a session on a bare `GET` is CSRF-shaped: an `<img>` tag on any
page would log the user out of every realm they hold a session in. The
confirmation form carries the same single-use hidden field the login form
uses as its CSRF defence.

### 7.2 What logout revokes, stated plainly

The session row, and every grant whose `session_id` is that session. It does
**not** revoke access tokens, and the specification, the README and
`docs/request-paths.md` will all say so in those words: Odudu's access
tokens are self-contained `at+jwt` JWTs, so a resource server verifies a
signature and an expiry and consults nothing. The window in which a logged
-out user's access token still works is exactly
`client_oidc_config.access_token_ttl_seconds`, which migration 0013 already
caps at one hour and documents as "the whole of the window in which a stolen
token still works". Logout shortens nothing about it.

Grants with a null `session_id` — offline grants — are untouched. That is
the definition of offline access, not an exception to logout.

### 7.3 `offline_access`

A realm-owned client scope, following P2a's model, which a client must be
assigned and must request. Granting it produces a grant with no
`session_id`; its refresh token is bounded by the client's own refresh TTL
and by the retention rules in section 8, and by nothing about a session.

Reuse detection is unchanged and unweakened: an offline grant is still a
family, still rotates, and a replayed token still revokes it.

## 8. Reaping, and the retention window

### 8.1 Shape

The pass is a usecase with no timer in it, exposed as `odudu reap` through
the `apps/server/src/cli` path `seed` already uses. `apps/server` then runs
it on a jittered interval behind a Postgres advisory lock, so two instances
never reap concurrently and a default container reaps itself without an
operator having to learn that it must.

The loop holds no logic — interval, jitter, lock, call — and the retention
rule lives in the command, where a test drives it directly.

### 8.2 The rule

**A row is deletable once no decision can read it.** Applied per table, that
is:

| Table                     | Deletable when                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authentication_sessions` | expired or consumed, plus a short grace — nothing reads a spent one except to refuse it, and the parked request dies with it                                              |
| `authorization_codes`     | the grant family it produced is past its own retention, **not** when the code expires                                                                                     |
| `refresh_tokens`          | the grant family is past its retention                                                                                                                                    |
| `grants`                  | `created_at` plus the realm's detection window, which is the maximum family life: the refresh TTL for a session grant, and an explicit offline ceiling for an offline one |
| `sessions`                | past `expires_at` plus a grace, and no live grant references it                                                                                                           |
| `action_tokens`           | consumed or expired, plus a stated window, so a replayed link is still distinguishable from one that never existed                                                        |
| `email_outbox`            | sent, plus a stated window; a permanently failed message is kept until an operator has had a chance to see it                                                             |

ADR 0021 gets an amendment fixing the window numbers and recording the
`grants`-dated derivation, rather than a new ADR: the decision is unchanged,
its arithmetic is newly expressible.

### 8.3 The test that matters

`DELETE … WHERE expires_at < now()` is the implementation this phase must
not ship, and it passes every test that asserts a replayed credential was
refused — because the broken implementation refuses it too, with the same
`invalid_grant`, having simply failed to notice it was a replay.

So the reaping increment carries a test that, after a full pass:

1. replays a consumed refresh token and asserts the **family is revoked**,
   `{ kind: 'reused' }` and not `{ kind: 'unknown' }`;
2. replays a consumed authorization code and asserts the grant it produced
   is revoked.

An assertion on the refusal alone is not evidence and does not close these
rows.

## 9. Brute-force protection

Two mechanisms, because there are two authorities.

**Account lockout is in Postgres.** `login_failures` counts failures per
`(realm, subject)` and sets `locked_until` with backoff doubling to the
realm's ceiling; the counter resets after
`brute_force_failure_reset_seconds` of quiet, or on a successful login. It
is in the database because it must survive a restart and be shared by every
instance — a lockout an attacker can clear by waiting for a deploy is not a
lockout.

A locked account's login attempt returns what a wrong password returns. The
distinction is deliberate: telling a submitter "this account is locked"
confirms the account exists, which is the enumeration P1's constant-time
password path was built to prevent.

**The per-IP throttle is in process.** A small sliding window over the
routes that cost real CPU while unauthenticated: the login POST,
registration, and the password-reset request. Not `/token`, which is a
client-authenticated hot path where a per-request counter is a cost paid on
every legitimate call.

This is per-instance, and the spec, the README and the ADR say so rather
than implying otherwise: N instances behind a load balancer means N times
the allowance. It is accepted because the throttle's purpose is protecting
_this process's_ CPU from an unauthenticated Argon2id flood, which is
legitimately this process's business, while the security property that must
be globally true — lockout — is the one in the database.

The Argon2id surface P2a widened is what this closes: registration performs
one 19 MiB hash per request with no account requirement at all, and
Fastify's 1 MB body limit is currently the only ceiling on anything. A
maximum password length lands here too, since "no maximum" and "19 MiB per
attempt" are the same defect stated twice.

## 10. Spikes

Every claim about third-party behaviour on a load-bearing path is either
`verified: <command>` or `assumption:` in the plan, and every `assumption:`
gets a spike **before** the task depending on it. This is the P0 rule, and
each of these four is a claim that reads as obviously true and has a history
of not being:

1. **`@simplewebauthn/server`'s actual API at the version we pin.** Not the
   API its README shows for whatever version is current when the plan is
   written.
2. **`jsonb` conversion of `secret_data`** against a database carrying real
   Argon2id PHC strings, run forwards on a seeded database, including a
   string containing characters that make a naive `to_jsonb` call interesting.
3. **Postgres advisory locks inside `withRealm`.** The wrapper sets realm
   context with `set_config(..., true)` — the bindable form of `SET LOCAL` —
   on a pooled connection. Whether a session-scoped advisory lock behaves as
   the reaper needs it to inside that transaction, and whether the
   transaction-scoped variant is the correct one, is a property of the
   pooling and not of the documentation.
4. **A discoverable-credential assertion with no username.** Whether the
   ceremony can be completed, and the subject resolved from the credential
   ID, without the page ever having held a username — the assumption
   section 5.2's first row is built on.

## 11. Testing

Unchanged in discipline from P2a: tests precede implementation, integration
tests run against real PostgreSQL through Testcontainers, every repository
method is probed with a foreign `realm_id`, and `SET LOCAL` never `SET`.

Specific to this phase:

- **The flow engine's requirement semantics are unit-tested** as a pure
  evaluation over a list of executions and a set of outcomes, separately
  from any authenticator. The grouping rule in section 5.1 is the part most
  likely to be subtly wrong and the cheapest to test in isolation.
- **TOTP is tested against RFC 6238's published vectors** for all three
  hash functions, and under Stryker.
- **The cookie path gets its own email-verification test** (section 3.2).
- **Reaping gets the replay-after-pass test** (section 8.3).
- **Lockout is tested for what it does not say**: a locked account and a
  wrong password produce indistinguishable responses.
- **The outbox is tested for the oracle it closes**: the reset endpoint's
  response time for a known address and an unknown one, with the SMTP
  adapter deliberately slow, and no `await` on delivery in either.

`tests/docs/` grows checks for the claims this phase adds to
`docs/request-paths.md` that can be checked — the discovery document
advertising `end_session_endpoint`, and the lifespan defaults a realm is
provisioned with.

## 12. Traceability

Eight rows recorded `deferred: P2` become closable, and each needs a test id
rather than an adjacent assertion:

| Clause                  | What closes it                                             |
| ----------------------- | ---------------------------------------------------------- |
| RFC 6749 §2.3.1 MUST    | account lockout (section 9)                                |
| OIDC Core §2 MUST       | `auth_time` present when `max_age` was carried             |
| OIDC Core §2 SHOULD     | `acr` is a registered name or an absolute URI              |
| OIDC Core §2 MUST       | a registered `acr` name is not reused with another meaning |
| OIDC Core §2 SHOULD     | `amr` values, from the same                                |
| OIDC Core §3.1.2.1 MUST | `prompt=login` refusable when reauthentication cannot run  |
| OIDC Core §3.1.2.1 MUST | `max_age` exceeded forces reauthentication                 |
| OIDC Core §15.1 MUST    | the OP enforces `max_age`                                  |

Three rows **move** rather than close — §3.1.2.1's `select_account` SHOULD
and MUST, and §3.1.2.6's `account_selection_required` MAY — from
`deferred: P2` to `deferred: P3`. `pnpm trace` prints nothing for a
`deferred:` row in either state, so this change is invisible to the build
and must be made deliberately, in a diff a reviewer sees.

New clause tables under `docs/protocols/`: OpenID Connect RP-Initiated
Logout 1.0, RFC 6238, and WebAuthn Level 2 — scoped to the ceremonies a
relying party performs, not to a browser's obligations, which are not this
server's to hold. Every MUST and SHOULD introduced gets a row, and
`silenced-musts.json` is raised in the same commit as any `deferred:` or
`n/a:` row that silences one. `pnpm trace` runs strict: a MUST left `gap`
fails the build.

## 13. Roadmap amendments

Four, written as amendments to section 11 of the umbrella spec, because an
accepted document is corrected by appending rather than by editing what it
said:

1. **Nested subflows are P4's.** The flat model P2b ships is a valid
   single-level tree; P4 extends the schema when it has an editor asking for
   nesting, and existing rows migrate rather than convert.
2. **The email outbox is P2b's.** It applies section 11's own retention
   argument: the phase that builds the mechanism owns what depends on it.
   P2b builds the scheduler for reaping, so the outbox costs a table and a
   sender rather than new infrastructure — and P2a's recorded limitation is
   closed in the next phase rather than carried into a third.
3. **`prompt=select_account` is P3's**, beside consent, because both are a
   user-choice page rendered during `/authorize`, and a multi-session cookie
   does not belong in the phase inventing the single-session read.
4. **P2b's exit criterion is amended** to name the outbox and recovery
   codes. Section 11 already carries a heading on exit criteria that omitted
   work their phase owned; adding work to a phase without amending the
   sentence that decides when it is done would reproduce that failure
   exactly.

## 14. Documentation

`README.md` and `docs/request-paths.md` describe what the server does now,
and an increment that changes a request, a response, a branch, an error
code, an endpoint, a command or a default updates them in its own commit.
For this phase that is most increments.

`docs/request-paths.md` gains transcripts, each executed against a running
stack: a login reused from a cookie, a `prompt=none` that succeeds, a TOTP
enrolment and a TOTP login, a passwordless passkey login, a logout with and
without a hint, an offline grant surviving a logout, and a reaping pass. Its
promise is that every command was run and every response is real output; an
increment that changes behaviour re-runs the affected transcript or the
document silently becomes a claim.

`README.md` gains the environment variables this phase adds and loses P2a's
"Known limitation" paragraph on the password-reset timing oracle, which the
outbox closes.

`docs/NEXT.md` is updated at the end of **every** increment, not at phase
close: it is the file the next session starts from, and an increment that
leaves it stale has moved the code and not the position. At phase close its
"Start here" section is rewritten to state what P3 inherits — including
anything this phase's exit criterion does not ask for, so that a phase
closing cleanly is not read as a phase closing completely.

`CLAUDE.md` is updated when this phase changes a convention rather than
applying one. Two candidates are known in advance: the codebase acquires its
first background loop (section 8.1), so "how a scheduled pass is written and
how it is tested without a timer" becomes a rule rather than a precedent;
and the required-action mechanism (section 6.5) establishes where a
server-rendered flow page lives. A third may appear; the test is whether a
future increment would otherwise have to guess.

**No document in this repository describes behaviour that has not been
run.** That is the standing promise of `docs/request-paths.md`, and this
phase holds `README.md` and `docs/NEXT.md` to it as well: a default, a
lifespan, an error code or an endpoint stated in prose is one a test asserts
or a transcript shows. Where something cannot be run — a per-instance limit
under a load balancer nobody here runs (section 9) — the document says it
cannot, rather than showing output nobody produced.

New ADRs: the flat flow model and what P4 must extend; the `grants` table
replacing per-token family columns; the split brute-force authority and the
per-instance limit it accepts. One amendment: ADR 0021, for the retention
window's numbers and its `grants`-dated derivation.

## 15. Shape and risk

Roughly **95–130 hours**, against the roadmap's 80–110. The difference is
the outbox and recovery codes, both added deliberately in section 13's
amendments, and not scope discovered inside the original sentence.

The three risks worth naming:

- **WebAuthn is the only item with an irreducible unknown.** Its spike is
  first among the four, and if a passwordless assertion cannot be resolved
  as section 5.2 assumes, the flow's first group degrades to a passkey
  second factor and the phase still closes — but that is a spec change, made
  visibly, not a quiet retreat during an increment.
- **The `grants` migration touches the refresh path**, which is the busiest
  code in the repository and the one carrying reuse detection. It lands
  first, alone, with the replay tests green before anything else is built on
  it.
- **The phase is long.** Seven items, each independently mergeable, each
  ending green, with a draft pull request open from the first push and CI
  green per increment. P1 ran nineteen increments with no pull request open
  and a broken container build survived eight of them; the mechanism that
  prevents a repeat is the pull request, not the intention.

## 16. Exit criteria

The roadmap's sentence, as amended:

> password, TOTP, passkey and recovery-code login through the flow tree;
> password policies and brute-force protection; an SSO session that is read
> as well as written, with idle and maximum lifespans, ended by RP-initiated
> logout; offline access; mail sent off the request path; expired state
> reaped on a stated retention window, with a test that fails if reaping
> breaks code or refresh-token reuse detection; adversarial suite green.

Checked clause by clause against a running stack at phase close, not
inferred from the code — the practice P2a's closing note established. Plus
the standing conditions: `pnpm verify` green, `pnpm trace` green in strict
mode, `container` and `conformance` green on a pushed commit with a pull
request open, and `docs/NEXT.md` updated to say what P2b leaves for P3.
