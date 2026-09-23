# P4a — Token exchange (RFC 8693)

**Date:** 2026-09-23
**Status:** Draft
**Umbrella:** `docs/superpowers/specs/2026-09-10-odudu-design.md`, section 11

## 1. What this phase is

A fourth grant at `/token`: RFC 8693 token exchange, by which a client
presents a token it holds and receives a different one, narrowed, for a
different audience. It is protocol work in `protocol-oidc` and touches no
console. P5's agent layer consumes it at stage 4 of the token pipeline,
where the delegated intersection is the attenuation check, and introduces
no grant of its own.

It also closes the grant-selection gap `docs/NEXT.md` has held open since
P3b — `/token` enforces no `config.grantTypes` allowlist — because adding a
grant is the next change to grant selection and the two must not be done
twice.

The exit criterion is section 14.

## 2. P4 is four phases, and this is the first

Section 11 carried P4 as one 155–230 hour row: "Admin API and consoles". It
is fourteen independent deliverables, against P3b's 135–165 hours, which the
roadmap already treated as the largest it would tolerate whole. P2 became
P2a and P2b, P3 became P3a and P3b, and P10 became P4b and P10, each for
less.

P4 therefore splits four ways:

| Order | Phase   | Contents                                                                                                                                                                                                                                                                                             | Effort   |
| ----- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1     | **P4a** | This phase. Token exchange, the `grant_types` allowlist, `rfc8693.md`.                                                                                                                                                                                                                               | 45–65 h  |
| 2     | **P4c** | The admin API: the `admin-api` package, the system tenant and admin authorization, tenant settings, client management, user provisioning, session listing and termination, signing-key rotation, audit events, OpenAPI — and claim mappers and the authentication flow made configurable through it. | 95–125 h |
| 3     | **P4d** | The admin and account consoles, the console framework ADR, Playwright, tenant import and export.                                                                                                                                                                                                     | 55–85 h  |
| 4     | **P4b** | Theming and client branding. Unchanged.                                                                                                                                                                                                                                                              | 55–90 h  |

**The letters do not read in execution order.** `P4b` was spent on theming
on 2026-09-17, when P10 split, and it is cited in fifteen passages of the
umbrella spec and seven of ADR 0030 — an accepted ADR is corrected by
appending, not by editing what it said, so renaming it would falsify a
record that was true when written. The order is **P4a → P4c → P4d → P4b**,
and section 11 says so where the rows appear.

Two things the split does not cost, both checked rather than assumed.
`tests/docs/not-implemented-placement.test.ts` accepts `\bP\d+[a-z]?\b`, so
new letters pass the build check with no edit. And nothing under
`docs/protocols/` defers a clause past P3, so no traceability row moves.

What it does cost is citation ambiguity: roughly 130 bare `P4` references
exist across the documents. The P2 split answered this with a written rule
rather than an edit, and this split tried to inherit that — wrongly.

**`tests/docs/phase-references.test.ts` requires every phase a document
cites to exist as a row in the roadmap table.** It did not exist when P2
split. Removing the `P4` row therefore turned every bare `P4` in `README.md`
and `docs/request-paths.md` into a build failure — twelve of them — and no
written rule can satisfy a test that resolves citations against the table.
They were resolved individually, which is what the test is for.

The rule survives only for the prose the test does not read — `docs/NEXT.md`
and the archived phase specs — where **a bare `P4` means P4c** unless it
concerns token exchange, the grant allowlist, theming or client branding.
P4c is the right default because it inherits the admin surface, which is
what almost every such citation is reaching for.

The general lesson is the one `CLAUDE.md` already states and this split
rediscovered: a phase that renumbers or splits anything greps every document
before it closes. Here the grep was run and the conclusion drawn from the
P2 precedent was still wrong, because a check had been added in between.

### Why token exchange goes first

It is the only one of the four that depends on nothing the others build.
Its permissions are per-client metadata on `client_oidc_config`, which the
dynamic client registration endpoint P3a shipped already writes, so it
needs no admin API. It is continuous with P3a and P3b, in the same package
and the same test infrastructure. And it unblocks P5 three phases earlier
than the alternative.

