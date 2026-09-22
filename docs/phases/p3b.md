# P3b — sessions, logout and the token surface

What the phase found, and specifically what turned out to be **wrong**.
Written at the phase-closing pass, in the shape `docs/phases/p2b.md`
established: this file is the running record the spec, the plan and the
umbrella spec's close note do not keep. It is not a list of deliverables —
what shipped is in the exit criterion, and what it means for the next phase
is in [docs/NEXT.md](../NEXT.md).

The phase's own argument is in
[its spec](../superpowers/specs/2026-09-19-p3b-sessions-logout-token-surface-design.md);
section 11 of [the umbrella spec](../superpowers/specs/2026-09-10-odudu-design.md)
carries the roadmap-level amendments.

Findings that recurred are recorded once, with their instances. A reader
needs the pattern; the count is only evidence that it is one.

## The shape of this phase's defects

P0's were claims about third-party behaviour asserted from documentation.
P2b's were claims about this repository asserted from memory. P3a's were
claims about what a specification requires, read as prose rather than
executed.

**P3b's were claims about its own code — and overwhelmingly they were in the
explanations, not the behaviour.** The code that shipped was mostly right
the first time. What was wrong, over and over, was the sentence beside it
saying why: a comment, a clause-table status, a paragraph in
`docs/request-paths.md`, an ADR's own bound. Two dozen instances, catalogued
below as one finding, and the reviews earned their cost on every one of
them.

The second shape is narrower and sharper: **a rule applied at one door out
of several**, where the rule itself was correct and the enumeration of doors
was not.

## The false-reason comment: twenty-four instances, one defect

A comment whose **conclusion is sound and whose stated reason is false**.
This is the most frequent defect in this codebase and nothing checks for it:
a reviewer reads the code the comment sits beside, agrees with the
conclusion, and never tests the reason.

The variants, in rising order of danger:

- **Ordinary.** A mechanism named wrongly. `/userinfo`'s post-logout
  inactive answer attributed to session liveness when the grant's
  `revoked_at` returns first. A cache described as evicting the coldest
  entry when `Map` iteration order makes it the oldest-written — whose real
  consequence is the opposite of the stated one, since under sustained
  failure the short-lived negative entries stay young and the **successes**
  are evicted. A promise ordering justified by ".finally runs in the same
  microtask turn as .then", refuted by a four-line probe.
- **A citation.** The hardest to notice, because a section number reads as
  evidence. RFC 7523 §3 credited for rules that are OIDC Core §9's. OIDC
  Core §5.3.2 credited, in three committed places, for admitting
  `alg: none` — §5.3.2 mentions neither the parameter nor the value. RFC
  7519 §4.1.4 credited for a required `exp`, in a clause that ends "Use of
  this claim is OPTIONAL".
- **A comment about somewhere else.** The variant nobody checks, because
  the reviewer reads the code the comment is attached to.
  `packages/crypto`'s signing module listed `/introspect`, and later
  `/logout`, under "a call site with no principal of its own" — false for
  both, and the honest comment at one of those call sites then derived its
  authority from the false line.
- **"This check is not load-bearing."** An instruction to a future
  maintainer rather than a description of the code, and the only variant
  that is dangerous on its own. Two such comments claimed a
  registered-method check mattered only for the refusal reason; deleting it
  and pointing a certificate at a `client_secret_basic` client that carried
  a subject DN answered **200**. The rule that came out of it: a comment
  asserting a check is not load-bearing is written only after deleting that
  check and running the suite.
- **A false reason that authorised a real loss.** `/userinfo`'s empty 500
  body was justified by "the reason is a configuration state an operator
  reads from this endpoint's own logs". Captured at `trace` across exactly
  that request: two lines, naming neither the client, the algorithm nor the
  key. The comment made a deletion look like a trade, and the observability
  it pointed at had never been written.

**The meta-finding is the one worth acting on: a comment written to correct
a comment is the highest-risk prose in this repository.** Five separate
correction passes each introduced a fresh false reason, twice inside the
very comment being corrected — including a ceiling comment made false by
the commit asked to fix it (the key changed from a URI to a realm-and-URI
pair, so "1000 distinct URIs" stopped being the bound), and a
claim-by-exclusion ("unlike every other repository in this package")
refuted by a sibling file in the same directory. A review pass that reads
every comment against the code it describes cannot be the only net, because
that pass is itself the most productive source of them.

