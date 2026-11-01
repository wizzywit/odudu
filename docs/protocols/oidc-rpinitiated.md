# OpenID Connect RP-Initiated Logout 1.0

**Status in Odudu:** `end_session_endpoint` is implemented — the
confirmation page (§2), both HTTP methods §2 requires, the `client_id`
cross-check (§2), the exact-match redirect rule (§3), and the discovery
advertisement (§2.1). What logout revokes, and why access tokens
are not on that list, is README.md's own section rather than a row here:
neither this specification nor RFC 9068 says anything normative about
access tokens, and the rule that does apply — Back-Channel Logout §2.7 —
already has its own file.

§1.1 (Requirements Notation) and §7 (IANA Considerations) impose nothing on
a deployment: the first is the notational convention every OpenID
specification opens with, and the second registers `end_session_endpoint`
and `post_logout_redirect_uris` in IANA's registries, stating no behaviour
beyond what §2.1 and §3.1 already do. Neither is rowed. The sentence in §2
that has the OP "notify any RPs logged in as that End-User that they are to
likewise log out" carries no RFC 2119 keyword and is not rowed here either;
the mechanism it points at is Back-Channel Logout 1.0, whose own table
(`docs/protocols/oidc-backchannel.md`) holds those obligations.

## Clause table

| Clause | Level  | Requirement                                                                                                                                              | Test ID                   | Status                                                                                                                                                                                            |
| ------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2      | MUST   | when both `client_id` and `id_token_hint` are present, the OP verifies that the Client Identifier matches the one used when issuing the ID Token         | `OIDC-RPINITIATED-2-04`   | covered                                                                                                                                                                                           |
| 2      | MUST   | the value of `post_logout_redirect_uri` has been previously registered with the OP                                                                       | `OIDC-RPINITIATED-3-01`   | covered                                                                                                                                                                                           |
| 2      | SHOULD | `post_logout_redirect_uri` uses the `https` scheme                                                                                                       | —                         | deferred: P4 — `post_logout_redirect_uris` is settable by `seed client` alone; dynamic registration does not read the member, so the scheme policy arrives with the admin surface that manages it |
| 2      | MAY    | `post_logout_redirect_uri` uses the `http` scheme where the Client Type is confidential and the OP allows it                                             | —                         | gap                                                                                                                                                                                               |
| 2      | MAY    | `post_logout_redirect_uri` uses an alternate scheme identifying a callback into a native application                                                     | —                         | gap                                                                                                                                                                                               |
| 2      | SHOULD | an `id_token_hint` is included when `post_logout_redirect_uri` is                                                                                        | —                         | n/a: addressed to the RP composing the logout request, not to the OP answering it                                                                                                                 |
| 2      | SHOULD | no error results when some or all of the locales requested through `ui_locales` are unsupported                                                          | —                         | n/a: `ui_locales` is not read at the Logout Endpoint, whose pages are served in one language, so no requested locale can produce an error                                                         |
| 2      | MUST   | the OP supports the HTTP `GET` and `POST` methods at the Logout Endpoint                                                                                 | `OIDC-RPINITIATED-2-03`   | covered                                                                                                                                                                                           |
| 2      | MUST   | when an `id_token_hint` is present, the OP validates that it was the issuer of the ID Token                                                              | `OIDC-RPINITIATED-2-02`   | covered                                                                                                                                                                                           |
| 2      | SHOULD | the OP accepts an ID Token whose `exp` has passed, where the RP identified by its `aud` and/or `sid` has a current or recent session                     | `OIDC-RPINITIATED-2-05`   | covered                                                                                                                                                                                           |
| 2      | SHOULD | a logout request whose `sid` does not correspond to a current or recent session is treated as suspect                                                    | `OIDC-RPINITIATED-2-01`   | covered                                                                                                                                                                                           |
| 2      | MAY    | the OP declines to act on a logout request whose `sid` does not correspond to a current or recent session                                                | —                         | accepted: "An expired hint is accepted, bound to the live session" — such a request asks the End-User rather than being declined                                                                  |
| 2      | SHOULD | at the Logout Endpoint, the OP asks the End-User whether to log out of the OP as well                                                                    | `OIDC-RPINITIATED-2-01`   | accepted: "A client may opt out" — a client with `skip_logout_confirmation` on is not asked, for a valid hint of its own that belongs to the current session                                      |
| 2      | MUST   | the OP asks the End-User to confirm logout if an `id_token_hint` was not provided, or if the supplied ID Token does not belong to the current OP session | `OIDC-RPINITIATED-2-01`   | covered                                                                                                                                                                                           |
| 2      | MUST   | if the End-User says "yes", the OP logs the End-User out                                                                                                 | `OIDC-RPINITIATED-2-01`   | covered                                                                                                                                                                                           |
| 2.1    | MUST   | `end_session_endpoint` is included in the OP's discovery response, RP-Initiated Logout and Discovery both being supported                                | `OIDC-RPINITIATED-2.1-01` | covered                                                                                                                                                                                           |
| 2.1    | MUST   | the advertised `end_session_endpoint` URL uses the `https` scheme                                                                                        | —                         | accepted: "The scheme in the advertised endpoint" — the path and authority are this server's, the scheme is whatever a terminating proxy asserts                                                  |
| 2.1    | MAY    | the advertised `end_session_endpoint` URL contains port, path and query parameter components                                                             | `OIDC-RPINITIATED-2.1-01` | covered                                                                                                                                                                                           |
| 3      | SHOULD | an `id_token_hint` carrying an ID Token for the RP is included when post-logout redirection is requested                                                 | —                         | n/a: addressed to the RP composing the logout request, not to the OP answering it                                                                                                                 |
| 3      | MUST   | with no `id_token_hint` supplied, the OP performs no post-logout redirection unless it has other means of confirming the target's legitimacy             | `OIDC-RPINITIATED-3-01`   | covered                                                                                                                                                                                           |
| 3      | MUST   | the OP does not perform post-logout redirection unless `post_logout_redirect_uri` exactly matches one of the client's registered values                  | `OIDC-RPINITIATED-3-01`   | covered                                                                                                                                                                                           |
| 3.1    | SHOULD | registered `post_logout_redirect_uris` use the `https` scheme                                                                                            | —                         | deferred: P4 — the same missing registration-time scheme policy as §2's own row on the request parameter                                                                                          |
| 3.1    | MAY    | registered `post_logout_redirect_uris` use the `http` scheme where the Client Type is confidential and the OP allows it                                  | —                         | gap                                                                                                                                                                                               |
| 4      | MUST   | when a validation procedure fails, any operation requiring the information that failed to validate is aborted                                            | `OIDC-RPINITIATED-3-01`   | covered                                                                                                                                                                                           |
| 4      | MUST   | information that failed to validate is not used                                                                                                          | `OIDC-RPINITIATED-2-04`   | covered                                                                                                                                                                                           |
| 4      | MUST   | when the OP detects errors in the logout request, it performs no post-logout redirection to an RP                                                        | `OIDC-RPINITIATED-3-01`   | covered                                                                                                                                                                                           |
| 4      | MAY    | the OP displays an error message in the page it renders instead                                                                                          | `OIDC-RPINITIATED-3-01`   | covered                                                                                                                                                                                           |
| 4      | MAY    | the OP asks the End-User whether to log out of the OP in that page                                                                                       | —                         | gap                                                                                                                                                                                               |
| 5      | MUST   | every feature this specification lists as REQUIRED or describes with a MUST is implemented                                                               | —                         | n/a: a restatement of every other MUST in this table rather than an obligation of its own; those rows are the record of which hold                                                                |
| 6      | SHOULD | the OP obtains explicit confirmation from the End-User before acting on a logout request with no valid `id_token_hint`                                   | `OIDC-RPINITIATED-2-01`   | covered                                                                                                                                                                                           |

