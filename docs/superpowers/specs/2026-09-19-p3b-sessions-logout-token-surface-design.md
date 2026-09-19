# P3b — Sessions, logout and the token surface

**Date:** 2026-09-19
**Status:** Draft
**Umbrella:** `docs/superpowers/specs/2026-09-10-odudu-design.md`, section 11

## 1. What this phase is

Everything that happens to a login after it succeeds: how many of them a
browser may hold at once, how long one outlives the browser, how one ends
everywhere it was used, and what a resource server may ask about the tokens
it produced. It is the second half of what section 11 carried as P3, and it
reads client metadata P3a registered — logout URIs, client keys, audiences,
UserInfo algorithms — while P3a reads nothing this phase builds.

The exit criterion is section 13.

## 2. The size, and why the roadmap row is being corrected

Section 11 estimates P3b at 55–85 hours. That figure is wrong, and this
spec corrects it in the same commit rather than leaving a number standing
that the phase disproves in its first week.

Sizing was done against the two phases that have actually been built.
P3a's plan is 19 tasks across 6 increments against a 55–80 hour row; P2b's
is 29 tasks against 95–130 hours — so this repository runs at roughly
three to four hours per task
(`grep -c '^### Task' docs/superpowers/plans/*.md`). P3b's nine
deliverables size at **about 42 tasks, 135–165 hours**: more than P3 was
after the two omitted items were found, which is the figure that caused
the P3a/P3b split in the first place.

**It stays one phase anyway.** That is a deliberate decision taken on
2026-09-19 with the size known, not an estimate nobody checked. Three
things make it survivable, and they are requirements on the plan rather
than hopes:

- Eight increments, each independently mergeable and each ending green, so
  the phase can be **paused** between any two of them rather than only
  finished.
- Increment order runs from the surface everything else reads — the session
  set — outward, so a pause after any increment leaves a coherent server
  rather than a half-built session model.
- The roadmap row carries the real figure, so whoever picks this up is not
  told it is six weeks of work when it is not.

The seam that was considered and rejected is recorded for whoever revisits
it: sessions and logout (increments 1–5, ~20 tasks, 60–80 h) against the
token and client-authentication surface (increments 6–8, ~22 tasks,
70–90 h). The dependency runs one way — introspection reports
session-backed liveness, and §3.1.2.1's `sub`-with-a-value rule is stated
in terms of an active session, while nothing in the session work reads the
token surface. If this phase stalls, that is where to cut it.

## 3. Decisions

| #   | Decision                                                                                                                                   | Rejected                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Two session cookies, split by lifetime, each a list of session ids                                                                         | One cookie with one list (cannot express per-login remember-me); a `browser_sessions` row the cookie names (a join on `/authorize`, and rebuilds logout's CSRF check) |
| 2   | `frame-src` derived from `RenderedPage`, as `script-src` already is                                                                        | A policy assembled beside the markup; framing only confidential clients; skipping front-channel logout entirely                                                       |
| 3   | `/introspect` authenticates the caller and describes a token only when the caller is in its `aud`; anything else reads `{"active": false}` | An explicit error (an oracle for which tokens exist); any client sees any token; a new resource-server registration concept                                           |
| 4   | The `claims` parameter parses §5.5 in full and is honoured against `standardClaimMappers`                                                  | Honouring only the two clause rows that placed it here; extending the consent screen to individual claims                                                             |
| 5   | Back-channel logout copies the outbox pattern wholesale — queue, command, loop                                                             | Delivery on the request path; a general-purpose job runner                                                                                                            |

Decisions 1, 2 and 3 each get an ADR, because each rejects an alternative
somebody will propose again.

## 4. What is already here

Every claim in this section was checked with the command beside it, per
`CLAUDE.md`'s P2b rule. They are the reason several parts of this phase are
smaller than they look.