**And correcting them made the codebase worse in a way nobody measured
until late.** Pressing twenty-four times on "a stated reason must be true"
and never once on "write none where none is needed" is a complete
instruction to justify harder. Comment density on this phase's files reached
28–50% against a 24.4% repository baseline, with one fact — "a realm holds
exactly one active signing key" — stated seven times across five files.
The order is: **first ask whether the comment is needed, then make what
survives true.** Stating only the second half produces the first half's
opposite.

## A rule applied at one door out of several

The rule is right, the enumeration of the places it must hold is not, and
nothing goes red because every test drives the door the author was thinking
of.

- **`resource` reached the authorization code on one door in four.** An
  `/authorize` carrying a registered, validated, accepted `resource` minted
  a code with `resource = []` the moment the user signed in at the form;
  only the immediate session-reuse path carried it.
- **The `claims` `sub` rule was bypassed by logging in as somebody else.**
  It was consulted in `/authorize`'s candidate-session filter and nowhere
  after a login: a request naming bob showed the login form, alice signed
  in, and the ID Token's `sub` was alice — which OIDC Core §3.1.2.2 forbids.
  `id_token_hint` already solved this by parking the subject and re-checking
  after the login. The `claims` `sub` was folded into the same _filter_ and
  not into the same _re-check_, and the re-check is the half that matters
  once a login intervenes.
- **The same commit asserted the behaviour that bypass disproved** — the
  clause row moved to `covered` and `docs/request-paths.md` gained a
  sentence saying the `claims` `sub` "reaches the same check an
  `id_token_hint` does". Worse than an ordinary false reason, because it is
  the sentence that stops the next reader looking.
- **`max_age` was re-applied on the chooser's GET and not on its POST.**
  The chooser listed only fresh sessions; posting a stale id passed
  membership and minted a code whose `auth_time` was older than the client
  demanded.
- **A sixth login journey nobody had enumerated.** The `claims` fix was
  built against five doors; independent enumeration found a sixth, the
  required-action detour, correct by construction and driven by nothing. A
  fifth had been found the same way one deliverable earlier. Four of the
  six were untested when the count said six of six.

**The lesson that generalises past this phase:** a coverage claim stated as
a count hides which member is missing. "Six journeys, six tests" was wrong
about the _first_ journey — its coverage was attributed to a test that
drives the second, and a mutation at door one left every test in the file
green.

## "Disabled" treated as "absent" — four instances, three deliverables

Each was a security hole, the third was found only because the second
prompted a grep, and the fourth was found the same way, one review later.

- A **disabled client authenticated by `private_key_jwt`** and received
  tokens. `authenticatePrivateKeyJwt` never consulted `client.enabled`; the
  password path got that check only incidentally, from inside
  `verifyClientSecret`, which the assertion path does not call.
- A **disabled client that registered encryption received clear-text
  claims.** `userinfoEncryptionTarget` mapped a disabled client to `null`,
  and the caller read `null` as "no encryption registered" rather than
  "cannot encrypt".
- A **disabled client kept its `fullScopeAllowed` bypass at `/userinfo`**,
  so tokens it issued before being disabled still reached the unmapped role
  set.
- A **disabled client stayed a logout target.** `clientsForSession`
  (`repository/grants.ts`) joined `clients` with no `enabled` filter, so a
  disabled client still had its `frontchannel_logout_uri` framed and still
  received a signed Logout Token on its `backchannel_logout_uri`. Found at
  the whole-branch review, against the same sibling this family always
  reads: `webOriginsForRealm`, ten lines below in a different file. The
  pre-existing `postLogoutRedirectUris` lookup (P3a) had the identical gap,
  closed in the same change.

The third is the instructive one: **the principle was already written down
ten lines below the gap.** `resolveClientWebOrigins` carries "a disabled
client's origin must stop working the same way a disabled client's tokens
do — the CORS allowlist is not a second, forgotten door"; its neighbour
`resolveRoleReach` did not check `enabled`. Knowing the rule and writing it
down did not make it get applied at the next site.

