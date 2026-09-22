# P3a — clients, dynamic registration and consent

What the phase found, in the order it found it (newest first). Written at
the phase-closing pass, in the shape `docs/phases/p2b.md` established: this
file is the running record the spec, the plan and the umbrella spec's close
note do not keep — what was discovered while building, especially what
turned out to be wrong.

The phase's own argument is in
[its spec](../superpowers/specs/2026-09-18-p3a-clients-registration-consent-design.md)
and [its plan](../superpowers/plans/2026-09-18-p3a-clients-registration-consent.md);
section 11 of [the umbrella spec](../superpowers/specs/2026-09-10-odudu-design.md)
carries the roadmap-level amendments. The full task-by-task record, every
review verdict and every ruling, is
[the phase ledger](../superpowers/sdd/2026-09-18-p3a-clients-registration-consent/progress.md).

## Which of CLAUDE.md's two rules caught this phase's defects

P0's defects were claims about third-party behaviour — a library, a
database, a resolver — asserted from documentation rather than execution.
P2b's were claims about this repository — a schema, a migration number, a
helper, a file path. **P3a's defects were mostly a third shape neither rule
names: claims about what a specification actually requires, checked by
reading prose rather than the test suite's own source or by executing the
function under review.** The rule that caught it wasn't `verified:` /
`assumption:` or "grep before you write it" — it was a review habit forced
into every dispatch after Task 8: **execute the function, don't reason
about it**, and per property, **ask what the test would still pass under**.

The repository-claim shape still appeared (the realm schema file named
wrong in Task 5's plan — the P2b rule's exact failure, caught by the two
greps CLAUDE.md now demands and corrected before the implementer even
needed to). But the phase's costliest findings were all "the suite's own
source says something different from what the plan assumed it said":
Task 1's spike answered its four questions from the OIDF suite's Java
source directly, not from reading about it, and reversed two rulings on
that evidence (see below); Task 19's attribution counted modules instead of
conditions and inverted the phase's own headline claim about
`private_key_jwt`; and five separate tasks shipped a test that agreed with
the bug it was meant to catch, because a test written by whoever wrote the
code tends to assert what the code does rather than what the requirement
says. That is the finding worth carrying into P3b's own review dispatches,
already added to them: **name, per property, what the test would still
pass under** — not "does this test pass" but "what would have to be true
for this test to be lying to us."

## The pass that closes the phase, 2026-09-19

Four checks, per CLAUDE.md.