| Claim                                                                              | Command                                                                                                             |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| The cookie value **is** a session id, fed straight to `sessionRepository.liveById` | `grep -rn 'resolveSession' packages/protocol-oidc/src/index.ts` — `:379`, `:532`                                    |
| …and is also logout's double-submit CSRF token                                     | `sed -n '170,190p' packages/protocol-oidc/src/usecase/logout.ts`                                                    |
| It is emitted from three places with hand-matched attributes                       | `grep -rn 'set-cookie' packages/protocol-oidc/src/view/routes/` — `login.ts:250`, `consent.ts:101`, `logout.ts:110` |
| The name has one authority already                                                 | `packages/authn-flows/src/index.ts:6` (`sessionCookieName`, ADR 0020)                                               |
| `decideReuse` is 36 lines and assumes one session                                  | `wc -l packages/protocol-oidc/src/usecase/session-reuse.ts`                                                         |
| `parsePrompt` already parses `select_account`                                      | `packages/protocol-oidc/src/service/prompt.ts:4`                                                                    |
| The realm already carries one lifespan pair, with CHECK ranges                     | `packages/db/drizzle/0028_realm_session_lifespans.sql:4,5,8,10,16`                                                  |
| `token_grants` carries `client_id` and `session_id`, indexed                       | `packages/db/drizzle/0026_token_grants_session.sql:5,23`                                                            |
| The queue-and-command pattern exists end to end                                    | `packages/db/drizzle/0043_email_outbox.sql`; `apps/server/src/main.ts:33`; `apps/server/src/modules/outbox.ts:88`   |
| `client_oidc_config.audiences` exists and is already the `aud` source              | `packages/db/drizzle/0007_client_oidc_config.sql:7`; `packages/protocol-oidc/src/usecase/token-issuance.ts:368`     |
| `private_key_jwt` and `tls_client_auth` already pass metadata validation           | `packages/protocol-oidc/src/service/client-metadata.ts:38-44`                                                       |
| `clientKeySet` and its pinned transport are built, tested and wired to nothing     | `packages/protocol-oidc/src/repository/client-keys.ts`; `apps/server/src/client-key-transport.ts`                   |
| The page contract has one authority for headers                                    | `packages/kernel/src/page.ts:62` (`pageHeaders`, ADR 0029)                                                          |
| 44 `deferred: P3b` rows: 29 back-channel, 13 core, 2 RFC 9068                      | `grep -rc 'deferred: P3b' docs/protocols/`                                                                          |
| Latest migration is 0047                                                           | `ls packages/db/drizzle/`                                                                                           |

Two findings from that pass change the work:

**`frontchannel_logout_session_required` exists nowhere.** Not in the
schema, not in `parseClientMetadata`, while its back-channel twin is in
both (`grep -rn 'logout' packages/protocol-oidc/src/schema/client-oidc-config.ts`
returns `postLogoutRedirectUris`, `frontchannelLogoutUri`,
`backchannelLogoutUri` and `backchannelLogoutSessionRequired`, and no
front-channel counterpart). `docs/NEXT.md` records the missing clause
table; it does not record the missing column. Section 6 adds both.

**There is no JWE in this repository.**
`grep -rn 'CompactEncrypt\|EncryptJWT\|JWE' packages/*/src apps/server/src`
is empty. Encrypted UserInfo is a new capability, not a parameterisation of
an existing one, and it is sequenced last for that reason.

## 5. The session model

### 5.1 Two cookies

`__Host-{realm}-session` carries no `Max-Age`; `__Host-{realm}-session-persistent`
carries one. Each holds a delimited list of session ids, and resolution is
the union of the two, pruned to live rows in one query.

The split exists because **"remember me" is a property of one login and
`Max-Age` is a property of one cookie.** A browser holding three sessions
where one was remembered cannot express that with a single cookie: it
either outlives the browser for all three or for none. Splitting by
lifetime makes the correct behaviour fall out — a remembered login survives
browser close and its neighbours do not — without a row to carry it.

Both names go through `sessionCookieName`, which grows a second entry under
ADR 0020's unchanged rule: `__Host-` when TLS is on, unprefixed and without
`Secure` when it is not.

### 5.2 One authority for the cookie

On `pageHeaders`' precedent (ADR 0029): one module decides name,
attributes, list encoding, `Max-Age` and eviction, and the three emission
sites spread its result. A test holds every route to naming no cookie
attribute of its own, the way `html-response.test.ts` already holds view
layers to naming no header.

This is not tidying. The three sites are hand-matched today, and the
comment at `logout.ts:51` says so explicitly — "the attributes have to
match login.ts's own `set-cookie` for a browser to…". Two cookies,
`Max-Age` and a list encoding is more than a hand-match survives.

### 5.3 Schema

- `sessions.remembered boolean NOT NULL DEFAULT false`.
- A second realm lifespan pair beside 0028's, with CHECK ranges in the same
  shape and the same `idle <= max` constraint.