One distinction must survive any later "consistency" cleanup:
`userinfoSignedResponseAlg` deliberately maps a disabled client to plain
JSON and says so. Withholding a signature reveals nothing; falling back to
JSON on the encryption path _publishes_ what the client asked to protect.
Same shape, opposite consequence.

A related insight, and the sharpest of the phase: **the branch nobody
thought of was a success, not a refusal.** The client-authentication work
was organised around enumerating refusals and proving them byte-identical,
so no amount of scrutiny of that list could have found a disabled client
being let in. Enumerate what must be true for authentication to _succeed_.

## Four species of test that assert nothing, plus three more

A test that names a property and exercises something else. Seven distinct
shapes turned up, which is worth more than the tally:

- **Two checks refusing the same input.** A fragment-bearing `resource`
  that is also unregistered: delete the fragment check and every test still
  passes, because the allowlist refuses the value anyway.
- **A fixture refused for an unrelated reason.** The one-method-per-request
  rule was pinned by a request that failed on other grounds; with the check
  removed, a real certificate plus a body `client_secret` answered 200.
- **The library refusing before the code does.** "Refuses an algorithm the
  spike did not confirm" used the literal string `'unsupported'`, which
  `jose` rejects on its own. **A negative test needs an input the library
  would otherwise accept**, or it proves only that nonsense is nonsense.
- **A count assertion over a symmetric fixture.** One stale row and one live
  row, asserting a count: it cannot tell a retention rule from its inverse.
- **A tautology.** The concurrency test queried exactly five known ids and
  asserted `<= 5`. Removing the eviction call entirely left it green — and
  it was cited as evidence in an ADR and twice in `docs/request-paths.md`.
- **A new check unpinning an older one.** Closing the `id_token_hint`
  audience check at `/authorize` made an existing refusal test pass for a
  second reason, so the `typ: at+jwt` refusal it named became held by no
  test at all. The question to ask of any new refusal: **which existing
  tests now pass for two reasons?**
- **A guarantee that was a comment.** A repository method promised its claim
  survived the caller's rollback; its test opened its own inner transaction
  and passed _that_ in, so it exercised the transaction helper rather than
  the method, and would have passed against the most rollback-fragile
  implementation possible. Closed structurally — the method takes the
  database handle and opens its own transaction, so the enclosing one is out
  of reach and the counterexample no longer compiles.

**A mutation is only as good as the fixtures that reach it.** Every client
reaching the encryption-unavailable branch had registered encryption _only_,
so the fallback mutation could prove a fallback to plain JSON and nothing
else; for a sign-and-encrypt client the same fallback emits a readable JWS
and nothing goes red.

## What the plan and the spec got wrong

Each of these was written as fact and disproved by execution.

- **`FOR UPDATE` on the session rows does not bound the cap.** A row lock is
  not a predicate lock: under READ COMMITTED a blocked statement re-qualifies
  only the rows its original scan found, so a row another transaction
  inserted meanwhile is invisible. Measured at cap 3, five runs each:
  realm-row lock `[3,3,3,3,3]`, session-row lock `[4,4,4,4,4]`, no lock
  `[4,4,4,4,4]`. The lock the plan specified performs identically to none.
  ADR 0033 carries it.
- **The replay `jti` was to be claimed before the signature was verified.**
  As written, an assertion with a forged or absent signature still spends
  its `jti` — so anyone who observes a legitimate assertion, or guesses a
  predictable one, can spend it and have the legitimate client refused as a
  replay. No key required. Verify first, claim second; a failed signature
  leaves the table untouched.
- **`parseResource` as specified refused every client in this repository.**
  `client_oidc_config.audiences` defaults to `[]` and every creation path
  writes `[]` explicitly, so "refuse when the intersection is empty" would
  have made `/authorize` redirect `invalid_target` for all of them.
- **The audience rule the spec stated would describe nothing to anybody.**
  `/introspect`'s entitlement compared the caller's `client_id` against an
  `aud` built from RFC 8707 resource URIs — different namespaces that never
  intersect. Amended in the spec at this pass.