The two items originally grouped with it — configurable claim mappers and
the configurable authentication flow — cannot go first, and not for effort
reasons. "Configurable" is a surface, not a mechanism. Shipping them before
the admin API leaves them settable by `psql` alone, which is precisely the
state `docs/NEXT.md` complains of for client metadata today, and would need
a throwaway CLI door built to be deleted. They are P4c's, delivered through
the surface that makes them configurable at all.

### The consequence for an open decision

`docs/NEXT.md` triggers the `client.enabled` question — `/userinfo` and
`/introspect` honouring a disabled client's live access token — on "where
disabling a client becomes an operation at all". That is P4c, so the
question stays open one phase longer than that entry anticipates. P4a does
not answer it, and must not: an exchanged token inherits the subject
grant's liveness checks unchanged, so whatever P4c decides applies to
exchange for free.

## 3. Decisions

1. **The profile is full, bounded by what this server can express.** Not a
   minimal profile. RFC 8693 is a framework and names no mandatory token
   type set, so "fully implemented" is a decision to write down rather than
   a property to read off the RFC. Section 4 is that decision, and every
   exclusion in it is a clause-table row rather than a silence.
2. **Scope attenuates; audience does not.** Section 7.
3. **An exchanged grant inherits the subject grant's session.** Section 9.
   This is the decision the phase turns on.
4. **Impersonation is off by default and opt-in per client**; delegation
   rides the `grant_types` allowlist. Section 6.
5. **The generic `:jwt` token type is refused**, deliberately. Section 4.
6. **The dead schemas in `packages/contracts/src/token.ts` are deleted**
   rather than extended. Section 5.

## 4. The profile

| RFC element                            | P4a                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `grant_type`                           | `urn:ietf:params:oauth:grant-type:token-exchange`                           |
| `subject_token_type`                   | `access_token`, `refresh_token`, `id_token`                                 |
| `requested_token_type`                 | `access_token`, `refresh_token`, `id_token`; defaults to `access_token`     |
| `issued_token_type`                    | always returned                                                             |
| `actor_token` / `actor_token_type`     | supported; presence selects delegation                                      |
| `resource`                             | via the existing `parseResource`                                            |
| `audience`                             | supported, matched without URI parsing                                      |
| `scope`                                | intersected against the subject grant                                       |
| `act`, nested `act`                    | full chain, depth-capped                                                    |
| `may_act`                              | **enforced when present**; minting and its policy store `deferred: P5`      |
| `saml1`, `saml2`                       | `deferred: P8`                                                              |
| `urn:ietf:params:oauth:token-type:jwt` | **refused**                                                                 |
| Errors                                 | `invalid_request`, `invalid_target`, `invalid_scope`, `unauthorized_client` |

**Why `:jwt` is refused.** This server mints four kinds of JWT: `at+jwt`,
ID tokens with `typ` absent per OIDC, `logout+jwt`
(`packages/protocol-oidc/src/service/logout-token.ts`) and `userinfo+jwt`
(`packages/protocol-oidc/src/usecase/userinfo.ts`). The last of those
exists _because_ a signed UserInfo response was once acceptable as an
`id_token_hint`. A token type identifier meaning "any JWT this issuer
signed" reopens that class on purpose, at a grant whose output is a
credential for a third party. The three named types each carry their own
verification rule, and a caller that wants one names it.

**`invalid_request`, not `invalid_grant`, for a bad subject token.** §2.2.2
is unusually strong: "If the request itself is not valid or if either the
`subject_token` or `actor_token` are invalid for any reason, or are
unacceptable based on policy, the authorization server MUST construct an
error response ... The value of the `error` parameter MUST be the
`invalid_request` error code." That covers a revoked grant and a dead
session too, where OAuth intuition reaches for `invalid_grant`. The RFC
wins; the clause table records that it is a MUST and that the intuitive
code is wrong here. `invalid_scope` and `unauthorized_client` ride §2.2.2's
"Other error codes may also be used, as appropriate".