- Both reach `realm-settings.ts`'s name-to-column map, so `seed realm --set`
  configures them with no new CLI concept and no second coercion table.

Ranges stay CHECK constraints rather than validation, per the note in
`docs/NEXT.md`: a policy no writer may bypass belongs at the database.

### 5.4 The cap

A configured per-browser maximum bounds the list. A browser at the cap
which logs in again **evicts its least recently active session** rather
than refusing the login: a login that fails because of an invisible cookie
limit is indistinguishable, to the person in front of it, from a broken
server. `sessions.last_active_at` (0027) is the ordering, and already
exists.

The cap's default is set well below the point where the encoded list
approaches a browser's cookie size limit — see the spike in section 12,
which fixes both the limit and the default.

### 5.5 The reuse decision

`decideReuse` becomes a decision over a set rather than over a session:
`prompt=login` and `max_age` are applied per candidate, and the outcome is
reuse of the single remaining live session, a request for selection, or the
refusals §3.1.2.1 and §3.1.2.6 name.

**Recorded divergence:** logout's double-submit check compares one posted
session id against _membership_ in the resolved set, rather than equality
with the cookie's value. It is the same defence — only a browser holding
the `HttpOnly` cookie can supply a member — restated for a list, and the
ADR for decision 1 says so.

## 6. Logout

### 6.1 The missing half of the front-channel metadata

`frontchannel_logout_session_required` is added to the schema and to
`parseClientMetadata`, and `docs/protocols/oidc-frontchannel.md` is written
with a clause table. The three `ODUDU-CLIENT-META-FRONTCHANNEL-*` ids in
`client-metadata.test.ts` are re-traced to real clause ids against it,
which is the whole of the asymmetry `docs/NEXT.md` records.

### 6.2 Framing, and the page contract

`RenderedPage` grows `frames: readonly string[]` — the exact origins the
page's own markup embeds — and `policyFor` derives `frame-src` from that
one value. This is ADR 0018's amendment applied a second time: the page
says what it carries, the policy is derived from it, and a header naming an
origin the markup does not embed becomes impossible rather than merely
unlikely. `x-frame-options: DENY` stays; it governs being framed, not
framing.

An ADR records what is being accepted. A framed page can navigate the top
window away, so framing a registered URI hands a registered client — in a
realm with anonymous dynamic registration enabled, an anonymous one — a
top-navigation primitive. `sandbox` without `allow-same-origin` would
remove it and would also deny the frame the cookies that are the entire
mechanism, so it is not the answer. The ADR also states plainly that
third-party cookie policy makes front-channel logout best-effort in current
browsers; the spike in section 12 establishes what actually survives before
the increment is planned, rather than after.

### 6.3 The set of logged-in RPs

Back-Channel §2.3's "set of logged-in RPs" for a session is
`select distinct client_id from token_grants where session_id = $1`, on the
index 0026 already created. No new table, and no tracking to maintain.

### 6.4 Back-channel delivery

Copied from the outbox, which is ADR 0024's split already built once:

- `backchannel_logout_deliveries`, written **in the same transaction that
  ends the session**, so a delivery cannot be lost to a crash between the
  two.