- **The `/logout` audience ruling was mine and was wrong.** Moving the
  comparison inside token verification is not available there:
  RP-Initiated Logout §4 requires a disagreeing `client_id`/hint pair to be
  told apart from no usable hint at all, and a refusal inside verification
  collapses both to `null` — which silently reversed a documented redirect
  behaviour. `/logout` had been correct all along; what was wrong was the
  **symbol**, `AUDIENCE_UNCHECKED` reading as "nobody checks this" four
  lines above the code that checks it.
- **The refresh path recomputed the audience from client config**, so a
  client could narrow `aud` with a `resource` at `/token` and widen it back
  on the next refresh, in one round trip. The plan named three grant paths;
  there were four, and the fourth was the only one where this was a security
  property rather than a correctness one.
- **An access token carried no reference to its grant.** Introspection keyed
  on `{clientId, subjectId, sessionId}`, which is unique for nothing — for
  `client_credentials` every grant a client ever holds shares one triple, so
  a token from a revoked grant matched a live sibling and answered
  `active: true`. The endpoint reporting the opposite of the one thing it
  exists to report. Closed with the grant's id as a documented private claim,
  failing closed for tokens minted before it.
- **Two distinct `private_key_jwt` refusals are themselves an oracle.** They
  tell a caller whether its registered `jwks_uri` was reachable and served
  parseable JWKS — the same class for which registration-time dereferencing
  had already been reverted a phase earlier. The spec's own stated principle
  demanded one refusal and the spec did not reach that conclusion.
- **Renumbering a migration invalidates every later reference to the number
  it took.** A correction that moved one migration out of a collision
  created a second collision two deliverables later.

## The four spikes, against their assumptions

Two confirmed, one strengthened, one disproved — and the disproved one is
the one that paid.

- **Cookie capacity** confirmed the session model's precondition: two
  `__Host-` cookies coexist, the ceiling is 110 ids in a 4158-byte header,
  and `Secure` works over `http://localhost`. The cap was set at 25 with
  4.4x headroom. The carried finding matters more than the number:
  **exceeding the limit fails silently** — the browser keeps the old value
  and reports nothing — so enforcement has to be server-side.
- **Framed cross-site cookies** replaced caution with measurement: a
  `SameSite=Lax` cookie never reaches a framed cross-site logout request,
  and `SameSite=None; Secure` clears only one of two gates, the other being
  a third-party-cookie policy Safari and Firefox deny by default. The exit
  criterion already promised the attempt; it is now backed rather than
  hedged. Cross-site-ness was established empirically rather than assumed,
  which is what avoided the two-ports-on-one-host false positive.
- **Introspection's silent refusal** turned out to be a MUST, not a
  permission: RFC 7662 §2.2's final normative paragraph requires
  `{"active": false}` to an authenticated caller not authorized for the
  token. The alternative the spec had rejected as a defensible different
  choice would have been a conformance violation.
- **JWE found a live defect instead of confirming an assumption.** `RSA1_5`
  is producible by no installed version of `jose`, and the registration
  metadata was weaker still — `userinfo_encrypted_response_alg` and `_enc`
  were plain optional strings, so **any** string registered and the failure
  would have surfaced at response time. Narrowing became a correctness fix.
  The spike then reproduced, in its own selection rule, the defect it exists
  to prevent: `kty: "OKP"` does not prove ECDH-ES support, and the spike
  itself had established that a key with neither `use` nor `alg` is the
  common case. Its replacement filter was then justified by a claim by
  exclusion — "X25519 is the only curve JWA assigns to `ECDH-ES*`", which is
  false, JWA assigns X448 too. The filter was right both times; its reason
  was wrong both times. **"No other X is supported" and "no other X is
  supported by us" lead to different code**, and a later reader implements
  whatever the document says.

## Two tokens that were not distinguishable

- **The signed UserInfo response was a valid `id_token_hint`.** No `typ`, no
  `exp`, correct `iss`/`aud`/`sub`, signed by a publishable key — so
  `/userinfo` was minting never-expiring ID Token hints usable at
  `/authorize` and `/logout` by anyone the response reached. The root cause
  is a reasoning step, not a slip: "an ID Token carries no `typ`, so this
  carries none either" makes the two indistinguishable _by construction_.
  The premise was right — `at+jwt` is wrong here — and the conclusion that
  nothing is right does not follow. Closed on both sides: a `typ` on the
  response, and a required `exp` in the hint verifier.