**One target, not many — a divergence.** §2.1 says "Multiple `resource`
parameters may be used to indicate that the issued token is intended to be
used at the multiple resources listed", and says the same of `audience`.
This server issues single-audience tokens: `parseResource` accepts exactly
one value and refuses an array, a decision RFC 8707 already made and
`docs/protocols/rfc8707.md` already records. P4a inherits it rather than
reopening it, and refuses multiple targets with `invalid_target` — which is
precisely what §2.2.2 provides for, "unwilling or unable to issue a token
for any target service indicated by the `resource` or `audience`
parameters". A divergence, recorded as one, not a gap.

**Why `may_act` is enforced but not minted.** Section 9 of the umbrella
assigns `may_act` — who may act for whom — to P5, along with the ownership
model it describes. Enforcing a claim nothing yet mints costs one check and
means P5 does not have to revisit this code to turn it on. Minting it
without P5's model would mean inventing that model here and living with
whatever P5 actually needs.

## 5. Stage 1, and the fall-through

`parseStructure` gains a fourth `StructuredRequest` variant. The dispatch at
the tail of `issueTokens` becomes **exhaustive**, with a `never` check:
today `client_credentials` is the unguarded fall-through, so a fifth variant
added carelessly would route there silently rather than fail.

`packages/contracts/src/token.ts` exports `tokenRequestSchema` and three
per-grant schemas that **nothing imports**. ADR 0007 describes exactly this
file — Zod authored in `contracts`, compiled for ajv and OpenAPI — and it
was never wired; `parseStructure` is the real authority. Adding a fourth
member to a dead union makes it stale rather than merely unused, so P4a
deletes the four exports. Wiring `parseStructure` to consume `contracts` is
a refactor of three working grants, which does not belong in the phase
adding a fourth; it goes to `docs/NEXT.md` triggered on **P4c**, which
publishes OpenAPI and is where ADR 0007 has to be honoured or amended.

## 6. Authorization

Three checks, one new column between them.

1. **`grant_types` contains the exchange URN.** This is also where the
   allowlist itself lands: `config.grantTypes.includes(request.grantType)`
   before dispatch, refusing with `unauthorized_client`. `GRANT_TYPES_PERMITTED`
   in `service/client-metadata.ts` and the `client_oidc_config_grant_types_check`
   constraint both gain the URN.
2. **Impersonation requires `client_oidc_config.token_exchange_impersonation_allowed`**,
   a new boolean defaulting to **false**. Delegation — an `actor_token` is
   present and the chain is recorded — needs only check 1. This is what
   makes "impersonation distinguished from delegation" a decision rather
   than a side effect of which parameters a caller happened to send.
3. **`may_act`**, when the subject token carries it, must name **the party
   that becomes the actor** — which is not always the requesting client.
   §4.4 defines it as a statement "that one party is authorized to become
   the actor and act on behalf of another party", and §4.1 requires a
   consumer to consider "the party identified as the current actor by the
   `act` claim". So the comparison must be made against whatever section 8
   records in `act.sub`: **the actor token's subject under delegation**, and
   the requesting client under impersonation, where no actor token exists
   and the client is itself the actor.

   Checking it against the requesting client in both cases — which this spec
   said until the first review of this branch — would let a client with
   exchange permission present a subject token authorizing _itself_ and
   receive a token recording delegation to an actor that subject never
   authorized. The check and the claim must read the same party, or the
   claim is a record of an authorization that was never made.

**The allowlist is a behaviour change.** A client registered for
`authorization_code` alone can obtain a `client_credentials` token today;
after this phase it cannot. Nothing is deployed, so this is a hard cutover
with no transition to describe — the same reasoning the tenant rename used,
and the same reason it was cheap there.

## 7. Narrowing

**Scope attenuates — and this is policy, not conformance.** The requested
scope must be a subset of the subject grant's; absent, the subject's scope
is carried verbatim. Never widens, refused with `invalid_scope`.