## Reading note

§2 says the OP "SHOULD ask the End-User whether to log out of the OP as
well", and makes the question a MUST when the hint is missing or "does not
belong to the current OP session". Odudu asks whenever a session is present,
whatever the hint is, except for a client whose operator turned the question
off (below). Skipping it on a hint that matched would otherwise let anyone
holding a leaked ID Token force a sign-out by a `GET`, which a cross-site
image or link can send. `decideLogout`
(`packages/protocol-oidc/src/usecase/logout.ts`) therefore returns `confirm`
for every request that finds a session, and ends only when there is no
session and the requested redirect is registered, or for the opt-out below.
The form's `POST` ends a session too (`handleLogoutConfirmation`); both paths
apply §3's redirect rule through the same `endAndAnswer`.

**The hint identifies the session; by default it never licenses ending it.** A
hint's `sid` claim (Back-Channel Logout §2.1) is looked up among the sessions
the browser's cookies resolve to, so the page asks about the session the
End-User's RP meant when a browser holds several, and `mostRecentlyActive`
is the fallback for a hint that names nothing usable. A hint with no `sid`
falls to that fallback and is never compared by subject: the one current token
without `sid` is an `offline_access` grant's, which has no session to name.
For a client with `skip_logout_confirmation` off, the default, a valid hint,
an expired one, one whose `sid` matches the cookie's session and one whose
`sid` names another all produce the same page; a client that has opted out
(below) is the one case where a valid hint changes the outcome.