- The fix pattern held for the third token-confusion finding of the phase
  too: **make the two superficially similar tokens distinguishable, rather
  than checking harder.**

## Failures that reach the user late

- **A security check that fires on ordinary input is a check somebody
  disables.** The duplicated-certificate-header defence tested for `', '`,
  which is how Node joins repeated headers — verified with a raw socket,
  which was the right method. But RFC 2253 escapes an embedded comma as
  `\,` and keeps the following space, so an ordinary subject containing
  `O=Example, Inc.` collides. Three `openssl` renderings of one certificate
  all contained `', '`, including the one nginx emits. All three answered
  401 with no logged reason. Counting duplicates from `rawHeaders` makes no
  assumption about encoding.
- **A complete defect chain, each step individually reasonable.** Discovery
  advertised `RS256` and `ES256` to every realm, justified by "every realm
  signs with the same two algorithms" — false, and disproved by a partial
  unique index in the same schema: a realm signs with exactly one. A client
  read the advertisement, registered the other, and every `/userinfo`
  request answered a raw 500 that neither it nor the resource server could
  fix. Closed at the earliest point — refuse the mismatch at registration,
  advertise per realm — so the 500 became unreachable rather than
  better-worded.
- **A configurability feature that breaks on the natural spelling of its own
  default.** The configurable certificate-header name was compared
  case-sensitively, so `X-SSL-Client-S-DN` reported the header absent and
  silently disabled the duplicate defence.

## Claims by exclusion

The form most likely to be false, because it asserts about everything not
named. Three instances, one of them inside the fix for the failure
`CLAUDE.md` already records.

- A sentence added to stop gap admissions drifting claimed `seed client` had
  no flag "beyond redirect URIs, web origins and the auth method" —
  asserting by exclusion that none existed for `post_logout_redirect_uris`,
  which it does, and which the same document says elsewhere. Rewritten to
  enumerate what exists.
- The JWA curve claim above.
- "Unlike every other repository in this package", refuted by a sibling in
  the same directory.

## Documentation integrity

`docs/request-paths.md`'s promise is that every command was executed and
every response is real output. Four ways it was false while looking fine
turned up, one of them new to `CLAUDE.md`'s list:

- **A transcript must reproduce in the order it is written.** A refusal
  block reused an authorization code the block above it had already
  consumed, so the real answer in sequence was `invalid_grant`, not the
  `invalid_target` shown. Now recorded in `CLAUDE.md` alongside the other
  three.
- **A policy switched on and never switched back.** The dynamic client
  registration section moved the realm to the `token` policy and then showed
  five later unauthenticated registrations succeeding; replayed live they
  answer `401`. Nothing had ever flagged the section as derived, so nobody
  re-ran it. Re-captured at this pass, with the policy reopened where the
  transcript needs it.
- **A precondition asserted rather than shown.** The same section's two
  `404`s — a closed policy and an absent realm — are byte-identical, so the
  transcript proved nothing about which check fired. It now creates its own
  realm and shows discovery answering `200` for it first.
- **A derived section got the behaviour right and the bytes wrong.** The
  consent walkthrough, replayed against a live stack, differed in exactly
  three ways: a missing `charset=utf-8`, an unescaped `iss` on a redirect
  where every other transcript percent-encodes it, and a scope list rendered
  one `<li>` per line. Which is precisely why the document's promise is
  about bytes rather than about behaviour.

Two further integrity findings, both invisible to `pnpm verify`: a README
carrying a **fabricated** command response, in a repository whose standing
promise is that none is; and three README claims that were checkable with no
check behind them, when a doc-test already held exactly that shape for two
sibling commands.

**Unrun means unclaimed.** Three mutation tables in this phase recorded a
predicted result for an experiment that was never run — once for the exact
deletion that a reviewer then performed and found survivable. A mutation
entry is a run with its real output pasted, or a plain statement that it was
not run.

## The census, and what it cannot see

`pnpm trace` is the one artefact claiming to be exhaustive, and three things
were established about it by deliberate experiment rather than suspicion.

- **One malformed clause status masks every later problem, in every later
  file.** `parseStatus` throws in `loadTables` before any id is resolved, so
  a single `trace` error is never safely the only one. That same throw had
  been masking a stale silenced-MUST list across two commits.