RFC 8693 does **not** require this. §2.1 defines `scope` as letting the
client "specify the desired scope of the requested security token", and
§2.2.1 contemplates the issued scope differing from the requested one, but
no clause anywhere bounds the issued token's rights by the subject token's.
An implementation may legitimately issue a token that exceeds its input.
This one does not, because section 9 of the umbrella commits the project to
"child scopes ⊆ parent scopes; strictly attenuating, never widening" and
P5's attenuation check is the consumer. The clause table records it as a
deliberate strictness, in the row that would otherwise read as though the
RFC demanded it — which is the failure mode `docs/phases/p3b.md` names as
this repository's most frequent: a comment whose conclusion is right and
whose stated reason is false.

**Audience does not attenuate against the subject token, and must not.** The
canonical exchange turns a token for API-A into a token for API-B; narrowing
against the subject token's `aud` would forbid the case the RFC exists to
serve. The ceiling is the **requesting client's registered `audiences`** —
the same ceiling `client_credentials` already uses, so `resolveAudience`'s
existing contract holds unchanged.

`resource` goes through `parseResource` (one absolute URI, no fragment,
present in the ceiling). `audience` is an RFC 8693 logical name, so it is
matched against the ceiling without URI parsing. Both present and naming
different targets is `invalid_target`, not a silent preference — as is more
than one value of either, per section 4's divergence.

**An issued ID token's audience is the requesting client, and is not
selectable.** `resource` and `audience` choose where an _access_ token may
be used. An ID token's `aud` is fixed by OpenID Connect Core to the client
it is issued to, and a token whose `aud` named a resource server instead
would be rejected by every conforming OIDC client that received it. So an
ID token issued by exchange carries `aud` of the requesting client, and a
`resource` or `audience` parameter sent with `requested_token_type=id_token`
is refused with `invalid_target` rather than ignored: naming a target for a
token whose target is not selectable is a mistake worth surfacing, and
silently discarding the parameter would leave the caller believing it had
been honoured.

## 8. `act`, and what the grant records

Delegation mints `act: { sub: <actor subject id> }`, nesting the actor's own
`act` beneath it when the actor token carries one. Impersonation mints none,
and `sub` is the subject's. `mintAccessToken` gains one optional input,
layered through `withRegisteredClaimsWinning` so that no claim mapper can
forge it.

Nesting depth is capped by a named constant. The tenant-configurable
`max_depth` section 9 describes is `deferred: P5`.

The exchanged `token_grants` row gains two nullable columns:

- `actor_subject_id` — so `/introspect` can reproduce `act` rather than
  recomputing it from a token it may not hold.
- `exchanged_from_grant_id` — lineage, which P4c's audit events read and
  which is the prerequisite for section 9's "revoking any link transitively
  revokes everything below it". **The cascade itself is `deferred: P5`**;
  this phase records the edge and does not walk it.

## 9. The property this phase turns on

The exchanged grant **inherits the subject grant's `session_id`**.

`tokenGrantRepository.revokeForSession` already exists and is already called
when a session ends, so an exchanged token dies with the session **with no
new code**. Without the inheritance, exchange would launder a session-bound
token into one no logout can reach — the single most dangerous thing this
grant could do, and one that would look like nothing at all in a test suite
that only asserted exchange succeeds.

**The RFC permits this and does not require it.** §2.1 is explicit that "the
exchange is a one-time event and does not create a tight linkage between the
input and output tokens", and that propagating revocation "is not a general
property of the STS protocol and would be specific to a particular
implementation, token type, or deployment" — while saying in the same breath
that it "may still be appropriate or desirable". So inheritance is a choice,
and the reasons it is the right one are local rather than protocol-derived:

- **The codebase already made it, for the same reason.** `rotateRefreshToken`
  refuses to rotate a session-bound family whose session has died, and says
  why in its own comment: "A session-bound family lives exactly as long as
  its session: an idle timeout that a refresh could out-live would not be an
  idle timeout." An exchange that could out-live the session is the same
  sentence with one word changed. Exchange inheriting `session_id` makes it
  one rule at both doors, rather than a rule at one door out of several,
  which `docs/phases/p3b.md` names as this repository's recurring defect.
- **P5 requires it.** Section 9 of the umbrella fixes the agent layer's
  invariant as "child TTL ≤ parent TTL, and never beyond the root user
  session". An exchanged token that survived the session would make that
  invariant unenforceable at the layer below the one that states it.