- A logout token per RP: `iss`, `aud`, `iat`, `exp`, `jti`, `sid`, the
  `events` member, `typ: logout+jwt`, no `nonce`, and an expiry of at most
  two minutes (§4's SHOULD). Signed; **not encrypted** — §2.4's MAY, and
  JWE does not exist until increment 8. Recorded as deferred with its
  reason.
- `odudu send-logouts`, a command holding all the logic and taking its
  `now` as an argument.
- A module wrapping `startScheduler` and holding none, refusing to start
  rather than rediscovering a missing setting every tick.
- Retry with backoff for recoverable failures only, and no retransmission
  otherwise — §2.5's two SHOULDs are a pair, and implementing one without
  the other is the wrong half.
- Retention folded into `reap`, alongside the outbox's own.

The loop is tested with `vi.useFakeTimers()`, its jitter band asserted by
injecting the draw, and its survival asserted by a **later** run after a
throwing pass — not by the error having been logged.

## 7. Account selection

`prompt=select_account` renders a chooser over the browser's live sessions:
a `*-html.ts` in `protocol-oidc`'s view layer returning `RenderedPage`, on
the consent page's shape, every interpolated value through the renderer's
own `escapeHtml`.

- No session, or selection cannot be obtained: `account_selection_required`.
- Under `prompt=none`: that error rather than any interaction (§3.1.2.6's
  MAY).
- More than one live session and no `prompt` at all: the chooser, not a
  silent reuse of whichever row sorted first.

## 8. The token surface

### 8.1 Audience and `resource`

The per-client audience allowlist becomes the authority for `aud`. RFC 8707
`resource` is accepted at `/authorize` and `/token`, single-valued,
validated against that allowlist, making `aud` derived rather than
asserted. A `resource` naming something the client did not register is
`invalid_target`.

The same work closes `AUDIENCE_UNCHECKED` on `id_token_hint` at **both**
`/authorize` and `/logout` — the second is easy to miss, because
`handleLogoutRequest` reaches the check through
`subjectOfIdTokenHint`, which it shares with `/authorize`
(`packages/protocol-oidc/src/usecase/logout.ts:131`).

### 8.2 Introspection

`/introspect` authenticates the caller with the client-authentication
machinery `/token` already has, including the `client_secret` rate limit
ADR 0023 governs. A token is described only when the caller's own
`client_id` appears in its `aud`; anything else answers
`{"active": false}`.

`active` consults **session liveness**, not only the grant's `revoked_at`.
That is what makes revocation real inside an access token's hour: an
`at+jwt` is self-contained and nothing consults anything before accepting
one, which `docs/NEXT.md` records as the gap introspection exists to close.

### 8.3 Revocation

`/revoke` per RFC 7009, against the grant the token names.

### 8.4 `private_key_jwt`

Wires `clientKeySet` at the moment a signature is verified — never at
registration, which was reverted in P3a for turning an SSRF guard's refusal
reason into a network oracle for an anonymous caller. The refusal says "the
signature did not verify" or "the key could not be retrieved", and never
the guard's own reasoning.

The three nits `docs/NEXT.md` records are fixed here, because this is the
call site that makes them matter:

- `expiresAt` computed from the post-fetch clock, so a slow fetch does not
  shorten its own cache TTL.
- In-flight coalescing, so two concurrent verifications of one URI do not
  both reach the network.
- A negative cache entry with its own shorter TTL, which is the umbrella
  spec §6's "a failure is not a permanent cache miss".

A `jti` replay guard rejects a re-presented assertion within its validity
window.

### 8.5 mTLS

Proxy-header client authentication, gated on the existing
`ODUDU_TRUST_PROXY` (`packages/kernel/src/config.ts:82`). A certificate
header is read only when that flag is on; with it off the method is refused
rather than trusted, since an untrusted header is an authentication bypass
and not a degraded mode.

### 8.6 Clause tables

New reading notes with clause tables for RFC 7662, RFC 7009 and RFC 8707,
in the shape the existing `docs/protocols/` documents use, so every claim
this section makes is traced rather than asserted.

## 9. UserInfo

Signed responses reuse `signJwt`. Encrypted responses introduce the
repository's first JWE, reading the client's encryption key through the
same `clientKeySet` fetcher increment 7 wires. Signed-then-encrypted for
the nested case, `application/jwt` for both, `iss` and `aud` as members of
a signed response — the six §5.3.2 rows in `docs/protocols/oidc-core.md`.

Selection is by registration: `userinfo_signed_response_alg`,
`userinfo_encrypted_response_alg` and `userinfo_encrypted_response_enc`
are already stored and read by nothing.

## 10. The `claims` parameter

§5.5 is parsed in full — both the `userinfo` and `id_token` members, and
`essential`, `value` and `values` — and honoured against
`standardClaimMappers` (`packages/protocol-oidc/src/service/claims.ts:181`),
the same registry that already backs the 22 names in `claims_supported`.

**A requested claim outside the granted scopes is not returned.** The
parameter is never a path around consent, and a test says so rather than a
comment.

Two clause rows placed this parameter here: Essential `auth_time` (§2) and
`sub` requested with a specific value (§3.1.2.1), the second of which is
stated in terms of an active session and so reads section 5's work.

Partial support was rejected. A parameter that parses everything and
honours two things reads as done while failing quietly for every client
that uses the rest — which is the shape of failure this phase inherited
when P3a's machinery shipped without the parameter that reads it.

## 11. Increments

Each is independently mergeable and ends green. A draft pull request opens
with the first push, and every increment ends with CI green on a pushed
commit and the review that push attracted answered.

| #   | Increment                                                     | Tasks |
| --- | ------------------------------------------------------------- | ----- |
| 1   | The cookie authority and the session set                      | 5     |
| 2   | Remember me                                                   | 2     |
| 3   | Account selection                                             | 3     |
| 4   | Front-channel logout, its clause table and its missing column | 4     |
| 5   | Back-channel logout: token, queue, command, loop, retention   | 6     |
| 6   | Audience, `resource`, introspection, revocation               | 9     |
| 7   | `private_key_jwt` and mTLS                                    | 5     |
| 8   | UserInfo JWS/JWE, the `claims` parameter, and the close pass  | 8     |

Increment 1 comes first because everything else reads it, and increment 8
comes last because JWE is the only genuinely new capability in the phase.

## 12. Assumptions, and the spikes that settle them

Per `CLAUDE.md`'s P0 rule: a claim about third-party behaviour carries
either `verified:` or `assumption:`, and every `assumption:` on a
load-bearing path gets a spike **before** the task that depends on it.

**Spike 1 — two cookies and the size limit.** `assumption:` a browser
accepts two `__Host-`-prefixed cookies differing only in name, and the
per-cookie size limit is about 4096 bytes including the name. Both numbers
fix section 5.4's default cap. Runs **before increment 1**, because the
whole session model rests on it.

**Spike 2 — what survives of front-channel logout.** `assumption:`
third-party cookie policy in current browsers prevents a framed logout URI
from seeing the RP's cookies in the common cross-site case, making delivery
best-effort. This decides how section 6.2's ADR is written and whether the
increment promises delivery or attempts. Runs before increment 4.

**Spike 3 — RFC 7662 §2.2 on unauthorized callers.** `assumption:` the
specification permits answering `{"active": false}` to an authenticated
caller not authorized for the token, rather than requiring an error.
Decision 3 rests on it. Runs before increment 6.

**Spike 4 — JWE algorithms and key selection.** `assumption:` `jose`
supports the `alg`/`enc` pairs the registration metadata admits, and a
client's encryption key is selectable from its JWKS by `use`/`alg` without
ambiguity. Runs before increment 8.

## 13. Exit criterion

Concurrent sessions per browser, with `prompt=select_account` choosing
among them and `account_selection_required` where it cannot; a realm's
"remember me", offered on the login form, carrying a cookie that outlives
the browser session and selecting the second pair of idle and maximum
lifespans; front-channel logout delivered against the URIs P3a registers,
with a clause table and the registration metadata completed, and
back-channel logout delivered through a queue and a command rather than on
the request path; token introspection (RFC 7662) scoped by audience and
consulting session liveness, and revocation (RFC 7009); RFC 8707 `resource`
indicators, single-valued against the per-client audience allowlist, making
`aud` derived rather than asserted, with `AUDIENCE_UNCHECKED` closed at
`/authorize` **and** `/logout`; signed and encrypted UserInfo responses
selected by client registration; the `claims` request parameter parsed in
full and honoured against the claim registry, including an Essential
`auth_time` and a `sub` requested with a specific value; `private_key_jwt`
with the JWKS fetcher wired, its three recorded nits fixed and a `jti`
replay guard, and proxy-header mTLS client authentication; the consent
section of `docs/request-paths.md` replaced by a real transcript; every new
repository method probed with a foreign `realm_id`; cross-realm RLS probes
green; CI green on a pushed commit with a pull request open.

## 14. What P3b does not do

- **RFC 7592 client management.** P4, with the rest of the admin surface.
- **Administrative session listing and ending somebody else's session.**
  P4. The session set this phase builds is what that surface will read.
- **Signing-key rotation.** P4; no relying party's request triggers it.
- **Encrypted logout tokens** (Back-Channel §2.4's MAY). Deferred, with its
  reason: JWE arrives in the last increment of this phase, and a logout
  token nobody asked to be encrypted is not worth reopening increment 5
  for.
- **Token exchange, CIBA, the device grant, DPoP.** P5 and P13, unchanged.
- **Theming.** P4b, which the page contract retrofit and section 6.2's
  `frames` member both feed.

## 15. Index of verified claims

Every repository claim in sections 2 and 4 was run on 2026-09-19; the
commands are in the tables beside them. Sections 12's four `assumption:`
entries are the only load-bearing claims in this spec that have not been
executed, and each names the increment it blocks.