§3's "exactly match" is deliberately not URL-normalized. A trailing slash,
a query string, or a case difference in the host all fail the match —
`decideRedirect`'s test cases (`logout.test.ts`) enumerate exactly those,
because each is a plausible "surely this still counts" mistake to make
implementing this clause. The consequence spelled out in the design spec
and worth repeating here: **a refused redirect still ends the session.**
Nothing in §3 says a redirect the OP cannot validate should also keep the
session alive, and treating an untrusted return URL as a reason not to log
out would make the redirect check load-bearing for something it was never
meant to guard.

**§3 forbids redirecting to an unmatched URI; it says nothing against
honouring a matched one with no session to end.** An RP that sends a user
to logout after their session has already idled out would otherwise strand
them on an OP page with no way back — so `decideLogout` still redirects
when `post_logout_redirect_uri` exactly matches the client's own
registration, even with no live session, which is what Keycloak does too.

### A client may opt out

A client with `skip_logout_confirmation` on is
signed out without the page when the request carries an `id_token_hint` that
verifies, whose single audience is that client and whose `sid` is the session
the browser holds; no hint, a hint that does not verify, one for another
client or session, and every client with the setting off still ask, so a valid hint of its own is the only request that is not asked about. This
deviates from the SHOULD at the operator's request and for the client's own
hint only, because the setting exists for a relying party whose ID token never
reaches a browser, such as the console's. An expired hint still counts, as it
does for every logout hint, so the residual risk is that anyone holding any
ID Token ever issued to such a client for a live session can force that
sign-out. Dynamic registration refuses the field, and only the admin API sets
it (ADR 0047).

### A matched redirect waits for the front-channel frames

§3 says where the OP sends the browser once the session has ended; Front-Channel
Logout 1.0 §3 says the OP reaches the relying parties of that session through a
page of `<iframe>` tags. A `302` at once leaves before any frame loads, so an
app registered only for front-channel logout would keep its own session.
`respondToOutcome` therefore answers `200` with `renderLoggedOutRedirectPage`
whenever a matched redirect comes with at least one `frontchannel_logout_uri`
to frame, and a `302` straight away when there is none.