**Exchange does not `touch` the session.** Rotation does
(`refresh-rotation.ts`), because a refresh is a client acting for a user who
is present. An exchange is a third party acting on a delegated token, and
letting it extend the idle window would mean a busy backend keeps a departed
user signed in indefinitely — an idle timeout that never fires while
anything downstream is working. Liveness is checked; the clock is not reset.

**The issued token's `exp` is capped at the subject token's `exp`.** RFC
§2.1 permits it — "the expiration time of the output token may be influenced
by that of the input token" — and requires nothing. The alternative is that
a presented credential with thirty seconds left buys five minutes of reach,
which is widening along the one dimension section 9's invariant names
explicitly. A cap that leaves a uselessly short token is the caller's signal
to present a fresher one. Note this is **stricter than every other grant
here**: `mintAccessToken` otherwise sets `exp` from
`config.accessTokenTtlSeconds` alone and lets use-time liveness do the rest.
The divergence is deliberate, because the other grants mint from a credential
the client owns, and this one mints from a credential it was handed.

For an `id_token` subject token, the session is its `sid` claim. A subject
token belonging to an offline grant has no session, and the exchanged grant
has none either; that is inherited, not invented.

An integration test ends the session and then finds the exchanged token dead
at `/introspect` **and** at `/userinfo`. Both, because P3b's recurring defect
was a rule applied at one door out of several.

## 10. Response and discovery

`issued_token_type` is always present. Per §2.2.1 the `access_token` member
carries the issued token **whatever its type**, so a request for
`requested_token_type=refresh_token` returns a refresh token in a member
named `access_token`. That surprises readers, so `docs/request-paths.md`
shows it as a transcript rather than asserting it in prose.

No `refresh_token` member is ever emitted opportunistically: a requested
refresh token is delivered in `access_token`, per the note above, and this
grant's response carries no `refresh_token` member at all.

`grant_types_supported` in `packages/contracts/src/discovery.ts` gains the
URN. It is a hardcoded array today.

## 11. Reachability

With the allowlist enforced, **no existing door can create a client
permitted to exchange.** `seed client` takes `--redirect-uri`,
`--post-logout-redirect-uri`, `--web-origin`, `--client-secret` and
`--token-endpoint-auth-method`, and nothing else. Dynamic registration can
write `grant_types`, but it is a per-tenant policy closed by default.

P4a therefore owes `seed client --grant-type`, repeatable, validated against
`GRANT_TYPES_PERMITTED`. Without it the phase ships a feature reachable only
by `psql`, which is the complaint P4 exists to end, and `docs/request-paths.md`
would have to say so at yet another site.

Impersonation's flag is deliberately **not** given a seed flag: it is
per-client and dangerous, and P4c's admin API is where it belongs. Until
then it is `psql`, recorded as such under "What is not implemented" and
placed against P4c.

## 12. Testing

Unit, on the leaf service: token-type identifier parsing, scope
intersection, audience ceiling arithmetic, `act` chain construction and its
depth cap, and the `resource`/`audience` disagreement.

Integration, against real PostgreSQL via Testcontainers: each accepted
subject token type; each requested token type, including the
refresh-token-in-`access_token` shape; delegation and impersonation; every
refusal in section 4; `may_act` honoured and violated; the session-death
property of section 9 at both doors; the allowlist refusing a grant the
client is not registered for, on both the password and the assertion
authentication paths; and a foreign-`tenant_id` probe on every new
repository method.

One negative test earns its place specifically: a subject token whose grant
is revoked, and a subject token whose session has ended, must each fail
_before_ any token is minted.

## 13. Documentation

`docs/protocols/rfc8693.md`, with a clause table `pnpm trace` reads —
including rows for the three exclusions, since a refusal this deliberate is
a decision and not an absence.

`docs/request-paths.md` gains the exchange transcripts, re-run against a
live stack, and its "What is not implemented" section gains the
impersonation flag's reachability, placed against P4c.

`README.md` gains the `seed client --grant-type` flag.

## 14. Exit criterion