**"What is not implemented" markers.** Read in full rather than grepped.
Three of the five markers the task brief expected to have gone stale
(consent, dynamic client registration, the `/token` rate limit) were
already accurate — earlier tasks in this phase had corrected them as they
landed, which is the document doing its job. The hardcoded-pages bullet
also already named the consent page alongside sign-in and error, correctly,
since that bullet was never about consent's existence, only its theming
(P4b's). Two markers were still wrong, both in `README.md`, neither in
`docs/request-paths.md`: the Status section still said "no consent
screen... P3a onwards" after P3a shipped one, and the dynamic-registration
paragraph's parenthetical — "`seed client` is the only way to create a
client in either case" — was false for the `open` and `token` policy cases
the same paragraph had just described, the exact scenario dynamic
registration exists to serve. Both corrected.

**Bare `P3`.** `grep -rnE "\bP3\b" README.md docs/ --include="*.md"`
returned nothing in `README.md` or `docs/request-paths.md` (the test-backed
files) or in `docs/protocols/`. Two ADRs still carried it in prose written
before the P3a/P3b split (0016, 0017) — reasoning text, not a claim about a
specific phase's criterion, so low-stakes, but bare `P3` all the same;
corrected to name the actual phase (P13 for the FAPI surfaces ADR 0016
was pointing at; generic "a later phase" for ADR 0017's illustrative
prose). The plans keep every historical `P3` — they are dated records of
what a phase was called when it was written, not living documents, and
`docs/superpowers/specs/2026-09-10-odudu-design.md`'s own dated amendment
history is the same kind of record: "P3 did not name consent," written
2026-09-14, stays exactly as written, because it is true about what the
table said that day. Only the current-state sections get the current
names.

**`docs/NEXT.md`'s headings against the phases that have closed.** Two
sections were addressed to P3a. The `claims` request parameter: P3a's plan
never named it in the criterion and nothing in the twenty-task plan built
it, so per CLAUDE.md's own rule this is exactly the shape section 11
catalogues five other instances of — resolved by moving the three
`deferred: P3a` rows in `docs/protocols/oidc-core.md` to `deferred: P3b`
and naming the parameter in P3b's roadmap row, next to the signed and
encrypted UserInfo responses it shares a shape with (both read per-client
registration data P3a stored but nothing yet acts on). The consent
transcript: still derived, not observed, as the note admits. Reproducing
it means replaying the whole document's transcript from the top to reach
the same `demo` realm state — infeasible inside a documentation-only
closing pass — so it is explicitly deferred rather than left open-ended.
A first pass of this note assigned it to P4b on the reasoning that
theming touches every rendered page; a review of this pass caught that as
the same defect it had just fixed for the `claims` parameter — P4b's
criterion is theming and branding, and re-deriving a transcript is named
in neither. Reassigned to **P3b**, which rewrites `/authorize`'s session
decision and adds concurrent sessions and "remember me," so it re-runs the
transcripts around this exact request path regardless, and whose own
criterion already names the surface. Recorded in `docs/NEXT.md` with that
owner rather than as a bare admission.

**The roadmap against the "not implemented" list, both directions.** One
new candidate, the `claims` parameter (above), resolved the same way
section 11's other five were — named in a criterion or moved with a
reason. Nothing else placed by this phase's work was missing from a
criterion: the OIDF Dynamic OP treatment, the registration cap, the
`client_secret` limiter and the page-contract authority are all named in
P3a's own criterion and all shipped.

## Task 19 — the Dynamic OP conformance run, and the laundering check

The run itself is real: the JSON matches Basic OP's evidence shape
field-for-field, 23 modules reconcile with the narrative, and the 243KB
logs zip holds 23 signed suite logs with real HTTP traffic. No server file
was touched to get there.

**What turned out to be wrong, and it is the phase's clearest instance of
"a claim about a specification checked by reading prose instead of
counting":** the report and ADR 0031 both stated `private_key_jwt` "is
never exercised by this plan at all — PKCE refuses every request before a
token-endpoint client authentication would matter." The suite's own logs
falsify that fifteen times: `EnsureServerConfigurationSupportsPrivateKeyJwt`
is the single most common failing condition, and it is a
_discovery-configuration_ check that fires before any authorization
request — it would still fail the same eleven PKCE modules even with PKCE
satisfied. The root cause was counting **modules**, not **conditions**: a
module fails several conditions, and counting modules hid fifteen
occurrences of the commonest one and turned four genuine
`private_key_jwt` failures into "harness limitations." The README's own
cause table had the same shape and propagated the same error. Fixed across
two rounds; a re-reviewer extracted the logs zip and counted the
conditions independently both times rather than trusting the report, and
confirmed the evidence files were byte-unchanged by the documentation
fix — the check that matters when a directory holds the project's only
durable conformance evidence.

**Ruling 3, upstream of this task:** P3a's exit criterion could never have
been "the Dynamic OP plan passes." Its discovery check requires
`response_types_supported` to contain `code`, `id_token` **and**
`token id_token` whenever `ClientRegistration` is `dynamic_client`, which
is every module group the plan defines — and OAuth 2.1 removes the grants
behind the last two, a decision ADR 0016 already recorded. The criterion
became "runs reproducibly with every divergence confirmed as a recorded
decision," verbatim the treatment P1's own criterion already gives Basic
OP — the repository's established answer to a suite whose own preconditions
a project has already, deliberately, declined to meet.

**Recorded, not fixed, by the whole-branch review:** "runs reproducibly" is
not yet demonstrated for Dynamic OP the way it is for Basic OP. Basic OP's
own precedent (P1) committed a run and a rerun, so its evidence directory
holds two independent executions that agree. Only one Dynamic OP run is
committed here — the claim rests on the plan's own text, not on a second
execution the repository can point to. Not re-run in this pass, which is a
documentation-only closing pass rather than a conformance re-execution;
left for whoever next touches the Dynamic OP evidence to add the rerun
Basic OP already has.

## Task 18 — the `client_secret` limiter, and an accepted timing oracle

The limiter is real: keyed by realm and client, genuinely injected rather
than imported, bounded, and confirmed failures-only by the implementer's
own mutation run.

**Ruling 14, the phase's one deliberate non-fix.** An unknown `client_id`
returns before `verifyClientSecret` runs, so it never pays the Argon2id
cost a wrong secret does — byte-identical responses, distinguishable
latency. Adding a dummy-hash comparison to close it would make every
unauthenticated request naming an unknown `client_id` cost an Argon2id
verification, which is worse: a `client_id` is not secret (it appears in
every `/authorize` URL in plain sight, unlike a username), and the
mitigation would be a CPU-amplification vector the per-client budget
cannot bound, since an attacker rotating `client_id`s draws a fresh budget
each time. Accepted, with the reasoning in ADR 0023's amendment so it is
not reopened as an oversight.

**A claim three documents overstated, found reading the diff rather than
the report:** `docs/request-paths.md` said a wrong secret "is refused
before it is even checked against the stored hash," but the limiter is
consulted in the `catch` **after** Argon2id has already run — the
over-budget attempt pays the hash. Unlike the per-origin throttle (an
`onRequest` hook, ahead of everything), this limiter bounds guesses, not
CPU. Corrected, and the distinction is now stated rather than implied.

## Task 17 — consent wiring, and a security-relevant claim that leaked into a token

The hard part — whether a session "authenticated, no factor run" could be
abused — held up under an adversarial trace from the HTTP entry point: no
path reaches `markAuthenticated` outside a live SSO reuse, no MFA is
skippable, replay is bound.

**What the review found that the report missed: consent-after-reuse
reported an `auth_time` that never happened.** The gated path stamps
`authTime: now`; the reuse path was supposed to carry the session's own
`decision.authTime` through unchanged, and it did — until consent's second
round-trip went through `completeLogin` again instead of touching the
existing session, so the same second request asserted a fresh
authentication purely because consent was asked. `auth_time` is a security
input (`max_age` and client freshness policy read it), not cosmetics; the
fix made `completeLogin` touch and reuse the original SSO session, so the
ceiling is not restarted and no session is orphaned by a second
`establishSession` call that never should have run.

A second, smaller finding of the same species: §3.1.2.1-14 (a MUST about
`prompt=consent`) was closed against a test carrying no `prompt` parameter
at all. The behaviour is very likely right; the evidence never exercised
the condition the row claims to close. Recorded as a parked minor rather
than looped, since the row's own claim (`covered`) is what the pattern
above is about — but this one is a coverage gap, not a wrong outcome.

## Task 12b — the reversed registration-time fetch, and the oracle it built

The endpoint itself reviewed clean: the registration cap is atomic under
real concurrency, nothing is over-advertised. The defect was one reversed
decision and what it dragged in.

**Ruling 13, and it corrects Ruling 2's own basis.** The implementer made
registration dereference the client's `jwks_uri` and refuse on failure —
reversing a recorded shape-only decision. Put to the reviewer as a
question rather than settled by argument, the suite's own source answered
it: `OIDCCRegistrationJwksUri` only _serves_ a JWKS on demand and is
`@VariantNotApplicable` for every client-auth method except
`private_key_jwt` — the key is wanted at the _token_ endpoint, in P3b, not
at registration. That also means Ruling 2 (which had pulled the fetcher
forward into P3a because "the OP must dereference `jwks_uri` during the
run") was half a fact: the spike had established _that_ the OP must
dereference it, never _when_, and Ruling 2 answered the unasked half by
assumption. The fetcher is nonetheless worth having built now — tested,
ADR'd, and P3b's actual consumer — so the outcome is right, but by
accident rather than by the reasoning that produced it. Recorded plainly
rather than let the accident read as foresight.

The reversal's collateral was worse than the reversal itself: `error.message`
from the failed fetch was returned verbatim in a 400 `error_description`
to an **anonymous, unauthenticated registrant** — the address guard
refused a private address and then told the caller exactly what it found,
a network oracle built out of the error text of the control meant to
prevent one. Fixed by deleting the registration-time call entirely and
confirmed by grepping the whole registration path for every shape an error
message could leak through (`error.message`, `String(error)`, template
literals over caught bindings, serialised `cause`); the one surviving catch
uses a typed `reason` built from static literals in a function that
performs no I/O, so it carries no timing or reachability signal.

## Task 8 — the address guard, and the finding the phase is built around

`assertPublicAddresses` decides what URL the server will fetch on a
client's say-so — the entire trust boundary dynamic registration and the
key fetcher both sit on top of. It is also where the phase's single most
serious finding landed, and the one that produced the "execute, don't
reason" rule everything after it followed.

**The Critical.** `asIPv4Mapped` matched only the dotted spelling
(`::ffff:a.b.c.d`); every other spelling of an IPv4-mapped or
IPv4-compatible address fell through to the IPv6 loopback test, whose
check requires hextets 0–6 to be zero — which a mapped address never
satisfies (hextet 5 is `0xffff`). `::ffff:7f00:1` (loopback) and
`::ffff:a9fe:a9fe` (the cloud metadata service, `169.254.169.254`) were
both **allowed**, reachable with no DNS control at all: `new URL`
normalises `https://[0:0:0:0:0:ffff:127.0.0.1]/` to `::ffff:7f00:1`, and
`dns.lookup` returns that exact spelling. The reviewer found this by
running the function against real addresses rather than reading it, and
the suite guarding it had the same blind spot the code did — one
mapped-address test, the one spelling the parser happened to handle. That
pairing (a defect and a test that agrees with it) recurred four more times
this phase; this was the first and the most severe.

**Ruling 9 — three further bypasses (`::ffff:0:0/96`, `64:ff9b:1::/48`,
`2002::/16`) went into the same fix loop rather than being parked**, on the
reasoning that the loop-extension rule is scope discipline, not a licence
to ship a security control with three verified, executed bypasses in it —
Task 9's fetcher was going to call this function, so parking them would
have meant every later task building on a guard known to be walkable.

**Ruling 10 — corrected during the whole-branch review**: the finding as
recorded here claimed a bare `::/96` residue outside the named markers.
Re-checked against `ENCAPSULATIONS[0]` in `remote-address.ts`: its `matches`
predicate accepts `h[5] === 0` with no further constraint on `h[6]`/`h[7]`,
which is exactly `::/96` — the whole block is already unwrapped and checked,
not merely the deprecated and mapped forms named in its comment. There is no
`::/96` gap. The residue RFC 6052 §2.2's non-`/96` embeddings leave
unguarded is real but narrower and already covered below; a second, distinct
residue is `::/80` addresses whose sixth hextet is neither `0` nor `0xffff`
(so `h[0]`–`h[4]` are zero but `h[5]` is not) — these fall through every
encapsulation, unrecognised as IPv4, and reach the ordinary IPv6 check. That
range is unrouted (RFC 4291's Unspecified/Loopback carve-outs aside, `::/96`
downward is deprecated and unallocated), so nothing routable is missed. The
follow-up this ruling spawned (`spawn_task task_0799dcb9`, "refuse all of
`::/96`") is against a gap that does not exist and should be dismissed or
re-scoped to the `::/80` residue instead.

## Increments 1–3 — the page contract, the schema, dynamic registration's shape

**The `RenderedPage` retrofit (Tasks 2–4) turned out to be 26 render
functions across 10 files, not seven pages** — both `docs/NEXT.md` and
`CLAUDE.md` had counted pages a user navigates to rather than functions a
contract must cover; both corrected in the increment that did the work.
Widening the contract also surfaced that `<title>` needed escaping it had
never had — correct for a general-purpose helper, since a later page
interpolating a realm or client name into a title would otherwise be
injectable — but it changed served bytes for any apostrophe-bearing title.
Seven transcripts in `docs/request-paths.md` carried exactly that
apostrophe ("Can't create this account" ×5, "Can't reset your password"
×2); all seven were re-observed against a live server rather than
hand-edited, and a reviewer judged the re-run credible against the
compose-hang workaround it used.

**The markup freeze caught its own violator inside the plan that wrote
it.** Task 3's brief forbade changing any page's visible markup and then,
two paragraphs later, gave a worked example asserting a _different_ title
than the one already served — the implementer followed the more specific
instruction. Reverted; the freeze is the binding rule, because it is what
lets a reviewer diff structure separately from prose and lets transcripts
stay true. Two live transcripts had already been silently falsified by the
uncaught change before the review that caught it — the exact drift the
document's own promise exists to prevent, closed with a served-title
assertion added to the adversarial test suite so it cannot recur silently
again.

**A file-path claim that would have failed the P2b rule outright, except
this time the grep happened before the plan shipped.** The plan named
`packages/domain-realm/src/schema/realms.ts` for the realm table; it lives
in `packages/db/src/schema/realms.ts`. Caught and corrected in the plan
before the implementer needed to detour around it — CLAUDE.md's rule
working as intended rather than as a postmortem.

**Ruling 1, reversed by Ruling 2, corrected again by Ruling 13.** The
pre-execution scan found Task 9 (the JWKS fetcher) had no consumer inside
P3a's own plan and deferred it to P3b; Task 1's spike then found the
Dynamic OP suite _does_ dereference `jwks_uri` during its own run and
pulled the fetcher back into P3a (Ruling 2); Task 12b's review then found
the suite wants it dereferenced at the _token_ endpoint (P3b), not at
registration, which is what actually determines when a fetch may safely
run (Ruling 13, above). Three rulings across the phase to answer one
question because each answered on a partial fact — the fetcher's mere
existence, not its calling site. The module itself was right from Ruling 1
onward; only where it plugs in kept moving.

## Parked minors: disposition

Fourteen items were explicitly parked across the phase's reviews. Each is
resolved below rather than left to be re-discovered.

**Fixed in this pass (documentation only):**

- _Task 8_ — ADR 0028's NAT64 clause claimed coverage of "the NAT64
  well-known and local-use prefixes (RFC 6052, RFC 8215)" outright, when
  the guard only unwraps and checks the `/96`-shaped embeddings under
  those prefixes — true-with-a-caveat, per the ledger's own naming of the
  gap. Corrected to say `/96`-shaped embeddings under those prefixes, and
  to name the non-`/96` case it does not cover (below) rather than leave
  it implied.
- _Task 9_ — commit `a2f3b4d`'s body cites "the Task 8 guard," a process
  reference CLAUDE.md bars from comments and, by the same reasoning, from
  commit messages. Not rewritten: it is already pushed history, and
  rewriting it would cost more than the reference itself. Recorded here so
  the decision not to rewrite is explicit rather than silent.
- _Task 11_ — the minor named a transcript citing ADR 0014 (fixed compose
  passwords) to justify pasting a live token verbatim. Checked against the
  current document: no such citation exists in
  `docs/request-paths.md`'s registration-token section as written — the
  concern does not reproduce against the merged text. No change needed.

**Spun off as immediate follow-ups, not deferred to a phase**:

- _Task 4_ — the three `authn-flows` renderers (`update-password-html.ts`,
  `recovery-codes-html.ts`, `passkey-enrolment-html.ts`) still carry a
  local `escapeHtml` instead of importing the package's shared one in
  `document.ts`. Mechanical, behaviour-preserving.

**Assigned to P3b**, because each concerns the JWKS fetcher and transport
Task 9/12a built and left unwired, and P3b is what wires them for
`private_key_jwt`:

- _Task 9_ — `expiresAt` was computed from the pre-fetch clock, so a slow
  fetch shortened its own cache TTL by the fetch duration. Fixed:
  `client-keys.ts` now reads the clock after the fetch resolves.
- _Task 9_ — there was no in-flight coalescing, so two concurrent fetches
  of one URI both reached the network. Fixed: concurrent fetches of one
  URI now join a single attempt.
- _Task 12b_ — the `jwks_uri`-shape test at registration would also pass a
  build that catches a fetch failure and proceeds; it discriminates the
  specific reversal Ruling 13 found, not every variant of it. Worth
  strengthening once the fetcher has a real caller to test end to end.

**Already resolved, no action needed** — checked directly rather than
assumed:

- _Task 12a_ — `ClientKeyResponse`/`ClientKeyRequest` were flagged as
  structurally re-declared in `apps/server` instead of imported.
  `apps/server/src/client-key-transport.ts` now imports both types from
  `@odudu/protocol-oidc` directly; Task 12b's export work closed this
  before the phase ended.

**Dropped, with reasons** — low risk, narrow blast radius, not worth a
phase slot:

- _Task 8_ — RFC 6052 §2.2 non-`/96` embeddings under `64:ff9b:1::/48`
  (e.g. `64:ff9b:1:7f00:0:1::`) reach the ordinary IPv6 check unrecognised
  as IPv4, since the guard only unwraps the `/96` form. It needs an unusual
  RFC 6052 deployment to exploit (§2.2 permits several other prefix
  lengths, none in ordinary use). Left for whoever next touches
  `remote-address.ts`'s IPv4-in-IPv6 table, alongside the `::/80` residue
  Ruling 10 now names above (`h[5]` neither `0` nor `0xffff`) — both are
  the same class of "unwrapped only at `/96`" gap and worth closing
  together rather than in two separate passes.
- _Task 2_ — the page-contract exit test exempts a file by basename rather
  than full path, so a same-named file anywhere else would also be exempt.
  True, and the directory structure this test polices has exactly three
  page-owning packages with no naming collision today; tighten it if a
  fourth package or a colliding filename ever appears, not before.
- _Task 3_ — no `tests/docs/` check compares a page's `<title>` against
  what its renderer actually produces, the gap that let the markup-freeze
  violation above reach two live transcripts before a human caught it.
  Genuinely worth having, but P4b rewrites every page's rendering path for
  theming and would need to re-derive this check's shape against whatever
  that retrofit lands on — building it now risks throwing it away in one
  phase. Left as a known gap for P4b to pick up alongside its own title
  handling.
- _Task 14_ — a test's comment cites two files as precedent for a testing
  deviation; only one actually holds (the other uses a different
  mechanism). The test itself is unaffected — only the comment overstates
  its lineage. Cosmetic; correct it whenever that file is next opened for
  an unrelated reason.
- _Task 17_ — the `auth_time` regression test leans on a real 1.1-second
  delay against JWT's one-second timestamp granularity: adequate margin
  today, not bulletproof under severe CI scheduling jitter. Watch for
  flakes; no action absent one.