- **The summary counts a broken `covered` row as covered** — it printed
  `410 covered` on a failing run. Only reachable in an already-red build,
  but the census is the artefact that claims completeness.
- **A `covered` row is only worth what deleting its check proves.** Two rows
  were marked covered on tests that stayed green when the cited checks were
  deleted, one of them repeating verbatim the defect the immediately
  preceding commit was written to fix. A third was covered because the claim
  it named was emitted unconditionally. The standard that came out of it:
  delete the check the row names, watch the named test fail, paste that
  output.

And the opposite error, which reads as diligence and is not: **a clause
row's level is the level the RFC text carries at that point, not the level
the behaviour deserves.** Four MUSTs were removed from the census because
the RFCs never imposed them — found because two reading notes written in the
same commit took opposite positions on declarative prose.

## `CLAUDE.md` states a rule its own tests forbid

Established by experiment, not inference, and left open for a deliberate
decision rather than fixed in passing.

`CLAUDE.md`: a fenced block holding a response carries no language tag,
because Prettier reformats a tagged one. Verified true — Prettier rewrites a
block tagged `json`. But `tests/docs/markdown.ts`'s
`blockAfter(document, marker, language)` selects a block **by** language,
and its callers pass `'json'`,
so an untagged JSON response block is invisible to every check built on it.
Every JSON response in `docs/request-paths.md` therefore shows Prettier's
formatting rather than the server's bytes. Content survives — keys, values
and order are intact — but the byte-level promise does not.

The fix is small: teach the locator to match an empty-language block, which
the parser beneath it already accepts, then untag the responses. Recorded in
[docs/NEXT.md](../NEXT.md) rather than done here, because it touches every
JSON transcript in the document at once.

## A discriminated union names a conflation; it does not prevent one

Worth recording because the claim was mine and it was overstated. The
two-meaning `null` on the encryption path became a three-state union —
`'none'` / `'unavailable'` / `'target'` — which I described as making the
two states unrepresentable as one. Probed: collapsing both branches back
into a single non-`target` check **typechecks cleanly**, and only the
regression test goes red. The union is a legibility fix, not a safety one,
unless the impossible state is genuinely unconstructible. The implementer's
own wording, "cannot _silently_ conflate", was the accurate one.

## What the process itself got wrong

- **A branch with no pull request open runs nothing.** Already in
  `CLAUDE.md`; this phase confirmed the other half — a pull request whose
  checks are read by eye is barely better. One merge went through on a run
  reported `fail` because only the last six lines of output were read, and
  the whole of that deliverable's CI had died at `prettier --check` before
  any suite executed. Another nearly repeated it against a _stale_ run that
  listed only the completed jobs while three were still pending. Counting
  `fail` across the full list, and looping on `pending`, is the reliable
  form.
- **A local `pnpm verify` is contaminable by construction.** Three runs in
  this phase measured a working tree somebody was still editing and reported
  failures in code that was fine. CI already does this correctly, in a clean
  isolated checkout. A verify result means nothing unless you can name the
  state it measured.
- **A substitute for `pnpm verify` has to name every member of its chain.**
  Agents were told to run typecheck and the suites; `boundaries` and `trace`
  were omitted and each turned CI red in turn. `pnpm typecheck` and
  `vitest run tests/docs` are also not the same check — an exhaustive
  `Record<Union, true>` in the docs suite is a typecheck, so the suite
  passed while the typecheck did not.
- **Resolution state is not visible through the REST comments endpoint.** A
  finding fixed without a reply leaves an open thread that reads as a silent
  drop; two pull requests were merged that way before anybody queried
  `reviewThreads { isResolved }`.
- **Thirteen agent stalls on a notification that never arrives.** Every one
  resolved by the same message, roughly an hour of wall clock in total.
  Prohibiting the _waiting_ did not work — each new instance found a new
  mechanism to wait on. Prohibiting the _mechanism_ is what the wording
  became: never background a command, never end a turn with work
  outstanding.
- **A file list in a brief is a starting point, not a boundary.** Three of
this phase's defects sat in code no brief named, including two
non-negotiables missed on repository methods the plan had not anticipated:
a method the plan never names inherits none of the plan's checklist.
</content>