Token exchange (RFC 8693) as a grant at stage 3 of the token pipeline:
`subject_token` and `actor_token`, audience and scope narrowing, `act` and
nested `act` carrying the delegation chain, and impersonation distinguished
from delegation by a per-client permission that is off by default — with
`access_token`, `refresh_token` and `id_token` accepted and issued, the
generic `:jwt` type refused on a recorded rationale, `may_act` enforced
where present, and the SAML types placed against P8; an exchanged token
that dies with the session its subject token belonged to, proven at
`/introspect` and `/userinfo` both; `/token` refusing a grant its client is
not registered for, on every client-authentication path; a client permitted
to exchange creatable without `psql`; a clause table under
`docs/protocols/` that `pnpm trace` reads; cross-tenant RLS probes green;
CI green on a pushed commit with a pull request open.

## 15. What this phase does not do

- No admin API, no console, no OpenAPI. P4c and P4d.
- No `may_act` minting and no ownership model. P5.
- No transitive revocation down a delegation chain, though the column that
  records the edge lands here. P5.
- No tenant-configurable chain depth. P5.
- No SAML token types. P8.
- No answer to the `client.enabled` question. P4c, per section 2.
- No rewiring of `parseStructure` onto `packages/contracts`. P4c, per
  section 5.

## 16. Index of verified claims

Every claim this spec makes about the repository, with the command that
settled it. Per `CLAUDE.md`'s sibling rule to P0's: a confident sentence
about your own codebase reads exactly like a true one.

| Claim                                                                                                             | Verified by                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `client_credentials` is the unguarded fall-through in `issueTokens`                                               | read `usecase/token-issuance.ts:965-971`                                                                                 |
| `config.grantTypes` is read once, gating refresh issuance only                                                    | `grep -rn "grantTypes" packages/*/src` — one hit in `token-issuance.ts:500`                                              |
| `tokenRequestSchema` and the three grant schemas are imported nowhere                                             | `grep -rn "tokenRequestSchema\|...GrantSchema" --include=*.ts packages apps tests tools` — only `contracts/src/index.ts` |
| `parseResource` takes one absolute URI, no fragment, and requires membership                                      | read `service/resource-indicator.ts`                                                                                     |
| `refreshTokenRepository.byHash` reads without consuming                                                           | read `repository/refresh.ts:88-94`                                                                                       |
| `tokenGrantRepository.revokeForSession` exists                                                                    | read `repository/grants.ts:94`                                                                                           |
| `token_grants` carries `session_id`, nullable, meaning an offline grant                                           | read `schema/token-grants.ts:25`                                                                                         |
| `mintAccessToken` is shared by every grant and layers registered claims last                                      | read `usecase/token-issuance.ts:268-345`                                                                                 |
| This server mints `at+jwt`, `logout+jwt`, `userinfo+jwt` and typ-absent ID tokens                                 | `grep -rn "typ: '" packages/*/src`; `service/logout-token.ts:6`; `usecase/userinfo.ts:92`                                |
| `GRANT_TYPES_PERMITTED` is three entries, mirroring a DB CHECK from migration 0007                                | read `service/client-metadata.ts:35-39`                                                                                  |
| `grant_types_supported` is a hardcoded array                                                                      | read `contracts/src/discovery.ts:107`                                                                                    |
| `seed client` takes five flags and no `--grant-type`                                                              | read `apps/server/src/cli/seed.ts`; `docs/NEXT.md` "What P4 inherits"                                                    |
| `client_oidc_config` is a one-to-one extension of `clients` carrying per-client arrays                            | read `schema/client-oidc-config.ts:8-31`                                                                                 |
| `not-implemented-placement.test.ts` accepts any `P<digits><letter>`                                               | read `tests/docs/not-implemented-placement.test.ts:10`                                                                   |
| `phase-references.test.ts` resolves every phase `README.md` and `request-paths.md` cite against the roadmap table | `npx vitest run tests/docs/phase-references.test.ts` after deleting the `P4` row — twelve failures, each named           |
| Nothing under `docs/protocols/` defers a clause past P3                                                           | umbrella spec, "Theming was named but never required"                                                                    |
| `P4b` is cited 15× in the umbrella spec and 7× in ADR 0030                                                        | `grep -rno "P4[a-z]*" docs ... \| sort \| uniq -c`                                                                       |
| No `rfc8693.md`, and no token-exchange code of any kind, exists                                                   | `grep -rni "rfc8693\|token.exchange" --include=*.ts --include=*.md --include=*.sql` — zero matches                       |