The page leaves by script when every frame has loaded or after two seconds,
whichever comes first. The script reads the target from the page's own link,
so nothing is spliced into it. The policy takes its `script-src` from the nonce
the renderer returns (ADR 0018's amendment). A browser that does not run
script is moved on by a `<meta http-equiv="refresh">` after five seconds; a
meta refresh is not a script or a form, so the policy that blocks everything
inline does not stop it. The target is the one `decideRedirect` already matched,
with `state` added, so no unregistered address is reachable this way.

Two limits. The two seconds are a ceiling: leaving cancels a frame still in
flight, so a slow relying party may not finish clearing its session. And the
`refresh` element sits in the page body, which HTML does not allow; browsers
honour it there (observed in Chromium), and the script path does not depend on it.

The session ends before the page renders, so a replay of the same request finds
no session and, the redirect still matching, answers `302`: nothing is ended
twice and no frame is shown again. `frame-src` names the origins of the framed
URIs only, because a source expression with a path is not an origin and the
policy's one builder takes origins. At most 25 clients are framed
(`MAX_FRONT_CHANNEL_FRAMES`), chosen in client-id order, where a tenant's
session could otherwise reach all 10,000; the rest are still told by
back-channel logout where they registered one. A `frontchannel_logout_uri`
that is not `http` or `https` is never framed. Covered by
`[OIDC-FRONTCHANNEL-3-REDIRECT-01]` and its neighbours in
`frontchannel-logout.int.test.ts`.

### The exact registration match is §3's "other means"

§3 has two prohibitions, and only one of them is about the value matching.
The first fires when no hint is supplied at all: the OP "MUST NOT perform
post-logout redirection unless the OP has other means of confirming the
legitimacy of the post-logout redirection target." The exact, unnormalized
comparison against the values the client itself registered is that other
means, and it is the only means Odudu has — a redirect target is honoured
because the client registered it, never because a hint vouched for it.
That is why a hintless logout still redirects once the value matches
(`logout.int.test.ts`'s no-session redirect case) and why a mismatching
value is refused whether a hint accompanied it or not.

### A hint with no `client_id` names its client by its audience

§2 makes `client_id` optional and the hint recommended whenever a redirect is
requested, so an RP that sends only `id_token_hint` and
`post_logout_redirect_uri` is following the text. §3's registration match
needs a client to match against, and a hint that verified already names the
one it was issued to. `handleLogoutRequest` takes that client from the hint's
`aud` when `client_id` is absent and the hint has exactly one audience; a hint
with several says nowhere which of them is asking, so none is used and the
redirect is refused with the session still ended. An audience that is no client
of this tenant resolves to no registered address, the same refusal. When
`client_id` is present nothing changes: the pair must agree, as above.

The resolved client, not the parameter, goes into the confirmation form, so
the form's own POST finds the same registered list. `exp` is judged no more
here than with a `client_id`: the hint only identifies the client and the
session. Covered by `[ODUDU-LOGOUT-HINT-CLIENT-01]` in `logout.int.test.ts`.
The OIDF plans in `infra/conformance` (basic, config, dynamic OP) include no
RP-initiated logout test, so no plan variant exercises this path.

### The scheme in the advertised endpoint

`end_session_endpoint` is built by the same `tenantIssuerFor` the issuer
identifier is (`packages/protocol-oidc/src/view/issuer.ts`), so its
authority and path are this server's own, and §2.1's `https` demand is
unmet in exactly one component: the scheme is whatever the request arrived
under, which behind the TLS-terminating proxy Odudu expects is whatever
that proxy asserts through `X-Forwarded-Proto` with `ODUDU_TRUST_PROXY`
on. `docs/protocols/rfc9207.md`'s own note declines to treat that operator
assertion as proof, and this row takes the same position rather than
closing on a test of the components a test can see. What would close it is
a scheme this process establishes rather than reads off a forwarded
header.

### An expired hint is accepted, bound to the live session

§2 asks the OP to "accept ID Tokens when the RP identified by the ID
Token's `aud` claim and/or `sid` claim has a current session or had a
recent session at the OP, even when the `exp` time has passed." The
logout door reads its hint through `subjectOfLogoutHint`
(`packages/protocol-oidc/src/usecase/authorization-request.ts`), which is
`subjectOfIdTokenHint` with `verifyJwt`'s `expiry: EXPIRY_NOT_ENFORCED`
named. Everything else is judged as before: a signature by one of the
tenant's publishable keys, `iss`, `typ` absent, `sub` present, and `exp`
**present** (OIDC Core §2 makes it required, so a token with none is not an
ID Token). `aud` is compared against `client_id` in `handleLogoutRequest`
as it always was. The option is a named symbol, not a flag. Only this door
and `/authorize` (`docs/protocols/oidc-core.md`, where the hint merely
constrains the login) name it; the token-exchange subject check and every
other `verifyJwt` caller omit it and still refuse a lapsed token
(`token-exchange.int.test.ts` pins token exchange doing so).

**No age cap, because the session is the bound.** A lapsed hint only
identifies a session: it selects the live session its `sid` equals among this
browser's own cookies, and the End-User is asked about that session exactly as
for an unexpired hint. A session is bounded by the tenant's idle and maximum
lifetimes, so the hint identifies for exactly as long as the session it names
and no longer. A cap would shorten a session's own life for one door only, and
every number it could take is arbitrary against tenants that configure those
lifetimes themselves. A leaked ID Token, lapsed or not, cannot end a session
by itself, because the page asks and the form's anti-forgery token is derived
from the cookie's own secret; the hint travels in a query string, so it can
still reach logs and history, and the same token cannot be exchanged,
introspected or used as a bearer credential.

What a lapsed hint still cannot do, each case a test: carry a forged
signature, another issuer or another tenant's key, a `typ` header, an
`aud` that disagrees with `client_id`, no `sub`, no `exp`, or `alg: none`;
name a session the browser does not hold or that already ended; or arrive
with no session cookie. Each is treated as no hint: the page asks, about the
most recently active session where there is one. A hint signed
by a **retired** key is among them: `listPublishableKeys` omits retired keys,
so the `kid` resolves to nothing and the request falls to the confirmation
page. Rotation alone does not do this: `promote` leaves the previous key
`rotating`, which is still published and still verifies. Only an operator's
explicit `key.retire` (`packages/protocol-admin/src/usecase/keys.ts`) makes
a key unpublished, and nothing retires one automatically (`not_after` is not
consulted). Such a hint then identifies no session by `sid`, so the page asks
about the most recently active one.

A request whose `sid` names no live session of the browser is answered
with the confirmation page rather than declined outright: §2's "MAY
decline" is permission, and asking is the more conservative of the two
outcomes it leaves open.

The audit trail does not tell the two apart. Ending a session on either
hint writes the same `session.ended` row with `detail: {via: 'logout'}`;
the audit vocabulary records no hint outcome and this change adds none.

### One endpoint, two methods, and `session_id` as the discriminator

§2 requires both: "OpenID Providers MUST support the use of the HTTP `GET`
and `POST` methods defined in RFC 7231 at the Logout Endpoint", an RP
being free to Form-Serialize the request parameters into a body instead of
a query string. Two different messages therefore arrive at the same
`POST`: the confirmation form submitting back, and a logout request. The
form's hidden `session_id` is what tells them apart — only the page Odudu
rendered carries it — so a body with that field takes the confirmation
path and a body without it is read as a logout request, through the same
`handleLogoutRequest` a `GET` reaches. `logoutRequestParams`
(`view/routes/logout.ts`) is the one place either method's parameters are
read, because two readers are how the two methods would drift into
answering the same request differently.

The `session_id` itself is no defence: it is the session's public id, the
`sid` every token for the session carries. What makes a confirmation
unforgeable is the form's `csrf` field, an HMAC over the session id keyed by
the secret half of the cookie's entry, recomputed by the `POST` from the
entry the browser presents; `SameSite=Lax` and the check that `session_id`
names a session the cookie resolves to stand beside it. A forged `POST` with
no token is refused exactly as a non-member `session_id` is, and one with no
`session_id` lands on the request path, where the answer to a hintless
request is the confirmation page and nothing is ended. What changes is that
the same request now gets the same answer either way, which is what the
`[OIDC-RPINITIATED-2-03]` tests assert by driving every property — the
confirmation triggers, the exact-match refusal, the ended session, the
cleared cookie — over both methods rather than over `GET` alone.

### A `client_id` that disagrees with the hint is an error, not a tie-break

§2's `client_id` parameter is optional, and the sentence that makes it
load-bearing is: "When both `client_id` and `id_token_hint` are present,
the OP MUST verify that the Client Identifier matches the one used when
issuing the ID Token." `subjectOfIdTokenHint` returns the hint's `aud`
values for exactly this comparison — it still checks no audience of its
own, since an OP reading its own ID Token back is not the principal RFC
7519 §4.1.3 addresses — and `handleLogoutRequest` compares the parameter
against them.

A pair that disagrees is a validation failure, so §4 governs what happens
next: "the information that failed to validate MUST NOT be used", and the
OP "MUST not perform post-logout redirection". Both halves are dropped
together — the hint proves nothing, and the `post_logout_redirect_uri` it
would have authorised is not carried into the confirmation form either,
even where that value is registered to the `client_id` given. Ending the
session on the strength of a disagreeing pair would be worse than
refusing: a client that can quote another client's ID Token is the case
the comparison exists to catch, and the honest answer to it is to ask the
End-User.

A hint carrying no `aud` claim at all reaches the same refusal: `aud`
absent reads as `[]`, which cannot include a `client_id` that was given,
so the comparison is already `true` against it.