## 16a. Index of RFC clauses this spec relies on

Quoted from `https://www.rfc-editor.org/rfc/rfc8693.txt` on 2026-09-23,
because four decisions in this spec turned on the exact wording and two of
them were wrong before it was read.

| Clause | What it settles                                                                                                         |
| ------ | ----------------------------------------------------------------------------------------------------------------------- |
| §1.1   | Impersonation makes A indistinguishable from B; delegation keeps A's own identity. Section 6's two permissions.         |
| §2.1   | `resource`/`audience`/`scope` definitions; multiple values permitted, which this server refuses — section 4.            |
| §2.1   | "no tight linkage" between input and output tokens; revocation propagation is implementation-specific — section 9.      |
| §2.1   | An exchange has no effect on the subject token's validity — section 18's "does not consume".                            |
| §2.2.1 | `issued_token_type` REQUIRED; `scope` REQUIRED when it differs from the request — section 10.                           |
| §2.2.2 | `invalid_request` is a **MUST** for an invalid or policy-rejected subject or actor token — section 4.                   |
| §2.2.2 | `invalid_target` for a target the server will not issue for — sections 4 and 7.                                         |
| §4.1   | The outermost `act` is the current actor; consumers MUST consider only it — section 8.                                  |
| §4.4   | `may_act` authorizes a party "to become the actor" — section 6's corrected check.                                       |
| —      | **No clause bounds the issued token's scope by the subject token's.** Attenuation is this project's policy — section 7. |

## 17. Assumptions, and the spikes that settle them

Per ADR-adjacent practice from P0: a claim about third-party behaviour is
either verified with the command that ran, or marked an assumption and
spiked before the task that depends on it.

- **verified:** `z.toJSONSchema` exists in Zod 4.6.1 and emits draft
  2020-12 — `node --input-type=module -e "import * as z from 'zod'; ..."`
  in `packages/contracts`. Not used by this phase; recorded because section
  5 sends ADR 0007's debt to P4c and the debt should not be re-investigated
  there.
- **assumption:** `pnpm trace` will read a new `rfc8693.md` clause table
  without incident. `docs/NEXT.md` records that `parseStatus` throws on the
  first malformed status, masking every later error, and that the summary
  counts a broken `covered` row as covered. **Spike before the clause-table
  task**: add a deliberately malformed row, confirm the failure names it,
  remove it. If the defect bites, fixing `tools/trace` is in scope here —
  `NEXT.md` triggers it on "whichever change next touches `tools/trace`",
  and a table added on top of a masking bug is a table nobody can trust.
- **assumption:** an `id_token` verifies through the existing `verifyJwt`
  with `typ` absent and an `aud` containing the requesting client. Spike
  against `usecase/authorization-request.ts:789`, which already verifies an
  `id_token_hint`, before the subject-token task.
- **assumption:** adding the exchange URN to
  `client_oidc_config_grant_types_check` is a constraint replacement that
  needs no table rewrite at this size. Spike in the migration task.

## 18. Open questions this phase answers on purpose

- **Does an exchange consume the subject token?** No. A `refresh_token`
  presented as `subject_token` is read through `byHash` and neither
  consumed nor rotated; exchange is not a refresh, and treating it as one
  would make a single exchange invalidate the caller's own credential.
- **Does an exchange extend the user's session?** No. It checks liveness and
  does not `touch`, unlike rotation. Section 9.
- **How long does the issued token live?** No longer than the token
  presented for it. Section 9.
- **May a client exchange a token it was not issued?** Yes, for
  `access_token` and `refresh_token` — that is the resource-server case the
  RFC is written for. **No, for `id_token`**: its `aud` must contain the
  requesting client. An ID token is an authentication receipt for one
  client, not a bearer credential, so accepting one from any holder is
  weaker than the RFC requires. Recorded as a deliberate strictness in the
  clause table.
